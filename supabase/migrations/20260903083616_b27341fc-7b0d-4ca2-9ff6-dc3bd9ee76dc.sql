CREATE OR REPLACE FUNCTION public.validate_profile_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_delta INTEGER := 50;
  lvl INTEGER;
  cap INTEGER;
  k TEXT;
  allowed_keys TEXT[] := ARRAY['damage','cooldown','speed','health','armour'];
  allowed_weapons TEXT[] := ARRAY[
    'pistol','shotgun','sniper','rocket','mine','sword',
    'tracking_missile','nuke','grenade','mini_soldiers',
    'dual_pistols','chain','battleaxe','spear',
    'army','smg','flak','crossbow',
    'laser','railgun','plasma','flamethrower','minigun','boomerang','shuriken',
    'katana','warhammer','scythe','revolver','autoshotgun','grenade_launcher',
    'cluster_bomb','freeze_ray','poison_dart','lightning','blackhole','turret',
    'drone_swarm','javelin','bazooka','icicle','acid_spitter','gauss_rifle'
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
    NEW.upgrades := COALESCE(OLD.upgrades, '{"damage":0,"cooldown":0,"speed":0,"health":0,"armour":0}'::jsonb);
  END IF;

  FOREACH k IN ARRAY allowed_keys LOOP
    IF k IN ('damage','cooldown','armour') THEN cap := 20; ELSE cap := 5; END IF;
    lvl := COALESCE((NEW.upgrades->>k)::int, 0);
    IF lvl < 0 THEN lvl := 0; END IF;
    IF lvl > cap THEN lvl := cap; END IF;
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
    ) s;
    IF k = 'hotbar' AND jsonb_array_length(cleaned) > 4 THEN
      SELECT jsonb_agg(value) INTO cleaned
      FROM (SELECT value FROM jsonb_array_elements(cleaned) WITH ORDINALITY AS t(value, idx) ORDER BY idx LIMIT 4) s;
    END IF;
    IF k = 'inventory' AND jsonb_array_length(cleaned) > 18 THEN
      SELECT jsonb_agg(value) INTO cleaned
      FROM (SELECT value FROM jsonb_array_elements(cleaned) WITH ORDINALITY AS t(value, idx) ORDER BY idx LIMIT 18) s;
    END IF;
    IF k = 'inventory' THEN NEW.inventory := cleaned;
    ELSIF k = 'storage_weapons' THEN NEW.storage_weapons := cleaned;
    ELSIF k = 'hotbar' THEN NEW.hotbar := cleaned;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_profile_progress() FROM PUBLIC, anon, authenticated;