-- Add weapon inventory + hotbar storage on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS inventory jsonb NOT NULL DEFAULT '["pistol"]'::jsonb,
  ADD COLUMN IF NOT EXISTS storage_weapons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hotbar jsonb NOT NULL DEFAULT '["pistol"]'::jsonb;

-- Replace validation trigger so it also bounds/sanitises the new weapon arrays.
CREATE OR REPLACE FUNCTION public.validate_profile_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  item text;
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id cannot be changed';
  END IF;

  IF NEW.kill_points IS NULL OR NEW.kill_points < 0 THEN
    NEW.kill_points := COALESCE(OLD.kill_points, 0);
  END IF;
  IF NEW.kill_points > COALESCE(OLD.kill_points, 0) + max_delta THEN
    NEW.kill_points := COALESCE(OLD.kill_points, 0) + max_delta;
  END IF;

  IF NEW.upgrades IS NULL OR jsonb_typeof(NEW.upgrades) <> 'object' THEN
    NEW.upgrades := COALESCE(OLD.upgrades, '{"damage":0,"cooldown":0,"speed":0,"health":0}'::jsonb);
  END IF;

  FOREACH k IN ARRAY allowed_keys LOOP
    lvl := COALESCE((NEW.upgrades->>k)::int, 0);
    IF lvl < 0 THEN lvl := 0; END IF;
    IF lvl > 5 THEN lvl := 5; END IF;
    IF lvl > COALESCE((OLD.upgrades->>k)::int, 0) + 1 THEN
      lvl := COALESCE((OLD.upgrades->>k)::int, 0) + 1;
    END IF;
    NEW.upgrades := jsonb_set(NEW.upgrades, ARRAY[k], to_jsonb(lvl), true);
  END LOOP;

  -- Sanitise weapon arrays: must be jsonb arrays of allowed weapon ids only.
  FOR k IN SELECT unnest(ARRAY['inventory','storage_weapons','hotbar']) LOOP
    IF NEW IS NOT NULL THEN
      EXECUTE format('SELECT ($1).%I', k) INTO cleaned USING NEW;
      IF cleaned IS NULL OR jsonb_typeof(cleaned) <> 'array' THEN
        cleaned := '[]'::jsonb;
      END IF;
      -- Filter to allowed weapons, dedupe-preserve-order, cap length.
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
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Ensure trigger is attached (was implied earlier; safe to re-create)
DROP TRIGGER IF EXISTS validate_profile_progress_trg ON public.profiles;
CREATE TRIGGER validate_profile_progress_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_progress();