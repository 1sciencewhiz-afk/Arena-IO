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

    const apiKey = process.env["GEMINI_API_KEY"];
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

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("The AI assistant is rate limited right now. Try again shortly.");
      if (res.status === 400 || res.status === 403) throw new Error("The Gemini API key was rejected. Check the key and try again.");
      throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    const answer = text.trim() || "The assistant finished without a written plan. Try running it again.";
    await supabase
      .from("suggestions")
      .update({ ai_response: answer, reviewed_at: new Date().toISOString() })
      .eq("id", row.id);

    return { answer };
  });
