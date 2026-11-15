import { demoUser } from "@/lib/demo-mode";
import { demoFieldsApi, demoPreflight, demoProfile, demoRelease, demoRun, demoWorkspace, DEMO_PROFILE_ID, stamp } from "./data";
import { iowaMonthly } from "./iowa-backend-data";
import { demoObservationResponse } from "./observation-api";
import { demoRetrievalAnswer } from "./assistant-retrieval";

const WORKSPACE_KEY = "agrisata-demo-workspace";
const RUN_KEY = "agrisata-demo-run";
const CHAT_KEY = "agrisata-demo-conversations";
const KNOWLEDGE_KEY = "agrisata-demo-local-knowledge";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const bodyOf = (options: { body?: unknown }): Record<string, unknown> => {
  try {
    const value = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
};
const now = () => new Date().toISOString();
function workspace() {
  if (typeof localStorage === "undefined") return demoWorkspace();
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "null") as ReturnType<typeof demoWorkspace> | null;
    return stored?.initialized_from === "iowa-backend-sample-v1" ? stored : demoWorkspace();
  } catch { return demoWorkspace(); }
}
function saveWorkspace(value: unknown) { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(value)); } catch { /* demo remains in memory */ } }
function run() {
  if (typeof localStorage === "undefined") return demoRun({});
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_KEY) ?? "null") as ReturnType<typeof demoRun> | null
    if (!saved) return demoRun({})
    return { ...saved, request: { ...saved.request, scenario: saved.request?.scenario ?? { temperature_change_c: 0, rainfall_change_pct: 0 } } }
  } catch { return demoRun({}); }
}
function assistantAnswer(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("水") || lower.includes("moisture")) return { paragraphs: [{ text: "Iowa 示例区的土壤水分处于可管理范围。Field 3 的灌溉余量最低，建议在播种前复核田间持水量。", evidence_ids: ["demo-soil-moisture"] }], actions: ["view_sources"], needs_clarification: false, facts: [{ id: "demo-soil-moisture", key: "soil_moisture", label: "表层土壤水分", value: 0.27, unit: "m³/m³", display: "0.27 m³/m³", source: { release_id: "demo" }, limitations: ["合成演示指标"] }] };
  return { paragraphs: [{ text: "基于 Iowa benchmark，建议在玉米和大豆之间轮换，并保留燕麦作为覆盖作物候选。当前演示方案优先平衡水量、覆盖天数和作物科属多样性。", evidence_ids: ["demo-rotation-rule"] }], actions: ["open_planner"], needs_clarification: false, facts: [], citations: [], warnings: ["这是预计算的演示回复，不是实时农艺处方。"] };
}
async function groqAnswer(body: Record<string, unknown>, history: unknown[]) {
  try {
    const response = await fetch("/api/groq-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, history }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      const status = response.status;
      await response.json().catch(() => undefined);
      // The demo must remain usable without a working optional Groq setup.
      // Fall back to the deterministic local answer below for missing keys,
      // network failures, rate limits, and invalid credentials alike.
      if (status === 501) return null;
      return null;
    }
    const payload = await response.json() as { answer?: unknown };
    if (typeof payload.answer !== "string" || !payload.answer.trim()) return { error: "Groq returned an empty response", status: 502 };
    return { response: { paragraphs: [{ text: payload.answer.trim(), evidence_ids: [] }], actions: [], needs_clarification: false, facts: [], citations: [], warnings: ["回答由 Groq 生成，仅供演示参考。"] } };
  } catch {
    return null;
  }
}
type DemoConversation = { id: string; preset: string; bot_id: string; language: string; detail: string; kb_release_id: string; created_at: string; updated_at: string; messages: unknown[] };
function conversationStore(): DemoConversation[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]") as DemoConversation[]; } catch { return []; }
}
function saveConversations(value: DemoConversation[]) { try { localStorage.setItem(CHAT_KEY, JSON.stringify(value)); } catch { /* no-op */ } }
function localKnowledge() {
  const fallback = () => {
    const profile = JSON.parse(JSON.stringify(demoProfile));
    return {
      active: { id: "demo-kb", revision: 1, status: "published", is_active: true, sha256: "demo", profile, created_at: stamp, updated_at: stamp, published_at: stamp },
      draft: { id: "demo-kb-draft", revision: null, status: "draft", is_active: false, sha256: "demo", profile: JSON.parse(JSON.stringify(profile)), created_at: stamp, updated_at: stamp, published_at: null },
      versions: [],
    };
  };
  if (typeof localStorage === "undefined") return fallback();
  try {
    const stored = JSON.parse(localStorage.getItem(KNOWLEDGE_KEY) ?? "null");
    return stored?.active && stored?.draft ? stored : fallback();
  } catch { return fallback(); }
}
function saveLocalKnowledge(value: unknown) { try { localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(value)); } catch { /* demo remains in memory */ } }

