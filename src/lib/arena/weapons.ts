export type WeaponId =
  | "pistol" | "shotgun" | "sniper" | "rocket" | "mine" | "sword"
  | "tracking_missile" | "nuke" | "grenade" | "mini_soldiers"
  | "dual_pistols" | "chain" | "battleaxe" | "spear"
  | "army" | "smg" | "flak" | "crossbow";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export const RARITY_META: Record<Rarity, { label: string; color: string; weight: number }> = {
  common:    { label: "Common",    color: "#9ca3af", weight: 55 },
  rare:      { label: "Rare",      color: "#60a5fa", weight: 28 },
  epic:      { label: "Epic",      color: "#c084fc", weight: 13 },
  legendary: { label: "Legendary", color: "#fbbf24", weight: 4 },
};

export type WeaponDef = {
  id: WeaponId;
  name: string;
  cooldown: number;
  dmg: number;
  speed: number;
  lifetime: number;
  radius: number;
  splash?: number;
  pellets?: number;
  spread?: number;
  charge?: number;
  melee?: { range: number; arc: number };
  placeable?: { armTime: number; trigger: number };
  homing?: { turn: number; range: number }; // radians/sec, detection range
  bouncing?: { bounces: number; fuse: number }; // walls, ms before explode
  pierce?: boolean;
  immobilize?: number; // ms freeze on hit
  twin?: boolean; // dual barrels
  summon?: number; // mini soldier count
  rarity: Rarity;
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol:           { id: "pistol",           name: "Pistol",           cooldown: 0.22, dmg: 12, speed: 560, lifetime: 1400, radius: 5, rarity: "common" },
  shotgun:          { id: "shotgun",          name: "Shotgun",          cooldown: 0.75, dmg: 8,  speed: 480, lifetime: 700,  radius: 4, pellets: 5, spread: 0.45, rarity: "common" },
  sniper:           { id: "sniper",           name: "Sniper",           cooldown: 1.1,  dmg: 45, speed: 1100, lifetime: 1600, radius: 3, charge: 0.6, rarity: "rare" },
  rocket:           { id: "rocket",           name: "Rocket",           cooldown: 1.4,  dmg: 35, speed: 340, lifetime: 2200, radius: 7, splash: 70, rarity: "epic" },
  mine:             { id: "mine",             name: "Mine",             cooldown: 1.6,  dmg: 50, speed: 0,   lifetime: 15000, radius: 9, splash: 60, placeable: { armTime: 500, trigger: 36 }, rarity: "rare" },
  sword:            { id: "sword",            name: "Sword",            cooldown: 0.35, dmg: 22, speed: 0,   lifetime: 180, radius: 0, melee: { range: 58, arc: Math.PI * 0.55 }, rarity: "rare" },
  tracking_missile: { id: "tracking_missile", name: "Homing Missile",   cooldown: 1.6,  dmg: 26, speed: 260, lifetime: 3800, radius: 6, splash: 48, homing: { turn: 3.2, range: 600 }, rarity: "epic" },
  nuke:             { id: "nuke",             name: "Nuke",             cooldown: 8.0,  dmg: 80, speed: 260, lifetime: 2400, radius: 10, splash: 220, rarity: "legendary" },
  grenade:          { id: "grenade",          name: "Grenade",          cooldown: 1.0,  dmg: 28, speed: 380, lifetime: 1300, radius: 6, splash: 70, bouncing: { bounces: 3, fuse: 1200 }, rarity: "rare" },
  mini_soldiers:    { id: "mini_soldiers",    name: "Mini Soldiers",    cooldown: 6.0,  dmg: 14, speed: 220, lifetime: 7000, radius: 5, homing: { turn: 2.0, range: 800 }, summon: 3, rarity: "legendary" },
  dual_pistols:     { id: "dual_pistols",     name: "Dual Pistols",     cooldown: 0.18, dmg: 10, speed: 580, lifetime: 1300, radius: 4, twin: true, rarity: "rare" },
  chain:            { id: "chain",            name: "Chain",            cooldown: 1.4,  dmg: 8,  speed: 520, lifetime: 700, radius: 5, immobilize: 1500, rarity: "rare" },
  battleaxe:        { id: "battleaxe",        name: "Battleaxe",        cooldown: 0.55, dmg: 38, speed: 0,   lifetime: 220, radius: 0, melee: { range: 74, arc: Math.PI * 0.75 }, rarity: "epic" },
  spear:            { id: "spear",            name: "Spear",            cooldown: 0.85, dmg: 30, speed: 720, lifetime: 1200, radius: 4, pierce: true, rarity: "rare" },
  army:             { id: "army",             name: "Army",             cooldown: 7.0,  dmg: 1,  speed: 240, lifetime: 9000, radius: 5, homing: { turn: 2.6, range: 900 }, summon: 5, rarity: "legendary" },
  smg:              { id: "smg",              name: "SMG",              cooldown: 0.11, dmg: 6,  speed: 620, lifetime: 1100, radius: 3, spread: 0.09, rarity: "common" },
  flak:             { id: "flak",             name: "Flak Cannon",      cooldown: 1.2,  dmg: 9,  speed: 430, lifetime: 900,  radius: 5, pellets: 7, spread: 0.7, splash: 34, rarity: "epic" },
  crossbow:         { id: "crossbow",         name: "Crossbow",         cooldown: 1.0,  dmg: 34, speed: 820, lifetime: 1500, radius: 4, pierce: true, charge: 0.35, rarity: "rare" },
};

