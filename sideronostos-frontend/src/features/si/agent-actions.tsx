"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listProfiles } from "@/lib/api/field-shift";
import { listLayers } from "@/lib/api/rotation";
import type { Profile } from "@/lib/api/field-shift-types";
import type { ScienceLayer } from "@/lib/api/rotation-types";
import * as api from "./agent-api";
import type { AgentActionName, AgentActionOutcome, AgentDomain } from "./agent-api";

type Props = {
  conversationId: string | null;
  ensureConversation: () => Promise<string | null>;
  domain: AgentDomain;
  botId?: string;
  language: "en" | "zh";
  userId: string;
};

const copy = {
  en: { create: "Create field", layer: "Open published layer", fact: "Find published observation", continue: "Continue action", open: "Open result", name: "Field name", area: "Area (ha)", lat: "Latitude", lon: "Longitude", soil: "Soil texture", irrigation: "Irrigation available", profile: "Profile", published: "Published layer", selection: "Map selection ID", metric: "Observation", start: "Start date", end: "End date", noLayers: "No published layers are available.", error: "The action could not be loaded. Try again.", choose: "Choose an action", pending: "Working on the action…", unknown: "Unknown", sand: "Sand", loam: "Loam", clay: "Clay", moisture: "Surface soil moisture", rainfall: "Rainfall total", et0: "Reference ET₀ total" },
  zh: { create: "创建地块", layer: "打开已发布图层", fact: "查询已发布观测", continue: "继续操作", open: "打开结果", name: "地块名称", area: "面积（公顷）", lat: "纬度", lon: "经度", soil: "土壤质地", irrigation: "有灌溉条件", profile: "资料配置", published: "已发布图层", selection: "地图选区 ID", metric: "观测指标", start: "开始日期", end: "结束日期", noLayers: "暂无已发布图层。", error: "操作未能加载，请重试。", choose: "选择操作", pending: "正在处理操作…", unknown: "未知", sand: "砂土", loam: "壤土", clay: "黏土", moisture: "表层土壤湿度", rainfall: "总降雨量", et0: "参考蒸散量总计" },
};

const actions: Record<"field_management" | "remote_sensing", AgentActionName[]> = {
  field_management: ["field.create"],
  remote_sensing: ["remote_sensing.layer", "remote_sensing.fact"],
};

function resultHref(outcome: AgentActionOutcome): string | null {
  const href = outcome.status === "succeeded" ? outcome.href : null;
  if (!href || !href.startsWith("/field-shift") || href.startsWith("//")) return null;
  try {
    const parsed = new URL(href, "https://local.invalid");
    if (parsed.origin !== "https://local.invalid") return null;
    if (outcome.action === "field.create" && parsed.pathname === "/field-shift" && parsed.searchParams.has("field")) return href;
    if (outcome.action !== "field.create" && parsed.pathname === "/field-shift/map" && (parsed.searchParams.has("layer") || parsed.searchParams.has("selection"))) return href;
  } catch { /* Invalid URLs never become links. */ }
  return null;
}

