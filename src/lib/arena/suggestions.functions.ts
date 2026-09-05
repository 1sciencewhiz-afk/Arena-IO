import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = { id: string };

/**
 * Admin-only: run the AI assistant over an approved suggestion and store its
 * implementation plan on the row.
 */
export const aiReviewSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => {
    if (!input || typeof input.id !== "string" || !input.id) throw new Error("Missing suggestion id");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: row, error } = await supabase
      .from("suggestions")
      .select("id, kind, details, username")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) throw new Error("Suggestion not found");

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const prompt = [
      "You are the AI engineer for Arena.io, a fast-paced online 2D PvP browser arena game",
      "(rooms with codes, 43 weapons, kill-point upgrades, bot squads, mobile joysticks).",
      `A player named ${row.username} submitted an approved suggestion.`,
      `Category: ${row.kind}.`,
      `Suggestion: ${row.details}`,
      "",
      "Reply with a concise implementation plan the team can act on:",
      "1) what exactly changes in the game, 2) step-by-step build steps,",
      "3) balance or performance risks, 4) how to test it. Keep it under 250 words.",
    ].join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.6-sol",
        input: prompt,
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("The AI assistant is busy right now. Try again shortly.");
      if (res.status === 402) throw new Error("AI credits are exhausted. Add credits to keep using the assistant.");
      throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as { type?: string; delta?: string };
          if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
            text += evt.delta;
          }
        } catch {
          /* ignore keep-alive fragments */
        }
      }
    }

    const answer = text.trim() || "The assistant finished without a written plan. Try running it again.";
    await supabase
      .from("suggestions")
      .update({ ai_response: answer, reviewed_at: new Date().toISOString() })
      .eq("id", row.id);

    return { answer };
  });