export const WEAPON_ORDER: WeaponId[] = [
  "pistol", "shotgun", "sniper", "rocket", "mine", "sword",
  "tracking_missile", "nuke", "grenade", "mini_soldiers",
  "dual_pistols", "chain", "battleaxe", "spear",
  "army", "smg", "flak", "crossbow",
];

export const ALL_WEAPONS = WEAPON_ORDER;
export const WEAPON_ROLL_COST = 4;
export const STARTING_WEAPONS: WeaponId[] = ["pistol"];
export const MAX_INVENTORY = 18;
export const MAX_HOTBAR = 4;

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === "string" && (WEAPON_ORDER as string[]).includes(v);
}

export function rollRandomWeapon(rng: () => number = Math.random): WeaponId {
  const total = WEAPON_ORDER.reduce(
    (acc, id) => acc + RARITY_META[WEAPONS[id].rarity].weight,
    0,
  );
  let r = rng() * total;
  for (const id of WEAPON_ORDER) {
    r -= RARITY_META[WEAPONS[id].rarity].weight;
    if (r <= 0) return id;
  }
  return "pistol";
}

export type UpgradeId = "damage" | "cooldown" | "speed" | "health" | "armour";
export type Upgrades = Record<UpgradeId, number>;
/** Highest level any upgrade can reach (used for clamping untrusted input). */
export const MAX_UPGRADE_LEVEL = 20;

export const UPGRADE_MAX: Record<UpgradeId, number> = {
  damage: 20,
  cooldown: 20,
  armour: 20,
  speed: 5,
  health: 5,
};

export const UPGRADE_DEFS: { id: UpgradeId; name: string; desc: string }[] = [
  { id: "damage",   name: "Damage",     desc: "+10% per level" },
  { id: "cooldown", name: "Fire Rate",  desc: "-7% cooldown per level" },
  { id: "armour",   name: "Armour",     desc: "-3% damage taken per level" },
  { id: "speed",    name: "Move Speed", desc: "+8% per level" },
  { id: "health",   name: "Max HP",     desc: "+15 per level" },
];

export function upgradeCost(currentLevel: number) { return currentLevel + 1; }
export function dmgMult(u: Upgrades)      { return 1 + 0.1 * u.damage; }
export function cooldownMult(u: Upgrades) { return Math.max(0.15, Math.pow(0.93, u.cooldown)); }
export function speedMult(u: Upgrades)    { return 1 + 0.08 * u.speed; }
export function maxHp(u: Upgrades)        { return 100 + 15 * u.health; }
export function damageTakenMult(u: Upgrades) { return Math.max(0.4, 1 - 0.03 * (u.armour ?? 0)); }

export const ZERO_UPGRADES: Upgrades = { damage: 0, cooldown: 0, speed: 0, health: 0 };
