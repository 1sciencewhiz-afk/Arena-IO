import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/room/$code")({
  head: () => ({
    meta: [{ title: "Arena Room" }, { name: "robots", content: "noindex" }],
  }),
  component: RoomPage,
});

const ARENA_W = 1200;
const ARENA_H = 700;
const PLAYER_R = 18;
const BULLET_R = 5;
const SPEED = 260; // px/sec
const BULLET_SPEED = 520;
const FIRE_COOLDOWN = 0.25;
const MAX_HP = 100;
const BULLET_DMG = 12;

type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  hp: number;
  kills: number;
};

type Bullet = {
  id: string;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
};

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

  // Mutable game state held in refs (no React re-renders per frame)
  const playersRef = useRef<Map<string, Player>>(new Map());
  const bulletsRef = useRef<Bullet[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef({ x: ARENA_W / 2, y: ARENA_H / 2, down: false });
  const lastFireRef = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const me: Player = {
      id: meRef.current.id,
      name: meRef.current.name,
      x: Math.random() * (ARENA_W - 200) + 100,
      y: Math.random() * (ARENA_H - 200) + 100,
      color: colorFor(meRef.current.id),
      hp: MAX_HP,
      kills: 0,
    };
    playersRef.current.set(me.id, me);

    const channel = supabase.channel(`arena:${code}`, {
      config: {
        broadcast: { self: false },
        presence: { key: me.id },
      },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string; color: string }>();
        // Remove players no longer present
        const presentIds = new Set(Object.keys(state));
        for (const id of Array.from(playersRef.current.keys())) {
          if (!presentIds.has(id)) playersRef.current.delete(id);
        }
        // Ensure each present player exists
        for (const id of presentIds) {
          if (!playersRef.current.has(id)) {
            const meta = state[id]?.[0];
            playersRef.current.set(id, {
              id,
              name: meta?.name ?? "???",
              x: ARENA_W / 2,
              y: ARENA_H / 2,
              color: meta?.color ?? colorFor(id),
              hp: MAX_HP,
              kills: 0,
            });
          }
        }
        updateScoreboard();
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        const p = payload as { id: string; x: number; y: number; hp: number; name: string; kills: number };
        const existing = playersRef.current.get(p.id);
        if (existing) {
          existing.x = p.x;
          existing.y = p.y;
          existing.hp = p.hp;
          existing.kills = p.kills;
          existing.name = p.name;
        } else {
          playersRef.current.set(p.id, {
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            color: colorFor(p.id),
            hp: p.hp,
            kills: p.kills,
          });
        }
      })
      .on("broadcast", { event: "shoot" }, ({ payload }) => {
        const b = payload as Bullet;
        if (b.owner !== me.id) bulletsRef.current.push(b);
      })
      .on("broadcast", { event: "hit" }, ({ payload }) => {
        const { target, by } = payload as { target: string; by: string };
        const t = playersRef.current.get(target);
        if (t) {
          t.hp = Math.max(0, t.hp - BULLET_DMG);
          if (t.hp === 0) {
            const shooter = playersRef.current.get(by);
            if (shooter) shooter.kills += 1;
            // respawn target after 1.5s if it's us; others handle their own respawn
            if (target === me.id) {
              setTimeout(() => {
                const self = playersRef.current.get(me.id);
                if (self) {
                  self.hp = MAX_HP;
                  self.x = Math.random() * (ARENA_W - 200) + 100;
                  self.y = Math.random() * (ARENA_H - 200) + 100;
                }
              }, 1500);
            }
          }
          updateScoreboard();
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          await channel.track({ name: me.name, color: me.color });
        }
      });

    let scoreboardTimer = 0;
    function updateScoreboard() {
      const now = performance.now();
      if (now - scoreboardTimer < 200) return;
      scoreboardTimer = now;
      setScoreboard(
        Array.from(playersRef.current.values()).sort((a, b) => b.kills - a.kills),
      );
    }

    // Input
    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase());
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
    const onMouseDown = () => (mouseRef.current.down = true);
    const onMouseUp = () => (mouseRef.current.down = false);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

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
        const len = Math.hypot(dx, dy) || 1;
        self.x += (dx / len) * SPEED * dt * (dx || dy ? 1 : 0);
        self.y += (dy / len) * SPEED * dt * (dx || dy ? 1 : 0);
        self.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, self.x));
        self.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, self.y));

        // Shoot
        if (mouseRef.current.down) {
          const t = now / 1000;
          if (t - lastFireRef.current > FIRE_COOLDOWN) {
            lastFireRef.current = t;
            const ang = Math.atan2(mouseRef.current.y - self.y, mouseRef.current.x - self.x);
            const bullet: Bullet = {
              id: `${me.id}-${now}`,
              owner: me.id,
              x: self.x + Math.cos(ang) * (PLAYER_R + 4),
              y: self.y + Math.sin(ang) * (PLAYER_R + 4),
              vx: Math.cos(ang) * BULLET_SPEED,
              vy: Math.sin(ang) * BULLET_SPEED,
              born: now,
            };
            bulletsRef.current.push(bullet);
            channelRef.current?.send({ type: "broadcast", event: "shoot", payload: bullet });
          }
        }
      }

      // Update bullets
      const alive: Bullet[] = [];
      for (const b of bulletsRef.current) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (now - b.born > 2000) continue;
        if (b.x < 0 || b.x > ARENA_W || b.y < 0 || b.y > ARENA_H) continue;

        // Collision check vs MY player only (each client validates hits on self)
        let hit = false;
        if (self && self.hp > 0 && b.owner !== self.id) {
          const d = Math.hypot(b.x - self.x, b.y - self.y);
          if (d < PLAYER_R + BULLET_R) {
            hit = true;
            const newHp = Math.max(0, self.hp - BULLET_DMG);
            self.hp = newHp;
            channelRef.current?.send({
              type: "broadcast",
              event: "hit",
              payload: { target: self.id, by: b.owner },
            });
            if (newHp === 0) {
              const shooter = playersRef.current.get(b.owner);
              if (shooter) shooter.kills += 1;
              setTimeout(() => {
                self.hp = MAX_HP;
                self.x = Math.random() * (ARENA_W - 200) + 100;
                self.y = Math.random() * (ARENA_H - 200) + 100;
              }, 1500);
            }
          }
        }
        if (!hit) alive.push(b);
      }
      bulletsRef.current = alive;

      // Broadcast our state ~20Hz
      if (self && now - lastBroadcast > 50) {
        lastBroadcast = now;
        channelRef.current?.send({
          type: "broadcast",
          event: "state",
          payload: {
            id: self.id,
            name: self.name,
            x: self.x,
            y: self.y,
            hp: self.hp,
            kills: self.kills,
          },
        });
      }

      // Render
      ctx.fillStyle = "#0d1320";
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < ARENA_W; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ARENA_H);
        ctx.stroke();
      }
      for (let y = 0; y < ARENA_H; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ARENA_W, y);
        ctx.stroke();
      }
      // border
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, ARENA_W, ARENA_H);

      // bullets
      for (const b of bulletsRef.current) {
        const owner = playersRef.current.get(b.owner);
        ctx.fillStyle = owner?.color ?? "#fff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
        ctx.fill();
      }

      // players
      for (const p of playersRef.current.values()) {
        if (p.hp <= 0) continue;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // name
        ctx.fillStyle = "#fff";
        ctx.font = "600 13px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(p.name, p.x, p.y - PLAYER_R - 12);

        // hp bar
        const w = 42;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(p.x - w / 2, p.y - PLAYER_R - 8, w, 4);
        ctx.fillStyle = p.hp > 50 ? "#4ade80" : p.hp > 25 ? "#facc15" : "#ef4444";
        ctx.fillRect(p.x - w / 2, p.y - PLAYER_R - 8, (w * p.hp) / MAX_HP, 4);
      }

      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [code]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/room/${code}`;
  }, [code]);

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-foreground/60 hover:text-foreground">
              ← Leave
            </Link>
            <h1 className="text-2xl font-black tracking-tight">
              ARENA<span className="text-primary">.io</span>
            </h1>
            <span
              className={`text-xs ${connected ? "text-primary" : "text-foreground/40"}`}
            >
              {connected ? "● live" : "○ connecting…"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-1.5 font-mono text-sm">
              Room: <span className="font-bold tracking-widest">{code}</span>
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

        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
          <div className="overflow-hidden rounded-xl border border-foreground/10 bg-black shadow-2xl">
            <canvas
              ref={canvasRef}
              width={ARENA_W}
              height={ARENA_H}
              className="block w-full cursor-crosshair"
              style={{ aspectRatio: `${ARENA_W} / ${ARENA_H}` }}
            />
          </div>
          <aside className="space-y-3">
            <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
              <h2 className="mb-2 text-xs uppercase tracking-wider text-foreground/60">
                Scoreboard
              </h2>
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
              <div>Mouse — Aim</div>
              <div>Click / Hold — Shoot</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}