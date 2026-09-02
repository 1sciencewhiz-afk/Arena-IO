import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { subscribeLobby, type LobbyRoom } from "@/lib/arena/lobby";
import { useAuthUser, useProfile, signOut, useIsAdmin } from "@/lib/arena/auth";
import { useLoadout } from "@/lib/arena/loadout";
import { Armory } from "@/components/arena/Armory";
import { AdminPanel } from "@/components/arena/AdminPanel";

export const PUBLIC_ROOM_CODE = "PUBLIC";

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
  const { userId, ready } = useAuthUser();
  const { profile } = useProfile(userId);
  const { loadout, update } = useLoadout(userId);
  const isAdmin = useIsAdmin(userId);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  useEffect(() => subscribeLobby(setRooms), []);

  // Hydrate name on client to avoid SSR mismatch
  useEffect(() => {
    try { setName(localStorage.getItem("arena.name") ?? ""); } catch { /* ignore */ }
  }, []);

  // Sync nickname to username when signed in
  useEffect(() => {
    if (profile?.username) {
      setName(profile.username);
      try { localStorage.setItem("arena.name", profile.username); } catch { /* ignore */ }
    }
  }, [profile?.username]);

  const isGuest = !userId;
  const displayName = profile?.username ?? (name.trim() || "Guest");

  const go = (roomCode: string, customName?: string, cfg?: RoomConfig) => {
    const trimmed = name.trim() || `Player${Math.floor(Math.random() * 999)}`;
    try { localStorage.setItem("arena.name", trimmed); } catch { /* ignore */ }
    const upper = roomCode.toUpperCase();
    const finalName =
      upper === PUBLIC_ROOM_CODE
        ? "Public Arena"
        : (customName ?? roomName).trim() || `${trimmed}'s Arena`;
    try {
      sessionStorage.setItem(`arena.roomName.${upper}`, finalName);
      if (cfg && upper !== PUBLIC_ROOM_CODE) {
        sessionStorage.setItem(`arena.roomConfig.${upper}`, encodeConfig(cfg));
      }
    } catch { /* ignore */ }
    navigate({ to: "/room/$code", params: { code: upper } });
  };

  const publicRoom = rooms.find((r) => r.code === PUBLIC_ROOM_CODE);
  const otherRooms = rooms.filter((r) => r.code !== PUBLIC_ROOM_CODE);

  return (
    <div className="min-h-screen bg-background px-4 text-foreground">
      <div className="mx-auto w-full max-w-6xl space-y-8 py-10">
        {/* Account bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${userId ? "bg-primary" : "bg-foreground/30"}`} />
            <span className="text-foreground/70">
              {ready
                ? userId
                  ? <>Signed in as <span className="font-bold text-foreground">{displayName}</span></>
                  : <>Playing as <span className="font-bold text-foreground">Guest</span></>
                : "…"}
            </span>
            {isAdmin && (
              <span className="ml-1 rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
                Admin
              </span>
            )}
            <span className="ml-2 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
              {loadout.killPoints} pts
            </span>
          </div>
          <div className="flex items-center gap-2">
            {userId ? (
              <Button size="sm" variant="ghost" onClick={() => signOut()}>Sign out</Button>
            ) : (
              <Link to="/login">
                <Button size="sm" variant="secondary">Sign in / Create account</Button>
              </Link>
            )}
          </div>
        </div>

        <div className="relative text-center">
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
            ARENA<span className="text-primary">.io</span>
          </h1>
          <p className="mt-3 text-sm text-foreground/60">
            Real-time 2D PvP. Build your loadout, then jump in.
          </p>
          <Link
            to="/how-to-play"
            className="mt-3 inline-block text-xs font-semibold text-primary underline-offset-4 hover:underline sm:absolute sm:right-0 sm:top-1 sm:mt-0"
          >
            How to play →
          </Link>
        </div>

        {/* Public Arena CTA */}
        <button
          onClick={() => go(PUBLIC_ROOM_CODE, "Public Arena")}
          className="group flex w-full items-center justify-between gap-4 rounded-2xl border-2 border-primary/40 bg-gradient-to-r from-primary/20 to-primary/5 p-5 text-left transition hover:border-primary hover:from-primary/30"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-black tracking-tight">PUBLIC ARENA</span>
              <span className="rounded-md bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                No code needed
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-foreground/60">
              {publicRoom && publicRoom.players.length > 0
                ? `${publicRoom.players.length} player${publicRoom.players.length === 1 ? "" : "s"} in the arena: ${publicRoom.players.join(", ")}`
                : "Be the first one in — open to everyone."}
            </p>
          </div>
          <span className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition group-hover:scale-105">
            JOIN →
          </span>
        </button>

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
                disabled={!!userId}
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
                Private rooms
              </h2>
              <span className="text-xs text-foreground/40">{otherRooms.length} live</span>
            </div>
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {otherRooms.map((r) => (
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
              {otherRooms.length === 0 && (
                <li className="rounded-lg border border-dashed border-foreground/10 p-6 text-center text-xs text-foreground/40">
                  No private rooms. Create one to get started.
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Armory */}
        <Armory loadout={loadout} update={update} isGuest={isGuest} />

        {isAdmin && <AdminPanel />}

        {profile?.banned && (
          <p className="text-center text-xs font-bold text-red-400">
            Your account has been banned. You cannot join matches.
          </p>
        )}

        {isGuest && ready && (
          <p className="text-center text-[11px] text-foreground/50">
            Playing as guest — <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">create an account</Link> to save your loadout across devices.
          </p>
        )}
      </div>
    </div>
  );
}
