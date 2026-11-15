import { afterEach, expect, it, vi } from "vitest";
import { demoApiResponse } from "./api";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

async function ask(bot_id: string, text: string) {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("The assistant must use its local evidence for data questions"); }));
  const created = await demoApiResponse("/farm-assistant/conversations", { method: "POST", body: { bot_id, language: "en" } });
  const conversation = await created.json();
  const response = await demoApiResponse(`/farm-assistant/conversations/${conversation.id}/messages`, { method: "POST", body: { text } });
  expect(response.status).toBe(200);
  return response.json();
}

it("answers an annual rainfall question from the Iowa release instead of an ungrounded chat reply", async () => {
  const message = await ask("remote-water", "What was rainfall in 2023?");
  const answer = message.response.paragraphs[0].text;
  expect(answer).toContain("873.234981 mm");
  expect(answer).toContain("GPM");
  expect(answer).toContain("2023");
});

it("offers only available periods when the requested soil moisture year has no sample", async () => {
  const message = await ask("remote-soil", "Field 1 soil moisture in 2025");
  const answer = message.response.paragraphs[0].text;
  expect(answer).toContain("2024-07-16");
  expect(answer).not.toMatch(/0\.25 m³\/m³/);
  expect(message.response.suggestions).toEqual([
    "Field 1 soil moisture in 2024", "Field 2 soil moisture in 2024",
    "Field 3 soil moisture in 2024", "Field 4 soil moisture in 2024",
  ]);
});

it("retrieves a named field's SMAP sample and labels it as demo data", async () => {
  const message = await ask("remote-soil", "Field 2 soil moisture in 2024");
  const answer = message.response.paragraphs[0].text;
  expect(answer).toContain("0.26 m³/m³");
  expect(answer).toContain("SMAP");
  expect(answer).toContain("precomputed demo");
});

it("does not turn an unavailable field number into a different field's reading", async () => {
  const message = await ask("remote-soil", "Field 10 soil moisture in 2024");
  expect(message.response.paragraphs[0].text).toContain("Choose Field 1, Field 2, Field 3, or Field 4");
  expect(message.response.paragraphs[0].text).not.toContain("0.25 m³/m³");
});

it("offers supported metrics and years for an unspecified water request", async () => {
  const message = await ask("remote-water", "Check water conditions");
  const answer = message.response.paragraphs[0].text;
  expect(answer).toContain("2022, 2023, 2024");
  expect(answer).toMatch(/rainfall/i);
  expect(answer).toContain("ET₀");
  expect(answer).toContain("2024-07-16");
  expect(message.response.suggestions).toEqual([
    "2024 rainfall", "2024 reference ET₀", "Field 1 soil moisture in 2024",
  ]);
});

it("retrieves a crop calendar from the published Iowa demo profile", async () => {
  const message = await ask("local-knowledge-guide", "When can I sow maize?");
  const answer = message.response.paragraphs[0].text;
  expect(answer).toContain("Apr 20");
  expect(answer).toContain("May 18");
  expect(answer).toContain("iowa-benchmark-20261114-v2");
  expect(answer).toContain("benchmark");
});

it("offers only knowledge topics backed by the demo profile", async () => {
  const message = await ask("local-knowledge-guide", "What local knowledge can you check?");
  expect(message.response.suggestions).toEqual([
    "Maize sowing window", "Spring oat sowing window", "Dry field pea sowing window",
  ]);
});

it("does not fabricate a current crop price from the demo profile", async () => {
  const message = await ask("local-knowledge-guide", "What is the current soybean price?");
  expect(message.response.paragraphs[0].text).toMatch(/no live.*price/i);
  expect(message.response.suggestions).toContain("Maize sowing window");
});
