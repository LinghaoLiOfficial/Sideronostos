"use client";

import { useState } from "react";
import { listFields } from "@/lib/api/field-shift";
import { createSelection, listLayers } from "@/lib/api/rotation";
import type { Geometry } from "@/lib/api/rotation-types";
import { Input, LoadingState, NoFields, primary, secondary, Select, TaskFeedback, tr, useDraft, useLoad, useTaskExecution, type TaskProps } from "./shared";

const metrics = {
  surface_soil_moisture: ["Surface soil moisture", "表层土壤湿度"],
  rainfall_total: ["Rainfall", "降雨量"],
  reference_et0_total: ["Reference water loss (ET₀)", "参考蒸散量（ET₀）"],
} as const;
function metricLabel(language: "en" | "zh", metric: string) {
  const pair = metrics[metric as keyof typeof metrics];
  return language === "en" ? pair[0] : pair[1];
}

export function Observations(props: TaskProps) {
  const { botId, language, scope } = props;
  const fields = useLoad(listFields);
  const allowed = botId === "remote-soil" ? ["surface_soil_moisture"] : botId === "remote-weather" ? ["rainfall_total", "reference_et0_total"] : Object.keys(metrics);
  const [draft, setDraft] = useDraft(`${scope}:observation`, { field: "", metric: allowed[0], start: "", end: "" });
  const [selection, setSelection] = useDraft<{ basis: string; id: string } | null>(`${scope}:selection`, null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const execution = useTaskExecution(props, "observation");
  const selected = fields.data?.items.find((item) => item.id === draft.field);
  const confirmed = execution.outcome?.status === "succeeded";
  const metric = allowed.includes(draft.metric) ? draft.metric : allowed[0];
  const update = (key: keyof typeof draft, value: string) => { setError(""); setDraft((old) => ({ ...old, [key]: value })); };
  async function check() {
    if (!selected || preparing) return;
    if (Boolean(draft.start) !== Boolean(draft.end) || (draft.start && draft.start > draft.end)) {
      setError(tr(language, "Choose both dates, with the end on or after the start.", "请填写起止日期，结束日期不能早于开始日期。")); return;
    }
    setPreparing(true); setError("");
    try {
      const geometry: Geometry = selected.geometry ?? { type: "Point", coordinates: [selected.longitude, selected.latitude] };
      const basis = JSON.stringify([selected.id, selected.version, geometry]);
      let id = selection?.basis === basis ? selection.id : undefined;
      if (!id) {
        const created = await createSelection(geometry.type === "Point" ? "point" : "polygon", geometry, selected.version);
        id = created.id; setSelection({ basis, id });
      }
      await execution.run({ kind: "action", action: "remote_sensing.fact", arguments: { selection_id: id, metric, ...(draft.start && draft.end ? { start: draft.start, end: draft.end } : {}) } });
    } catch { setError(tr(language, "The field location could not be prepared. Your choices are kept; try again.", "暂时无法加载地块位置，选择已保留，请重试。")); }
    finally { setPreparing(false); }
  }
  const fact = execution.outcome?.result as { value?: number | null; unit?: string; limitations?: string[]; period?: { start: string; end: string } } | null;
  return <div className="space-y-3"><LoadingState state={fields} language={language} />
    {fields.data && !fields.data.items.length && <NoFields language={language} />}
    {!confirmed && Boolean(fields.data?.items.length) && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void check(); }}>
      <fieldset disabled={preparing || execution.busy || execution.uncertain} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Select label={tr(language, "Which field?", "查看哪个地块？")} required value={draft.field} onChange={(e) => update("field", e.target.value)}><option value="">{tr(language, "Choose a saved field", "选择已保存地块")}</option>{fields.data?.items.map((field) => <option key={field.id} value={field.id}>{field.name} · {field.area_ha} ha · {field.latitude.toFixed(3)}, {field.longitude.toFixed(3)}</option>)}</Select>
        <Select label={tr(language, "What would you like to check?", "想查看什么？")} value={metric} onChange={(e) => update("metric", e.target.value)}>{allowed.map((key) => <option key={key} value={key}>{metricLabel(language, key)}</option>)}</Select>
        <Input label={tr(language, "From", "开始日期")} type="date" value={draft.start} onChange={(e) => update("start", e.target.value)} max={draft.end || undefined} />
        <Input label={tr(language, "To", "结束日期")} type="date" value={draft.end} onChange={(e) => update("end", e.target.value)} min={draft.start || undefined} />
        <p className="text-xs text-muted-foreground sm:col-span-2">{tr(language, "Leave both dates blank to use the published observation period. These are historical readings, not a forecast or an irrigation instruction.", "日期均留空时使用已发布观测时段。这是历史观测，不是天气预报或灌溉指令。")}</p>
        {selected && !selected.geometry && <p className="text-xs text-muted-foreground sm:col-span-2">{tr(language, "I’ll check the saved field location. No field boundary has been recorded yet.", "将查询地块已保存的位置，目前尚未记录边界。")}</p>}
        <div className="sm:col-span-2"><button className={primary}>{tr(language, preparing ? "Preparing the field…" : "Check observations", preparing ? "正在准备地块…" : "查询观测")}</button></div>
      </fieldset>
    </form>}
    {error && <p role="alert">{error}</p>}
    <TaskFeedback execution={execution} language={language} success={tr(language, `${metricLabel(language, metric)} for ${selected?.name ?? "your field"}.`, `${selected?.name ?? "地块"}的${metricLabel(language, metric)}。`)} linkLabel={tr(language, "Open observation map", "打开观测地图")}>
      {typeof fact?.value === "number" && <p className="mt-2 text-xl font-semibold">{fact.value} {fact.unit}</p>}
      {fact?.period && <p className="mt-1 text-xs text-muted-foreground">{fact.period.start} – {fact.period.end}</p>}
      {fact?.limitations?.map((limit) => <p key={limit} className="mt-1 text-xs text-muted-foreground">{limit}</p>)}
    </TaskFeedback>
    {confirmed && <button className={secondary} onClick={execution.clear}>{tr(language, "Check another observation", "查询其他观测")}</button>}
  </div>;
}

