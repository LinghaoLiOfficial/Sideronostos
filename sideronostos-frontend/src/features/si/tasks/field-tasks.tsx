"use client";

import { useState } from "react";
import Link from "next/link";
import * as fields from "@/lib/api/field-shift";
import type { Field, FieldInput } from "@/lib/api/field-shift-types";
import { Input, linkStyle, LoadingState, NoFields, primary, secondary, Select, TaskFeedback, tr, useDraft, useLoad, useTaskExecution, type TaskProps } from "./shared";

export function FieldList(props: TaskProps) {
  const { language } = props;
  const records = useLoad(fields.listFields);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Field | null>(null);
  if (editing) return <><button className={secondary} onClick={() => { records.reload(); setEditing(null); }}>{tr(language, "Back to my fields", "返回地块列表")}</button><FieldForm key={`${editing.id}:${editing.version}`} {...props} field={editing} /></>;
  const matches = records.data?.items.filter((item) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return <div className="space-y-3"><LoadingState state={records} language={language} />
    {records.data && !records.loading && (records.data.items.length ? <>
      {records.data.items.length > 5 && <Input label={tr(language, "Find a field", "查找地块")} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}
      {!matches.length && <p>{tr(language, "No fields match that name.", "没有找到该名称的地块。")}</p>}
      <ul className="divide-y divide-border">{matches.map((field) => <li key={field.id} className="py-3 first:pt-0"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="break-words font-semibold">{field.name}</h4><span className="text-xs text-muted-foreground">{field.area_ha} ha · {field.latitude.toFixed(3)}, {field.longitude.toFixed(3)}</span></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><Link className={linkStyle} href={`/field-shift?field=${encodeURIComponent(field.id)}&step=field`}>{tr(language, `Open ${field.name}`, `打开${field.name}`)}</Link><button className={linkStyle} onClick={() => setEditing(field)}>{tr(language, "Edit details", "修改资料")}</button><Link className={linkStyle} href={`/field-shift?field=${encodeURIComponent(field.id)}&step=environment`}>{tr(language, "Check conditions", "查看环境")}</Link><Link className={linkStyle} href={`/field-shift?field=${encodeURIComponent(field.id)}&step=field#history`}>{tr(language, "Planting history", "种植历史")}</Link></div></li>)}</ul>
    </> : <NoFields language={language} />)}
    <Link href="/fields" className={linkStyle}>{tr(language, "Manage farm boundaries on the map", "在地图上管理农场边界")}</Link>
  </div>;
}

export function FieldForm(props: TaskProps & { field?: Field }) {
  const { field, language, scope } = props;
  const editKey = field ? `${field.id}:v${field.version}` : "new";
  const profiles = useLoad(fields.listProfiles);
  const [draft, setDraft] = useDraft(`${scope}:field:${editKey}`, {
    name: field?.name ?? "", area: field ? String(field.area_ha) : "", latitude: field ? String(field.latitude) : "", longitude: field ? String(field.longitude) : "",
    soil: field?.soil_texture ?? "unknown", irrigation: field?.irrigation_available ?? false, profile: field?.profile_id ?? "",
  });
  const [locationError, setLocationError] = useState(false);
  const [locating, setLocating] = useState(false);
  const execution = useTaskExecution(props, `field:${editKey}`);
  const update = (key: keyof typeof draft, value: string | boolean) => setDraft((old) => ({ ...old, [key]: value }));
  const chosen = profiles.data?.items.find((item) => item.id === draft.profile);
  const confirmed = execution.outcome?.status === "succeeded";
  function locate() {
    setLocationError(false); setLocating(true);
    if (!navigator.geolocation) { setLocationError(true); setLocating(false); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => { setDraft((old) => ({ ...old, latitude: String(coords.latitude), longitude: String(coords.longitude) })); setLocating(false); }, () => { setLocationError(true); setLocating(false); }, { timeout: 10000 });
  }
  async function save() {
    const body: FieldInput = {
      name: draft.name.trim(), area_ha: Number(draft.area), latitude: Number(draft.latitude), longitude: Number(draft.longitude),
      soil_texture: draft.soil, irrigation_available: draft.irrigation, profile_id: draft.profile,
      history: field?.history ?? [], ...(field ? { geometry: field.geometry, history_events: field.history_events } : {}),
    };
    await execution.run(field
      ? { kind: "operation", method: "PATCH", path: "/field-shift/fields/{field_id}", pathParams: { field_id: field.id }, body: { ...body, expected_version: field.version } }
      : { kind: "action", action: "field.create", arguments: body });
  }
  return <div className="space-y-3"><LoadingState state={profiles} language={language} />
    {!confirmed && profiles.data && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset disabled={execution.busy || execution.uncertain} className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Input label={tr(language, "Field name", "地块名称")} required maxLength={160} value={draft.name} onChange={(e) => update("name", e.target.value)} />
        <Input label={tr(language, "Area (ha)", "面积（公顷）")} type="number" min="0.0001" step="any" required value={draft.area} onChange={(e) => update("area", e.target.value)} />
        <div className="sm:col-span-2"><p className="mb-1 text-xs text-muted-foreground">{tr(language, "Use your current location only while standing in this field, or enter its coordinates.", "只有身处该地块时才使用当前位置，也可输入地块坐标。")}</p><button type="button" className={secondary} disabled={locating} onClick={locate}>{tr(language, locating ? "Finding your location…" : "Use my current location", locating ? "正在定位…" : "使用当前位置")}</button>{locationError && <p role="alert">{tr(language, "Location is unavailable. Enter the coordinates below or use the field map.", "无法取得位置，请输入坐标或使用地块地图。")}</p>}</div>
        <Input label={tr(language, "Latitude", "纬度")} type="number" min="-90" max="90" step="any" required value={draft.latitude} onChange={(e) => update("latitude", e.target.value)} />
        <Input label={tr(language, "Longitude", "经度")} type="number" min="-180" max="180" step="any" required value={draft.longitude} onChange={(e) => update("longitude", e.target.value)} />
        <Select label={tr(language, "Soil type", "土壤类型")} value={draft.soil} onChange={(e) => update("soil", e.target.value)}>{[["unknown", "I’m not sure", "不确定"], ["sand", "Sandy", "砂土"], ["loam", "Loam", "壤土"], ["clay", "Clay", "黏土"]].map(([value, en, zh]) => <option key={value} value={value}>{tr(language, en, zh)}</option>)}</Select>
        <Select label={tr(language, "Crop settings", "作物设置")} required value={draft.profile} onChange={(e) => update("profile", e.target.value)} disabled={Boolean(field?.history.length || field?.history_events?.length)}><option value="">{tr(language, "Choose crop settings", "选择作物设置")}</option>{profiles.data.items.map((profile) => <option key={profile.id} value={profile.id}>{profile.id === "temperate-demo" ? tr(language, "Temperate annual crops", "温带一年生作物") : profile.name}{profile.is_demo ? tr(language, " (example data)", "（示例数据）") : ""}</option>)}</Select>
        <p className="text-xs text-muted-foreground sm:col-span-2">{chosen?.is_demo ? tr(language, "These crop settings use example data. Review their suitability before planning real farm work.", "这些作物设置使用示例数据，实际作业前请确认是否适用。") : tr(language, "Crop settings provide the crop choices used when planning. Planting history can be added on the field page.", "作物设置提供规划时的作物选项，种植历史可在地块页面补充。")}</p>
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={draft.irrigation} onChange={(e) => update("irrigation", e.target.checked)} />{tr(language, "This field can be irrigated", "该地块可灌溉")}</label>
        <div className="sm:col-span-2"><button className={primary} disabled={!profiles.data.items.length}>{tr(language, field ? "Save changes" : "Save field", field ? "保存修改" : "保存地块")}</button></div>
      </fieldset>
      {!profiles.data.items.length && <p role="status">{tr(language, "No crop settings have been published yet. Field creation will be available once they are ready.", "暂无已发布作物设置，发布后即可创建地块。")}</p>}
    </form>}
    <TaskFeedback execution={execution} language={language} success={tr(language, `${draft.name} ${field ? "has been updated" : "has been added"}.`, `${draft.name}已${field ? "更新" : "添加"}。`)} linkLabel={tr(language, "Open saved field", "打开已保存地块")}><p className="mt-2 text-sm">{draft.area} ha · {draft.latitude}, {draft.longitude}</p></TaskFeedback>
    {confirmed && !field && <button className={secondary} onClick={() => { execution.clear(); setDraft({ name: "", area: "", latitude: "", longitude: "", soil: "unknown", irrigation: false, profile: "" }); }}>{tr(language, "Add another field", "再添加一个地块")}</button>}
  </div>;
}

export function FieldPlans({ language }: TaskProps) {
  const plans = useLoad(() => fields.listPlans());
  const [query, setQuery] = useState("");
  return <div className="space-y-3"><LoadingState state={plans} language={language} />{plans.data && <>
    {plans.data.items.length > 5 && <Input label={tr(language, "Find a plan", "查找计划")} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}
    {!plans.data.items.length && <p>{tr(language, "You haven’t saved a planting plan yet.", "还没有保存种植计划。")}</p>}
    <ul className="divide-y divide-border">{plans.data.items.filter((p) => `${p.title} ${p.field_name}`.toLowerCase().includes(query.toLowerCase())).map((plan) => <li key={plan.id} className="py-2"><Link className={linkStyle} href={`/field-shift?step=saved&plan=${encodeURIComponent(plan.id)}`}>{plan.title}</Link><p className="text-xs text-muted-foreground">{plan.field_name}</p></li>)}</ul>
  </>}<Link href="/field-shift?step=plan" className={linkStyle}>{tr(language, "Plan what to grow", "规划种植安排")}</Link></div>;
}
