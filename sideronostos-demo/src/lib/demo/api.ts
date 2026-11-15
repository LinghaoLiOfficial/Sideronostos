import { demoUser } from "@/lib/demo-mode";
import { demoFieldsApi, demoPreflight, demoProfile, demoRelease, demoRun, demoWorkspace, DEMO_PROFILE_ID, stamp } from "./data";

const WORKSPACE_KEY = "agrisata-demo-workspace";
const RUN_KEY = "agrisata-demo-run";
const CHAT_KEY = "agrisata-demo-conversations";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const bodyOf = (options: { body?: unknown }) => { try { return typeof options.body === "string" ? JSON.parse(options.body) : {}; } catch { return {}; } };
const now = () => new Date().toISOString();
function workspace() {
  if (typeof localStorage === "undefined") return demoWorkspace();
  try { return JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? "null") ?? demoWorkspace(); } catch { return demoWorkspace(); }
}
function saveWorkspace(value: unknown) { try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(value)); } catch { /* demo remains in memory */ } }
function run() {
  if (typeof localStorage === "undefined") return demoRun({});
  try { return JSON.parse(localStorage.getItem(RUN_KEY) ?? "null") ?? demoRun({}); } catch { return demoRun({}); }
}
function assistantAnswer(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("水") || lower.includes("moisture")) return { paragraphs: [{ text: "Iowa 示例区的土壤水分处于可管理范围。Field 3 的灌溉余量最低，建议在播种前复核田间持水量。", evidence_ids: ["demo-soil-moisture"] }], actions: ["view_sources"], needs_clarification: false, facts: [{ id: "demo-soil-moisture", key: "soil_moisture", label: "表层土壤水分", value: 0.27, unit: "m³/m³", display: "0.27 m³/m³", source: { release_id: "demo" }, limitations: ["合成演示指标"] }] };
  return { paragraphs: [{ text: "基于 Iowa benchmark，建议在玉米和大豆之间轮换，并保留燕麦作为覆盖作物候选。当前演示方案优先平衡水量、覆盖天数和作物科属多样性。", evidence_ids: ["demo-rotation-rule"] }], actions: ["open_planner"], needs_clarification: false, facts: [], citations: [], warnings: ["这是预计算的演示回复，不是实时农艺处方。"] };
}
type DemoConversation = { id: string; preset: string; bot_id: string; language: string; detail: string; kb_release_id: string; created_at: string; updated_at: string; messages: unknown[] };
function conversationStore(): DemoConversation[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]") as DemoConversation[]; } catch { return []; }
}
function saveConversations(value: DemoConversation[]) { try { localStorage.setItem(CHAT_KEY, JSON.stringify(value)); } catch { /* no-op */ } }