export async function demoApiResponse(path: string, options: { method?: string; body?: unknown } = {}) {
  const method = options.method ?? "GET";
  const body = bodyOf(options);
  const clean = path.split("?")[0];
  const actionConversation = clean.match(/^\/farm-assistant\/conversations\/([^/]+)\/actions(?:\/|$)/)?.[1];
  const actionLanguage = actionConversation ? conversationStore().find((item) => item.id === decodeURIComponent(actionConversation))?.language : undefined;
  const observation = demoObservationResponse(clean, method, body, actionLanguage);
  if (observation) return observation;
  if (clean === "/users/me") return json(demoUser);
  if (clean === "/field-shift/workspace" && method === "GET") return json(workspace());
  if (clean === "/field-shift/workspace/sample" && method === "POST") return json(workspace());
  if (clean === "/field-shift/workspace" && method === "PUT") { const next = { ...body, version: (workspace().version ?? 1) + 1, updated_at: now() }; saveWorkspace(next); return json(next); }
  if (clean === "/field-shift/farms" && method === "GET") return json({ items: workspace().farms });
  if (clean.startsWith("/field-shift/farms/") && method === "GET") return json({ ...workspace().farms[0], fields: workspace().fields });
  if (clean === "/field-shift/fields" && method === "GET") return json({ items: demoFieldsApi() });
  const fieldDetailId = clean.match(/^\/field-shift\/fields\/([^/]+)$/)?.[1];
  if (fieldDetailId && method === "GET") return json(demoFieldsApi().find((field) => field.id === decodeURIComponent(fieldDetailId)) ?? demoFieldsApi()[0]);
  if (clean === "/field-shift/profiles") return json({ items: [{ id: "temperate-demo", name: "Temperate demonstration profile", version: "demo-v1", is_demo: true, description: "Synthetic demo profile", assumptions: ["Synthetic weather"], crops: [], rules: [], sources: [] }] });
  if (clean.includes("/environment")) return json({ status: "cached", source_name: "NASA POWER + GPM historical backend release", source_url: "https://power.larc.nasa.gov/", reference_year: 2024, fetched_at: stamp, spatial_resolution: "regional point and 0.1-degree precipitation grid", months: iowaMonthly.filter((item) => item.month.startsWith("2024-")).map((item) => ({ month: Number(item.month.slice(-2)), rainfall_mm: item.rain_mm, tmin_c: item.tmean_c, tmax_c: item.tmean_c, reference_et_mm: item.et0_mm, valid_days: 30, expected_days: 30 })), limitations: ["Historical regional values from the backend Iowa release; not field-scale measurements."], evidence: [], fingerprint: demoRelease.manifest_sha256 });
  if (clean.includes("/analyses")) return json({ id: "iowa-backend-analysis", field_id: demoFieldsApi()[0].id, field_version: 1, created_at: now(), profile: { id: DEMO_PROFILE_ID, name: demoProfile.name, version: demoProfile.profile_version_id, is_demo: false }, profile_snapshot: demoProfile, inputs: body, environment: { status: "cached", source_name: "NASA POWER + GPM historical backend release", source_url: "https://power.larc.nasa.gov/", reference_year: 2024, fetched_at: stamp, spatial_resolution: "regional point and 0.1-degree precipitation grid", months: iowaMonthly.filter((item) => item.month.startsWith("2024-")).map((item) => ({ month: Number(item.month.slice(-2)), rainfall_mm: item.rain_mm, tmin_c: item.tmean_c, tmax_c: item.tmean_c, reference_et_mm: item.et0_mm, valid_days: 30, expected_days: 30 })), limitations: ["Historical regional values from the backend Iowa release; not field-scale measurements."], evidence: [], fingerprint: demoRelease.manifest_sha256 }, baseline: demoRun(body).result?.baseline, alternatives: demoRun(body).result?.options?.slice(1) ?? [], feasible_count: 2, rejected_count: 0, rejection_summary: [], limitations: ["Historical backend sample; not a planting prescription."], elapsed_ms: 40 });
  if (clean === "/rotation-optimizer/profiles") return json({ items: [demoProfile], default_profile_id: demoProfile.id });
  if (clean === "/rotation-optimizer/data-releases") return json({ items: [demoRelease] });
  if (clean.startsWith("/rotation-optimizer/data-releases/")) return json(demoRelease);
  if (clean === "/rotation-optimizer/preflight") return json(demoPreflight);
  if (clean === "/rotation-optimizer/runs" && method === "POST") { const next = demoRun(body); try { localStorage.setItem(RUN_KEY, JSON.stringify(next)); } catch {} return json(next); }
  if (clean === "/rotation-optimizer/runs" && method === "GET") return json({ items: [run()] });
  if (clean.startsWith("/rotation-optimizer/runs/")) return json(run());
  if (clean === "/rotation-optimizer/plans" && method === "GET") return json({ items: [] });
  if (clean === "/rotation-optimizer/plans" && method === "POST") return json({ id: "demo-plan-1", run_id: body.run_id, option_id: body.option_id, title: body.title, notes: body.notes, created_at: now() });
  if (clean === "/agri-data/layers") return json({ items: [{ id: "iowa-ndvi-hls", title: "HLS vegetation index", pass: "HLSL30/HLSS30", start: "2022-01-01", end: "2024-12-31", unit: "NDVI", source: { release_id: demoRelease.id, product: "HLS" } }] });
  if (clean.startsWith("/agri-data/layers/") && clean.endsWith("/manifest")) return json({ id: "iowa-ndvi-hls", title: "HLS vegetation index", pass: "HLSL30/HLSS30", start: "2022-01-01", end: "2024-12-31", unit: "NDVI", source: { release_id: demoRelease.id, product: "HLS" }, type: "raster", tile_size: 256, minzoom: 0, maxzoom: 12, tiles: [], bounds: demoRelease.bounds, legend: { min: 0, max: 1, colors: ["#d73027", "#1a9850"], missing: "transparent" }, resampling: "nearest", spatial_support: "regional", limitations: ["HLS observations are regional context and do not resolve individual 8.7-ha fields." ] });
  if (clean.startsWith("/agri-data/selections/") && clean.endsWith("/facts")) return json({ selection: { id: "iowa-selection", revision: 1, kind: "viewport", geometry: { type: "Point", coordinates: [-93.5, 42] }, center: [-93.5, 42], area_ha: 35, created_at: now() }, facts: [{ id: "iowa-rain-2024", metric: "Precipitation", value: 1049.312467, unit: "mm", status: "available", data_kind: "observed_historical", source: { release_id: demoRelease.id, product: "GPM_3IMERGDF.07 AOI mean" }, period: { start: "2024-01-01", end: "2024-12-31" }, limitations: ["GPM 0.1-degree pixels do not resolve individual fields."] }, { id: "iowa-et0-2024", metric: "Reference evapotranspiration", value: 1165.753116, unit: "mm", status: "available", data_kind: "observed_historical", source: { release_id: demoRelease.id, product: "NASA POWER + SRTM FAO-56" }, period: { start: "2024-01-01", end: "2024-12-31" }, limitations: ["Reference ET0 is a regional calculation, not irrigation demand."] }], unavailable: [], online_fetch_performed: false });
  if (clean === "/farm-assistant/conversations" && method === "GET") return json({ items: conversationStore() });
  if (clean === "/farm-assistant/conversations" && method === "POST") { const item = { id: `demo-chat-${Date.now()}`, preset: String(body.preset ?? "rotation"), bot_id: String(body.bot_id ?? "rotation-guide"), language: String(body.language ?? "zh"), detail: "brief", kb_release_id: "demo-kb", created_at: now(), updated_at: now(), messages: [] }; const all = [item, ...conversationStore()]; saveConversations(all); return json(item); }
  const conversationMatch = clean.match(/^\/farm-assistant\/conversations\/([^/]+)(?:\/messages)?(?:\/([^/]+))?$/);
  if (conversationMatch && clean.endsWith("/messages") && method === "POST") { const id = decodeURIComponent(conversationMatch[1]); const conversation = conversationStore().find((item) => item.id === id); const history = (conversation?.messages ?? []).flatMap((item) => { const row = item as { text?: unknown; response?: { paragraphs?: Array<{ text?: unknown }> } }; const answer = row.response?.paragraphs?.map((paragraph) => paragraph.text).filter((value): value is string => typeof value === "string").join("\n"); return [typeof row.text === "string" ? { role: "user", content: row.text } : null, answer ? { role: "assistant", content: answer } : null].filter(Boolean); }); const retrieved = demoRetrievalAnswer(String(body.text ?? ""), conversation?.bot_id ?? "general-guide", conversation?.language ?? "zh"); const groq = retrieved ? null : await groqAnswer({ text: body.text ?? "", bot_id: conversation?.bot_id ?? "general-guide", language: conversation?.language ?? "zh" }, history); if (groq?.error) return json({ error: { code: "groq_failed", message: groq.error, request_id: "demo-groq", details: null } }, groq.status); const message = { id: `demo-message-${Date.now()}`, sequence: (conversation?.messages?.length ?? 0) + 1, client_message_id: body.client_message_id ?? "demo", status: "complete", text: body.text ?? "", context: body.context ?? { page: "map", revision: 1 }, context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null, plan_id: null }, response: retrieved ?? groq?.response ?? assistantAnswer(String(body.text ?? "")), facts: [], error_code: null, created_at: now(), completed_at: now() }; const all = conversationStore().map((item) => item.id === id ? { ...item, updated_at: now(), messages: [...(item.messages ?? []), message] } : item); saveConversations(all); return json(message); }
  if (conversationMatch && method === "GET") { const item = conversationStore().find((value) => value.id === decodeURIComponent(conversationMatch[1])) ?? { id: conversationMatch[1], preset: "rotation", bot_id: "rotation-guide", language: "zh", detail: "brief", kb_release_id: "demo-kb", created_at: now(), updated_at: now(), messages: [] }; return json({ ...item, next_before_sequence: null }); }
  if (clean === "/farm-assistant/presets") return json({ items: [{ id: "rotation", enabled: true, name: "Crop rotation", name_en: "Crop rotation", description: "Demo assistant", color: "#8671d9" }] });
  if (clean.includes("/preferences")) return json(body);
  if (clean === "/rotation-optimizer/local-knowledge" && method === "GET") return json(localKnowledge());
  if (clean === "/rotation-optimizer/local-knowledge/draft" && method === "PUT") {
    const catalogue = localKnowledge();
    const draft = { ...catalogue.draft, profile: body.profile ?? catalogue.draft.profile, updated_at: now(), sha256: "demo-draft" };
    const next = { ...catalogue, draft };
    saveLocalKnowledge(next);
    return json(draft);
  }
  if (clean === "/rotation-optimizer/local-knowledge/publish" && method === "POST") {
    const catalogue = localKnowledge();
    const publishedAt = now();
    const active = { ...catalogue.draft, id: "demo-kb", revision: (catalogue.active.revision ?? 0) + 1, status: "published", is_active: true, sha256: "demo", updated_at: publishedAt, published_at: publishedAt };
    const draft = { ...active, id: "demo-kb-draft", revision: null, status: "draft", is_active: false, published_at: null };
    const next = { active, draft, versions: [active, ...(catalogue.versions ?? [])] };
    saveLocalKnowledge(next);
    return json(next);
  }
  return json({ items: [] });
}
