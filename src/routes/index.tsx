import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { subscribeLobby, type LobbyRoom } from "@/lib/arena/lobby";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Arena.io — 2D PvP Arena" },
      { name: "description", content: "Create or join a private arena and battle your friends in real time." },
    ],
  }),
  component: Index,
});

function randomCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function Index() {
  const navigate = useNavigate();
  const [name, setName] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("arena.name") ?? "",
  );
  const [code, setCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);

  useEffect(() => subscribeLobby(setRooms), []);

  const go = (roomCode: string, customName?: string) => {
    const trimmed = name.trim() || `Player${Math.floor(Math.random() * 999)}`;
    localStorage.setItem("arena.name", trimmed);
    const upper = roomCode.toUpperCase();
    const finalName = (customName ?? roomName).trim() || `${trimmed}'s Arena`;
    try {
      sessionStorage.setItem(`arena.roomName.${upper}`, finalName);
    } catch {
      /* ignore */
    }
    navigate({ to: "/room/$code", params: { code: upper } });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-5xl space-y-8 py-10">
        <div className="relative text-center">
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
            ARENA<span className="text-primary">.io</span>
          </h1>
          <p className="mt-3 text-sm text-foreground/60">
            Real-time 2D PvP. Create a room or jump into a friend's.
          </p>
          <Link
            to="/how-to-play"
            className="mt-3 inline-block text-xs font-semibold text-primary underline-offset-4 hover:underline sm:absolute sm:right-0 sm:top-1 sm:mt-0"
          >
            How to play →
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-foreground/10 bg-foreground/5 p-6 backdrop-blur">
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-foreground/60">
                Nickname
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={16}
                className="border-foreground/10 bg-background text-foreground"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-foreground/60">
                Room name (optional)
              </label>
              <Input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="The Pit"
                maxLength={24}
                className="border-foreground/10 bg-background text-foreground"
              />
            </div>

            <Button onClick={() => go(randomCode())} className="h-12 w-full text-base font-bold">
              Create new room
            </Button>

            <div className="flex items-center gap-3 text-xs text-foreground/40">
              <div className="h-px flex-1 bg-foreground/10" />
              OR
              <div className="h-px flex-1 bg-foreground/10" />
            </div>

            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wider text-foreground/60">
                Join with code
              </label>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCDE"
                  maxLength={6}
                  className="border-foreground/10 bg-background font-mono uppercase tracking-widest text-foreground"
                />
                <Button variant="secondary" disabled={!code.trim()} onClick={() => go(code.trim())}>
                  Join
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-foreground/10 bg-foreground/5 p-6 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground/80">
                Open rooms
              </h2>
              <span className="text-xs text-foreground/40">{rooms.length} live</span>
            </div>
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {rooms.map((r) => (
                <li
                  key={r.code}
                  className="flex items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-bold">{r.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-foreground/40">
                        {r.code}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-foreground/60">
                      {r.players.length} player{r.players.length === 1 ? "" : "s"} ·{" "}
                      {r.players.join(", ")}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => go(r.code, r.name)}>
                    Join
                  </Button>
                </li>
              ))}
              {rooms.length === 0 && (
                <li className="rounded-lg border border-dashed border-foreground/10 p-6 text-center text-xs text-foreground/40">
                  No active rooms. Create one to get started.
                </li>
              )}
            </ul>
          </div>
        </div>

        <p className="text-center text-xs text-foreground/40">
          WASD to move · 1–6 switch weapons · Click to attack · Spend kills on upgrades
        </p>
      </div>
    </div>
  );
}