export function ObservationMaps(props: TaskProps) {
  const { language, botId, scope } = props;
  const layers = useLoad(listLayers);
  const [layer, setLayer] = useDraft(`${scope}:layer`, "");
  const execution = useTaskExecution(props, "layer");
  const available = layers.data?.items.filter((item) => botId !== "remote-soil" || item.source.product === "SPL3SMP_E") ?? [];
  return <div className="space-y-3"><LoadingState state={layers} language={language} />
    {layers.data && !available.length && <p role="status">{tr(language, "No observation maps have been published for this specialist yet. You can still check a saved field for available readings.", "这位助手暂无已发布观测地图，仍可查询已保存地块的可用读数。")}</p>}
    {Boolean(available.length) && execution.outcome?.status !== "succeeded" && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void execution.run({ kind: "action", action: "remote_sensing.layer", arguments: { layer_id: layer } }); }}><fieldset disabled={execution.busy || execution.uncertain} className="space-y-3">
      <Select label={tr(language, "Observation map", "观测地图")} required value={layer} onChange={(e) => setLayer(e.target.value)}><option value="">{tr(language, "Choose a published map", "选择已发布地图")}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.start} – {item.end}</option>)}</Select><button className={primary}>{tr(language, "Check map data", "查看图层资料")}</button>
    </fieldset></form>}
    <TaskFeedback execution={execution} language={language} success={tr(language, "The published observation data is ready here. The map page is still being prepared.", "已发布观测数据可在此查看；地图发布页仍在准备中。")} linkLabel={tr(language, "View observation map", "查看观测地图")} />
    {execution.outcome?.status === "succeeded" && <button className={secondary} onClick={execution.clear}>{tr(language, "Choose another map", "选择其他地图")}</button>}
  </div>;
}
