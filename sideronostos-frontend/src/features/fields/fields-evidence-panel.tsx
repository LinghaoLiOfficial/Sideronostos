"use client"
import { useI18n } from "@/lib/i18n/provider";
import { useState, type RefObject } from "react"
import { Button } from "@/components/ui/button"
import { dataStatus, labels, missingReason, readableUnit } from "@/components/rotation/science-presentation"
import { observationWindow } from "@/components/rotation/workspace-state"
import type { FieldsContext } from "./use-fields-context"
import type { FieldMapHandle } from "./field-map"

export function FieldsEvidencePanel({ context, mapRef, ownerId, onMapInteraction }: { context: FieldsContext; mapRef: RefObject<FieldMapHandle | null>; ownerId: string | null; onMapInteraction?: () => void }) {
  const { t } = useI18n();

  const { navigation, selection, facts, layers, manifest } = context
  const [longitude, setLongitude] = useState(""), [latitude, setLatitude] = useState("")
  const [dateDraft, setDateDraft] = useState<{ basis: string; start: string; end: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const basis = `${navigation.search.get("obsStart")}:${navigation.search.get("obsEnd")}`
  const start = dateDraft?.basis === basis ? dateDraft.start : context.window.dates?.start ?? ""
  const end = dateDraft?.basis === basis ? dateDraft.end : context.window.dates?.end ?? ""
  return <section className="border-b p-4 text-xs leading-5" aria-label={t("科学资料与临时提问选区")}>
    <h3 className="text-sm font-semibold">{t("科学资料 / Evidence")}</h3><p className="my-2 text-muted-foreground">{t("临时提问选区独立于农场与地块边界。NASA GIBS 图层用于显示，下面仅列已实际处理的数据。")}</p>
    <fieldset disabled={!ownerId} className="space-y-3">
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { mapRef.current?.startQuery("point"); onMapInteraction?.() }}>{t("地图选点")}</Button><Button variant="outline" size="sm" onClick={() => { mapRef.current?.startQuery("polygon"); onMapInteraction?.() }}>{t("临时多边形")}</Button><Button variant="outline" size="sm" onClick={() => void mapRef.current?.queryViewport()}>{t("使用当前视野")}</Button></div>
      <form onSubmit={event => { event.preventDefault(); if (!longitude.trim() || !latitude.trim() || !Number.isFinite(Number(longitude)) || !Number.isFinite(Number(latitude)) || Math.abs(Number(longitude)) > 180 || Math.abs(Number(latitude)) > 85.051129) { setError(t("请填写有效的经纬度（纬度在 ±85.05° 内）。")); return } setError(null); void context.selectRegion("point", { type: "Point", coordinates: [Number(longitude), Number(latitude)] }) }}>
        <div className="grid grid-cols-2 gap-2"><label>{t("经度")}<input className="mt-1 w-full rounded border p-2" type="number" step="any" value={longitude} onChange={e => setLongitude(e.target.value)} /></label><label>{t("纬度")}<input className="mt-1 w-full rounded border p-2" type="number" step="any" value={latitude} onChange={e => setLatitude(e.target.value)} /></label></div><Button className="mt-2" size="sm" variant="outline">{t("使用坐标查询")}</Button>
      </form>
      {selection.data && <div className="rounded border p-2"><p>{selection.data.kind} · {selection.data.center.map(v => v.toFixed(4)).join(", ")}</p>{selection.data.area_ha != null && <p>{t("查询区域 ")}{selection.data.area_ha.toFixed(2)} {t(" ha")}</p>}<button className="underline" onClick={() => navigation.navigate({ selection: null })}>{t("清除临时选区")}</button></div>}
      <details><summary>{t("科学观测时间范围")}</summary><form className="mt-2" onSubmit={e => { e.preventDefault(); const next = observationWindow(start, end); if (!next.dates) { setError(next.error ?? t("请填写日期")); return } setError(null); navigation.navigate({ obsStart: start, obsEnd: end }) }}>
        <label className="block">{t("起始日期")}<input className="ml-2 rounded border p-1" type="date" value={start} onChange={e => setDateDraft({ basis, start: e.target.value, end })} /></label><label className="mt-2 block">{t("结束日期")}<input className="ml-2 rounded border p-1" type="date" value={end} onChange={e => setDateDraft({ basis, start, end: e.target.value })} /></label>
        <div className="mt-2 flex gap-2"><Button size="sm" variant="outline">{t("应用观测日期")}</Button><Button size="sm" type="button" variant="ghost" onClick={() => { setDateDraft(null); navigation.navigate({ obsStart: null, obsEnd: null }) }}>{t("查看全部")}</Button></div></form></details>
      <p className="text-muted-foreground">{context.window.dates ? `${start}—${end}` : t("全部已发布观测")}{t("。此范围独立于底部 GIBS 显示日期和轮作规划日期。")}</p>
      <label className="block">{t("已处理科学图层")}<select className="mt-1 w-full rounded border p-2" value={navigation.search.get("layer") ?? ""} onChange={e => navigation.navigate({ layer: e.target.value || null })}><option value="">{t("不叠加科学图层")}</option>{layers.data?.items.map(layer => <option key={layer.id} value={layer.id}>{t(layer.title)} · {layer.start.slice(0,10)}</option>)}</select></label>
      {manifest.data && <div className="space-y-1 rounded border p-2"><p>{manifest.data.title} · {manifest.data.start.slice(0,10)}—{manifest.data.end.slice(0,10)}</p><div aria-label={t("科学图层图例")} className="h-3" style={{ background: `linear-gradient(to right, ${manifest.data.legend.colors.join(",")})` }} /><p>{manifest.data.legend.min}—{manifest.data.legend.max} {t(readableUnit(manifest.data.unit))}</p><p>{manifest.data.spatial_support}</p>{manifest.data.limitations.map((v,i) => <p key={i}>{v}</p>)}</div>}
    </fieldset>
    {!ownerId && <p>{t("登录后可查询已发布数据和使用轮作助手。")}</p>}
    {(context.selecting || facts.isFetching) && <p role="status">{t("正在读取选区与科学资料…")}</p>}
    {[error, context.error, context.window.error].filter(Boolean).map((value,i) => <p key={i} role="alert" className="my-2 text-red-700">{value}</p>)}
    {[selection, facts, layers, manifest].filter(q => q.isError).map((q,i) => <div key={i} role="alert"><p>{t(q.error instanceof Error ? q.error.message : t("资料读取失败"))}</p><Button size="sm" variant="outline" onClick={() => void q.refetch()}>{t("重试读取")}</Button>{q === selection && <Button size="sm" variant="ghost" onClick={() => navigation.navigate({ selection: null })}>{t("清除不可用选区")}</Button>}</div>)}
    {facts.data?.facts.map((fact,i) => <article className="mt-3 rounded border p-2" key={`${fact.id}:${i}`}><strong>{t(labels[fact.metric] ?? fact.metric)}{fact.pass && ` · ${fact.pass}`}</strong><p>{t(fact.value == null ? t("暂无有效值") : `${fact.value.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${readableUnit(fact.unit)}`)}</p><p>{fact.period.start.slice(0,10)}—{fact.period.end.slice(0,10)} · {t(dataStatus[fact.status] ?? fact.status)}</p><details><summary>{t("来源、质量与限制")}</summary><p>{String(fact.source.product ?? fact.source.release_id ?? fact.data_kind)}</p>{fact.acquired_at && <p>{fact.acquired_at}</p>}{fact.retrieval_qual_flag != null && <p>{t("质量标记 ")}{fact.retrieval_qual_flag}</p>}{fact.limitations.map((v,j) => <p key={j}>{v}</p>)}{typeof fact.source.url === "string" && /^https?:\/\//.test(fact.source.url) && <a href={fact.source.url} target="_blank" rel="noreferrer" className="underline">{t("原始来源")}</a>}</details></article>)}
    {facts.data?.unavailable.map((missing,i) => <p key={i} className="my-2 border-l-2 pl-2">{t(missingReason[missing.reason] ?? missing.reason)}{missing.release_id && ` · ${missing.release_id}`}</p>)}
    {(context.run.isError || context.saved.isError) && <p role="alert">{t("历史方案无法载入，助手不会改用当前地块替代。")}<button className="underline" onClick={() => navigation.navigate({ run: null, plan: null, option: null, compare: null, compareOption: null })}>{t("返回当前地块")}</button></p>}
  </section>
}
