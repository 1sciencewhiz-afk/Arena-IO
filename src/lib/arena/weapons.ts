export type WeaponId =
  | "pistol" | "shotgun" | "sniper" | "rocket" | "mine" | "sword"
  | "tracking_missile" | "nuke" | "grenade" | "mini_soldiers"
  | "dual_pistols" | "chain" | "battleaxe" | "spear"
  | "army" | "smg" | "flak" | "crossbow"
  | "laser" | "railgun" | "plasma" | "flamethrower" | "minigun"
  | "boomerang" | "shuriken" | "katana" | "warhammer" | "scythe"
  | "revolver" | "autoshotgun" | "grenade_launcher" | "cluster_bomb"
  | "freeze_ray" | "poison_dart" | "lightning" | "blackhole"
  | "turret" | "drone_swarm" | "javelin" | "bazooka"
  | "icicle" | "acid_spitter" | "gauss_rifle";


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
  laser:            { id: "laser",            name: "Laser Rifle",      cooldown: 0.45, dmg: 20, speed: 1400, lifetime: 900, radius: 3, pierce: true, rarity: "epic" },
  railgun:          { id: "railgun",          name: "Railgun",          cooldown: 1.8,  dmg: 60, speed: 1600, lifetime: 1400, radius: 3, pierce: true, charge: 0.8, rarity: "legendary" },
  plasma:           { id: "plasma",           name: "Plasma Gun",       cooldown: 0.5,  dmg: 18, speed: 520, lifetime: 1200, radius: 6, splash: 30, rarity: "epic" },
  flamethrower:     { id: "flamethrower",     name: "Flamethrower",     cooldown: 0.09, dmg: 4,  speed: 300, lifetime: 320, radius: 6, pellets: 3, spread: 0.45, rarity: "rare" },
  minigun:          { id: "minigun",          name: "Minigun",          cooldown: 0.06, dmg: 4,  speed: 700, lifetime: 1000, radius: 3, spread: 0.18, rarity: "epic" },
  boomerang:        { id: "boomerang",        name: "Boomerang",        cooldown: 0.9,  dmg: 22, speed: 460, lifetime: 1800, radius: 6, bouncing: { bounces: 6, fuse: 1800 }, rarity: "rare" },
  shuriken:         { id: "shuriken",         name: "Shuriken",         cooldown: 0.4,  dmg: 11, speed: 700, lifetime: 900, radius: 4, pellets: 3, spread: 0.22, pierce: true, rarity: "rare" },
  katana:           { id: "katana",           name: "Katana",           cooldown: 0.25, dmg: 19, speed: 0, lifetime: 160, radius: 0, melee: { range: 64, arc: Math.PI * 0.5 }, rarity: "epic" },
  warhammer:        { id: "warhammer",        name: "Warhammer",        cooldown: 0.95, dmg: 55, speed: 0, lifetime: 260, radius: 0, melee: { range: 70, arc: Math.PI * 0.6 }, rarity: "epic" },
  scythe:           { id: "scythe",           name: "Scythe",           cooldown: 0.6,  dmg: 30, speed: 0, lifetime: 240, radius: 0, melee: { range: 82, arc: Math.PI * 1.1 }, rarity: "legendary" },
  revolver:         { id: "revolver",         name: "Revolver",         cooldown: 0.5,  dmg: 26, speed: 700, lifetime: 1400, radius: 4, rarity: "common" },
  autoshotgun:      { id: "autoshotgun",      name: "Auto Shotgun",     cooldown: 0.45, dmg: 7,  speed: 500, lifetime: 650, radius: 4, pellets: 6, spread: 0.5, rarity: "epic" },
  grenade_launcher: { id: "grenade_launcher", name: "Grenade Launcher", cooldown: 0.9,  dmg: 24, speed: 460, lifetime: 1500, radius: 6, splash: 62, bouncing: { bounces: 2, fuse: 1000 }, rarity: "epic" },
  cluster_bomb:     { id: "cluster_bomb",     name: "Cluster Bomb",     cooldown: 2.4,  dmg: 34, speed: 380, lifetime: 1600, radius: 8, splash: 130, bouncing: { bounces: 1, fuse: 1300 }, rarity: "legendary" },
  freeze_ray:       { id: "freeze_ray",       name: "Freeze Ray",       cooldown: 1.3,  dmg: 6,  speed: 600, lifetime: 900, radius: 5, immobilize: 1800, rarity: "rare" },
  poison_dart:      { id: "poison_dart",      name: "Poison Dart",      cooldown: 0.55, dmg: 14, speed: 760, lifetime: 1200, radius: 3, pierce: true, immobilize: 400, rarity: "rare" },
  lightning:        { id: "lightning",        name: "Lightning Coil",   cooldown: 1.0,  dmg: 24, speed: 1500, lifetime: 700, radius: 4, pierce: true, immobilize: 500, rarity: "epic" },
  blackhole:        { id: "blackhole",        name: "Black Hole",       cooldown: 9.0,  dmg: 45, speed: 160, lifetime: 4000, radius: 12, splash: 200, homing: { turn: 1.4, range: 900 }, immobilize: 900, rarity: "legendary" },
  turret:           { id: "turret",           name: "Turret",           cooldown: 2.2,  dmg: 40, speed: 0, lifetime: 14000, radius: 9, splash: 55, placeable: { armTime: 700, trigger: 44 }, rarity: "epic" },
  drone_swarm:      { id: "drone_swarm",      name: "Drone Swarm",      cooldown: 5.5,  dmg: 8,  speed: 280, lifetime: 7000, radius: 5, homing: { turn: 2.4, range: 850 }, summon: 4, rarity: "legendary" },
  javelin:          { id: "javelin",          name: "Javelin",          cooldown: 1.1,  dmg: 42, speed: 900, lifetime: 1300, radius: 4, pierce: true, rarity: "epic" },
  bazooka:          { id: "bazooka",          name: "Bazooka",          cooldown: 1.7,  dmg: 44, speed: 380, lifetime: 2200, radius: 8, splash: 90, rarity: "epic" },
  icicle:           { id: "icicle",           name: "Icicle Launcher",  cooldown: 0.8,  dmg: 12, speed: 640, lifetime: 1100, radius: 4, pellets: 3, spread: 0.3, immobilize: 500, rarity: "rare" },
  acid_spitter:     { id: "acid_spitter",     name: "Acid Spitter",     cooldown: 0.65, dmg: 13, speed: 430, lifetime: 900, radius: 5, pellets: 2, spread: 0.25, splash: 28, rarity: "rare" },
  gauss_rifle:      { id: "gauss_rifle",      name: "Gauss Rifle",      cooldown: 1.4,  dmg: 52, speed: 1300, lifetime: 1500, radius: 3, charge: 0.5, pierce: true, rarity: "legendary" },
};

export const WEAPON_ORDER: WeaponId[] = [
  "pistol", "shotgun", "sniper", "rocket", "mine", "sword",
  "tracking_missile", "nuke", "grenade", "mini_soldiers",
  "dual_pistols", "chain", "battleaxe", "spear",
  "army", "smg", "flak", "crossbow",
  "laser", "railgun", "plasma", "flamethrower", "minigun",
  "boomerang", "shuriken", "katana", "warhammer", "scythe",
  "revolver", "autoshotgun", "grenade_launcher", "cluster_bomb",
  "freeze_ray", "poison_dart", "lightning", "blackhole",
  "turret", "drone_swarm", "javelin", "bazooka",
  "icicle", "acid_spitter", "gauss_rifle",
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

export const ZERO_UPGRADES: Upgrades = { damage: 0, cooldown: 0, speed: 0, health: 0, armour: 0 };
