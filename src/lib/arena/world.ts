import { ALL_WEAPONS, type WeaponId } from "@/lib/arena/weapons";

export type TerrainId = "open" | "blocks" | "pillars" | "maze";
export type MapSizeId = "small" | "medium" | "large" | "massive";

export type RoomConfig = {
  bots: boolean;
  terrain: TerrainId;
  size: MapSizeId;
  pickups: boolean;
};

export const MAP_SIZES: Record<MapSizeId, { w: number; h: number; label: string }> = {
  small:   { w: 1200, h: 700,  label: "Small" },
  medium:  { w: 2000, h: 1200, label: "Medium" },
  large:   { w: 3200, h: 1900, label: "Large" },
  massive: { w: 5200, h: 3200, label: "Massive" },
};

export const TERRAINS: { id: TerrainId; label: string; desc: string }[] = [
  { id: "open",    label: "Open Field", desc: "No cover — pure duelling" },
  { id: "blocks",  label: "Blocks",     desc: "Scattered crates to hide behind" },
  { id: "pillars", label: "Pillars",    desc: "Regular grid of pillars" },
  { id: "maze",    label: "Maze",       desc: "Dense corridors and walls" },
];

export const DEFAULT_CONFIG: RoomConfig = {
  bots: true,
  terrain: "blocks",
  size: "medium",
  pickups: true,
};

export const PUBLIC_CONFIG: RoomConfig = {
  bots: true,
  terrain: "blocks",
  size: "massive",
  pickups: true,
};

/** Compact URL encoding, e.g. "b1-blocks-massive-p1". */
export function encodeConfig(c: RoomConfig): string {
  return `b${c.bots ? 1 : 0}-${c.terrain}-${c.size}-p${c.pickups ? 1 : 0}`;
}

export function decodeConfig(raw: string | null | undefined): RoomConfig | null {
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length !== 4) return null;
  const [b, terrain, size, p] = parts;
  if (!(terrain in { open: 1, blocks: 1, pillars: 1, maze: 1 })) return null;
  if (!(size in MAP_SIZES)) return null;
  return {
    bots: b === "b1",
    terrain: terrain as TerrainId,
    size: size as MapSizeId,
    pickups: p === "p1",
  };
}

export type Obstacle = { x: number; y: number; w: number; h: number };
export type PickupKind = "medkit" | "lootbox";
export type Pickup = { id: string; kind: PickupKind; x: number; y: number };

/** Deterministic RNG so every peer generates the identical world. */
export function seededRng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type World = {
  w: number;
  h: number;
  obstacles: Obstacle[];
  pickups: Pickup[];
};

export function buildWorld(code: string, config: RoomConfig): World {
  const { w, h } = MAP_SIZES[config.size];
  const rng = seededRng(`${code}:${config.terrain}:${config.size}`);
  const obstacles: Obstacle[] = [];

  const area = (w * h) / 1_000_000; // in "million px" units

  /** Reject a rect that comes within `gap` px of an existing one. */
  const fits = (r: Obstacle, gap: number) =>
    !obstacles.some(
      (o) =>
        r.x < o.x + o.w + gap &&
        r.x + r.w + gap > o.x &&
        r.y < o.y + o.h + gap &&
        r.y + r.h + gap > o.y,
    );

  if (config.terrain === "blocks") {
    const target = Math.round(26 * area) + 8;
    const GAP = 140; // wide lanes between cover so fights have space
    let placed = 0;
    for (let i = 0; i < target * 60 && placed < target; i++) {
      const bw = 70 + rng() * 150;
      const bh = 70 + rng() * 150;
      const r: Obstacle = {
        x: 120 + rng() * (w - 240 - bw),
        y: 120 + rng() * (h - 240 - bh),
        w: bw,
        h: bh,
      };
      if (!fits(r, GAP)) continue;
      obstacles.push(r);
      placed++;
    }
  } else if (config.terrain === "pillars") {
    const step = 260;
    for (let x = step; x < w - step / 2; x += step) {
      for (let y = step; y < h - step / 2; y += step) {
        const s = 50 + rng() * 30;
        obstacles.push({ x: x - s / 2, y: y - s / 2, w: s, h: s });
      }
    }
  } else if (config.terrain === "maze") {
    const cell = 300;
    for (let x = cell; x < w - cell / 2; x += cell) {
      for (let y = cell; y < h - cell / 2; y += cell) {
        if (rng() < 0.55) {
          const len = cell * (0.5 + rng() * 0.6);
          if (rng() < 0.5) obstacles.push({ x, y, w: len, h: 34 });
          else obstacles.push({ x, y, w: 34, h: len });
        }
      }
    }
  }

  const pickups: Pickup[] = [];
  if (config.pickups) {
    const medkits = Math.round(10 * area) + 4;
    const boxes = Math.round(8 * area) + 3;
    const freeSpot = () => {
      for (let t = 0; t < 40; t++) {
        const x = 60 + rng() * (w - 120);
        const y = 60 + rng() * (h - 120);
        if (!pointInObstacles(obstacles, x, y, 30)) return { x, y };
      }
      return { x: 60 + rng() * (w - 120), y: 60 + rng() * (h - 120) };
    };
    for (let i = 0; i < medkits; i++) {
      pickups.push({ id: `m${i}`, kind: "medkit", ...freeSpot() });
    }
    for (let i = 0; i < boxes; i++) {
      pickups.push({ id: `l${i}`, kind: "lootbox", ...freeSpot() });
    }
  }

  return { w, h, obstacles, pickups };
}

