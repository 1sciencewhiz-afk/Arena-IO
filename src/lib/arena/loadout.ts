import { useEffect, useMemo, useState } from "react";
import {
  ZERO_UPGRADES,
  STARTING_WEAPONS,
  MAX_INVENTORY,
  MAX_HOTBAR,
  isWeaponId,
  isGearId,
  type GearCounts,
  type Upgrades,
  type WeaponId,
} from "@/lib/arena/weapons";
import { useProfile, saveProfileProgress, sanitizeGear } from "@/lib/arena/auth";

export type Loadout = {
  killPoints: number;
  upgrades: Upgrades;
  inventory: WeaponId[]; // playable; max MAX_INVENTORY
  storage: WeaponId[];   // overflow; only swappable in lobby
  hotbar: WeaponId[];    // max MAX_HOTBAR; subset of inventory
  gear: GearCounts;      // store-bought utility items, unlimited
};

const GUEST_KEY = "arena.loadout.v1";

export function defaultLoadout(): Loadout {
  return {
    killPoints: 0,
    upgrades: { ...ZERO_UPGRADES },
    inventory: [...STARTING_WEAPONS],
    storage: [],
    hotbar: [...STARTING_WEAPONS],
    gear: {},
  };
}

function readGuest(): Loadout {
  if (typeof window === "undefined") return defaultLoadout();
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return defaultLoadout();
    const j = JSON.parse(raw);
    const def = defaultLoadout();
    return {
      killPoints: Math.max(0, Number(j.killPoints) || 0),
      upgrades: { ...def.upgrades, ...(j.upgrades ?? {}) },
      inventory: Array.isArray(j.inventory) ? j.inventory.filter(isWeaponId) : def.inventory,
      storage: Array.isArray(j.storage) ? j.storage.filter(isWeaponId) : def.storage,
      hotbar: (Array.isArray(j.hotbar) ? j.hotbar.filter(isWeaponId) : def.hotbar).slice(0, MAX_HOTBAR),
      gear: sanitizeGear(j.gear),
    };
  } catch {
    return defaultLoadout();
  }
}

function writeGuest(l: Loadout) {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

export function useLoadout(userId: string | null) {
  const { profile, refresh } = useProfile(userId);
  const [guest, setGuest] = useState<Loadout>(() => defaultLoadout());

  // Hydrate guest state after mount to avoid SSR mismatch
  useEffect(() => {
    if (!userId) setGuest(readGuest());
  }, [userId]);

  const loadout: Loadout = useMemo(() => {
    if (userId && profile) {
      return {
        killPoints: profile.kill_points,
        upgrades: profile.upgrades,
        inventory: profile.hotbar.filter((w) => !isGearId(w)).slice(0, MAX_HOTBAR),
        storage: [],
        hotbar: profile.hotbar.filter((w) => !isGearId(w)).slice(0, MAX_HOTBAR),
        gear: profile.gear,
      };
    }
    return guest;
  }, [userId, profile, guest]);

  const ready = !userId || !!profile;

  const update = async (patch: Partial<Loadout>) => {
    const next: Loadout = { ...loadout, ...patch };
    // Enforce invariants
    // Players carry only their hotbar (max 4 weapons); no storage.
    next.hotbar = next.hotbar.filter((w, i, a) => !isGearId(w) && a.indexOf(w) === i).slice(0, MAX_HOTBAR);
    next.inventory = [...next.hotbar].slice(0, MAX_INVENTORY);
    next.storage = [];
    if (next.hotbar.length === 0 && next.inventory.length > 0) {
      next.hotbar = [next.inventory[0]];
    }

    if (userId) {
      await saveProfileProgress(userId, {
        kill_points: next.killPoints,
        upgrades: next.upgrades,
        inventory: next.inventory,
        storage_weapons: next.storage,
        hotbar: next.hotbar,
        gear: next.gear,
      });
      refresh();
    } else {
      setGuest(next);
      writeGuest(next);
    }
  };

  return { loadout, update, ready };
}