export function AgentActions({ conversationId, ensureConversation, domain, botId, language, userId }: Props) {
  const c = copy[language];
  const [action, setAction] = useState<AgentActionName | null>(null);
  const [outcome, setOutcome] = useState<AgentActionOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [layers, setLayers] = useState<ScienceLayer[]>([]);
  const activeKey = useRef<string | null>(null);
  const activeChat = useRef<string | null>(conversationId);
  const storageKey = (chat: string) => `agrisata-action:${userId}:${chat}`;

  useEffect(() => {
    if (!conversationId) return;
    activeChat.current = conversationId;
    let live = true;
    const stored = localStorage.getItem(storageKey(conversationId));
    const latest = () => api.listActions(conversationId).then((rows) => {
      const row = rows.items[0];
      return row ? { key: row.idempotency_key, saved: row.outcome } : null;
    });
    const load = stored ? api.getAction(conversationId, stored).then((saved) => ({ key: stored, saved })).catch(latest) : latest();
    load.then((entry) => {
      if (!entry || !live || (activeKey.current && activeKey.current !== entry.key)) return;
      const { key, saved } = entry;
      activeKey.current = key;
      localStorage.setItem(storageKey(conversationId), key);
      setAction(saved.action);
      setOutcome(saved);
      if (saved.pending?.arguments) setValues(Object.fromEntries(Object.entries(saved.pending.arguments).filter(([, value]) => typeof value === "string" || typeof value === "number").map(([key, value]) => [key, String(value)])));
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  // The component is keyed by conversation in its parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (action === "field.create") listProfiles().then((value) => setProfiles(value.items)).catch(() => setError(true));
    if (action === "remote_sensing.layer") listLayers().then((value) => setLayers(value.items)).catch(() => setError(true));
  }, [action]);

  async function start(next: AgentActionName) {
    if (busy) return;
    setBusy(true);
    setError(false);
    setAction(next);
    setValues({});
    setOutcome(null);
    const key = crypto.randomUUID();
    activeKey.current = key;
    try {
      const chat = activeChat.current ?? await ensureConversation();
      if (!chat) throw new Error("Conversation unavailable");
      activeChat.current = chat;
      localStorage.setItem(storageKey(chat), key);
      const result = await api.postAction(chat, { action: next, arguments: {}, idempotency_key: key });
      setOutcome(result);
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  async function advance() {
    if (!action || !activeChat.current || !activeKey.current || busy) return;
    const args: Record<string, unknown> = {};
    if (action === "field.create") {
      args.name = values.name?.trim();
      args.area_ha = Number(values.area_ha);
      args.latitude = Number(values.latitude);
      args.longitude = Number(values.longitude);
      args.soil_texture = values.soil_texture || "unknown";
      args.irrigation_available = values.irrigation_available === "true";
      args.profile_id = values.profile_id;
      args.history = [];
    } else if (action === "remote_sensing.layer") args.layer_id = values.layer_id;
    else {
      args.selection_id = values.selection_id?.trim();
      args.metric = values.metric && metrics.includes(values.metric) ? values.metric : metrics[0];
      if (values.start && values.end) { args.start = values.start; args.end = values.end; }
    }
    setBusy(true);
    setError(false);
    try {
      const result = await api.postAction(activeChat.current, { action, arguments: args, idempotency_key: activeKey.current });
      setOutcome(result);
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  function update(key: string, value: string) { setValues((previous) => ({ ...previous, [key]: value })); }
  const common = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary";
  const field = (key: string, label: string, type = "text", required = true) => <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span><input className={common} aria-label={label} type={type} step={type === "number" ? "any" : undefined} required={required} value={values[key] ?? ""} onChange={(event) => update(key, event.target.value)} /></label>;
  const available = domain === "field_management" ? actions.field_management : domain === "remote_sensing" ? botId === "remote-weather" ? ["remote_sensing.fact" as AgentActionName] : actions.remote_sensing : [];
  const metrics = botId === "remote-soil" ? ["surface_soil_moisture"] : botId === "remote-weather" ? ["rainfall_total", "reference_et0_total"] : ["surface_soil_moisture", "rainfall_total", "reference_et0_total"];
  if (available.length === 0) return null;
  const href = outcome ? resultHref(outcome) : null;
  return <section aria-label={c.choose} className="mx-auto mb-3 max-h-[min(45dvh,26rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-3 text-sm sm:p-4">
    <div className="flex flex-wrap gap-2">{available.map((item) => <button key={item} type="button" disabled={busy} aria-pressed={action === item} onClick={() => void start(item)} className={(action === item ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted") + " rounded-full border px-3 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"}>{item === "field.create" ? c.create : item === "remote_sensing.layer" ? c.layer : c.fact}</button>)}</div>
    {busy && <p role="status" className="mt-3 text-muted-foreground">{c.pending}</p>}
    {error && <p role="alert" className="mt-3 text-destructive">{c.error}</p>}
    {outcome && <div className="mt-3"><p role="status" className="leading-6">{outcome.text}</p>{href && <Link href={href} className="mt-2 inline-block font-medium text-primary underline">{c.open}</Link>}</div>}
    {action && outcome && (outcome.status === "needs_input" || (outcome.status === "failed" && outcome.pending)) && <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void advance(); }}>
      {action === "field.create" && <>{field("name", c.name)}{field("area_ha", c.area, "number")}{field("latitude", c.lat, "number")}{field("longitude", c.lon, "number")}<label className="block text-sm"><span className="mb-1 block font-medium">{c.soil}</span><select className={common} value={values.soil_texture || "unknown"} onChange={(event) => update("soil_texture", event.target.value)}><option value="unknown">{c.unknown}</option><option value="sand">{c.sand}</option><option value="loam">{c.loam}</option><option value="clay">{c.clay}</option></select></label><label className="block text-sm"><span className="mb-1 block font-medium">{c.profile}</span><select className={common} aria-label={c.profile} required value={values.profile_id ?? ""} onChange={(event) => update("profile_id", event.target.value)}><option value="">—</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.irrigation_available === "true"} onChange={(event) => update("irrigation_available", String(event.target.checked))} />{c.irrigation}</label></>}
      {action === "remote_sensing.layer" && <label className="block text-sm"><span className="mb-1 block font-medium">{c.published}</span><select className={common} aria-label={c.published} required value={values.layer_id ?? ""} onChange={(event) => update("layer_id", event.target.value)}><option value="">—</option>{layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.title}</option>)}</select>{layers.length === 0 && <span className="mt-1 block text-muted-foreground">{c.noLayers}</span>}</label>}
      {action === "remote_sensing.fact" && <>{field("selection_id", c.selection)}<label className="block text-sm"><span className="mb-1 block font-medium">{c.metric}</span><select className={common} value={values.metric && metrics.includes(values.metric) ? values.metric : metrics[0]} onChange={(event) => update("metric", event.target.value)}>{metrics.map((metric) => <option key={metric} value={metric}>{metric === "surface_soil_moisture" ? c.moisture : metric === "rainfall_total" ? c.rainfall : c.et0}</option>)}</select></label>{field("start", c.start, "date", false)}{field("end", c.end, "date", false)}</>}
      <div className="sm:col-span-2"><button type="submit" disabled={busy || (action === "remote_sensing.layer" && layers.length === 0)} className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{c.continue}</button></div>
    </form>}
  </section>;
}
