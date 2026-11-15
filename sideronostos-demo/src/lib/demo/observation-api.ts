import { iowaAnnual, iowaMonthly } from "./iowa-backend-data";
import { demoFields, demoFieldsApi, demoRelease } from "./data";
import { createDemoObservations } from "@/features/fields/demo-data";

const SELECTIONS_KEY = "agrisata-demo-observation-selections";
const ACTIONS_KEY = "agrisata-demo-observation-actions";
type Selection = { id: string; kind: string; geometry: { type: string; coordinates: unknown }; center: [number, number]; revision: number; created_at: string };
type Outcome = { status: "succeeded" | "unavailable"; action: string; text: string; missing_fields: string[]; pending: null; result: Record<string, unknown> | null; href: null };

function stored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The current request still completes. */ }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const say = (language: string, en: string, zh: string) => language === "zh" ? zh : en;
const unavailable = (action: string, text: string): Outcome => ({ status: "unavailable", action, text, missing_fields: [], pending: null, result: null, href: null });

function observation(action: string, args: Record<string, unknown>, language: string): Outcome {
  const selection = stored<Record<string, Selection>>(SELECTIONS_KEY, {})[String(args.selection_id ?? "")];
  if (!selection) return unavailable(action, say(language, "Choose a saved field and try again.", "请选择已保存的地块后重试。"));
  if (selection.kind !== "point") return unavailable(action, say(language, "Published area statistics are not available. Choose a field location.", "暂无已发布的区域统计，请选择地块位置。"));
  const [longitude, latitude] = selection.center;
  const [west, south, east, north] = demoRelease.bounds;
  if (longitude < west || longitude > east || latitude < south || latitude > north) {
    return unavailable(action, say(language, "The Iowa observations do not cover this field location.", "Iowa 观测资料未覆盖该地块位置。"));
  }
  const metric = String(args.metric ?? "");
  if (metric === "surface_soil_moisture") {
    const fieldIndex = demoFieldsApi().findIndex((field) =>
      Math.abs(field.longitude - longitude) < 0.000001 && Math.abs(field.latitude - latitude) < 0.000001);
    const sample = fieldIndex < 0 ? undefined : createDemoObservations(demoFields[fieldIndex], "2024-07-16")
      .find((item) => item.metric === "Surface soil moisture");
    if (!sample) return unavailable(action, say(language, "No precomputed SMAP observation is available for this field location.", "该地块位置没有预计算的 SMAP 演示观测。"));
    if ((args.start || args.end) && (typeof args.start !== "string" || typeof args.end !== "string" ||
      args.start > sample.observedAt || args.end < sample.observedAt || args.start > args.end)) {
      return unavailable(action, say(language, "The precomputed SMAP sample is available only on 2024-07-16.", "预计算的 SMAP 演示样本仅有 2024-07-16 的记录。"));
    }
    return {
      status: "succeeded", action,
      text: say(language, "Precomputed demo observation found.", "已找到预计算的演示观测。"),
      missing_fields: [], pending: null, href: null,
      result: {
        id: sample.id, metric, value: sample.value, unit: sample.unit,
        period: { start: sample.observedAt, end: sample.observedAt, time_standard: "UTC" },
        data_kind: "demo_precomputed", spatial_support: sample.spatialSupport,
        source: { release_id: demoRelease.id, product: sample.sourceProduct },
        limitations: language === "zh"
          ? ["这是预计算的演示样本，并非实时检索或田间传感器读数。", "区域 SMAP 背景值不能表示单个地块的内部差异。"]
          : ["This is a precomputed demo sample, not a live retrieval or field sensor reading.", "Regional SMAP context does not resolve variation within an individual field."],
      },
    };
  }
  if (metric !== "rainfall_total" && metric !== "reference_et0_total") return unavailable(action, say(language, "This observation is not available.", "该观测项目暂无数据。"));

  const start = typeof args.start === "string" ? args.start : "2024-01-01";
  const end = typeof args.end === "string" ? args.end : "2024-12-31";
  const first = /^\d{4}-(0[1-9]|1[0-2])-01$/.exec(start);
  const last = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/.exec(end);
  const lastDay = last ? new Date(Date.UTC(Number(last[1]), Number(last[2]), 0)).getUTCDate() : 0;
  if (!first || !last || Number(last[3]) !== lastDay || start > end || start < "2022-01-01" || end > "2024-12-31") {
    return unavailable(action, say(language, "Demo observations are available for complete calendar months from 2022 through 2024.", "演示观测仅支持 2022 至 2024 年的完整自然月。"));
  }
  const months = iowaMonthly.filter((row) => `${row.month}-01` >= start && `${row.month}-${new Date(Date.UTC(Number(row.month.slice(0, 4)), Number(row.month.slice(5)), 0)).getUTCDate()}` <= end);
  const expectedMonths = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
  if (months.length !== expectedMonths) return unavailable(action, say(language, "Published observations are incomplete for this period.", "所选时段的已发布观测不完整。"));
  const field = metric === "rainfall_total" ? "rain_mm" : "et0_mm";
  const annual = start.endsWith("-01-01") && end.endsWith("-12-31") ? iowaAnnual.find((row) => row.year === Number(start.slice(0, 4)) && Number(end.slice(0, 4)) === row.year) : undefined;
  const value = annual ? annual[field] : Number(months.reduce((total, row) => total + row[field], 0).toFixed(6));
  const result = {
    id: `${demoRelease.id}:${metric}:${start}:${end}`, metric, value, unit: "mm",
    period: { start, end, time_standard: "UTC" }, data_kind: "derived_historical",
    spatial_support: "regional_background",
    source: { release_id: demoRelease.id, product: metric === "rainfall_total" ? "GPM_3IMERGDF" : "NASA_POWER_DAILY_WITH_GPM" },
    limitations: language === "zh"
      ? ["Iowa 区域历史观测，不是田间传感器读数或预报。", "数值是已发布 Iowa 演示数据的月度或年度合计。"]
      : ["Historical Iowa regional observations, not a field sensor reading or forecast.", "Monthly or annual totals from the published Iowa demo release."],
  };
  return { status: "succeeded", action, text: say(language, "Published observation found.", "已找到发布的观测值。"), missing_fields: [], pending: null, result, href: null };
}

