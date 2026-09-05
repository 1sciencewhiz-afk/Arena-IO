import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const SUGGESTION_KINDS = [
  { id: "technical", label: "Technical" },
  { id: "gameplay", label: "Gameplay" },
  { id: "new_content", label: "New content" },
  { id: "visual_effects", label: "Visual effects" },
] as const;

export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]["id"];

type MySuggestion = {
  id: string;
  kind: SuggestionKind;
  details: string;
  status: "pending" | "approved" | "rejected";
  ai_response: string | null;
};

export function SuggestionForm({ userId, username }: { userId: string | null; username: string }) {
  const [kind, setKind] = useState<SuggestionKind>("gameplay");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [mine, setMine] = useState<MySuggestion[]>([]);

  const load = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("suggestions")
      .select("id, kind, details, status, ai_response")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    setMine((data ?? []) as MySuggestion[]);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const submit = async () => {
    if (!userId || !details.trim()) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("suggestions").insert({
      user_id: userId,
      username: username || "Player",
      kind,
      details: details.trim().slice(0, 2000),
    });
    setBusy(false);
    if (error) { setMsg("Could not send your suggestion. Try again."); return; }
    setDetails("");
    setMsg("Thanks! Your suggestion was sent for review.");
    await load();
  };

  if (!userId) {
    return (
      <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4 text-xs text-foreground/60">
        Create an account to send suggestions to the developers.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4">
      <h3 className="text-sm font-bold uppercase tracking-wider">Suggestion box</h3>
      <p className="mb-3 text-[11px] text-foreground/60">
        Tell us what would make the arena better.
      </p>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {SUGGESTION_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              kind === k.id
                ? "border-primary bg-primary/20 text-primary"
                : "border-foreground/15 text-foreground/60 hover:text-foreground"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <Textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Describe your idea in as much detail as you like…"
        className="min-h-[90px] text-sm"
      />

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={busy || !details.trim()} onClick={() => void submit()}>
          {busy ? "Sending…" : "Send suggestion"}
        </Button>
        {msg && <span className="text-[11px] text-foreground/60">{msg}</span>}
      </div>

      {mine.length > 0 && (
        <ul className="mt-3 space-y-2">
          {mine.map((s) => (
            <li key={s.id} className="rounded-lg border border-foreground/10 p-2 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase tracking-wider text-foreground/50">
                  {SUGGESTION_KINDS.find((k) => k.id === s.kind)?.label ?? s.kind}
                </span>
                <span
                  className={
                    s.status === "approved"
                      ? "text-green-400"
                      : s.status === "rejected"
                        ? "text-red-400"
                        : "text-foreground/40"
                  }
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-0.5 text-foreground/70">{s.details}</div>
              {s.ai_response && (
                <div className="mt-1 whitespace-pre-wrap rounded bg-primary/10 p-2 text-foreground/80">
                  {s.ai_response}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
