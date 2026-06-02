import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ZERO_UPGRADES,
  STARTING_WEAPONS,
  isWeaponId,
  type Upgrades,
  type WeaponId,
} from "@/lib/arena/weapons";

export type Profile = {
  user_id: string;
  username: string;
  kill_points: number;
  upgrades: Upgrades;
  inventory: WeaponId[];
  storage_weapons: WeaponId[];
  hotbar: WeaponId[];
  banned: boolean;
};

function usernameToEmail(username: string) {
  return `${username.toLowerCase().replace(/[^a-z0-9_]/g, "_")}@arena.local`;
}

function sanitizeWeaponArr(v: unknown, fallback: WeaponId[]): WeaponId[] {
  if (!Array.isArray(v)) return [...fallback];
  const out: WeaponId[] = [];
  for (const x of v) if (isWeaponId(x) && !out.includes(x)) out.push(x);
  return out.length ? out : [...fallback];
}

export function useAuthUser() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  return { userId, ready };
}

export function useProfile(userId: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!userId) { setProfile(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, username, kill_points, upgrades, inventory, storage_weapons, hotbar, banned")
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled && data) {
        const inventory = sanitizeWeaponArr(data.inventory, STARTING_WEAPONS);
        const hotbar = sanitizeWeaponArr(data.hotbar, [inventory[0] ?? "pistol"])
          .filter((w) => inventory.includes(w))
          .slice(0, 4);
        setProfile({
          user_id: data.user_id,
          username: data.username,
          kill_points: data.kill_points,
          upgrades: { ...ZERO_UPGRADES, ...(data.upgrades as Upgrades) },
          inventory,
          storage_weapons: sanitizeWeaponArr(data.storage_weapons, []),
          hotbar: hotbar.length ? hotbar : [inventory[0] ?? "pistol"],
          banned: !!(data as { banned?: boolean }).banned,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [userId, version]);

  return { profile, refresh };
}

export async function signUpWithUsername(username: string, password: string) {
  const trimmed = username.trim();
  if (trimmed.length < 3) throw new Error("Username must be at least 3 characters");
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) throw new Error("Username can only contain letters, numbers, and _");
  if (password.length < 6) throw new Error("Password must be at least 6 characters");

  const { data: existing } = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("username", trimmed)
    .maybeSingle();
  if (existing) throw new Error("Username is already taken");

  const { error } = await supabase.auth.signUp({
    email: usernameToEmail(trimmed),
    password,
    options: { data: { username: trimmed } },
  });
  if (error) throw error;
}

export async function signInWithUsername(username: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username.trim()),
    password,
  });
  if (error) throw new Error("Invalid username or password");
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function saveProfileProgress(
  userId: string,
  patch: {
    kill_points?: number;
    upgrades?: Upgrades;
    inventory?: WeaponId[];
    storage_weapons?: WeaponId[];
    hotbar?: WeaponId[];
  },
) {
  await supabase.from("profiles").update(patch).eq("user_id", userId);
}
