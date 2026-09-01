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
  resolveCircle,
  safeSpawn,
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
const ADMIN_HP = 99999;

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
  nextShotAt?: number;   // summoned units: next pistol shot time
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
  const mouseRef = useRef({ x: ARENA_W / 2, y: ARENA_H / 2, down: false });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const weaponRef = useRef<WeaponId>("pistol");
  const lastFireRef = useRef<Record<WeaponId, number>>(emptyCooldowns());
  const chargeStartRef = useRef<number | null>(null);
  const upgradesRef = useRef<Upgrades>({ ...ZERO_UPGRADES });
  const hotbarRef = useRef<WeaponId[]>(["pistol"]);
  const isAdminRef = useRef(false);
  const hostRef = useRef(false);
  const botStateRef = useRef<Map<string, { lastFire: number; respawnAt: number; aim: number }>>(new Map());

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
      const newMax = maxHp(loadout.upgrades);
      if (newMax !== self.maxHp) {
        self.hp = Math.min(self.hp, newMax);
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
    const me: Player = {
      id: meRef.current.id,
      name: meRef.current.name,
      x: Math.random() * (ARENA_W - 200) + 100,
      y: Math.random() * (ARENA_H - 200) + 100,
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
      projectilesRef.current.push(p);
    }

    function applyDamage(targetId: string, byId: string, dmg: number, weapon: WeaponId, immobilizeMs?: number) {
      const t = playersRef.current.get(targetId);
      if (!t || t.hp <= 0) return;
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
              self.x = Math.random() * (ARENA_W - 200) + 100;
              self.y = Math.random() * (ARENA_H - 200) + 100;
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
        if (hostRef.current) ensureBots();
        else for (const b of BOT_DEFS) botStateRef.current.delete(b.id);
        for (const id of presentIds) {
          if (!playersRef.current.has(id)) {
            const meta = state[id]?.[0];
            playersRef.current.set(id, {
              id,
              name: meta?.name ?? "???",
              x: ARENA_W / 2,
              y: ARENA_H / 2,
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
        if (!p || typeof p.id !== "string") return;
        const safeMaxHp = clampNum(p.maxHp, 1, 1000, 100);
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
          projectilesRef.current.push({
            ...pr,
            dmg: safeDmg,
            hitSet: undefined, // remote-rendered, local set not needed
          });
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
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          await channel.track({ name: me.name, color: me.color });
        }
      });

    const stopAnnounce = announceRoom({
      roomCode: code,
      roomName,
      playerName: me.name,
    });

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
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * ARENA_W;
      mouseRef.current.y = ((e.clientY - rect.top) / rect.height) * ARENA_H;
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
      for (const def of BOT_DEFS) {
        if (!playersRef.current.has(def.id)) {
          playersRef.current.set(def.id, {
            id: def.id, name: def.name,
            x: Math.random() * (ARENA_W - 300) + 150,
            y: Math.random() * (ARENA_H - 300) + 150,
            color: def.color, hp: def.hp, maxHp: def.hp, kills: 0,
            upgrades: { ...ZERO_UPGRADES }, aim: 0, immobilizedUntil: 0,
          });
        }
        if (!botStateRef.current.has(def.id)) {
          botStateRef.current.set(def.id, { lastFire: 0, respawnAt: 0, aim: 0 });
        }
      }
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
            bot.x = Math.random() * (ARENA_W - 300) + 150;
            bot.y = Math.random() * (ARENA_H - 300) + 150;
          }
          continue;
        }
        if (!focus) continue;

        const dx = focus.x - bot.x;
        const dy = focus.y - bot.y;
        const dist = Math.hypot(dx, dy) || 1;
        bot.aim = Math.atan2(dy, dx);

        // Keep preferred spacing; melee always closes in
        let moveDir = 0;
        if (dist > def.keep + 40) moveDir = 1;
        else if (dist < def.keep - 40) moveDir = -1;
        if (moveDir !== 0) {
          const strafe = Math.sin(now / 700 + def.id.length) * 0.5;
          const ang = Math.atan2(dy, dx) + strafe * 0.6;
          bot.x += Math.cos(ang) * moveDir * def.speed * dt;
          bot.y += Math.sin(ang) * moveDir * def.speed * dt;
          bot.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, bot.x));
          bot.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, bot.y));
        }

        const w = WEAPONS[def.weapon];
        if (now - st.lastFire < w.cooldown * 1000) continue;
        if (dist > def.range) continue;
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
      const t = now / 1000;
      const cd = w.cooldown * cooldownMult(self.upgrades);
      if (t - lastFireRef.current[w.id] < cd) return;
      if (w.id === "sniper") return; // release-to-fire
      lastFireRef.current[w.id] = t;
      const ang = currentAimAngle(self);
      const dmgScale = dmgMult(self.upgrades);

      if (w.melee) { swingMelee(now, w.id); return; }

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

    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let lastBroadcast = 0;

    function step(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const self = playersRef.current.get(me.id);
      if (self && self.hp > 0) {
        // Admin: infinite HP
        if (isAdminRef.current) {
          if (self.maxHp < 99999) self.maxHp = 99999;
          self.hp = self.maxHp;
          self.immobilizedUntil = 0;
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
            self.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, self.x));
            self.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, self.y));
          }
        }
        self.aim = currentAimAngle(self);
        tryFire(now);
      }

      if (hostRef.current) botTick(now, dt);

      // Update projectiles + collision
      const alive: Projectile[] = [];
      for (const b of projectilesRef.current) {
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

        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Wall handling
        const offX = b.x < 0 || b.x > ARENA_W;
        const offY = b.y < 0 || b.y > ARENA_H;
        if (offX || offY) {
          if (b.bouncesLeft && b.bouncesLeft > 0 && isMine(b.owner)) {
            if (offX) { b.vx = -b.vx; b.x = Math.max(0, Math.min(ARENA_W, b.x)); }
            if (offY) { b.vy = -b.vy; b.y = Math.max(0, Math.min(ARENA_H, b.y)); }
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
                if (Math.hypot(other.x - b.x, other.y - b.y) < PLAYER_R + b.radius) {
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
                if (Math.hypot(other.x - b.x, other.y - b.y) < PLAYER_R + b.radius) { hit = other; break; }
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
      ctx.fillStyle = "#0d1320";
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < ARENA_W; x += 50) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke();
      }
      for (let y = 0; y < ARENA_H; y += 50) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, ARENA_W, ARENA_H);

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
  }, [code, roomName]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/room/${code}`;
  }, [code]);

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
            <div className={`overflow-hidden ${isTouch ? "h-full w-full" : "rounded-xl border border-foreground/10 bg-black shadow-2xl"}`}>
              <canvas
                ref={canvasRef}
                width={ARENA_W}
                height={ARENA_H}
                className={`block cursor-crosshair touch-none select-none ${isTouch ? "h-full w-full object-contain" : "w-full"}`}
                style={isTouch ? undefined : { aspectRatio: `${ARENA_W} / ${ARENA_H}` }}
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