export const PICKUP_R = 16;
export const MEDKIT_HEAL = 45;
export const PICKUP_RESPAWN_MS = 25000;

export function randomLootWeapon(rng: () => number = Math.random): WeaponId {
  return ALL_WEAPONS[Math.floor(rng() * ALL_WEAPONS.length)];
}

/** Push a circle out of any rect it overlaps. Mutates and returns the position. */
export function resolveCircle(
  obstacles: Obstacle[],
  x: number,
  y: number,
  r: number,
): { x: number; y: number } {
  for (const o of obstacles) {
    const cx = Math.max(o.x, Math.min(x, o.x + o.w));
    const cy = Math.max(o.y, Math.min(y, o.y + o.h));
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      y = cy + (dy / d) * r;
    } else {
      // centre inside the rect — eject along the shallowest axis
      const left = x - o.x;
      const right = o.x + o.w - x;
      const top = y - o.y;
      const bottom = o.y + o.h - y;
      const min = Math.min(left, right, top, bottom);
      if (min === left) x = o.x - r;
      else if (min === right) x = o.x + o.w + r;
      else if (min === top) y = o.y - r;
      else y = o.y + o.h + r;
    }
  }
  return { x, y };
}

export function pointInObstacles(obstacles: Obstacle[], x: number, y: number, pad = 0) {
  for (const o of obstacles) {
    if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
  }
  return false;
}

/** A spawn point that isn't inside terrain. */
export function safeSpawn(world: World, rng: () => number = Math.random) {
  for (let i = 0; i < 60; i++) {
    const x = 80 + rng() * (world.w - 160);
    const y = 80 + rng() * (world.h - 160);
    if (!pointInObstacles(world.obstacles, x, y, 24)) return { x, y };
  }
  return { x: world.w / 2, y: world.h / 2 };
}

/** True when a circle (e.g. a projectile) overlaps any obstacle. */
export function circleHitsObstacle(obstacles: Obstacle[], x: number, y: number, r: number) {
  for (const o of obstacles) {
    const cx = Math.max(o.x, Math.min(x, o.x + o.w));
    const cy = Math.max(o.y, Math.min(y, o.y + o.h));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** A cluster of spawn points around one safe location — used for the bot squad. */
export function groupSpawn(world: World, count: number, rng: () => number = Math.random) {
  const centre = safeSpawn(world, rng);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / Math.max(1, count)) * Math.PI * 2;
    const rad = 70;
    let x = centre.x + Math.cos(ang) * rad;
    let y = centre.y + Math.sin(ang) * rad;
    x = Math.max(40, Math.min(world.w - 40, x));
    y = Math.max(40, Math.min(world.h - 40, y));
    const fix = resolveCircle(world.obstacles, x, y, 18);
    out.push(fix);
  }
  return out;
}
