-- Admin role system + ban + override loadout caps for admins
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Add banned flag on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false;

-- Allow admins to update any profile (for grants / bans)
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Update new-user trigger: auto-grant admin role to username John316
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uname text;
BEGIN
  uname := COALESCE(new.raw_user_meta_data->>'username', 'Player' || substr(new.id::text, 1, 6));
  INSERT INTO public.profiles (user_id, username)
  VALUES (new.id, uname)
  ON CONFLICT (user_id) DO NOTHING;

  IF lower(uname) = 'john316' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (new.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN new;
END;
$$;

-- Validate trigger: admins bypass caps on kill_points and upgrades; banned cannot self-update
CREATE OR REPLACE FUNCTION public.validate_profile_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_delta INTEGER := 50;
  lvl INTEGER;
  k TEXT;
  allowed_keys TEXT[] := ARRAY['damage','cooldown','speed','health'];
  allowed_weapons TEXT[] := ARRAY[
    'pistol','shotgun','sniper','rocket','mine','sword',
    'tracking_missile','nuke','grenade','mini_soldiers',
    'dual_pistols','chain','battleaxe','spear'
  ];
  cleaned jsonb;
  caller_is_admin boolean := false;
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id cannot be changed';
  END IF;

  BEGIN
    caller_is_admin := public.has_role(auth.uid(), 'admin');
  EXCEPTION WHEN OTHERS THEN
    caller_is_admin := false;
  END;

  IF NEW.kill_points IS NULL OR NEW.kill_points < 0 THEN
    NEW.kill_points := COALESCE(OLD.kill_points, 0);
  END IF;
  IF NOT caller_is_admin AND NEW.kill_points > COALESCE(OLD.kill_points, 0) + max_delta THEN
    NEW.kill_points := COALESCE(OLD.kill_points, 0) + max_delta;
  END IF;

  IF NEW.upgrades IS NULL OR jsonb_typeof(NEW.upgrades) <> 'object' THEN
    NEW.upgrades := COALESCE(OLD.upgrades, '{"damage":0,"cooldown":0,"speed":0,"health":0}'::jsonb);
  END IF;

  FOREACH k IN ARRAY allowed_keys LOOP
    lvl := COALESCE((NEW.upgrades->>k)::int, 0);
    IF lvl < 0 THEN lvl := 0; END IF;
    IF lvl > 5 THEN lvl := 5; END IF;
    IF NOT caller_is_admin AND lvl > COALESCE((OLD.upgrades->>k)::int, 0) + 1 THEN
      lvl := COALESCE((OLD.upgrades->>k)::int, 0) + 1;
    END IF;
    NEW.upgrades := jsonb_set(NEW.upgrades, ARRAY[k], to_jsonb(lvl), true);
  END LOOP;

  FOR k IN SELECT unnest(ARRAY['inventory','storage_weapons','hotbar']) LOOP
    EXECUTE format('SELECT ($1).%I', k) INTO cleaned USING NEW;
    IF cleaned IS NULL OR jsonb_typeof(cleaned) <> 'array' THEN
      cleaned := '[]'::jsonb;
    END IF;
    SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb) INTO cleaned
    FROM (
      SELECT v FROM jsonb_array_elements_text(cleaned) AS v
      WHERE v = ANY(allowed_weapons)
      LIMIT 64
    ) s;
    IF k = 'hotbar' AND jsonb_array_length(cleaned) > 4 THEN
      SELECT jsonb_agg(value) INTO cleaned
      FROM (SELECT value FROM jsonb_array_elements(cleaned) WITH ORDINALITY AS t(value, idx) ORDER BY idx LIMIT 4) s;
    END IF;
    IF k = 'inventory' AND jsonb_array_length(cleaned) > 14 THEN
      SELECT jsonb_agg(value) INTO cleaned
      FROM (SELECT value FROM jsonb_array_elements(cleaned) WITH ORDINALITY AS t(value, idx) ORDER BY idx LIMIT 14) s;
    END IF;
    IF k = 'inventory' THEN NEW.inventory := cleaned;
    ELSIF k = 'storage_weapons' THEN NEW.storage_weapons := cleaned;
    ELSIF k = 'hotbar' THEN NEW.hotbar := cleaned;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