export function demoObservationResponse(clean: string, method: string, body: Record<string, unknown>, language = "en"): Response | null {
  if (clean === "/agri-data/selections" && method === "POST") {
    const geometry = body.geometry as Selection["geometry"] | undefined;
    const coordinates = geometry?.type === "Point" ? geometry.coordinates : null;
    const center: [number, number] = Array.isArray(coordinates) && coordinates.length >= 2 ? [Number(coordinates[0]), Number(coordinates[1])] : [NaN, NaN];
    if (body.kind !== "point" || geometry?.type !== "Point" || !center.every(Number.isFinite)) return json({ error: { code: "invalid_selection", message: "Choose a field location." } }, 422);
    const selection: Selection = { id: `demo-selection-${Date.now()}-${Math.random().toString(36).slice(2)}`, kind: "point", geometry, center, revision: Number(body.revision) || 1, created_at: new Date().toISOString() };
    save(SELECTIONS_KEY, { ...stored<Record<string, Selection>>(SELECTIONS_KEY, {}), [selection.id]: selection });
    return json(selection, 201);
  }
  const selectionId = clean.match(/^\/agri-data\/selections\/([^/]+)$/)?.[1];
  if (selectionId && method === "GET") return json(stored<Record<string, Selection>>(SELECTIONS_KEY, {})[decodeURIComponent(selectionId)] ?? { error: { code: "not_found", message: "Selection not found" } });
  const actions = clean.match(/^\/farm-assistant\/conversations\/([^/]+)\/actions(?:\/([^/]+))?$/);
  if (!actions) return null;
  const conversation = decodeURIComponent(actions[1]);
  const saved = stored<Record<string, Outcome>>(ACTIONS_KEY, {});
  const key = actions[2] ? `${conversation}:${decodeURIComponent(actions[2])}` : "";
  if (method === "GET" && actions[2]) return json(saved[key] ?? { error: { code: "not_found", message: "Action not found" } }, saved[key] ? 200 : 404);
  if (method === "GET") return json({ items: Object.entries(saved).filter(([id]) => id.startsWith(`${conversation}:`)).map(([id, outcome]) => ({ idempotency_key: id.slice(conversation.length + 1), outcome })) });
  if (method !== "POST") return null;
  const idempotencyKey = String(body.idempotency_key ?? "");
  const actionKey = `${conversation}:${idempotencyKey}`;
  if (idempotencyKey && saved[actionKey]) return json(saved[actionKey]);
  const action = String(body.action ?? "");
  const args = body.arguments && typeof body.arguments === "object" ? body.arguments as Record<string, unknown> : {};
  let outcome: Outcome;
  if (action === "remote_sensing.fact") {
    outcome = observation(action, args, language);
  } else if (action === "remote_sensing.layer" && args.layer_id === "iowa-ndvi-hls") {
    outcome = {
      status: "succeeded", action,
      text: say(language, "Published layer metadata found.", "已找到发布的图层资料。"),
      missing_fields: [], pending: null, href: null,
      result: {
        id: "iowa-ndvi-hls", title: "HLS vegetation index", start: "2022-01-01",
        end: "2024-12-31", unit: "NDVI", bounds: demoRelease.bounds,
        source: { release_id: demoRelease.id, product: "HLS" },
        limitations: ["Regional observation context; not a field scale measurement."],
      },
    };
  } else {
    outcome = unavailable(action, say(language, "This action is not available in the demo.", "演示版暂不支持此操作。"));
  }
  if (idempotencyKey) save(ACTIONS_KEY, { ...saved, [actionKey]: outcome });
  return json(outcome);
}
