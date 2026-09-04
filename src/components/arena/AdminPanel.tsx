import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ALL_WEAPONS, WEAPONS, MAX_INVENTORY, isWeaponId, type WeaponId } from "@/lib/arena/weapons";

type AdminPlayer = {
  user_id: string;
  username: string;
  kill_points: number;
  banned: boolean;
  inventory: WeaponId[];
  storage_weapons: WeaponId[];
};

export function AdminPanel() {
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [grantAmount, setGrantAmount] = useState<Record<string, string>>({});
  const [grantWeapon, setGrantWeapon] = useState<Record<string, WeaponId>>({});
  const [takeWeapon, setTakeWeapon] = useState<Record<string, WeaponId>>({});

  const load = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, username, kill_points, banned, inventory, storage_weapons")
      .order("kill_points", { ascending: false })
      .limit(200);
    if (!data) return;
    setPlayers(
      data.map((p) => ({
        user_id: p.user_id,
        username: p.username,
        kill_points: p.kill_points,
        banned: !!p.banned,
        inventory: Array.isArray(p.inventory) ? (p.inventory as unknown[]).filter(isWeaponId) : [],
        storage_weapons: Array.isArray(p.storage_weapons) ? (p.storage_weapons as unknown[]).filter(isWeaponId) : [],
      })),
    );
  };

  useEffect(() => { void load(); }, []);

  const grantPoints = async (p: AdminPlayer) => {
    const amt = parseInt(grantAmount[p.user_id] ?? "10", 10);
    if (!Number.isFinite(amt)) return;
    setBusy(p.user_id);
    await supabase.from("profiles")
      .update({ kill_points: Math.max(0, p.kill_points + amt) })
      .eq("user_id", p.user_id);
    setBusy(null);
    await load();
  };

  const grantWeaponTo = async (p: AdminPlayer) => {
    const w = grantWeapon[p.user_id];
    if (!w) return;
    const owned = new Set([...p.inventory, ...p.storage_weapons]);
    if (owned.has(w)) return;
    const inv = [...p.inventory];
    const stor = [...p.storage_weapons];
    if (inv.length < MAX_INVENTORY) inv.push(w); else stor.push(w);
    setBusy(p.user_id);
    await supabase.from("profiles")
      .update({ inventory: inv, storage_weapons: stor })
      .eq("user_id", p.user_id);
    setBusy(null);
    await load();
  };

  const takeWeaponFrom = async (p: AdminPlayer) => {
    const w = takeWeapon[p.user_id];
    if (!w) return;
    const inv = p.inventory.filter((x) => x !== w);
    const stor = p.storage_weapons.filter((x) => x !== w);
    setBusy(p.user_id);
    await supabase.from("profiles")
      .update({ inventory: inv.length ? inv : ["pistol"], storage_weapons: stor, hotbar: ["pistol"] })
      .eq("user_id", p.user_id);
    setBusy(null);
    await load();
  };

  const stripAllWeapons = async (p: AdminPlayer) => {
    setBusy(p.user_id);
    await supabase.from("profiles")
      .update({ inventory: ["pistol"], storage_weapons: [], hotbar: ["pistol"] })
      .eq("user_id", p.user_id);
    setBusy(null);
    await load();
  };

  const resetPoints = async (p: AdminPlayer) => {
    setBusy(p.user_id);
    await supabase.from("profiles").update({ kill_points: 0 }).eq("user_id", p.user_id);
    setBusy(null);
    await load();
  };

  const toggleBan = async (p: AdminPlayer) => {
    setBusy(p.user_id);
    await supabase.from("profiles").update({ banned: !p.banned }).eq("user_id", p.user_id);
    setBusy(null);
    await load();
  };

  const filtered = players.filter((p) =>
    !filter.trim() || p.username.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="rounded-xl border-2 border-yellow-500/40 bg-yellow-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
              Admin
            </span>
            <h3 className="text-sm font-bold uppercase tracking-wider">Player Management</h3>
          </div>
          <div className="text-[11px] text-foreground/60">
            {players.length} players · You also have infinite HP in matches.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by username…"
            className="h-8 w-48"
          />
          <Button size="sm" variant="secondary" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      <div className="max-h-[360px] overflow-y-auto rounded-md border border-foreground/10">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background/95 text-left text-[10px] uppercase tracking-wider text-foreground/50">
            <tr>
              <th className="px-2 py-1.5">User</th>
              <th className="px-2 py-1.5">Pts</th>
              <th className="px-2 py-1.5">Grant pts</th>
              <th className="px-2 py-1.5">Grant weapon</th>
              <th className="px-2 py-1.5">Take weapon</th>
              <th className="px-2 py-1.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.user_id} className="border-t border-foreground/5">
                <td className="px-2 py-1.5">
                  <div className="font-bold">{p.username}</div>
                  {p.banned && <span className="text-[10px] font-bold text-red-400">BANNED</span>}
                </td>
                <td className="px-2 py-1.5 font-mono">{p.kill_points}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={grantAmount[p.user_id] ?? "10"}
                      onChange={(e) => setGrantAmount({ ...grantAmount, [p.user_id]: e.target.value })}
                      className="h-7 w-16"
                    />
                    <Button size="sm" disabled={busy === p.user_id} onClick={() => void grantPoints(p)}>
                      +
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <select
                      className="h-7 rounded border border-foreground/10 bg-background px-1 text-[11px]"
                      value={grantWeapon[p.user_id] ?? ""}
                      onChange={(e) =>
                        setGrantWeapon({ ...grantWeapon, [p.user_id]: e.target.value as WeaponId })
                      }
                    >
                      <option value="">—</option>
                      {ALL_WEAPONS.map((w) => (
                        <option key={w} value={w}>{WEAPONS[w].name}</option>
                      ))}
                    </select>
                    <Button size="sm" disabled={busy === p.user_id || !grantWeapon[p.user_id]} onClick={() => void grantWeaponTo(p)}>
                      Give
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <select
                      className="h-7 rounded border border-foreground/10 bg-background px-1 text-[11px]"
                      value={takeWeapon[p.user_id] ?? ""}
                      onChange={(e) =>
                        setTakeWeapon({ ...takeWeapon, [p.user_id]: e.target.value as WeaponId })
                      }
                    >
                      <option value="">—</option>
                      {[...p.inventory, ...p.storage_weapons].map((w) => (
                        <option key={w} value={w}>{WEAPONS[w].name}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === p.user_id || !takeWeapon[p.user_id]}
                      onClick={() => void takeWeaponFrom(p)}
                    >
                      Take
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant={p.banned ? "secondary" : "destructive"}
                      disabled={busy === p.user_id}
                      onClick={() => void toggleBan(p)}
                    >
                      {p.banned ? "Unban" : "Ban"}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === p.user_id} onClick={() => void stripAllWeapons(p)}>
                      Strip all
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy === p.user_id} onClick={() => void resetPoints(p)}>
                      Zero pts
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-foreground/40">
                  No players match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}