import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInWithUsername, signUpWithUsername } from "@/lib/arena/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Arena.io" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUpWithUsername(username, password);
        await signInWithUsername(username, password);
      } else {
        await signInWithUsername(username, password);
      }
      try { localStorage.setItem("arena.name", username.trim()); } catch { /* ignore */ }
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const playAsGuest = () => {
    try { localStorage.setItem("arena.guest", "1"); } catch { /* ignore */ }
    navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm space-y-6 py-10">
        <div className="text-center">
          <Link to="/" className="text-3xl font-black tracking-tight">
            ARENA<span className="text-primary">.io</span>
          </Link>
          <p className="mt-2 text-xs text-foreground/60">
            Accounts save your upgrades. No email required.
          </p>
        </div>

        <div className="flex rounded-lg border border-foreground/10 p-1">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition ${mode === "signin" ? "bg-foreground/10 text-foreground" : "text-foreground/60"}`}
          >Sign in</button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition ${mode === "signup" ? "bg-foreground/10 text-foreground" : "text-foreground/60"}`}
          >Create account</button>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-foreground/10 bg-foreground/5 p-5">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-foreground/60">Username</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="warrior42"
              maxLength={16}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-foreground/60">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button type="submit" disabled={busy} className="h-11 w-full font-bold">
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs text-foreground/40">
          <div className="h-px flex-1 bg-foreground/10" />
          OR
          <div className="h-px flex-1 bg-foreground/10" />
        </div>

        <Button variant="secondary" onClick={playAsGuest} className="h-11 w-full font-semibold">
          Continue as guest
        </Button>
        <p className="text-center text-[10px] text-foreground/40">
          Guests can play, but upgrades won't be saved.
        </p>
      </div>
    </div>
  );
}