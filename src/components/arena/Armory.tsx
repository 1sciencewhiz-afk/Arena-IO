import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  WEAPONS,
  UPGRADE_DEFS,
  MAX_UPGRADE_LEVEL,
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
    const lvl = loadout.upgrades[id];
    if (lvl >= MAX_UPGRADE_LEVEL) return;
    const cost = upgradeCost(lvl);
    if (loadout.killPoints < cost) return;
    const upgrades: Upgrades = { ...loadout.upgrades, [id]: lvl + 1 };
    update({ killPoints: loadout.killPoints - cost, upgrades });
  };

  const roll = () => {
    if (loadout.killPoints < WEAPON_ROLL_COST) return;
    const owned = new Set<WeaponId>([...loadout.inventory, ...loadout.storage]);
    if (owned.size >= 14) {
      // already own all (legitimate cap is 14 weapons total)
    }
    let pick: WeaponId = rollRandomWeapon();
    let guard = 0;
    while (owned.has(pick) && guard++ < 40) pick = rollRandomWeapon();
    const isNew = !owned.has(pick);

    if (!isNew) {
      // small partial refund handled by no-op + visible duplicate notice
      update({ killPoints: loadout.killPoints - 1 });
      setFlash({ weapon: pick, isNew });
      setTimeout(() => setFlash(null), 2200);
      return;
    }

    const inventory = [...loadout.inventory];
    const storage = [...loadout.storage];
    if (inventory.length < MAX_INVENTORY) inventory.push(pick);
    else storage.push(pick);

    update({
      killPoints: loadout.killPoints - WEAPON_ROLL_COST,
      inventory,
      storage,
    });
    setFlash({ weapon: pick, isNew });
    setTimeout(() => setFlash(null), 2400);
  };

  const toggleHotbar = (w: WeaponId) => {
    if (!loadout.inventory.includes(w)) return;
    let hotbar = [...loadout.hotbar];
    if (hotbar.includes(w)) {
      hotbar = hotbar.filter((x) => x !== w);
      if (hotbar.length === 0) return; // need at least one
    } else {
      if (hotbar.length >= MAX_HOTBAR) hotbar = [...hotbar.slice(1), w];
      else hotbar.push(w);
    }
    update({ hotbar });
  };

  const moveToInventory = (w: WeaponId) => {
    if (loadout.inventory.length >= MAX_INVENTORY) return;
    update({
      inventory: [...loadout.inventory, w],
      storage: loadout.storage.filter((x) => x !== w),
    });
  };

  const moveToStorage = (w: WeaponId) => {
    if (loadout.inventory.length <= 1) return;
    const hotbar = loadout.hotbar.filter((x) => x !== w);
    update({
      inventory: loadout.inventory.filter((x) => x !== w),
      storage: [...loadout.storage, w],
      hotbar: hotbar.length ? hotbar : [loadout.inventory.find((x) => x !== w) ?? "pistol"],
    });
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
              const lvl = loadout.upgrades[u.id];
              const maxed = lvl >= MAX_UPGRADE_LEVEL;
              const cost = maxed ? 0 : upgradeCost(lvl);
              const can = !maxed && loadout.killPoints >= cost;
              return (
                <li key={u.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{u.name}</div>
                    <div className="text-[10px] text-foreground/50">
                      Lv {lvl}/{MAX_UPGRADE_LEVEL} · {u.desc}
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
            Roll for a random weapon. Rarer weapons drop less often. New weapons land in your inventory; if full, they go to storage.
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

      {/* Inventory + hotbar */}
      <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-foreground/60">
            Inventory ({loadout.inventory.length}/{MAX_INVENTORY})
          </h3>
          <div className="text-[10px] text-foreground/50">
            Hotbar {loadout.hotbar.length}/{MAX_HOTBAR} · click a weapon to add/remove from hotbar
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {loadout.inventory.map((id) => {
            const w = WEAPONS[id];
            const inBar = loadout.hotbar.includes(id);
            const slot = loadout.hotbar.indexOf(id) + 1;
            return (
              <div
                key={id}
                className={`rounded-lg border p-2 text-xs transition ${
                  inBar ? "border-primary bg-primary/10" : "border-foreground/10 bg-background/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <button onClick={() => toggleHotbar(id)} className="text-left font-bold">
                    {w.name}
                  </button>
                  {inBar && (
                    <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] text-primary-foreground">
                      {slot}
                    </span>
                  )}
                </div>
                <div className="text-[10px]" style={{ color: RARITY_META[w.rarity].color }}>
                  {RARITY_META[w.rarity].label} · {Math.round(w.dmg)} dmg
                </div>
                <div className="mt-1 flex gap-1">
                  <button
                    onClick={() => toggleHotbar(id)}
                    className="flex-1 rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] hover:bg-foreground/20"
                  >
                    {inBar ? "Unequip" : "Equip"}
                  </button>
                  {id !== "pistol" && (
                    <button
                      onClick={() => moveToStorage(id)}
                      className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] hover:bg-foreground/20"
                      title="Move to storage"
                    >
                      📦
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Storage */}
      {loadout.storage.length > 0 && (
        <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">
            Storage ({loadout.storage.length})
          </h3>
          <p className="mb-2 text-[11px] text-foreground/50">
            Weapons not currently in your inventory. Move into inventory to equip.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {loadout.storage.map((id) => {
              const w = WEAPONS[id];
              const canMove = loadout.inventory.length < MAX_INVENTORY;
              return (
                <div
                  key={id}
                  className="rounded-lg border border-foreground/10 bg-background/30 p-2 text-xs"
                >
                  <div className="font-bold">{w.name}</div>
                  <div className="text-[10px]" style={{ color: RARITY_META[w.rarity].color }}>
                    {RARITY_META[w.rarity].label}
                  </div>
                  <button
                    onClick={() => moveToInventory(id)}
                    disabled={!canMove}
                    className="mt-1 w-full rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] hover:bg-foreground/20 disabled:opacity-40"
                  >
                    {canMove ? "→ Inventory" : "Full"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isGuest && (
        <p className="text-center text-[11px] text-foreground/50">
          Playing as guest — progress is saved on this device only.
        </p>
      )}
    </div>
  );
}
