import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  const go = (roomCode: string) => {
    const trimmed = name.trim() || `Player${Math.floor(Math.random() * 999)}`;
    localStorage.setItem("arena.name", trimmed);
    navigate({ to: "/room/$code", params: { code: roomCode.toUpperCase() } });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-5xl font-black tracking-tight">
            ARENA<span className="text-primary">.io</span>
          </h1>
          <p className="mt-3 text-sm text-foreground/60">
            Real-time 2D PvP. Create a room or jump into a friend's.
          </p>
        </div>

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

          <Button
            onClick={() => go(randomCode())}
            className="h-12 w-full text-base font-bold"
          >
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
                className="border-foreground/10 bg-background font-mono tracking-widest text-foreground uppercase"
              />
              <Button
                variant="secondary"
                disabled={!code.trim()}
                onClick={() => go(code.trim())}
              >
                Join
              </Button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-foreground/40">
          WASD to move · Click to shoot · First to 0 HP loses
        </p>
      </div>
    </div>
  );
}
