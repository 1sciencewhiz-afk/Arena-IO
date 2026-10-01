import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { announceRoom } from "@/lib/arena/lobby";
import { TouchControls } from "@/components/arena/TouchControls";
import { HowToPlayContent } from "@/components/arena/HowToPlayContent";
import { useAuthUser, useProfile, useIsAdmin } from "@/lib/arena/auth";
import { useLoadout } from "@/lib/arena/loadout";
import {
  WEAPONS,
  WEAPON_ORDER,
  UPGRADE_MAX,
  damageTakenMult,
  ZERO_UPGRADES,
  dmgMult,
  cooldownMult,
  speedMult,
  maxHp,
  RARITY_META,
  type WeaponId,
  type Upgrades,
} from "@/lib/arena/weapons";
import {
  buildWorld,
  decodeConfig,
  encodeConfig,
  resolveCircle,
  safeSpawn,
  circleHitsObstacle,
  inSafeZone,
  groupSpawn,
  randomLootWeapon,
  MEDKIT_HEAL,
  PICKUP_R,
  PICKUP_RESPAWN_MS,
  PUBLIC_CONFIG,
  DEFAULT_CONFIG,
  MAP_SIZES,
  type RoomConfig,
  type World,
} from "@/lib/arena/world";


export const Route = createFileRoute("/room/$code")({
  head: () => ({
    meta: [{ title: "Arena Room" }, { name: "robots", content: "noindex" }],
  }),
  component: RoomPage,
});

const VIEW_W = 1200;
const VIEW_H = 700;
const PLAYER_R = 18;
const BASE_SPEED = 260;
const ADMIN_HP = 999;

/** Cooperative AI squad — one ranged, one summoner, one melee. */
type BotDef = {
  id: string; name: string; color: string; weapon: WeaponId;
  hp: number; speed: number; keep: number; range: number;
};
const BOT_DEFS: BotDef[] = [
  { id: "bot:ranged",   name: "Sentry",  color: "#f97316", weapon: "smg",           hp: 130, speed: 190, keep: 260, range: 380 },
  { id: "bot:summoner", name: "Warlock", color: "#a855f7", weapon: "mini_soldiers", hp: 110, speed: 155, keep: 430, range: 560 },
  { id: "bot:melee",    name: "Brute",   color: "#ef4444", weapon: "battleaxe",     hp: 190, speed: 235, keep: 0,   range: 62  },
];
const isBot = (id: string) => id.startsWith("bot:");


type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  hp: number;
  maxHp: number;
  kills: number;
  upgrades: Upgrades;
  aim: number;
  immobilizedUntil: number; // performance.now ms
};

type Projectile = {
  id: string;
  owner: string;
  ownerColor: string;
  weapon: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  radius: number;
  splash?: number;
  born: number;
  lifetime: number;
  armed?: number;        // mine arms at
  trigger?: number;      // mine trigger radius
  bouncesLeft?: number;  // grenade
  fuseAt?: number;       // grenade explodes at
  pierce?: boolean;      // spear
  hitSet?: Set<string>;  // pierce: who already got hit
  homing?: { turn: number; range: number };
  immobilize?: number;   // ms freeze on hit
  px?: number;           // previous position (swept collision)
  py?: number;
  seek?: number;         // summoned units: current heading
  stuckAt?: number;      // summoned units: last time they got wedged
  nextShotAt?: number;   // summoned units: next pistol shot time
  unitHp?: number;       // summoned units: personal health
  unitMaxHp?: number;

};

type SwingFx = { x: number; y: number; ang: number; range: number; arc: number; born: number; color: string };
type BoomFx = { x: number; y: number; r: number; born: number; color: string };

