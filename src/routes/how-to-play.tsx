import { createFileRoute, Link } from "@tanstack/react-router";
import { HowToPlayContent } from "@/components/arena/HowToPlayContent";

export const Route = createFileRoute("/how-to-play")({
  head: () => ({
    meta: [
      { title: "How to Play — Arena.io" },
      { name: "description", content: "Controls, weapons, upgrades and tips for Arena.io 2D PvP." },
      { property: "og:title", content: "How to Play — Arena.io" },
      { property: "og:description", content: "Controls, weapons, upgrades and tips for Arena.io 2D PvP." },
    ],
  }),
  component: HowToPlayPage,
});

function HowToPlayPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-sm text-foreground/60 hover:text-foreground">← Back to lobby</Link>
          <h1 className="text-2xl font-black tracking-tight">
            How to <span className="text-primary">play</span>
          </h1>
        </div>
        <HowToPlayContent />
      </div>
    </div>
  );
}