export async function demoApiResponse(path: string, options: { method?: string; body?: unknown } = {}) {
  const method = options.method ?? "GET";
  const body = bodyOf(options);
  const clean = path.split("?")[0];
  if (clean === "/users/me") return json(demoUser);
  if (clean === "/field-shift/workspace" && method === "GET") return json(workspace());
  if (clean === "/field-shift/workspace/sample" && method === "POST") return json(workspace());
  if (clean === "/field-shift/workspace" && method === "PUT") { const next = { ...body, version: (workspace().version ?? 1) + 1, updated_at: now() }; saveWorkspace(next); return json(next); }
  if (clean === "/field-shift/farms" && method === "GET") return json({ items: workspace().farms });
  if (clean.startsWith("/field-shift/farms/") && method === "GET") return json({ ...workspace().farms[0], fields: workspace().fields });
  if (clean === "/field-shift/fields" && method === "GET") return json({ items: demoFieldsApi() });
  if (clean.startsWith("/field-shift/fields/") && method === "GET") return json(demoFieldsApi().find((field) => field.id === decodeURIComponent(clean.split("/").pop() ?? "")) ?? demoFieldsApi()[0]);
  if (clean === "/field-shift/profiles") return json({ items: [{ id: "temperate-demo", name: "Temperate demonstration profile", version: "demo-v1", is_demo: true, description: "Synthetic demo profile", assumptions: ["Synthetic weather"], crops: [], rules: [], sources: [] }] });
  if (clean.includes("/environment")) return json({ status: "demo", source_name: "NASA benchmark fixture", source_url: null, reference_year: 2024, fetched_at: null, spatial_resolution: "regional", months: [], limitations: ["Synthetic demonstration environment"], evidence: [], fingerprint: "demo" });
  if (clean.includes("/analyses")) return json({ id: "demo-analysis", field_id: demoFieldsApi()[0].id, field_version: 1, created_at: now(), profile: { id: DEMO_PROFILE_ID, name: demoProfile.name, version: "demo-v1", is_demo: true }, profile_snapshot: demoProfile, inputs: body, environment: { status: "demo", source_name: "NASA benchmark fixture", source_url: null, reference_year: 2024, fetched_at: null, spatial_resolution: "regional", months: [], limitations: ["Synthetic demonstration environment"], evidence: [], fingerprint: "demo" }, baseline: demoRun(body).result?.baseline, alternatives: demoRun(body).result?.options?.slice(1) ?? [], feasible_count: 2, rejected_count: 0, rejection_summary: [], limitations: ["Precomputed demonstration result"], elapsed_ms: 40 });
  if (clean === "/rotation-optimizer/profiles") return json({ items: [demoProfile], default_profile_id: demoProfile.id });
  if (clean === "/rotation-optimizer/data-releases") return json({ items: [demoRelease] });
  if (clean.startsWith("/rotation-optimizer/data-releases/")) return json(demoRelease);
  if (clean === "/rotation-optimizer/preflight") return json(demoPreflight);
  if (clean === "/rotation-optimizer/runs" && method === "POST") { const next = demoRun(body); try { localStorage.setItem(RUN_KEY, JSON.stringify(next)); } catch {} return json(next); }
  if (clean === "/rotation-optimizer/runs" && method === "GET") return json({ items: [run()] });
  if (clean.startsWith("/rotation-optimizer/runs/")) return json(run());
  if (clean === "/rotation-optimizer/plans" && method === "GET") return json({ items: [] });
  if (clean === "/rotation-optimizer/plans" && method === "POST") return json({ id: "demo-plan-1", run_id: body.run_id, option_id: body.option_id, title: body.title, notes: body.notes, created_at: now() });
  if (clean === "/agri-data/layers") return json({ items: [{ id: "demo-ndvi", title: "Vegetation index (demo)", pass: "demo", start: "2022-01-01", end: "2024-12-31", unit: "NDVI", source: { release_id: demoRelease.id } }] });
  if (clean.startsWith("/agri-data/layers/") && clean.endsWith("/manifest")) return json({ id: "demo-ndvi", title: "Vegetation index (demo)", pass: "demo", start: "2022-01-01", end: "2024-12-31", unit: "NDVI", source: { release_id: demoRelease.id }, type: "raster", tile_size: 256, minzoom: 0, maxzoom: 12, tiles: [], bounds: demoRelease.bounds, legend: { min: 0, max: 1, colors: ["#d73027", "#1a9850"], missing: "transparent" }, resampling: "nearest", spatial_support: "field", limitations: ["Synthetic demonstration layer"] });
  if (clean.startsWith("/agri-data/selections/") && clean.endsWith("/facts")) return json({ selection: { id: "demo-selection", revision: 1, kind: "viewport", geometry: { type: "Point", coordinates: [-93.5, 42] }, center: [-93.5, 42], area_ha: 35, created_at: now() }, facts: [{ id: "demo-rain", metric: "Precipitation", value: 612, unit: "mm", status: "available", data_kind: "synthetic", source: { release_id: demoRelease.id }, period: { start: "2024-01-01", end: "2024-12-31" }, limitations: ["Synthetic demonstration value"] }], unavailable: [], online_fetch_performed: false });
  if (clean === "/farm-assistant/conversations" && method === "GET") return json({ items: conversationStore() });
  if (clean === "/farm-assistant/conversations" && method === "POST") { const item = { id: `demo-chat-${Date.now()}`, preset: body.preset ?? "rotation", bot_id: body.bot_id ?? "rotation-guide", language: body.language ?? "zh", detail: "brief", kb_release_id: "demo-kb", created_at: now(), updated_at: now(), messages: [] }; const all = [item, ...conversationStore()]; saveConversations(all); return json(item); }
  const conversationMatch = clean.match(/^\/farm-assistant\/conversations\/([^/]+)(?:\/messages)?(?:\/([^/]+))?$/);
  if (conversationMatch && clean.endsWith("/messages") && method === "POST") { const id = decodeURIComponent(conversationMatch[1]); const message = { id: `demo-message-${Date.now()}`, sequence: 1, client_message_id: body.client_message_id ?? "demo", status: "complete", text: body.text ?? "", context: body.context ?? { page: "map", revision: 1 }, context_labels: { fields: [], selection_kind: null, run_id: null, option_id: null, plan_id: null }, response: assistantAnswer(body.text ?? ""), facts: [], error_code: null, created_at: now(), completed_at: now() }; const all = conversationStore().map((item) => item.id === id ? { ...item, updated_at: now(), messages: [...(item.messages ?? []), message] } : item); saveConversations(all); return json(message); }
  if (conversationMatch && method === "GET") { const item = conversationStore().find((value) => value.id === decodeURIComponent(conversationMatch[1])) ?? { id: conversationMatch[1], preset: "rotation", bot_id: "rotation-guide", language: "zh", detail: "brief", kb_release_id: "demo-kb", created_at: now(), updated_at: now(), messages: [] }; return json({ ...item, next_before_sequence: null }); }
  if (clean === "/farm-assistant/presets") return json({ items: [{ id: "rotation", enabled: true, name: "Crop rotation", name_en: "Crop rotation", description: "Demo assistant", color: "#8671d9" }] });
  if (clean.includes("/preferences")) return json(body);
  if (clean === "/rotation-optimizer/local-knowledge") return json({ active: { id: "demo-kb", revision: 1, status: "published", is_active: true, sha256: "demo", profile: demoProfile, created_at: stamp, updated_at: stamp, published_at: stamp }, draft: { id: "demo-kb-draft", revision: null, status: "draft", is_active: false, sha256: "demo", profile: demoProfile, created_at: stamp, updated_at: stamp, published_at: null }, versions: [] });
  return json({ items: [] });
}
