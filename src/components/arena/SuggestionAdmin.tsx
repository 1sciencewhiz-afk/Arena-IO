import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { aiReviewSuggestion } from "@/lib/arena/suggestions.functions";
import { SUGGESTION_KINDS, type SuggestionKind } from "./SuggestionForm";

type Row = {
  id: string;
  username: string;
  kind: SuggestionKind;
  details: string;
  status: "pending" | "approved" | "rejected";
  ai_response: string | null;
  created_at: string;
};

export function SuggestionAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "all">("pending");

  const load = async () => {
    const { data } = await supabase
      .from("suggestions")
      .select("id, username, kind, details, status, ai_response, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => { void load(); }, []);

  const setStatus = async (r: Row, status: Row["status"]) => {
    setBusy(r.id);
    await supabase.from("suggestions").update({ status }).eq("id", r.id);
    setBusy(null);
    await load();
  };

  const approveAndFix = async (r: Row) => {
    setBusy(r.id);
    setError(null);
    try {
      await supabase.from("suggestions").update({ status: "approved" }).eq("id", r.id);
      await aiReviewSuggestion({ data: { id: r.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI assistant could not run.");
    }
    setBusy(null);
    await load();
  };

  const remove = async (r: Row) => {
    setBusy(r.id);
    await supabase.from("suggestions").delete().eq("id", r.id);
    setBusy(null);
    await load();
  };

  const visible = tab === "pending" ? rows.filter((r) => r.status === "pending") : rows;

  return (
    <div className="rounded-xl border-2 border-yellow-500/40 bg-yellow-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-400">
            Admin
          </span>
          <h3 className="text-sm font-bold uppercase tracking-wider">Suggestions</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={tab === "pending" ? "default" : "secondary"} onClick={() => setTab("pending")}>
            Pending
          </Button>
          <Button size="sm" variant={tab === "all" ? "default" : "secondary"} onClick={() => setTab("all")}>
            All
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      {error && <p className="mb-2 text-[11px] font-semibold text-red-400">{error}</p>}

      <ul className="max-h-[420px] space-y-2 overflow-y-auto">
        {visible.map((r) => (
          <li key={r.id} className="rounded-lg border border-foreground/10 bg-background/40 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{r.username}</span>
              <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground/60">
                {SUGGESTION_KINDS.find((k) => k.id === r.kind)?.label ?? r.kind}
              </span>
              <span
                className={`text-[10px] font-bold uppercase ${
                  r.status === "approved" ? "text-green-400" : r.status === "rejected" ? "text-red-400" : "text-foreground/40"
                }`}
              >
                {r.status}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-foreground/80">{r.details}</p>

            {r.ai_response && (
              <div className="mt-2 whitespace-pre-wrap rounded-md border border-primary/30 bg-primary/10 p-2 text-[11px] text-foreground/85">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">AI fix plan</div>
                {r.ai_response}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" disabled={busy === r.id} onClick={() => void approveAndFix(r)}>
                {busy === r.id ? "Working…" : r.ai_response ? "Re-run AI" : "Approve + AI fix"}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => void setStatus(r, "rejected")}>
                Reject
              </Button>
              <Button size="sm" variant="destructive" disabled={busy === r.id} onClick={() => void remove(r)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="rounded-lg border border-dashed border-foreground/10 p-6 text-center text-[11px] text-foreground/40">
            No suggestions here yet.
          </li>
        )}
      </ul>
    </div>
  );
}
