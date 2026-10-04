ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gear jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.validate_profile_gear()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  k TEXT;
  n INTEGER;
  out jsonb := '{}'::jsonb;
BEGIN
  IF NEW.gear IS NULL OR jsonb_typeof(NEW.gear) <> 'object' THEN
    NEW.gear := '{}'::jsonb;
  END IF;
  FOREACH k IN ARRAY ARRAY['heal_beacon','smoke_grenade','emp','flashbang','barricade','energy_shield'] LOOP
    BEGIN
      n := COALESCE((NEW.gear->>k)::int, 0);
    EXCEPTION WHEN OTHERS THEN n := 0;
    END;
    IF n < 0 THEN n := 0; END IF;
    IF n > 9999 THEN n := 9999; END IF;
    IF n > 0 THEN out := out || jsonb_build_object(k, n); END IF;
  END LOOP;
  NEW.gear := out;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_profile_gear_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_gear();