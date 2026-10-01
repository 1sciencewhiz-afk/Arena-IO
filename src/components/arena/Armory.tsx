import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  WEAPONS,
  ALL_WEAPONS,
  UPGRADE_DEFS,
  UPGRADE_MAX,
  MAX_INVENTORY,
  MAX_HOTBAR,
  WEAPON_ROLL_COST,
  RARITY_META,
  rollRandomWeapon,
  upgradeCost,
  maxHp,
  ZERO_UPGRADES,
  type WeaponId,
  type UpgradeId,
  type Upgrades,
} from "@/lib/arena/weapons";
import type { Loadout } from "@/lib/arena/loadout";

type Props = {
  loadout: Loadout;
  update: (patch: Partial<Loadout>) => void | Promise<void>;
  isGuest: boolean;
};

export function Armory({ loadout, update, isGuest }: Props) {
  const [flash, setFlash] = useState<null | { weapon: WeaponId; isNew: boolean }>(null);

  const buyUpgrade = (id: UpgradeId) => {
    const lvl = loadout.upgrades[id] ?? 0;
    if (lvl >= UPGRADE_MAX[id]) return;
    const cost = upgradeCost(lvl);
    if (loadout.killPoints < cost) return;
    const upgrades: Upgrades = { ...loadout.upgrades, [id]: lvl + 1 };
    update({ killPoints: loadout.killPoints - cost, upgrades });
  };

  const [pending, setPending] = useState<WeaponId | null>(null);
  const carried = loadout.hotbar.slice(0, MAX_HOTBAR);

  const roll = () => {
    if (pending || loadout.killPoints < WEAPON_ROLL_COST) return;
    let pick: WeaponId = rollRandomWeapon();
    let guard = 0;
    while (carried.includes(pick) && guard++ < 40) pick = rollRandomWeapon();
    if (carried.includes(pick)) {
      update({ killPoints: loadout.killPoints - 1 });
      setFlash({ weapon: pick, isNew: false });
      setTimeout(() => setFlash(null), 2200);
      return;
    }
    const killPoints = loadout.killPoints - WEAPON_ROLL_COST;
    if (carried.length < MAX_HOTBAR) {
      update({ killPoints, hotbar: [...carried, pick] });
      setFlash({ weapon: pick, isNew: true });
      setTimeout(() => setFlash(null), 2400);
    } else {
      update({ killPoints });
      setPending(pick);
    }
  };

  const replaceWith = (old: WeaponId) => {
    if (!pending) return;
    update({ hotbar: carried.map((x) => (x === old ? pending : x)) });
    setFlash({ weapon: pending, isNew: true });
    setTimeout(() => setFlash(null), 2400);
    setPending(null);
  };

  const maxHpPreview = maxHp(loadout.upgrades || ZERO_UPGRADES);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-foreground/10 bg-foreground/5 p-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground/60">Armory</div>
          <div className="text-sm text-foreground/70">
            Spend kill points on upgrades and new weapons. Set your hotbar before you drop in.
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-mono">HP {maxHpPreview}</span>
          <span className="rounded-md bg-primary/10 px-3 py-1 font-mono font-bold text-primary">
            ★ {loadout.killPoints} pts
          </span>
        </div>
      </div>

      {/* Upgrades + roll */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">Upgrades</h3>
          <ul className="space-y-2">
            {UPGRADE_DEFS.map((u) => {
              const lvl = loadout.upgrades[u.id] ?? 0;
              const cap = UPGRADE_MAX[u.id];
              const maxed = lvl >= cap;
              const cost = maxed ? 0 : upgradeCost(lvl);
              const can = !maxed && loadout.killPoints >= cost;
              return (
                <li key={u.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{u.name}</div>
                    <div className="text-[10px] text-foreground/50">
                      Lv {lvl}/{cap} · {u.desc}
                    </div>
                  </div>
                  <Button size="sm" variant={can ? "default" : "secondary"} disabled={!can} onClick={() => buyUpgrade(u.id)}>
                    {maxed ? "MAX" : `+1 (${cost})`}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">Weapon Crate</h3>
          <p className="mb-3 text-[11px] text-foreground/50">
            Roll for a random weapon. Rarer weapons drop less often. You can carry 4 weapons; when full, pick one to replace.
          </p>
          <Button
            className="w-full"
            disabled={loadout.killPoints < WEAPON_ROLL_COST}
            onClick={roll}
          >
            Open crate · {WEAPON_ROLL_COST} pts
          </Button>
          {flash && (
            <div
              className="mt-2 rounded-md border px-2 py-1 text-[11px]"
              style={{
                borderColor: RARITY_META[WEAPONS[flash.weapon].rarity].color,
                color: RARITY_META[WEAPONS[flash.weapon].rarity].color,
              }}
            >
              {flash.isNew ? "🎉 Unlocked: " : "Duplicate (small refund): "}
              <span className="font-bold">{WEAPONS[flash.weapon].name}</span>
              {" · "}
              {RARITY_META[WEAPONS[flash.weapon].rarity].label}
            </div>
          )}
        </div>
      </div>

      {pending && (
        <div className="rounded-xl border border-primary/50 bg-primary/10 p-4">
          <div className="mb-2 text-sm font-bold">
            You rolled <span style={{ color: RARITY_META[WEAPONS[pending].rarity].color }}>{WEAPONS[pending].name}</span> — pick a weapon to replace
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {carried.map((w) => (
              <Button key={w} size="sm" variant="secondary" onClick={() => replaceWith(w)}>{WEAPONS[w].name}</Button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => setPending(null)}>
            Discard {WEAPONS[pending].name}
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">
          Your weapons ({carried.length}/{MAX_HOTBAR})
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {carried.map((id, i) => {
            const w = WEAPONS[id];
            return (
              <div key={id} className="rounded-lg border border-primary bg-primary/10 p-2 text-xs">
                <div className="flex items-center justify-between font-bold">
                  {w.name}
                  <span className="rounded bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">{i + 1}</span>
                </div>
                <div className="text-[10px]" style={{ color: RARITY_META[w.rarity].color }}>
                  {RARITY_META[w.rarity].label} · {Math.round(w.dmg)} dmg
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isGuest && (
        <p className="text-center text-[11px] text-foreground/50">
          Playing as guest — progress is saved on this device only.
        </p>
      )}
    </div>
  );
}
