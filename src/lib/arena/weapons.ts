export type WeaponId = "pistol" | "shotgun" | "sniper" | "rocket" | "mine" | "sword";

export type WeaponDef = {
  id: WeaponId;
  name: string;
  key: string;
  cooldown: number; // seconds
  dmg: number;
  speed: number; // px/sec for projectiles
  lifetime: number; // ms
  radius: number; // bullet radius
  splash?: number; // splash radius
  pellets?: number;
  spread?: number; // radians
  charge?: number; // seconds to fully charge
  melee?: { range: number; arc: number };
  placeable?: { armTime: number; trigger: number };
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: "pistol", name: "Pistol", key: "1",
    cooldown: 0.22, dmg: 12, speed: 560, lifetime: 1400, radius: 5,
  },
  shotgun: {
    id: "shotgun", name: "Shotgun", key: "2",
    cooldown: 0.75, dmg: 8, speed: 480, lifetime: 700, radius: 4,
    pellets: 5, spread: 0.45,
  },
  sniper: {
    id: "sniper", name: "Sniper", key: "3",
    cooldown: 1.1, dmg: 45, speed: 1100, lifetime: 1600, radius: 3,
    charge: 0.6,
  },
  rocket: {
    id: "rocket", name: "Rocket", key: "4",
    cooldown: 1.4, dmg: 35, speed: 340, lifetime: 2200, radius: 7,
    splash: 70,
  },
  mine: {
    id: "mine", name: "Mine", key: "5",
    cooldown: 1.6, dmg: 50, speed: 0, lifetime: 15000, radius: 9,
    splash: 60, placeable: { armTime: 500, trigger: 36 },
  },
  sword: {
    id: "sword", name: "Sword", key: "6",
    cooldown: 0.35, dmg: 22, speed: 0, lifetime: 180, radius: 0,
    melee: { range: 58, arc: Math.PI * 0.55 },
  },
};

export const WEAPON_ORDER: WeaponId[] = ["pistol", "shotgun", "sniper", "rocket", "mine", "sword"];

export type UpgradeId = "damage" | "cooldown" | "speed" | "health";
export type Upgrades = Record<UpgradeId, number>;
export const MAX_UPGRADE_LEVEL = 5;

export const UPGRADE_DEFS: { id: UpgradeId; name: string; desc: string }[] = [
  { id: "damage", name: "Damage", desc: "+10% per level" },
  { id: "cooldown", name: "Fire Rate", desc: "-10% cooldown per level" },
  { id: "speed", name: "Move Speed", desc: "+8% per level" },
  { id: "health", name: "Max HP", desc: "+15 per level" },
];

export function upgradeCost(currentLevel: number) {
  return currentLevel + 1; // 1,2,3,4,5
}

export function dmgMult(u: Upgrades) {
  return 1 + 0.1 * u.damage;
}
export function cooldownMult(u: Upgrades) {
  return Math.pow(0.9, u.cooldown);
}
export function speedMult(u: Upgrades) {
  return 1 + 0.08 * u.speed;
}
export function maxHp(u: Upgrades) {
  return 100 + 15 * u.health;
}

export const ZERO_UPGRADES: Upgrades = { damage: 0, cooldown: 0, speed: 0, health: 0 };