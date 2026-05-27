-- 1. Restrict profile reads to authenticated users only
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by authenticated users"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

REVOKE SELECT ON public.profiles FROM anon;

-- 2. Guard against self-reported progress cheating
CREATE OR REPLACE FUNCTION public.validate_profile_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_delta INTEGER := 50; -- max kills that can be reported per update
  lvl INTEGER;
  k TEXT;
  allowed_keys TEXT[] := ARRAY['damage','cooldown','speed','health'];
BEGIN
  -- user_id is immutable
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id cannot be changed';
  END IF;

  -- kill_points must be non-negative and can only grow by a bounded amount
  IF NEW.kill_points IS NULL OR NEW.kill_points < 0 THEN
    NEW.kill_points := COALESCE(OLD.kill_points, 0);
  END IF;
  IF NEW.kill_points > COALESCE(OLD.kill_points, 0) + max_delta THEN
    NEW.kill_points := COALESCE(OLD.kill_points, 0) + max_delta;
  END IF;

  -- upgrades must be a json object with only known keys clamped to 0..5,
  -- and each level can only increase by at most 1 per update.
  IF NEW.upgrades IS NULL OR jsonb_typeof(NEW.upgrades) <> 'object' THEN
    NEW.upgrades := COALESCE(OLD.upgrades, '{"damage":0,"cooldown":0,"speed":0,"health":0}'::jsonb);
  END IF;

  FOREACH k IN ARRAY allowed_keys LOOP
    lvl := COALESCE((NEW.upgrades->>k)::int, 0);
    IF lvl < 0 THEN lvl := 0; END IF;
    IF lvl > 5 THEN lvl := 5; END IF;
    -- prevent jumping more than +1 per update
    IF lvl > COALESCE((OLD.upgrades->>k)::int, 0) + 1 THEN
      lvl := COALESCE((OLD.upgrades->>k)::int, 0) + 1;
    END IF;
    NEW.upgrades := jsonb_set(NEW.upgrades, ARRAY[k], to_jsonb(lvl), true);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_profile_progress_trigger ON public.profiles;
CREATE TRIGGER validate_profile_progress_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.validate_profile_progress();