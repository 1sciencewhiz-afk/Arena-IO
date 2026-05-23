import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { announceRoom } from "@/lib/arena/lobby";
import {
  WEAPONS,
  WEAPON_ORDER,
  UPGRADE_DEFS,
  MAX_UPGRADE_LEVEL,
  ZERO_UPGRADES,
  upgradeCost,
  dmgMult,
  cooldownMult,
  speedMult,
  maxHp,
  type WeaponId,
  type Upgrades,
  type UpgradeId,
} from "@/lib/arena/weapons";

export const Route = createFileRoute("/room/$code")({
  head: () => ({
    meta: [{ title: "Arena Room" }, { name: "robots", content: "noindex" }],
  }),
  component: RoomPage,
});

const ARENA_W = 1200;
const ARENA_H = 700;
const PLAYER_R = 18;
const BASE_SPEED = 260;

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
  born: number; // performance.now
  lifetime: number; // ms
  armed?: number; // when mine arms (perf.now ms)
  trigger?: number; // mine trigger radius
};

type SwingFx = { x: number; y: number; ang: number; range: number; arc: number; born: number; color: string };
type BoomFx = { x: number; y: number; r: number; born: number; color: string };

function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 85% 60%)`;
}

function RoomPage() {
  const { code } = Route.useParams();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [scoreboard, setScoreboard] = useState<Player[]>([]);
  const [copied, setCopied] = useState(false);
  const [weaponUi, setWeaponUi] = useState<WeaponId>("pistol");
  const [hpUi, setHpUi] = useState({ hp: 100, max: 100 });
  const [pointsUi, setPointsUi] = useState(0);
  const [upgradesUi, setUpgradesUi] = useState<Upgrades>({ ...ZERO_UPGRADES });

  const roomName = useMemo(() => {
    if (typeof window === "undefined") return code;
    return sessionStorage.getItem(`arena.roomName.${code}`) || code;
  }, [code]);

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

  // Game state in refs
  const playersRef = useRef<Map<string, Player>>(new Map());
  const projectilesRef = useRef<Projectile[]>([]);
  const swingsRef = useRef<SwingFx[]>([]);
  const boomsRef = useRef<BoomFx[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef({ x: ARENA_W / 2, y: ARENA_H / 2, down: false });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const weaponRef = useRef<WeaponId>("pistol");
  const lastFireRef = useRef<Record<WeaponId, number>>({
    pistol: 0, shotgun: 0, sniper: 0, rocket: 0, mine: 0, sword: 0,
  });
  const chargeStartRef = useRef<number | null>(null);
  const pointsRef = useRef(0);
  const upgradesRef = useRef<Upgrades>({ ...ZERO_UPGRADES });

  useEffect(() => {
    const me: Player = {
      id: meRef.current.id,
      name: meRef.current.name,
      x: Math.random() * (ARENA_W - 200) + 100,
      y: Math.random() * (ARENA_H - 200) + 100,
      color: colorFor(meRef.current.id),
      hp: 100,
      maxHp: 100,
      kills: 0,
      upgrades: { ...ZERO_UPGRADES },
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

    function applyDamage(targetId: string, byId: string, dmg: number, weapon: WeaponId) {
      const t = playersRef.current.get(targetId);
      if (!t || t.hp <= 0) return;
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp === 0) {
        const shooter = playersRef.current.get(byId);
        if (shooter) shooter.kills += 1;
        if (byId === me.id) {
          pointsRef.current += 1;
          setPointsUi(pointsRef.current);
        }
        if (targetId === me.id) {
          setTimeout(() => {
            const self = playersRef.current.get(me.id);
            if (self) {
              self.maxHp = maxHp(self.upgrades);
              self.hp = self.maxHp;
              self.x = Math.random() * (ARENA_W - 200) + 100;
              self.y = Math.random() * (ARENA_H - 200) + 100;
              setHpUi({ hp: self.hp, max: self.maxHp });
            }
          }, 1500);
        }
      }
      if (targetId === me.id) setHpUi({ hp: t.hp, max: t.maxHp });
      updateScoreboard();
      void weapon;
    }

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string; color: string }>();
        const presentIds = new Set(Object.keys(state));
        for (const id of Array.from(playersRef.current.keys())) {
          if (!presentIds.has(id)) playersRef.current.delete(id);
        }
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
            });
          }
        }
        updateScoreboard();
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const p = payload as {
          id: string; x: number; y: number; hp: number; maxHp: number; name: string;
          kills: number; color: string; upgrades: Upgrades;
        };
        const existing = playersRef.current.get(p.id);
        if (existing) {
          existing.x = p.x;
          existing.y = p.y;
          existing.hp = p.hp;
          existing.maxHp = p.maxHp;
          existing.kills = p.kills;
          existing.name = p.name;
          existing.color = p.color;
          existing.upgrades = p.upgrades;
        } else {
          playersRef.current.set(p.id, {
            id: p.id, name: p.name, x: p.x, y: p.y,
            color: p.color || colorFor(p.id),
            hp: p.hp, maxHp: p.maxHp, kills: p.kills, upgrades: p.upgrades,
          });
        }
      })
      .on("broadcast", { event: "fire" }, ({ payload }) => {
        const projectiles = (payload as { projectiles: Projectile[] }).projectiles;
        // Adopt these projectiles for rendering only; do NOT do collision (shooter authoritative)
        for (const pr of projectiles) projectilesRef.current.push({ ...pr });
      })
      .on("broadcast", { event: "swing" }, ({ payload }) => {
        const s = payload as SwingFx;
        swingsRef.current.push({ ...s, born: performance.now() });
      })
      .on("broadcast", { event: "boom" }, ({ payload }) => {
        const b = payload as BoomFx;
        boomsRef.current.push({ ...b, born: performance.now() });
      })
      .on("broadcast", { event: "hit" }, ({ payload }) => {
        const { target, by, dmg, weapon } = payload as {
          target: string; by: string; dmg: number; weapon: WeaponId;
        };
        applyDamage(target, by, dmg, weapon);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          await channel.track({ name: me.name, color: me.color });
        }
      });

    // Announce this room to the lobby
    const stopAnnounce = announceRoom({
      roomCode: code,
      roomName,
      playerName: me.name,
    });

    // Input
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysRef.current.add(key);
      const idx = ["1", "2", "3", "4", "5", "6"].indexOf(key);
      if (idx >= 0) {
        const w = WEAPON_ORDER[idx];
        weaponRef.current = w;
        chargeStartRef.current = null;
        setWeaponUi(w);
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
      if (weaponRef.current === "sniper") chargeStartRef.current = performance.now();
    };
    const onMouseUp = () => {
      // Sniper: release to fire if charged
      if (weaponRef.current === "sniper" && chargeStartRef.current != null) {
        fireSniperRelease();
        chargeStartRef.current = null;
      }
      mouseRef.current.down = false;
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

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
      const ang = Math.atan2(mouseRef.current.y - self.y, mouseRef.current.x - self.x);
      const dmg = w.dmg * (0.4 + 0.6 * chargeRatio) * dmgMult(self.upgrades);
      const p: Projectile = {
        id: `${me.id}-s-${now}`,
        owner: me.id,
        ownerColor: self.color,
        weapon: "sniper",
        x: self.x + Math.cos(ang) * (PLAYER_R + 4),
        y: self.y + Math.sin(ang) * (PLAYER_R + 4),
        vx: Math.cos(ang) * w.speed,
        vy: Math.sin(ang) * w.speed,
        dmg,
        radius: w.radius,
        born: now,
        lifetime: w.lifetime,
      };
      spawnProjectile(p);
      channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: [p] } });
    }

    function tryFire(now: number) {
      const self = playersRef.current.get(me.id);
      if (!self || self.hp <= 0) return;
      if (!mouseRef.current.down) return;
      const w = WEAPONS[weaponRef.current];
      const t = now / 1000;
      const cd = w.cooldown * cooldownMult(self.upgrades);
      if (t - lastFireRef.current[w.id] < cd) return;

      // Sniper fires only on release; skip continuous fire
      if (w.id === "sniper") return;

      lastFireRef.current[w.id] = t;
      const ang = Math.atan2(mouseRef.current.y - self.y, mouseRef.current.x - self.x);
      const dmgScale = dmgMult(self.upgrades);

      if (w.melee) {
        // Sword: instant arc check, broadcast swing fx, broadcast hits authoritatively
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
            applyDamage(other.id, me.id, dmg, "sword");
            channelRef.current?.send({
              type: "broadcast", event: "hit",
              payload: { target: other.id, by: me.id, dmg, weapon: "sword" },
            });
          }
        }
        return;
      }

      if (w.placeable) {
        const p: Projectile = {
          id: `${me.id}-m-${now}`,
          owner: me.id, ownerColor: self.color, weapon: "mine",
          x: self.x, y: self.y, vx: 0, vy: 0,
          dmg: w.dmg * dmgScale, radius: w.radius, splash: w.splash,
          born: now, lifetime: w.lifetime,
          armed: now + w.placeable.armTime, trigger: w.placeable.trigger,
        };
        spawnProjectile(p);
        channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: [p] } });
        return;
      }

      // Standard ranged: shotgun emits pellets, others single
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
          born: now,
          lifetime: w.lifetime,
        };
        batch.push(p);
        spawnProjectile(p);
      }
      channelRef.current?.send({ type: "broadcast", event: "fire", payload: { projectiles: batch } });
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
        let dx = 0;
        let dy = 0;
        const k = keysRef.current;
        if (k.has("w") || k.has("arrowup")) dy -= 1;
        if (k.has("s") || k.has("arrowdown")) dy += 1;
        if (k.has("a") || k.has("arrowleft")) dx -= 1;
        if (k.has("d") || k.has("arrowright")) dx += 1;
        if (dx || dy) {
          const len = Math.hypot(dx, dy) || 1;
          const sp = BASE_SPEED * speedMult(self.upgrades);
          self.x += (dx / len) * sp * dt;
          self.y += (dy / len) * sp * dt;
          self.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, self.x));
          self.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, self.y));
        }
        tryFire(now);
      }

      // Update projectiles + shooter-authoritative collision
      const alive: Projectile[] = [];
      for (const b of projectilesRef.current) {
        if (now - b.born > b.lifetime) continue;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) {
          if (b.splash && b.owner === me.id) explode(b);
          continue;
        }

        // Only the shooter resolves hits
        if (b.owner === me.id) {
          let hit = false;
          // Mine: arms then triggers when a non-owner enters trigger radius
          if (b.weapon === "mine") {
            if (b.armed && now >= b.armed) {
              for (const other of playersRef.current.values()) {
                if (other.id === me.id || other.hp <= 0) continue;
                if (Math.hypot(other.x - b.x, other.y - b.y) < (b.trigger ?? 36)) {
                  hit = true;
                  break;
                }
              }
            }
          } else {
            for (const other of playersRef.current.values()) {
              if (other.id === me.id || other.hp <= 0) continue;
              if (Math.hypot(other.x - b.x, other.y - b.y) < PLAYER_R + b.radius) {
                hit = true;
                break;
              }
            }
          }
          if (hit) {
            explode(b);
            continue;
          }
        }
        alive.push(b);
      }
      projectilesRef.current = alive;

      // Trim swing/boom fx
      const t0 = now;
      swingsRef.current = swingsRef.current.filter((s) => t0 - s.born < 180);
      boomsRef.current = boomsRef.current.filter((b) => t0 - b.born < 400);

      // Broadcast our state ~20Hz
      if (self && now - lastBroadcast > 50) {
        lastBroadcast = now;
        channelRef.current?.send({
          type: "broadcast",
          event: "state",
          payload: {
            id: self.id, name: self.name, x: self.x, y: self.y,
            hp: self.hp, maxHp: self.maxHp, kills: self.kills, color: self.color,
            upgrades: self.upgrades,
          },
        });
      }

      render(ctx, now, self ?? null);
      raf = requestAnimationFrame(step);
    }

    function explode(b: Projectile) {
      // Apply damage to all victims in radius (splash) or one direct
      const self = playersRef.current.get(me.id);
      if (!self) return;
      const isSplash = !!b.splash;
      const radius = b.splash ?? PLAYER_R + b.radius;
      for (const other of playersRef.current.values()) {
        if (other.id === me.id || other.hp <= 0) continue;
        const d = Math.hypot(other.x - b.x, other.y - b.y);
        if (d < radius + PLAYER_R) {
          const falloff = isSplash ? Math.max(0.4, 1 - d / (radius + PLAYER_R)) : 1;
          const dmg = b.dmg * falloff;
          applyDamage(other.id, me.id, dmg, b.weapon);
          channelRef.current?.send({
            type: "broadcast", event: "hit",
            payload: { target: other.id, by: me.id, dmg, weapon: b.weapon },
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

      // Booms
      for (const b of boomsRef.current) {
        const age = (now - b.born) / 400;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.6 + age * 0.6), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Projectiles
      for (const b of projectilesRef.current) {
        ctx.fillStyle = b.ownerColor || "#fff";
        if (b.weapon === "mine") {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.7)";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 3, 0, Math.PI * 2); ctx.stroke();
        } else if (b.weapon === "rocket") {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,180,60,0.7)";
          ctx.beginPath(); ctx.arc(b.x - b.vx * 0.01, b.y - b.vy * 0.01, b.radius * 0.8, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Swings
      for (const s of swingsRef.current) {
        const age = (now - s.born) / 180;
        ctx.globalAlpha = Math.max(0, 1 - age);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.arc(s.x, s.y, s.range, s.ang - s.arc / 2, s.ang + s.arc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Players
      for (const p of playersRef.current.values()) {
        if (p.hp <= 0) continue;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 2; ctx.stroke();

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

      // Sniper charge ring on self
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

  function buyUpgrade(id: UpgradeId) {
    const self = playersRef.current.get(meRef.current.id);
    if (!self) return;
    const lvl = upgradesRef.current[id];
    if (lvl >= MAX_UPGRADE_LEVEL) return;
    const cost = upgradeCost(lvl);
    if (pointsRef.current < cost) return;
    pointsRef.current -= cost;
    const next = { ...upgradesRef.current, [id]: lvl + 1 };
    upgradesRef.current = next;
    self.upgrades = next;
    const newMax = maxHp(next);
    if (id === "health") {
      self.hp = self.hp + (newMax - self.maxHp);
    }
    self.maxHp = newMax;
    setUpgradesUi(next);
    setPointsUi(pointsRef.current);
    setHpUi({ hp: self.hp, max: self.maxHp });
  }

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/room/${code}`;
  }, [code]);

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-foreground/60 hover:text-foreground">
              ← Leave
            </Link>
            <h1 className="text-2xl font-black tracking-tight">
              ARENA<span className="text-primary">.io</span>
            </h1>
            <span className={`text-xs ${connected ? "text-primary" : "text-foreground/40"}`}>
              {connected ? "● live" : "○ connecting…"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-sm">
              <span className="font-bold">{roomName}</span>
              <span className="ml-2 font-mono text-xs tracking-widest text-foreground/50">{code}</span>
            </div>
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
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-foreground/10 bg-black shadow-2xl">
              <canvas
                ref={canvasRef}
                width={ARENA_W}
                height={ARENA_H}
                className="block w-full cursor-crosshair"
                style={{ aspectRatio: `${ARENA_W} / ${ARENA_H}` }}
              />
            </div>
            {/* Weapon HUD */}
            <div className="grid grid-cols-6 gap-2">
              {WEAPON_ORDER.map((id) => {
                const w = WEAPONS[id];
                const active = weaponUi === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      weaponRef.current = id;
                      chargeStartRef.current = null;
                      setWeaponUi(id);
                    }}
                    className={`rounded-lg border p-2 text-left text-xs transition ${
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-foreground/10 bg-foreground/5 text-foreground/70 hover:border-foreground/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{w.name}</span>
                      <span className="font-mono text-[10px] text-foreground/40">{w.key}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-foreground/50">
                      {Math.round(w.dmg)} dmg
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
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
                <span className="text-foreground/70">Kill points</span>
                <span className="font-mono font-bold text-primary">{pointsUi}</span>
              </div>
            </div>

            <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
              <h2 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">Upgrades</h2>
              <ul className="space-y-2">
                {UPGRADE_DEFS.map((u) => {
                  const lvl = upgradesUi[u.id];
                  const maxed = lvl >= MAX_UPGRADE_LEVEL;
                  const cost = maxed ? 0 : upgradeCost(lvl);
                  const can = !maxed && pointsUi >= cost;
                  return (
                    <li key={u.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{u.name}</div>
                        <div className="text-[10px] text-foreground/50">
                          Lv {lvl}/{MAX_UPGRADE_LEVEL} · {u.desc}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={can ? "default" : "secondary"}
                        disabled={!can}
                        onClick={() => buyUpgrade(u.id)}
                      >
                        {maxed ? "MAX" : `+1 (${cost})`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
              <h2 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">Scoreboard</h2>
              <ul className="space-y-1.5">
                {scoreboard.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
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
              <div>1–6 — Switch weapon</div>
              <div>Sniper: hold to charge, release to fire</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}