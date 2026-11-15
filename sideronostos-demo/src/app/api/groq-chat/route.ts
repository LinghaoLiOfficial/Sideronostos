import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_API = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

type RequestBody = {
  text?: unknown;
  bot_id?: unknown;
  bot_name?: unknown;
  language?: unknown;
  history?: unknown;
};

const botInstructions: Record<string, string> = {
  "general-guide": "You are a general farm assistant. Help with fields, observations, and crop rotation, and clearly label assumptions.",
  "field-guide": "You are a field management assistant. Focus on saved field records, boundaries, field details, and practical management questions.",
  "remote-water": "You are a remote sensing water specialist. Discuss soil water and water observations, explain uncertainty, and never invent unavailable measurements.",
  "remote-soil": "You are a remote sensing soil specialist. Discuss soil observations and their limits, and distinguish measured data from examples.",
  "remote-weather": "You are a weather observations specialist. Discuss available historical observations and uncertainty; do not present a live forecast unless supplied.",
  "local-knowledge-guide": "You are a local agricultural knowledge assistant. Give practical, sourced-style explanations and clearly identify examples or assumptions.",
  "rotation-guide": "You are a crop rotation assistant. Explain rotation trade-offs involving water, cover, diversity, cost, and labor; do not present advice as a validated prescription.",
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return errorResponse("GROQ_API_KEY is not configured", 501);

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return errorResponse("Invalid JSON request", 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return errorResponse("Message text is required", 400);
  if (text.length > 8000) return errorResponse("Message is too long", 413);

  const botId = typeof body.bot_id === "string" ? body.bot_id : "general-guide";
  const language = body.language === "en" ? "English" : "Chinese";
  const botName = typeof body.bot_name === "string" ? body.bot_name : "farm assistant";
  const history = Array.isArray(body.history)
    ? body.history.filter((item): item is { role: "user" | "assistant"; content: string } =>
      typeof item === "object" && item !== null &&
      ((item as { role?: unknown }).role === "user" || (item as { role?: unknown }).role === "assistant") &&
      typeof (item as { content?: unknown }).content === "string",
    ).slice(-12)
    : [];
  const system = `${botInstructions[botId] ?? botInstructions["general-guide"]} You are ${botName}. Reply in ${language}. Keep the answer concise and useful. This is a frontend demonstration using synthetic or incomplete data; say when information is unavailable.`;
  const base = (process.env.GROQ_BASE_API?.trim() || DEFAULT_BASE_API).replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [{ role: "system", content: system }, ...history, { role: "user", content: text }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Groq request failed", response.status, detail.slice(0, 500));
      return errorResponse("Groq request failed", 502);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const answer = payload.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) return errorResponse("Groq returned an empty response", 502);
    return NextResponse.json({ answer: answer.trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Groq request error", error);
    return errorResponse("Groq is temporarily unavailable", 502);
  }
}