function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 85% 60%)`;
}

function emptyCooldowns(): Record<WeaponId, number> {
  const out = {} as Record<WeaponId, number>;
  for (const id of WEAPON_ORDER) out[id] = 0;
  return out;
}

function RoomPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const { userId } = useAuthUser();
  const { profile } = useProfile(userId);
  const isAdmin = useIsAdmin(userId);
  const { loadout, update: updateLoadout } = useLoadout(userId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [scoreboard, setScoreboard] = useState<Player[]>([]);
  const [copied, setCopied] = useState(false);
  const [weaponUi, setWeaponUi] = useState<WeaponId>("pistol");
  const [hpUi, setHpUi] = useState({ hp: 100, max: 100 });
  const [matchKills, setMatchKills] = useState(0);
  const [isTouch, setIsTouch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [lootMsg, setLootMsg] = useState<string | null>(null);
  const [lootPick, setLootPick] = useState<WeaponId | null>(null);
  const updateLoadoutRef = useRef<(p: Partial<Loadout>) => unknown>(() => {});
  // Hydrate room name client-side to avoid SSR mismatch
  const [roomName, setRoomName] = useState<string>(code);
  const [config, setConfig] = useState<RoomConfig>(code === "PUBLIC" ? PUBLIC_CONFIG : DEFAULT_CONFIG);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (code === "PUBLIC") { setRoomName("Public Arena"); setConfig(PUBLIC_CONFIG); return; }
    try {
      const stored = sessionStorage.getItem(`arena.roomName.${code}`);
      if (stored) setRoomName(stored);
      const fromUrl = new URLSearchParams(window.location.search).get("c");
      const fromStore = sessionStorage.getItem(`arena.roomConfig.${code}`);
      const cfg = decodeConfig(fromUrl) ?? decodeConfig(fromStore);
      if (cfg) {
        setConfig(cfg);
        sessionStorage.setItem(`arena.roomConfig.${code}`, fromUrl ?? fromStore ?? "");
      }
    } catch { /* ignore */ }
  }, [code]);

  const world: World = useMemo(() => buildWorld(code, config), [code, config]);


  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await (rootRef.current ?? document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const touchCapable =
      "ontouchstart" in window ||
      ((navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 0;
    setIsTouch(touchCapable && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Stable per-tab identity
  const meRef = useRef<{ id: string; name: string }>({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    name:
      (typeof window !== "undefined" && localStorage.getItem("arena.name")) ||
      `Player${Math.floor(Math.random() * 999)}`,
  });

  const loadoutAppliedRef = useRef(false);
  const startKillPointsRef = useRef(0);
  const matchKillsRef = useRef(0);

  // Game state in refs
  const playersRef = useRef<Map<string, Player>>(new Map());
  const projectilesRef = useRef<Projectile[]>([]);
  const swingsRef = useRef<SwingFx[]>([]);
  const boomsRef = useRef<BoomFx[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef({ x: 0, y: 0, down: false });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const weaponRef = useRef<WeaponId>("pistol");
  const lastFireRef = useRef<Record<WeaponId, number>>(emptyCooldowns());
  const chargeStartRef = useRef<number | null>(null);
  const upgradesRef = useRef<Upgrades>({ ...ZERO_UPGRADES });
  const hotbarRef = useRef<WeaponId[]>(["pistol"]);
  const isAdminRef = useRef(false);
  const hostRef = useRef(false);
  const botStateRef = useRef<
    Map<string, {
      lastFire: number; respawnAt: number; aim: number; slot: number;
      strikeAt: number; striking: boolean; dodgeAng: number; dodgeUntil: number;
    }>
  >(new Map());
  const camRef = useRef({ x: 0, y: 0 });
  const takenRef = useRef<Map<string, number>>(new Map());

  // Track admin status in a ref for the game loop
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);

  // Boot banned players back to the lobby
  useEffect(() => {
    if (profile?.banned) navigate({ to: "/" });
  }, [profile?.banned, navigate]);

  // Unified input refs
  const moveVecRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const aimVecRef = useRef<{ dx: number; dy: number } | null>(null);
  const fireRef = useRef(false);
  const controlsApiRef = useRef<{
    setMove: (v: { dx: number; dy: number }) => void;
    setAim: (v: { dx: number; dy: number } | null) => void;
    fireDown: () => void;
    fireUp: () => void;
    melee: () => void;
    selectWeapon: (w: WeaponId) => void;
  } | null>(null);

  updateLoadoutRef.current = updateLoadout;
  // Apply loadout to self when it loads / changes
  useEffect(() => {
    if (!loadout) return;
    upgradesRef.current = { ...loadout.upgrades };
    hotbarRef.current = loadout.hotbar.length ? [...loadout.hotbar] : ["pistol"];

    // Ensure equipped weapon is in hotbar
    if (!hotbarRef.current.includes(weaponRef.current)) {
      weaponRef.current = hotbarRef.current[0];
      setWeaponUi(weaponRef.current);
    }

    const self = playersRef.current.get(meRef.current.id);
    if (self) {
      self.upgrades = { ...loadout.upgrades };
      const newMax = isAdminRef.current ? ADMIN_HP : maxHp(loadout.upgrades);
      if (newMax !== self.maxHp) {
        // Raising max HP (e.g. profile finished loading) tops the player up to full
        self.hp = newMax > self.maxHp ? newMax : Math.min(self.hp, newMax);
        self.maxHp = newMax;
        setHpUi({ hp: self.hp, max: self.maxHp });
      }
    }

    if (!loadoutAppliedRef.current) {
      loadoutAppliedRef.current = true;
      startKillPointsRef.current = loadout.killPoints;
    }
  }, [loadout]);

  // Apply username on first profile load
  useEffect(() => {
    if (!profile?.username) return;
    meRef.current.name = profile.username;
    const self = playersRef.current.get(meRef.current.id);
    if (self) {
      self.name = profile.username;
      channelRef.current?.track({ name: self.name, color: self.color });
    }
  }, [profile?.username]);

  // Debounced save of accumulated match kills as kill points
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!loadoutAppliedRef.current) return;
      if (matchKillsRef.current === 0) return;
      const delta = matchKillsRef.current;
      matchKillsRef.current = 0;
      void updateLoadout({ killPoints: loadout.killPoints + delta });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [matchKills, loadout.killPoints, updateLoadout]);

  // Final flush on unmount
  useEffect(() => {
    return () => {
      if (loadoutAppliedRef.current && matchKillsRef.current > 0) {
        void updateLoadout({ killPoints: loadout.killPoints + matchKillsRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cam = camRef.current;
    const me: Player = {
      id: meRef.current.id,
      name: meRef.current.name,
      ...safeSpawn(world),
      color: colorFor(meRef.current.id),
      hp: maxHp(upgradesRef.current),
      maxHp: maxHp(upgradesRef.current),
      kills: 0,
      upgrades: { ...upgradesRef.current },
      aim: 0,
      immobilizedUntil: 0,
    };
    playersRef.current.set(me.id, me);
    setHpUi({ hp: me.hp, max: me.maxHp });

    const channel = supabase.channel(`arena:room:${code}`, {
      config: {
        broadcast: { self: false },
        presence: { key: me.id },
      },
    });
    channelRef.current = channel;

    let scoreboardTimer = 0;
    function updateScoreboard() {
      const now = performance.now();
      if (now - scoreboardTimer < 200) return;
      scoreboardTimer = now;
      setScoreboard(
        Array.from(playersRef.current.values()).sort((a, b) => b.kills - a.kills),
      );
    }

    function spawnProjectile(p: Projectile) {
      // Summoned units are little soldiers: give each one its own health bar
      if (WEAPONS[p.weapon]?.summon && p.unitHp == null) {
        p.unitMaxHp = 14;
        p.unitHp = 14;
      }
      projectilesRef.current.push(p);
    }

    function applyDamage(targetId: string, byId: string, dmg: number, weapon: WeaponId, immobilizeMs?: number) {
      const t = playersRef.current.get(targetId);
      if (!t || t.hp <= 0) return;
      // Respawn safe zones: no damage in, no damage out
      if (inSafeZone(world, t.x, t.y)) return;
      const attacker = playersRef.current.get(byId);
      if (attacker && inSafeZone(world, attacker.x, attacker.y)) return;
      t.hp = Math.max(0, t.hp - dmg * damageTakenMult(t.upgrades));
      if (immobilizeMs && targetId === me.id) {
        t.immobilizedUntil = Math.max(t.immobilizedUntil, performance.now() + immobilizeMs);
      } else if (immobilizeMs) {
        t.immobilizedUntil = Math.max(t.immobilizedUntil, performance.now() + immobilizeMs);
      }
      if (t.hp === 0) {
        const shooter = playersRef.current.get(byId);
        if (shooter) shooter.kills += 1;
        if (byId === me.id) {
          matchKillsRef.current += 1;
          setMatchKills(matchKillsRef.current);
        }
        if (targetId === me.id) {
          setTimeout(() => {
            const self = playersRef.current.get(me.id);
            if (self) {
              self.maxHp = maxHp(self.upgrades);
              self.hp = self.maxHp;
              const sp = safeSpawn(world);
              self.x = sp.x; self.y = sp.y;
              self.immobilizedUntil = 0;
              setHpUi({ hp: self.hp, max: self.maxHp });
            }
          }, 1500);
        }
      }
      if (targetId === me.id) setHpUi({ hp: t.hp, max: t.maxHp });
      updateScoreboard();
      void weapon;
    }

    const clampNum = (v: unknown, min: number, max: number, def = 0) => {
      const n = typeof v === "number" && Number.isFinite(v) ? v : def;
      return Math.max(min, Math.min(max, n));
    };

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string; color: string }>();
        const presentIds = new Set(Object.keys(state));
        for (const id of Array.from(playersRef.current.keys())) {
          if (!presentIds.has(id) && !isBot(id)) playersRef.current.delete(id);
        }
        // Lowest id present hosts the bot squad
        const sorted = Array.from(presentIds).sort();
        hostRef.current = sorted.length > 0 && sorted[0] === me.id;
        if (hostRef.current && config.bots) ensureBots();
        else for (const b of BOT_DEFS) botStateRef.current.delete(b.id);
        for (const id of presentIds) {
          if (!playersRef.current.has(id)) {
            const meta = state[id]?.[0];
            playersRef.current.set(id, {
              id,
              name: meta?.name ?? "???",
              x: world.w / 2,
              y: world.h / 2,
              color: meta?.color ?? colorFor(id),
              hp: 100,
              maxHp: 100,
              kills: 0,
              upgrades: { ...ZERO_UPGRADES },
              aim: 0,
              immobilizedUntil: 0,
            });
          }
        }
        updateScoreboard();
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const p = payload as {
          id: string; x: number; y: number; hp: number; maxHp: number; name: string;
          kills: number; color: string; upgrades: Upgrades; aim?: number;
        };
        if (!p || typeof p.id !== "string" || p.id === me.id) return;
        const safeMaxHp = clampNum(p.maxHp, 1, 99999, 100);
        const safeHp = clampNum(p.hp, 0, safeMaxHp, safeMaxHp);
        const safeKills = clampNum(p.kills, 0, 100000, 0);
        const rawU = (p.upgrades ?? ZERO_UPGRADES) as Upgrades;
        const safeUpgrades: Upgrades = {
          damage: clampNum(rawU.damage, 0, UPGRADE_MAX.damage),
          cooldown: clampNum(rawU.cooldown, 0, UPGRADE_MAX.cooldown),
          speed: clampNum(rawU.speed, 0, UPGRADE_MAX.speed),
          health: clampNum(rawU.health, 0, UPGRADE_MAX.health),
          armour: clampNum(rawU.armour, 0, UPGRADE_MAX.armour),
        };
        const safeName = typeof p.name === "string" ? p.name.slice(0, 32) : "Player";
        const safeColor = typeof p.color === "string" ? p.color.slice(0, 32) : colorFor(p.id);
        const safeX = clampNum(p.x, -10000, 10000);
        const safeY = clampNum(p.y, -10000, 10000);
        const safeAim = clampNum(p.aim, -Math.PI * 4, Math.PI * 4, 0);
        const existing = playersRef.current.get(p.id);
        if (existing) {
          existing.x = safeX; existing.y = safeY;
          existing.hp = safeHp; existing.maxHp = safeMaxHp;
          existing.kills = safeKills;
          existing.name = safeName; existing.color = safeColor;
          existing.upgrades = safeUpgrades;
          existing.aim = safeAim;
        } else {
          playersRef.current.set(p.id, {
            id: p.id, name: safeName, x: safeX, y: safeY,
            color: safeColor || colorFor(p.id),
            hp: safeHp, maxHp: safeMaxHp, kills: safeKills,
            upgrades: safeUpgrades, aim: safeAim, immobilizedUntil: 0,
          });
        }
      })
      .on("broadcast", { event: "fire" }, ({ payload }) => {
        const projectiles = (payload as { projectiles: Projectile[] }).projectiles;
        if (!Array.isArray(projectiles)) return;
        for (const pr of projectiles.slice(0, 64)) {
          const wDef = WEAPONS[pr?.weapon as WeaponId];
          if (!wDef) continue;
          const maxDmg = wDef.dmg * 3;
          const safeDmg = Math.max(0, Math.min(Number(pr.dmg) || 0, maxDmg));
          const rp: Projectile = { ...pr, dmg: safeDmg, hitSet: undefined };
          if (wDef.summon && rp.unitHp == null) { rp.unitMaxHp = 14; rp.unitHp = 14; }
          projectilesRef.current.push(rp);
        }
      })
      .on("broadcast", { event: "swing" }, ({ payload }) => {
        const s = payload as SwingFx;
        swingsRef.current.push({ ...s, born: performance.now() });
      })
      .on("broadcast", { event: "boom" }, ({ payload }) => {
        const b = payload as BoomFx;
        boomsRef.current.push({ ...b, born: performance.now() });
      })
      .on("broadcast", { event: "despawn" }, ({ payload }) => {
        const ids = new Set((payload as { ids: string[] }).ids);
        projectilesRef.current = projectilesRef.current.filter((p) => !ids.has(p.id));
      })
      .on("broadcast", { event: "hit" }, ({ payload }) => {
        const { target, by, dmg, weapon, immobilize } = payload as {
          target: string; by: string; dmg: number; weapon: WeaponId; immobilize?: number;
        };
        if (typeof target !== "string" || typeof by !== "string") return;
        const wDef = WEAPONS[weapon];
        if (!wDef) return;
        const maxDmg = wDef.dmg * 3;
        const n = typeof dmg === "number" && Number.isFinite(dmg) ? dmg : 0;
        const safeDmg = Math.max(0, Math.min(n, maxDmg));
        const safeImmo = Math.max(0, Math.min(Number(immobilize) || 0, 3000));
        applyDamage(target, by, safeDmg, weapon, safeImmo || undefined);
      })
      .on("broadcast", { event: "taken" }, ({ payload }) => {
        const id = (payload as { id?: string })?.id;
        if (typeof id !== "string") return;
        takenRef.current.set(id, performance.now() + PICKUP_RESPAWN_MS);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          await channel.track({ name: me.name, color: me.color });
        }
      });

    // Only the public arena is advertised in the lobby — private rooms stay hidden
    const stopAnnounce =
      code === "PUBLIC"
        ? announceRoom({ roomCode: code, roomName, playerName: me.name })
        : () => {};

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysRef.current.add(key);
      const idx = ["1", "2", "3", "4"].indexOf(key);
      if (idx >= 0) {
        const w = hotbarRef.current[idx];
        if (w) {
          weaponRef.current = w;
          chargeStartRef.current = null;
          setWeaponUi(w);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const canvas = canvasRef.current!;
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * VIEW_W + cam.x;
      mouseRef.current.y = ((e.clientY - rect.top) / rect.height) * VIEW_H + cam.y;
    };
    const onMouseDown = () => {
      mouseRef.current.down = true;
      fireRef.current = true;
      if (weaponRef.current === "sniper") chargeStartRef.current = performance.now();
    };
    const onMouseUp = () => {
      if (weaponRef.current === "sniper" && chargeStartRef.current != null) {
        fireSniperRelease();
        chargeStartRef.current = null;
      }
      mouseRef.current.down = false;
      fireRef.current = false;
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    controlsApiRef.current = {
      setMove: (v) => { moveVecRef.current = v; },
      setAim: (v) => { aimVecRef.current = v; },
      fireDown: () => {
        fireRef.current = true;
        if (weaponRef.current === "sniper") chargeStartRef.current = performance.now();
      },
      fireUp: () => {
        if (weaponRef.current === "sniper" && chargeStartRef.current != null) {
          fireSniperRelease();
          chargeStartRef.current = null;
        }
        fireRef.current = false;
      },
      melee: () => {
        // Tap melee triggers the equipped melee weapon if present; otherwise sword
        const cur = weaponRef.current;
        const wDef = WEAPONS[cur];
        if (wDef.melee) swingMelee(performance.now(), cur);
        else if (hotbarRef.current.includes("sword")) swingMelee(performance.now(), "sword");
        else if (hotbarRef.current.includes("battleaxe")) swingMelee(performance.now(), "battleaxe");
      },
      selectWeapon: (w) => {
        if (!hotbarRef.current.includes(w)) return;
        weaponRef.current = w;
        chargeStartRef.current = null;
        setWeaponUi(w);
      },
    };

    function fireSniperRelease() {
      const self = playersRef.current.get(me.id);
      if (!self || self.hp <= 0) return;
      const w = WEAPONS.sniper;
      const now = performance.now();
      const t = now / 1000;
      const cd = w.cooldown * cooldownMult(self.upgrades);
      if (t - lastFireRef.current.sniper < cd) return;
      lastFireRef.current.sniper = t;
      const chargedMs = chargeStartRef.current ? now - chargeStartRef.current : 0;
      const chargeRatio = Math.min(1, chargedMs / ((w.charge ?? 0.6) * 1000));
      const ang = currentAimAngle(self);
      const dmg = w.dmg * (0.4 + 0.6 * chargeRatio) * dmgMult(self.upgrades);
      const p: Projectile = {
        id: `${me.id}-s-${now}`,
        owner: me.id, ownerColor: self.color, weapon: "sniper",
        x: self.x + Math.cos(ang) * (PLAYER_R + 4),
        y: self.y + Math.sin(ang) * (PLAYER_R + 4),
        vx: Math.cos(ang) * w.speed,
        vy: Math.sin(ang) * w.speed,
        dmg, radius: w.radius, born: now, lifetime: w.lifetime,
      };
      spawnProjectile(p);
      channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: [stripSet(p)] } });
    }

    function currentAimAngle(self: Player): number {
      const v = aimVecRef.current;
      if (v && (v.dx !== 0 || v.dy !== 0)) return Math.atan2(v.dy, v.dx);
      return Math.atan2(mouseRef.current.y - self.y, mouseRef.current.x - self.x);
    }

    function swingMelee(now: number, weaponId: WeaponId) {
      const self = playersRef.current.get(me.id);
      if (!self || self.hp <= 0) return;
      const w = WEAPONS[weaponId];
      if (!w.melee) return;
      const t = now / 1000;
      const cd = w.cooldown * cooldownMult(self.upgrades);
      if (t - lastFireRef.current[weaponId] < cd) return;
      lastFireRef.current[weaponId] = t;
      const ang = currentAimAngle(self);
      const dmgScale = dmgMult(self.upgrades);
      const swing: SwingFx = {
        x: self.x, y: self.y, ang, range: w.melee.range, arc: w.melee.arc,
        born: now, color: self.color,
      };
      swingsRef.current.push(swing);
      channelRef.current?.send({ type: "broadcast", event: "swing", payload: swing });
      for (const other of playersRef.current.values()) {
        if (other.id === me.id || other.hp <= 0) continue;
        const dx = other.x - self.x;
        const dy = other.y - self.y;
        const dist = Math.hypot(dx, dy);
        if (dist > w.melee.range + PLAYER_R) continue;
        const a = Math.atan2(dy, dx);
        let diff = a - ang;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) <= w.melee.arc / 2) {
          const dmg = w.dmg * dmgScale;
          applyDamage(other.id, me.id, dmg, weaponId);
          channelRef.current?.send({
            type: "broadcast", event: "hit",
            payload: { target: other.id, by: me.id, dmg, weapon: weaponId },
          });
        }
      }
    }

    const isMine = (ownerId: string) =>
      ownerId === me.id || (hostRef.current && isBot(ownerId));
    const isEnemyOf = (ownerId: string, other: Player) =>
      other.hp > 0 && other.id !== ownerId && !(isBot(ownerId) && isBot(other.id));

    function ensureBots() {
      // The squad drops in together, clustered around one safe location
      const spots = groupSpawn(world, BOT_DEFS.length);
      BOT_DEFS.forEach((def, i) => {
        if (!playersRef.current.has(def.id)) {
          playersRef.current.set(def.id, {
            id: def.id, name: def.name,
            ...spots[i],
            color: def.color, hp: def.hp, maxHp: def.hp, kills: 0,
            upgrades: { ...ZERO_UPGRADES }, aim: 0, immobilizedUntil: 0,
          });
        }
        if (!botStateRef.current.has(def.id)) {
          botStateRef.current.set(def.id, {
            lastFire: 0, respawnAt: 0, aim: 0, slot: i, strikeAt: 0, striking: false,
            dodgeAng: 0, dodgeUntil: 0,
          });
        }
      });
    }

    /** Spawn a bullet owned by a bot (or a summoned unit) and tell everyone. */
    function spawnOwnedBullet(
      ownerId: string, ownerColor: string, weapon: WeaponId,
      x: number, y: number, ang: number, dmg: number, now: number, tag: string,
    ) {
      const w = WEAPONS[weapon];
      const p: Projectile = {
        id: `${ownerId}-${tag}-${Math.round(now)}-${Math.random().toString(36).slice(2, 6)}`,
        owner: ownerId, ownerColor, weapon,
        x: x + Math.cos(ang) * (PLAYER_R + 4),
        y: y + Math.sin(ang) * (PLAYER_R + 4),
        vx: Math.cos(ang) * w.speed,
        vy: Math.sin(ang) * w.speed,
        dmg, radius: w.radius, splash: w.splash,
        born: now, lifetime: w.lifetime,
        homing: w.homing,
      };
      spawnProjectile(p);
      channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: [stripSet(p)] } });
    }

    /** Nearest valid enemy for an owner id. */
    function nearestEnemy(ownerId: string, x: number, y: number, maxDist: number): Player | null {
      let best: Player | null = null;
      let bestD = maxDist;
      for (const other of playersRef.current.values()) {
        if (!isEnemyOf(ownerId, other)) continue;
        const d = Math.hypot(other.x - x, other.y - y);
        if (d < bestD) { best = other; bestD = d; }
      }
      return best;
    }

    /** Shortest distance from a point to a movement segment. */
    function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 < 0.0001) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * dx + (py - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
    }

    /** Swept terrain test along a projectile's travel this frame. */
    function segHitsObstacle(x1: number, y1: number, x2: number, y2: number, r: number) {
      const d = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(1, Math.ceil(d / Math.max(4, r)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (circleHitsObstacle(world.obstacles, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r)) return true;
      }
      return false;
    }

    /** Travel path of a projectile this frame (falls back to its position). */
    const pathOf = (b: Projectile) => ({ x1: b.px ?? b.x, y1: b.py ?? b.y, x2: b.x, y2: b.y });

    /** True when nothing solid sits between two points. */
    function losClear(x1: number, y1: number, x2: number, y2: number, r = 6) {
      const d = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(2, Math.ceil(d / 26));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (circleHitsObstacle(world.obstacles, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r)) return false;
      }
      return true;
    }

    /**
     * Greedy "pathfinding": probe fanned-out headings and keep the one that is
     * both clear for a few body-lengths and closest to the desired direction.
     */
    function steerAround(x: number, y: number, desired: number, r: number, probe = 90) {
      const offsets = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.2, -2.2, 2.8, -2.8, Math.PI];
      for (const o of offsets) {
        const a = desired + o;
        if (losClear(x, y, x + Math.cos(a) * probe, y + Math.sin(a) * probe, r)) return a;
      }
      return desired;
    }

    /**
     * Perpendicular escape direction from the nearest incoming enemy shot.
     * Shots that would smack into a wall before reaching the bot are ignored,
     * so bots stop twitching when a player sprays the cover in front of them.
     */
    function dodgeVec(bot: Player, lookahead = 260) {
      for (const b of projectilesRef.current) {
        if (b.owner === bot.id || isBot(b.owner)) continue;
        if (b.radius <= 0) continue;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp < 20) continue;
        const dx = bot.x - b.x;
        const dy = bot.y - b.y;
        const along = (dx * b.vx + dy * b.vy) / sp;
        if (along < 0 || along > lookahead) continue;
        const px = -b.vy / sp;
        const py = b.vx / sp;
        const lateral = dx * px + dy * py;
        if (Math.abs(lateral) > PLAYER_R + b.radius + 26) continue;
        // A wall between the shot and the bot means it is never arriving
        if (!losClear(b.x, b.y, bot.x, bot.y, Math.max(4, b.radius))) continue;
        const side = lateral >= 0 ? 1 : -1;
        return Math.atan2(py * side, px * side);
      }
      return null;
    }

    /** A nearby spot that breaks line of sight with `from` — used while reloading. */
    function coverSpot(bot: Player, from: Player) {
      let best: { x: number; y: number; d: number } | null = null;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        for (const rad of [90, 170, 250]) {
          const x = Math.max(40, Math.min(world.w - 40, bot.x + Math.cos(a) * rad));
          const y = Math.max(40, Math.min(world.h - 40, bot.y + Math.sin(a) * rad));
          if (circleHitsObstacle(world.obstacles, x, y, PLAYER_R + 4)) continue;
          if (losClear(x, y, from.x, from.y)) continue; // still exposed
          const d = Math.hypot(x - bot.x, y - bot.y);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      return best;
    }

    /** Sentry shield: shoot down enemy fire heading for itself or a team-mate. */
    function sentryIntercept(now: number) {
      const sentry = playersRef.current.get("bot:ranged");
      if (!sentry || sentry.hp <= 0) return;
      const mates = BOT_DEFS
        .map((d) => playersRef.current.get(d.id))
        .filter((p): p is Player => !!p && p.hp > 0);
      const dead: string[] = [];
      for (const b of projectilesRef.current) {
        if (isBot(b.owner) || b.radius <= 0) continue;
        if (!isMine(b.owner) && !hostRef.current) continue;
        const dS = Math.hypot(b.x - sentry.x, b.y - sentry.y);
        if (dS > 150) continue;                                  // shield arc radius
        // Only stop shots actually flying at the squad
        const threat = mates.some((m) => {
          const sp = Math.hypot(b.vx, b.vy) || 1;
          const along = ((m.x - b.x) * b.vx + (m.y - b.y) * b.vy) / sp;
          if (along < 0 || along > 500) return false;
          const lateral = Math.abs((m.x - b.x) * (-b.vy / sp) + (m.y - b.y) * (b.vx / sp));
          return lateral < PLAYER_R + b.radius + 18;
        });
        if (!threat) continue;
        dead.push(b.id);
        boomsRef.current.push({ x: b.x, y: b.y, r: 16, born: now, color: "#f97316" });
      }
      if (!dead.length) return;
      const set = new Set(dead);
      projectilesRef.current = projectilesRef.current.filter((p) => !set.has(p.id));
      channelRef.current?.send({ type: "broadcast", event: "despawn", payload: { ids: dead } });
    }

    /** Summoned units (Army / Mini Soldiers) shoot their pistols. */

    function unitFire(b: Projectile, now: number) {
      const w = WEAPONS[b.weapon];
      if (!w.summon) return;
      if (b.nextShotAt == null) b.nextShotAt = b.born + 400;
      if (now < b.nextShotAt) return;
      const target = nearestEnemy(b.owner, b.x, b.y, 420);
      if (!target) { b.nextShotAt = now + 200; return; }
      b.nextShotAt = now + 650;
      const ang = Math.atan2(target.y - b.y, target.x - b.x);
      const pw = WEAPONS.pistol;
      const p: Projectile = {
        id: `${b.id}-s${Math.round(now)}`,
        owner: b.owner, ownerColor: b.ownerColor, weapon: "pistol",
        x: b.x + Math.cos(ang) * (b.radius + 5),
        y: b.y + Math.sin(ang) * (b.radius + 5),
        vx: Math.cos(ang) * pw.speed,
        vy: Math.sin(ang) * pw.speed,
        dmg: Math.min(b.dmg, pw.dmg * 2),
        radius: 3,
        born: now, lifetime: 900,
      };
      spawnProjectile(p);
      channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: [stripSet(p)] } });
    }

    let lastBotBroadcast = 0;
    function botTick(now: number, dt: number) {
      ensureBots();
      // Shared focus: the human closest to the squad
      let focus: Player | null = null;
      let focusD = Infinity;
      for (const other of playersRef.current.values()) {
        if (isBot(other.id) || other.hp <= 0) continue;
        for (const def of BOT_DEFS) {
          const bp = playersRef.current.get(def.id);
          if (!bp) continue;
          const d = Math.hypot(other.x - bp.x, other.y - bp.y);
          if (d < focusD) { focusD = d; focus = other; }
        }
      }

      for (const def of BOT_DEFS) {
        const bot = playersRef.current.get(def.id);
        const st = botStateRef.current.get(def.id);
        if (!bot || !st) continue;

        if (bot.hp <= 0) {
          if (st.respawnAt === 0) st.respawnAt = now + 6000;
          else if (now >= st.respawnAt) {
            st.respawnAt = 0;
            bot.hp = bot.maxHp;
            // Rejoin the squad: drop next to a living team-mate when there is one
            const mate = BOT_DEFS.map((d) => playersRef.current.get(d.id))
              .find((b) => b && b.id !== bot.id && b.hp > 0);
            const bsp = mate
              ? resolveCircle(world.obstacles, mate.x + 60, mate.y + 40, PLAYER_R)
              : safeSpawn(world);
            bot.x = bsp.x; bot.y = bsp.y;
          }
          continue;
        }
        if (!focus) continue;

        const dx = focus.x - bot.x;
        const dy = focus.y - bot.y;
        const dist = Math.hypot(dx, dy) || 1;
        bot.aim = Math.atan2(dy, dx);
        const seen = losClear(bot.x, bot.y, focus.x, focus.y);

        // Ambush cycle: creep into a surround slot out of sight, then strike together
        if (st.strikeAt === 0) st.strikeAt = now + 4500;
        if (now >= st.strikeAt) {
          st.striking = !st.striking;
          st.strikeAt = now + (st.striking ? 6500 : 5000);
        }

        const AMBUSH_R = 640; // just outside the player's view
        const ring = st.striking ? Math.max(def.keep, 70) : Math.max(def.keep, AMBUSH_R);
        const slotAng = (st.slot / BOT_DEFS.length) * Math.PI * 2 + now / 6000;
        const goalX = Math.max(40, Math.min(world.w - 40, focus.x + Math.cos(slotAng) * ring));
        const goalY = Math.max(40, Math.min(world.h - 40, focus.y + Math.sin(slotAng) * ring));

        let desired = Math.atan2(goalY - bot.y, goalX - bot.x);
        const goalD = Math.hypot(goalX - bot.x, goalY - bot.y);

        // Sentry never charges: it holds a firing line and backs off when
        // a player closes the gap, staying alive to block shots.
        if (def.id === "bot:ranged") {
          const hold = def.range * 0.8;
          if (dist < hold - 60) {
            desired = Math.atan2(-dy, -dx);       // retreat
          } else if (dist > def.range * 0.95) {
            desired = Math.atan2(dy, dx);          // drift into range
          } else {
            desired = Math.atan2(dy, dx) + Math.PI / 2; // strafe on the line
          }
        }

        // Warlock retreats behind cover while its summon is on cooldown
        let reloading = false;
        if (def.id === "bot:summoner") {
          const wDef = WEAPONS[def.weapon];
          reloading = now - st.lastFire < wDef.cooldown * 1000;
          if (reloading && seen) {
            const spot = coverSpot(bot, focus);
            if (spot) desired = Math.atan2(spot.y - bot.y, spot.x - bot.x);
          }
        }

        // Twitchy evasion: bots flick side to side under fire so they are hard
        // to lead, but only against shots that can actually reach them.
        let speedMul = 1;
        let jinking = false;
        if (now < st.dodgeUntil) {
          desired = st.dodgeAng; speedMul = 1.35; jinking = true;
        } else {
          const dodge = dodgeVec(bot);
          if (dodge != null) {
            // Alternate sides each burst for a shuddering, unpredictable path
            const flip = Math.sin(now / 90) > 0 ? 0 : Math.PI;
            st.dodgeAng = dodge + flip;
            st.dodgeUntil = now + 130;
            desired = st.dodgeAng; speedMul = 1.35; jinking = true;
          }
        }
        // Constant micro-strafe while engaged keeps them shuddering
        if (!jinking && seen && dist < def.range * 1.1) {
          desired += Math.sin(now / 140 + st.slot) * 0.9;
        }

        if (goalD > 26 || speedMul > 1 || reloading || (seen && dist < def.range * 1.1)) {
          const ang = steerAround(bot.x, bot.y, desired, PLAYER_R, Math.min(110, goalD + 30));
          const sp = def.speed * (st.striking ? 1.15 : 0.85) * speedMul * (reloading ? 1.1 : 1);
          bot.x += Math.cos(ang) * sp * dt;
          bot.y += Math.sin(ang) * sp * dt;
          bot.x = Math.max(PLAYER_R, Math.min(world.w - PLAYER_R, bot.x));
          bot.y = Math.max(PLAYER_R, Math.min(world.h - PLAYER_R, bot.y));
          const bfix = resolveCircle(world.obstacles, bot.x, bot.y, PLAYER_R);
          bot.x = bfix.x; bot.y = bfix.y;
          // Bots are pushed out of respawn safe zones
          for (const z of world.safeZones) {
            const d = Math.hypot(bot.x - z.x, bot.y - z.y);
            if (d < z.r + PLAYER_R) {
              const a = d < 0.001 ? Math.random() * Math.PI * 2 : Math.atan2(bot.y - z.y, bot.x - z.x);
              bot.x = z.x + Math.cos(a) * (z.r + PLAYER_R);
              bot.y = z.y + Math.sin(a) * (z.r + PLAYER_R);
            }
          }
        }


        const w = WEAPONS[def.weapon];
        if (now - st.lastFire < w.cooldown * 1000) continue;
        if (dist > def.range) continue;
        if (!w.melee && !seen) continue;               // don't shoot through walls
        if (!st.striking && dist > def.range * 0.6) continue; // stay hidden until the ambush
        st.lastFire = now;


        if (w.melee) {
          const swing: SwingFx = {
            x: bot.x, y: bot.y, ang: bot.aim, range: w.melee.range, arc: w.melee.arc,
            born: now, color: bot.color,
          };
          swingsRef.current.push(swing);
          channelRef.current?.send({ type: "broadcast", event: "swing", payload: swing });
          for (const other of playersRef.current.values()) {
            if (!isEnemyOf(bot.id, other)) continue;
            const ox = other.x - bot.x; const oy = other.y - bot.y;
            if (Math.hypot(ox, oy) > w.melee.range + PLAYER_R) continue;
            let diff = Math.atan2(oy, ox) - bot.aim;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) <= w.melee.arc / 2) {
              applyDamage(other.id, bot.id, w.dmg, def.weapon);
              channelRef.current?.send({
                type: "broadcast", event: "hit",
                payload: { target: other.id, by: bot.id, dmg: w.dmg, weapon: def.weapon },
              });
            }
          }
        } else if (w.summon) {
          for (let i = 0; i < w.summon; i++) {
            const fan = (i - (w.summon - 1) / 2) * 0.35;
            spawnOwnedBullet(bot.id, bot.color, def.weapon, bot.x, bot.y, bot.aim + fan, w.dmg, now, `sum${i}`);
          }
        } else {
          const jitter = (Math.random() - 0.5) * (w.spread ?? 0.12);
          spawnOwnedBullet(bot.id, bot.color, def.weapon, bot.x, bot.y, bot.aim + jitter, w.dmg, now, "b");
        }
      }

      sentryIntercept(now);


      if (now - lastBotBroadcast > 60) {
        lastBotBroadcast = now;
        for (const def of BOT_DEFS) {
          const bot = playersRef.current.get(def.id);
          if (!bot) continue;
          channelRef.current?.send({
            type: "broadcast", event: "state",
            payload: {
              id: bot.id, name: bot.name, x: bot.x, y: bot.y,
              hp: bot.hp, maxHp: bot.maxHp, kills: bot.kills, color: bot.color,
              upgrades: bot.upgrades, aim: bot.aim,
            },
          });
        }
      }
    }

    function tryFire(now: number) {
      const self = playersRef.current.get(me.id);
      if (!self || self.hp <= 0) return;
      if (!fireRef.current) return;
      const wId = weaponRef.current;
      if (!hotbarRef.current.includes(wId)) return;
      const w = WEAPONS[wId];
      if (w.melee) { swingMelee(now, w.id); return; }
      const t = now / 1000;
      const cd = w.cooldown * cooldownMult(self.upgrades);
      if (t - lastFireRef.current[w.id] < cd) return;
      if (w.id === "sniper") return; // release-to-fire
      lastFireRef.current[w.id] = t;
      const ang = currentAimAngle(self);
      const dmgScale = dmgMult(self.upgrades);



      if (w.placeable) {
        const p: Projectile = {
          id: `${me.id}-m-${now}`,
          owner: me.id, ownerColor: self.color, weapon: w.id,
          x: self.x, y: self.y, vx: 0, vy: 0,
          dmg: w.dmg * dmgScale, radius: w.radius, splash: w.splash,
          born: now, lifetime: w.lifetime,
          armed: now + w.placeable.armTime, trigger: w.placeable.trigger,
        };
        spawnProjectile(p);
        channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: [stripSet(p)] } });
        return;
      }

      // Mini soldiers: spawn `summon` homing helpers in a fan
      if (w.summon) {
        const batch: Projectile[] = [];
        for (let i = 0; i < w.summon; i++) {
          const fan = (i - (w.summon - 1) / 2) * 0.35;
          const a = ang + fan;
          const p: Projectile = {
            id: `${me.id}-${w.id}-${now}-${i}`,
            owner: me.id, ownerColor: self.color, weapon: w.id,
            x: self.x + Math.cos(a) * (PLAYER_R + 4),
            y: self.y + Math.sin(a) * (PLAYER_R + 4),
            vx: Math.cos(a) * w.speed,
            vy: Math.sin(a) * w.speed,
            dmg: w.dmg * dmgScale,
            radius: w.radius,
            born: now, lifetime: w.lifetime,
            homing: w.homing,
          };
          batch.push(p);
          spawnProjectile(p);
        }
        channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: batch.map(stripSet) } });
        return;
      }

      // Twin barrel: dual pistols → two parallel bullets
      if (w.twin) {
        const batch: Projectile[] = [];
        const perp = ang + Math.PI / 2;
        for (const sgn of [-1, 1]) {
          const ox = Math.cos(perp) * 6 * sgn;
          const oy = Math.sin(perp) * 6 * sgn;
          const p: Projectile = {
            id: `${me.id}-${w.id}-${now}-${sgn}`,
            owner: me.id, ownerColor: self.color, weapon: w.id,
            x: self.x + Math.cos(ang) * (PLAYER_R + 4) + ox,
            y: self.y + Math.sin(ang) * (PLAYER_R + 4) + oy,
            vx: Math.cos(ang) * w.speed,
            vy: Math.sin(ang) * w.speed,
            dmg: w.dmg * dmgScale,
            radius: w.radius,
            born: now, lifetime: w.lifetime,
          };
          batch.push(p);
          spawnProjectile(p);
        }
        channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: batch.map(stripSet) } });
        return;
      }

      // Grenade: bouncing + fused
      if (w.bouncing) {
        const p: Projectile = {
          id: `${me.id}-${w.id}-${now}`,
          owner: me.id, ownerColor: self.color, weapon: w.id,
          x: self.x + Math.cos(ang) * (PLAYER_R + 4),
          y: self.y + Math.sin(ang) * (PLAYER_R + 4),
          vx: Math.cos(ang) * w.speed,
          vy: Math.sin(ang) * w.speed,
          dmg: w.dmg * dmgScale,
          radius: w.radius, splash: w.splash,
          born: now, lifetime: w.lifetime,
          bouncesLeft: w.bouncing.bounces,
          fuseAt: now + w.bouncing.fuse,
        };
        spawnProjectile(p);
        channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: [stripSet(p)] } });
        return;
      }

      // Standard ranged
      const pellets = w.pellets ?? 1;
      const spread = w.spread ?? 0;
      const batch: Projectile[] = [];
      for (let i = 0; i < pellets; i++) {
        const jitter = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5) * spread;
        const a = ang + jitter;
        const p: Projectile = {
          id: `${me.id}-${w.id}-${now}-${i}`,
          owner: me.id, ownerColor: self.color, weapon: w.id,
          x: self.x + Math.cos(a) * (PLAYER_R + 4),
          y: self.y + Math.sin(a) * (PLAYER_R + 4),
          vx: Math.cos(a) * w.speed,
          vy: Math.sin(a) * w.speed,
          dmg: w.dmg * dmgScale,
          radius: w.radius,
          splash: w.splash,
          born: now, lifetime: w.lifetime,
          homing: w.homing,
          pierce: w.pierce,
          hitSet: w.pierce ? new Set<string>() : undefined,
          immobilize: w.immobilize,
        };
        batch.push(p);
        spawnProjectile(p);
      }
      channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: batch.map(stripSet) } });
    }

    function stripSet(p: Projectile): Projectile {
      const { hitSet: _hs, ...rest } = p;
      void _hs;
      return rest as Projectile;
    }

    /** Projectiles are stopped by terrain, and opposing shots cancel each other out. */
    function resolveProjectileWorld(now: number) {
      const dead = new Set<string>();
      const list = projectilesRef.current;

      // 1. Terrain — only the owner resolves, then tells everyone
      for (const b of list) {
        if (!isMine(b.owner)) continue;
        if (b.weapon === "mine" || WEAPONS[b.weapon]?.summon || b.radius <= 0) continue;
        // Shots dissolve at the edge of a respawn safe zone
        if (inSafeZone(world, b.x, b.y)) {
          dead.add(b.id);
          boomsRef.current.push({ x: b.x, y: b.y, r: 10, born: now, color: "#7dd3fc" });
          continue;
        }
        const path = pathOf(b);
        if (!segHitsObstacle(path.x1, path.y1, path.x2, path.y2, b.radius)) continue;
        if (b.bouncesLeft && b.bouncesLeft > 0) {
          const hx = circleHitsObstacle(world.obstacles, b.x + Math.sign(b.vx) * (b.radius + 2), b.y, b.radius);
          if (hx) b.vx = -b.vx; else b.vy = -b.vy;
          const fix = resolveCircle(world.obstacles, b.x, b.y, b.radius + 1);
          b.x = fix.x; b.y = fix.y;
          b.bouncesLeft -= 1;
          continue;
        }
        if (b.splash) explode(b);
        dead.add(b.id);
      }

      // 1b. Summoned units are shootable: enemy fire chips their personal health
      for (const u of list) {
        if (!isMine(u.owner) || !WEAPONS[u.weapon]?.summon) continue;
        if (dead.has(u.id)) continue;
        for (const b of list) {
          if (b === u || dead.has(b.id) || b.radius <= 0) continue;
          if (WEAPONS[b.weapon]?.summon) continue;
          if (b.owner === u.owner) continue;
          if (isBot(b.owner) && isBot(u.owner)) continue;
          const bp = pathOf(b);
          if (segDist(u.x, u.y, bp.x1, bp.y1, bp.x2, bp.y2) > u.radius + b.radius + 2) continue;
          u.unitHp = (u.unitHp ?? 14) - b.dmg;
          dead.add(b.id);
          boomsRef.current.push({ x: u.x, y: u.y, r: 10, born: now, color: u.ownerColor });
          if (u.unitHp <= 0) { dead.add(u.id); break; }
        }
      }


      // 2. Ranged shots neutralise on contact
      const cancellable = (p: Projectile) =>
        !dead.has(p.id) && p.radius > 0 && p.weapon !== "mine" &&
        !WEAPONS[p.weapon]?.summon && !WEAPONS[p.weapon]?.placeable &&
        (p.vx !== 0 || p.vy !== 0);

      const pairLimit = list.length <= 220; // skip the O(n2) pass under heavy fire
      for (let i = 0; pairLimit && i < list.length; i++) {
        const a = list[i];
        if (!cancellable(a)) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (!cancellable(b)) continue;
          if (a.owner === b.owner) continue;
          if (isBot(a.owner) && isBot(b.owner)) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) > a.radius + b.radius + 4) continue;
          for (const p of [a, b]) {
            if (isMine(p.owner) && p.splash) explode(p);
            dead.add(p.id);
          }
          boomsRef.current.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 14, born: now, color: "#ffffff" });
          break;
        }
      }

      if (dead.size === 0) return;
      const mineDead = list.filter((p) => dead.has(p.id) && isMine(p.owner)).map((p) => p.id);
      projectilesRef.current = list.filter((p) => !dead.has(p.id));
      if (mineDead.length) {
        channelRef.current?.send({ type: "broadcast", event: "despawn", payload: { ids: mineDead } });
      }
    }

    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let lastBroadcast = 0;

    function step(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const self = playersRef.current.get(me.id);
      if (self && self.hp > 0) {
        // Admin: high but finite health pool
        if (isAdminRef.current) {
          if (self.maxHp !== ADMIN_HP) {
            if (ADMIN_HP > self.maxHp) self.hp = ADMIN_HP;
            self.maxHp = ADMIN_HP;
            self.hp = Math.min(self.hp, ADMIN_HP);
            setHpUi({ hp: self.hp, max: self.maxHp });
          }
        }

        const frozen = self.immobilizedUntil > now;
        let dx = 0; let dy = 0;
        if (!frozen) {
          const k = keysRef.current;
          if (k.has("w") || k.has("arrowup")) dy -= 1;
          if (k.has("s") || k.has("arrowdown")) dy += 1;
          if (k.has("a") || k.has("arrowleft")) dx -= 1;
          if (k.has("d") || k.has("arrowright")) dx += 1;
          if (dx === 0 && dy === 0) {
            const tv = moveVecRef.current;
            if (tv.dx !== 0 || tv.dy !== 0) { dx = tv.dx; dy = tv.dy; }
          }
          if (dx || dy) {
            const len = Math.hypot(dx, dy) || 1;
            const sp = BASE_SPEED * speedMult(self.upgrades);
            self.x += (dx / len) * sp * dt;
            self.y += (dy / len) * sp * dt;
            self.x = Math.max(PLAYER_R, Math.min(world.w - PLAYER_R, self.x));
            self.y = Math.max(PLAYER_R, Math.min(world.h - PLAYER_R, self.y));
            const fix = resolveCircle(world.obstacles, self.x, self.y, PLAYER_R);
            self.x = fix.x; self.y = fix.y;
          }
        }
        self.aim = currentAimAngle(self);
        tryFire(now);
      }

      if (hostRef.current && config.bots) botTick(now, dt);

      // Pickups: medkits heal, lootboxes grant a random weapon into the hotbar
      if (self && self.hp > 0 && config.pickups) {
        for (const p of world.pickups) {
          if ((takenRef.current.get(p.id) ?? 0) > now) continue;
          if (Math.hypot(self.x - p.x, self.y - p.y) > PICKUP_R + PLAYER_R) continue;
          takenRef.current.set(p.id, now + PICKUP_RESPAWN_MS);
          channelRef.current?.send({ type: "broadcast", event: "taken", payload: { id: p.id } });
          if (p.kind === "medkit") {
            if (self.hp >= self.maxHp) { takenRef.current.delete(p.id); continue; }
            self.hp = Math.min(self.maxHp, self.hp + MEDKIT_HEAL);
            setHpUi({ hp: self.hp, max: self.maxHp });
          } else {
            const w = randomLootWeapon();
            if (hotbarRef.current.includes(w)) {
              setLootMsg(`${WEAPONS[w].name} — already carried`);
              window.setTimeout(() => setLootMsg(null), 1800);
            } else if (hotbarRef.current.length < 4) {
              hotbarRef.current = [...hotbarRef.current, w];
              void updateLoadoutRef.current({ inventory: [...hotbarRef.current], hotbar: [...hotbarRef.current] });
              setLootMsg(`Picked up ${WEAPONS[w].name}!`);
              window.setTimeout(() => setLootMsg(null), 1800);
            } else {
              setLootPick(w);
            }
          }
        }
      }

      // Projectile vs terrain, and ranged shots neutralising each other
      resolveProjectileWorld(now);

      // Update projectiles + collision
      const alive: Projectile[] = [];
      // Cap the simulated swarm so heavy fire cannot stall the frame
      if (projectilesRef.current.length > 500) {
        projectilesRef.current = projectilesRef.current.slice(-500);
      }
      for (const b of projectilesRef.current) {
        b.px = b.x; b.py = b.y;
        // Lifetime / fuse
        if (now - b.born > b.lifetime) {
          if (b.splash && isMine(b.owner)) explode(b);
          continue;
        }
        if (b.fuseAt && now >= b.fuseAt && isMine(b.owner)) {
          explode(b);
          channelRef.current?.send({
            type: "broadcast", event: "despawn", payload: { ids: [b.id] },
          });
          continue;
        }

        // Homing — adjust velocity toward nearest non-owner
        if (b.homing && isMine(b.owner)) {
          const best = nearestEnemy(b.owner, b.x, b.y, b.homing.range);
          if (best) {
            const desired = Math.atan2(best.y - b.y, best.x - b.x);
            const cur = Math.atan2(b.vy, b.vx);
            let diff = desired - cur;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const maxTurn = b.homing.turn * dt;
            const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
            const speed = Math.hypot(b.vx, b.vy) || 1;
            const newAng = cur + turn;
            b.vx = Math.cos(newAng) * speed;
            b.vy = Math.sin(newAng) * speed;
          }
        }

        // Summoned units walk the map: they can't phase through terrain and
        // steer around anything in their way
        if (WEAPONS[b.weapon]?.summon && isMine(b.owner)) {
          const sp = Math.hypot(b.vx, b.vy) || 90;
          const foe = nearestEnemy(b.owner, b.x, b.y, 1400);
          const want = foe
            ? Math.atan2(foe.y - b.y, foe.x - b.x)
            : (b.seek ?? Math.atan2(b.vy, b.vx));
          const ang = steerAround(b.x, b.y, want, b.radius + 3, 120);
          b.seek = ang;
          b.vx = Math.cos(ang) * sp;
          b.vy = Math.sin(ang) * sp;
        }

        const beforeX = b.x; const beforeY = b.y;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        if (WEAPONS[b.weapon]?.summon) {
          const fix = resolveCircle(world.obstacles, b.x, b.y, b.radius + 1);
          b.x = fix.x; b.y = fix.y;
          for (const z of world.safeZones) {
            const d = Math.hypot(b.x - z.x, b.y - z.y);
            if (d < z.r + b.radius) {
              const ang2 = d < 0.001 ? 0 : Math.atan2(b.y - z.y, b.x - z.x);
              b.x = z.x + Math.cos(ang2) * (z.r + b.radius);
              b.y = z.y + Math.sin(ang2) * (z.r + b.radius);
            }
          }
          if (isMine(b.owner)) {
            const moved = Math.hypot(b.x - beforeX, b.y - beforeY);
            if (moved < Math.hypot(b.vx, b.vy) * dt * 0.4) {
              // Wedged against a wall: peel off along it instead of pushing in
              if ((b.stuckAt ?? 0) === 0) b.stuckAt = now;
              const sp = Math.hypot(b.vx, b.vy) || 90;
              const turn = ((now - (b.stuckAt ?? now)) > 700 ? -1 : 1) * 1.1;
              const ang = (b.seek ?? Math.atan2(b.vy, b.vx)) + turn;
              b.seek = ang;
              b.vx = Math.cos(ang) * sp;
              b.vy = Math.sin(ang) * sp;
              b.x += b.vx * dt * 0.6;
              b.y += b.vy * dt * 0.6;
              const fix2 = resolveCircle(world.obstacles, b.x, b.y, b.radius + 1);
              b.x = fix2.x; b.y = fix2.y;
            } else if ((b.stuckAt ?? 0) !== 0 && now - (b.stuckAt ?? 0) > 1400) {
              b.stuckAt = 0;
            }
          }
        }


        // Wall handling
        const offX = b.x < 0 || b.x > world.w;
        const offY = b.y < 0 || b.y > world.h;
        if (offX || offY) {
          if (b.bouncesLeft && b.bouncesLeft > 0 && isMine(b.owner)) {
            if (offX) { b.vx = -b.vx; b.x = Math.max(0, Math.min(world.w, b.x)); }
            if (offY) { b.vy = -b.vy; b.y = Math.max(0, Math.min(world.h, b.y)); }
            b.bouncesLeft -= 1;
          } else {
            if (b.splash && isMine(b.owner)) explode(b);
            continue;
          }
        }

        if (isMine(b.owner)) {
          unitFire(b, now);
          // Mine arms then triggers
          if (b.weapon === "mine") {
            if (b.armed && now >= b.armed) {
              let trig = false;
              for (const other of playersRef.current.values()) {
                if (!isEnemyOf(b.owner, other)) continue;
                if (Math.hypot(other.x - b.x, other.y - b.y) < (b.trigger ?? 36)) { trig = true; break; }
              }
              if (trig) {
                explode(b);
                channelRef.current?.send({ type: "broadcast", event: "despawn", payload: { ids: [b.id] } });
                continue;
              }
            }
          } else {
            // Pierce: collide with everyone it hasn't yet, don't die
            if (b.pierce) {
              const hits: Player[] = [];
              for (const other of playersRef.current.values()) {
                if (!isEnemyOf(b.owner, other)) continue;
                if (b.hitSet?.has(other.id)) continue;
                if (inSafeZone(world, other.x, other.y)) continue;
                const bp = pathOf(b);
                if (segDist(other.x, other.y, bp.x1, bp.y1, bp.x2, bp.y2) < PLAYER_R + b.radius) {
                  hits.push(other);
                }
              }
              for (const other of hits) {
                b.hitSet?.add(other.id);
                applyDamage(other.id, b.owner, b.dmg, b.weapon, b.immobilize);
                channelRef.current?.send({
                  type: "broadcast", event: "hit",
                  payload: { target: other.id, by: b.owner, dmg: b.dmg, weapon: b.weapon, immobilize: b.immobilize },
                });
              }
              // spear keeps flying; let lifetime handle it
            } else {
              let hit: Player | null = null;
              for (const other of playersRef.current.values()) {
                if (!isEnemyOf(b.owner, other)) continue;
                if (inSafeZone(world, other.x, other.y)) continue;
                const bp = pathOf(b);
                if (segDist(other.x, other.y, bp.x1, bp.y1, bp.x2, bp.y2) < PLAYER_R + b.radius) { hit = other; break; }
              }
              if (hit) {
                if (b.splash) {
                  explode(b);
                } else {
                  applyDamage(hit.id, b.owner, b.dmg, b.weapon, b.immobilize);
                  channelRef.current?.send({
                    type: "broadcast", event: "hit",
                    payload: { target: hit.id, by: b.owner, dmg: b.dmg, weapon: b.weapon, immobilize: b.immobilize },
                  });
                }
                channelRef.current?.send({ type: "broadcast", event: "despawn", payload: { ids: [b.id] } });
                continue;
              }
            }
          }
        }
        alive.push(b);
      }
      projectilesRef.current = alive;

      const t0 = now;
      swingsRef.current = swingsRef.current.filter((s) => t0 - s.born < 220);
      boomsRef.current = boomsRef.current.filter((b) => t0 - b.born < 400);

      if (self && now - lastBroadcast > 50) {
        lastBroadcast = now;
        channelRef.current?.send({
          type: "broadcast",
          event: "state",
          payload: {
            id: self.id, name: self.name, x: self.x, y: self.y,
            hp: self.hp, maxHp: self.maxHp, kills: self.kills, color: self.color,
            upgrades: self.upgrades, aim: self.aim,
          },
        });
      }

      render(ctx, now, self ?? null);
      raf = requestAnimationFrame(step);
    }

    function explode(b: Projectile) {
      const isSplash = !!b.splash;
      const radius = b.splash ?? PLAYER_R + b.radius;
      for (const other of playersRef.current.values()) {
        if (!isEnemyOf(b.owner, other)) continue;
        const d = Math.hypot(other.x - b.x, other.y - b.y);
        if (d < radius + PLAYER_R) {
          const falloff = isSplash ? Math.max(0.4, 1 - d / (radius + PLAYER_R)) : 1;
          const dmg = b.dmg * falloff;
          applyDamage(other.id, b.owner, dmg, b.weapon, b.immobilize);
          channelRef.current?.send({
            type: "broadcast", event: "hit",
            payload: { target: other.id, by: b.owner, dmg, weapon: b.weapon, immobilize: b.immobilize },
          });
        }
      }
      if (isSplash) {
        const boom: BoomFx = { x: b.x, y: b.y, r: radius, born: performance.now(), color: b.ownerColor };
        boomsRef.current.push(boom);
        channelRef.current?.send({ type: "broadcast", event: "boom", payload: boom });
      }
    }

    function render(ctx: CanvasRenderingContext2D, now: number, self: Player | null) {
      // Camera follows the local player, clamped to the world
      cam.x = Math.max(0, Math.min(world.w - VIEW_W, (self?.x ?? world.w / 2) - VIEW_W / 2));
      cam.y = Math.max(0, Math.min(world.h - VIEW_H, (self?.y ?? world.h / 2) - VIEW_H / 2));
      if (world.w < VIEW_W) cam.x = (world.w - VIEW_W) / 2;
      if (world.h < VIEW_H) cam.y = (world.h - VIEW_H) / 2;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#080c15";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.translate(-cam.x, -cam.y);

      ctx.fillStyle = "#0d1320";
      ctx.fillRect(0, 0, world.w, world.h);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      const gx0 = Math.floor(cam.x / 50) * 50;
      const gy0 = Math.floor(cam.y / 50) * 50;
      for (let x = gx0; x < cam.x + VIEW_W; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, cam.y); ctx.lineTo(x, cam.y + VIEW_H); ctx.stroke();
      }
      for (let y = gy0; y < cam.y + VIEW_H; y += 50) {
        ctx.beginPath(); ctx.moveTo(cam.x, y); ctx.lineTo(cam.x + VIEW_W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, world.w, world.h);

      // Terrain
      for (const o of world.obstacles) {
        if (o.x > cam.x + VIEW_W || o.x + o.w < cam.x || o.y > cam.y + VIEW_H || o.y + o.h < cam.y) continue;
        ctx.fillStyle = "#1c2740";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
      }

      // Respawn safe zones — softly pulsing translucent circles
      for (const z of world.safeZones) {
        if (z.x + z.r < cam.x || z.x - z.r > cam.x + VIEW_W) continue;
        if (z.y + z.r < cam.y || z.y - z.r > cam.y + VIEW_H) continue;
        const pulse = 0.5 + 0.5 * Math.sin(now / 900 + z.x * 0.01);
        const r = z.r * (0.97 + pulse * 0.03);
        const grad = ctx.createRadialGradient(z.x, z.y, r * 0.2, z.x, z.y, r);
        grad.addColorStop(0, `rgba(125, 211, 252, ${0.06 + pulse * 0.05})`);
        grad.addColorStop(1, "rgba(125, 211, 252, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(z.x, z.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(125, 211, 252, ${0.22 + pulse * 0.25})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 12]);
        ctx.beginPath(); ctx.arc(z.x, z.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(186, 230, 253, ${0.35 + pulse * 0.25})`;
        ctx.font = "600 15px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText("SAFE ZONE", z.x, z.y - r + 24);
        ctx.textAlign = "left";
      }

      // Pickups
      for (const p of world.pickups) {
        
        if ((takenRef.current.get(p.id) ?? 0) > now) continue;
        if (p.x > cam.x + VIEW_W + 40 || p.x < cam.x - 40 || p.y > cam.y + VIEW_H + 40 || p.y < cam.y - 40) continue;
        const bob = Math.sin(now / 400 + p.x) * 2;
        if (p.kind === "medkit") {
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(p.x - 11, p.y - 11 + bob, 22, 22);
          ctx.fillStyle = "#ef4444";
          ctx.fillRect(p.x - 7, p.y - 2.5 + bob, 14, 5);
          ctx.fillRect(p.x - 2.5, p.y - 7 + bob, 5, 14);
        } else {
          ctx.fillStyle = "#fbbf24";
          ctx.fillRect(p.x - 12, p.y - 10 + bob, 24, 20);
          ctx.fillStyle = "#78350f";
          ctx.fillRect(p.x - 12, p.y - 2 + bob, 24, 4);
          ctx.fillRect(p.x - 2, p.y - 10 + bob, 4, 20);
        }
      }


      for (const b of boomsRef.current) {
        const age = (now - b.born) / 400;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.6 + age * 0.6), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      for (const b of projectilesRef.current) {
        ctx.fillStyle = b.ownerColor || "#fff";
        if (b.weapon === "mine") {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.7)";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 3, 0, Math.PI * 2); ctx.stroke();
        } else if (b.weapon === "rocket" || b.weapon === "nuke" || b.weapon === "tracking_missile") {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,180,60,0.7)";
          ctx.beginPath(); ctx.arc(b.x - b.vx * 0.01, b.y - b.vy * 0.01, b.radius * 0.8, 0, Math.PI * 2); ctx.fill();
        } else if (b.weapon === "grenade") {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.5)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (b.weapon === "spear") {
          const ang = Math.atan2(b.vy, b.vx);
          ctx.save();
          ctx.translate(b.x, b.y); ctx.rotate(ang);
          ctx.fillRect(-12, -2, 24, 4);
          ctx.restore();
        } else if (b.weapon === "chain") {
          const ang = Math.atan2(b.vy, b.vx);
          ctx.save();
          ctx.translate(b.x, b.y); ctx.rotate(ang);
          for (let i = -8; i <= 8; i += 4) {
            ctx.beginPath(); ctx.arc(i, 0, 2.5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        } else if (b.weapon === "army" || b.weapon === "mini_soldiers") {
          const ang = Math.atan2(b.vy, b.vx);
          ctx.save();
          ctx.translate(b.x, b.y); ctx.rotate(ang);
          ctx.fillRect(-b.radius, -b.radius, b.radius * 2, b.radius * 2);
          ctx.fillRect(b.radius, -1.5, b.radius + 3, 3); // pistol barrel
          ctx.restore();
        } else {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
        }

        // Summoned units carry their own little health bar
        if (b.unitHp != null && b.unitMaxHp) {
          const bw = 16;
          const frac = Math.max(0, Math.min(1, b.unitHp / b.unitMaxHp));
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(b.x - bw / 2, b.y - b.radius - 8, bw, 3);
          ctx.fillStyle = frac > 0.5 ? "#4ade80" : frac > 0.25 ? "#facc15" : "#ef4444";
          ctx.fillRect(b.x - bw / 2, b.y - b.radius - 8, bw * frac, 3);
          ctx.fillStyle = b.ownerColor;
        }
      }


      for (const s of swingsRef.current) {
        const age = (now - s.born) / 220;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.arc(s.x, s.y, s.range, s.ang - s.arc / 2, s.ang + s.arc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      for (const p of playersRef.current.values()) {
        if (p.hp <= 0) continue;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 2; ctx.stroke();

        // Frozen ring if immobilized
        if (p.immobilizedUntil > now) {
          ctx.strokeStyle = "#7dd3fc";
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 5, 0, Math.PI * 2); ctx.stroke();
        }

        const ang = p.aim ?? 0;
        const eyeOffset = PLAYER_R * 0.45;
        const eyeSpread = PLAYER_R * 0.45;
        const fx = Math.cos(ang) * eyeOffset;
        const fy = Math.sin(ang) * eyeOffset;
        const px = -Math.sin(ang) * eyeSpread;
        const py =  Math.cos(ang) * eyeSpread;
        const eyeR = PLAYER_R * 0.22;
        const pupilR = eyeR * 0.55;
        for (const sgn of [-1, 1]) {
          const ex = p.x + fx + px * sgn;
          const ey = p.y + fy + py * sgn;
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#0b0b0b";
          ctx.beginPath();
          ctx.arc(
            ex + Math.cos(ang) * (eyeR - pupilR),
            ey + Math.sin(ang) * (eyeR - pupilR),
            pupilR, 0, Math.PI * 2,
          );
          ctx.fill();
        }

        ctx.fillStyle = "#fff";
        ctx.font = "600 13px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(p.name, p.x, p.y - PLAYER_R - 12);

        const w = 46;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(p.x - w / 2, p.y - PLAYER_R - 8, w, 4);
        ctx.fillStyle = p.hp > p.maxHp * 0.5 ? "#4ade80" : p.hp > p.maxHp * 0.25 ? "#facc15" : "#ef4444";
        ctx.fillRect(p.x - w / 2, p.y - PLAYER_R - 8, (w * p.hp) / p.maxHp, 4);
      }

      if (self && self.hp > 0 && weaponRef.current === "sniper" && chargeStartRef.current != null) {
        const ms = now - chargeStartRef.current;
        const ratio = Math.min(1, ms / ((WEAPONS.sniper.charge ?? 0.6) * 1000));
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(self.x, self.y, PLAYER_R + 6, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
        ctx.stroke();
      }
    }

    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      stopAnnounce();
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [code, roomName, world, config]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (code === "PUBLIC") return `${window.location.origin}/room/${code}`;
    return `${window.location.origin}/room/${code}?c=${encodeConfig(config)}`;
  }, [code, config]);

  const hotbar = loadout.hotbar;
  void startKillPointsRef; // referenced for future use

  return (
    <div
      ref={rootRef}
      className={`bg-background text-foreground ${isTouch ? "h-[100dvh] overflow-hidden p-2" : "min-h-screen px-4 py-6"}`}
    >
      <div className={`mx-auto flex flex-col gap-4 ${isTouch ? "h-full max-w-full gap-2" : "max-w-[1280px]"}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 ${isTouch ? "gap-1" : "gap-3"}`}>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-foreground/60 hover:text-foreground">
              ← Leave
            </Link>
            {!isTouch && (
              <h1 className="text-2xl font-black tracking-tight">
                ARENA<span className="text-primary">.io</span>
              </h1>
            )}
            <span className={`text-xs ${connected ? "text-primary" : "text-foreground/40"}`}>
              {connected ? "● live" : "○ connecting…"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isTouch && (
              <div className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm">
                <span className="font-bold">{roomName}</span>
                <span className="ml-2 font-mono text-xs tracking-widest text-foreground/50">{code}</span>
              </div>
            )}
            {!isTouch && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied!" : "Copy invite"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
              {isFullscreen ? "⤢" : "⛶"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowHelp(true)} aria-label="How to play">
              ?
            </Button>
          </div>
        </div>

        <div className={isTouch ? "flex min-h-0 flex-1" : "grid gap-4 lg:grid-cols-[1fr_260px]"}>
          <div className={isTouch ? "flex min-h-0 flex-1 items-center justify-center" : "space-y-3"}>
            <div className={`relative overflow-hidden ${isTouch ? "h-full w-full" : "rounded-xl border border-foreground/10 bg-black shadow-2xl"}`}>
              {lootMsg && (
                <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-primary/90 px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-lg">
                  {lootMsg}
                </div>
              )}
              {lootPick && (
                <div className="absolute left-1/2 top-4 z-30 w-[min(92%,360px)] -translate-x-1/2 rounded-xl border border-primary/40 bg-background/95 p-3 text-xs shadow-2xl">
                  <div className="mb-2 font-bold">
                    Found {WEAPONS[lootPick].name} — pick a weapon to replace
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {hotbarRef.current.map((w) => (
                      <button
                        key={w}
                        className="rounded bg-foreground/10 px-2 py-1.5 hover:bg-foreground/20"
                        onClick={() => {
                          const next = hotbarRef.current.map((x) => (x === w ? lootPick : x));
                          hotbarRef.current = next;
                          if (weaponRef.current === w) { weaponRef.current = lootPick; setWeaponUi(lootPick); }
                          void updateLoadout({ inventory: [...next], hotbar: [...next] });
                          setLootPick(null);
                        }}
                      >
                        {WEAPONS[w].name}
                      </button>
                    ))}
                  </div>
                  <button className="mt-2 w-full rounded bg-foreground/5 px-2 py-1 text-foreground/60" onClick={() => setLootPick(null)}>
                    Discard {WEAPONS[lootPick].name}
                  </button>
                </div>
              )}
              <canvas
                ref={canvasRef}
                width={VIEW_W}
                height={VIEW_H}
                className={`block cursor-crosshair touch-none select-none ${isTouch ? "h-full w-full object-contain" : "w-full"}`}
                style={isTouch ? undefined : { aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
              />
            </div>
            {/* Hotbar (desktop) */}
            {!isTouch && (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((_, i) => {
                const id = hotbar[i];
                const w = id ? WEAPONS[id] : null;
                const active = id && weaponUi === id;
                return (
                  <button
                    key={i}
                    disabled={!id}
                    onClick={() => {
                      if (!id) return;
                      weaponRef.current = id;
                      chargeStartRef.current = null;
                      setWeaponUi(id);
                    }}
                    className={`rounded-lg border p-2 text-left text-xs transition ${
                      !id
                        ? "cursor-not-allowed border-dashed border-foreground/10 bg-foreground/[0.02] text-foreground/30"
                        : active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-foreground/10 bg-foreground/5 text-foreground/70 hover:border-foreground/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{w?.name ?? "Empty"}</span>
                      <span className="font-mono text-[10px] text-foreground/40">{i + 1}</span>
                    </div>
                    {w && (
                      <div className="mt-0.5 text-[10px] font-semibold" style={{ color: RARITY_META[w.rarity].color }}>
                        {Math.round(w.dmg)} dmg · {RARITY_META[w.rarity].label}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            )}
          </div>
          {!isTouch && (
          <aside className="space-y-3">
            <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
              <h2 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">Status</h2>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-foreground/70">HP</span>
                <span className="font-mono font-bold">
                  {Math.round(hpUi.hp)} / {hpUi.max}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-foreground/10">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(hpUi.hp / hpUi.max) * 100}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-foreground/70">This match</span>
                <span className="font-mono font-bold text-primary">+{matchKills} pts</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-foreground/50">
                <span>Bank</span>
                <span className="font-mono">{loadout.killPoints} pts</span>
              </div>
              <p className="mt-2 text-[10px] text-foreground/40">
                Upgrades & weapon crates are in the lobby Armory.
              </p>
            </div>

            <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
              <h2 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">Scoreboard</h2>
              <ul className="space-y-1.5">
                {scoreboard.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="font-mono font-bold">{p.kills}</span>
                  </li>
                ))}
                {scoreboard.length === 0 && (
                  <li className="text-sm text-foreground/40">Waiting for players…</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4 text-xs text-foreground/60">
              <div className="mb-1 font-semibold text-foreground/80">Controls</div>
              <div>WASD / Arrows — Move</div>
              <div>Mouse — Aim · Click — Attack</div>
              <div>1–4 — Switch hotbar weapon</div>
              <div>Sniper: hold to charge, release to fire</div>
            </div>
          </aside>
          )}
        </div>
      </div>

      {/* Mobile compact HUD overlay */}
      {isTouch && (
        <>
          <div className="pointer-events-none fixed left-2 top-14 z-40 flex flex-col gap-1.5">
            <div className="pointer-events-auto rounded-md bg-background/60 px-2 py-1 backdrop-blur">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-foreground/60">HP</span>
                <div className="h-1.5 w-20 overflow-hidden rounded bg-foreground/15">
                  <div className="h-full bg-primary" style={{ width: `${(hpUi.hp / hpUi.max) * 100}%` }} />
                </div>
                <span className="font-mono">{Math.round(hpUi.hp)}</span>
              </div>
            </div>
            <div className="pointer-events-auto flex gap-1">
              <div className="rounded-md bg-background/60 px-2 py-1 text-[10px] font-bold backdrop-blur">
                ★ +{matchKills}
              </div>
              <button
                onClick={() => setShowScoreboard((v) => !v)}
                className="rounded-md bg-background/60 px-2 py-1 text-[10px] font-bold backdrop-blur"
              >
                ⚑ {scoreboard.length}
              </button>
            </div>
          </div>

          {showScoreboard && (
            <div
              className="fixed inset-0 z-50 flex items-end bg-background/60 backdrop-blur"
              onClick={() => setShowScoreboard(false)}
            >
              <div
                className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl border-t border-foreground/10 bg-background p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider">Scoreboard</h3>
                  <span className="font-mono text-xs text-foreground/50">{roomName} · {code}</span>
                </div>
                <ul className="space-y-1.5">
                  {scoreboard.map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 truncate">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <span className="font-mono font-bold">{p.kills}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-center text-[11px] text-foreground/50">
                  Leave the room to spend points in the Armory.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {isTouch && controlsApiRef.current && (
        <TouchControls
          weapon={weaponUi}
          ownedWeapons={hotbar}
          onMove={(v) => controlsApiRef.current?.setMove(v)}
          onAim={(v) => controlsApiRef.current?.setAim(v)}
          onFireDown={() => controlsApiRef.current?.fireDown()}
          onFireUp={() => controlsApiRef.current?.fireUp()}
          onMelee={() => controlsApiRef.current?.melee()}
          onSelectWeapon={(w) => controlsApiRef.current?.selectWeapon(w)}
        />
      )}

      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="my-8 w-full max-w-2xl rounded-2xl border border-foreground/10 bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black">How to play</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowHelp(false)}>✕</Button>
            </div>
            <HowToPlayContent />
          </div>
        </div>
      )}
    </div>
  );
}
