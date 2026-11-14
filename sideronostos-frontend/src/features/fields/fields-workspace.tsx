"use client"
/* eslint-disable react-hooks/set-state-in-effect -- Reconcile owned deep links with asynchronously restored farm identities. */

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Polygon } from "geojson"
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Database, Download, Eye, EyeOff, FileUp, Layers3, Map as MapIcon, Pause, Pentagon, Play, Plus, RefreshCw, Satellite, Sparkles, Trash2, X } from "lucide-react"

import { useQueryClient } from "@tanstack/react-query"
import { ApiError, type AuthUser } from "@/lib/api/client"
import { useWorkspaceSession } from "@/components/rotation/use-workspace-session"
import { AssistantDock } from "@/components/rotation/assistant-dock"
import { useFieldsContext } from "./use-fields-context"
import { FieldsEvidencePanel } from "./fields-evidence-panel"
import { FieldCompletionPanel } from "./field-completion-panel"
import { WorkspaceSyncPanel } from "./workspace-sync-panel"
import { useOwnedWorkspace } from "./use-owned-workspace"
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { GIBS_LAYERS, shiftDate, toIsoDate } from "@/data/gibs-layers"
import { createDemoFarm, createDemoObservations } from "@/features/fields/demo-data"
import { createFarmFeature, featureAreaHectares, featureCentroid, parseFarmGeoJson } from "@/features/fields/geometry"
import { FieldMap, type FieldMapHandle } from "@/features/fields/field-map"
import { FieldsShell } from "@/features/fields/fields-shell"
import { partitionFarm, validateCandidatePartition, type PartitionResult } from "@/features/fields/partition"
import { putObservations } from "@/features/fields/storage"
import { cn } from "@/lib/utils"
import type { FarmFeature, FieldFeature, FieldObservation, LayerState, PartitionMethod, PartitionOrientation, WorkspaceSettings } from "@/types/workspace"

const SETTINGS_KEY = "field-shift.workspace.v1"
const TODAY = toIsoDate(new Date())
const DEFAULT_DATE = TODAY < "2026-11-06" ? TODAY : "2026-11-06"
const defaultSettings: WorkspaceSettings = { version: 1, longitude: 8, latitude: 22, zoom: 1.5, basemap: "satellite", date: DEFAULT_DATE, layers: { "smap-day": { visible: true, opacity: 0.72 }, "smap-night": { visible: false, opacity: 0.72 } } }

function loadSettings(ownerId: string | null): WorkspaceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(`${SETTINGS_KEY}:${ownerId ?? "anonymous"}`) ?? "null") as Partial<WorkspaceSettings> | null
    return saved?.version === 1 ? { ...defaultSettings, ...saved, layers: { ...defaultSettings.layers, ...saved.layers } } : defaultSettings
  } catch { return defaultSettings }
}

function formatArea(value: number) { return value < 1 ? `${(value * 10_000).toFixed(0)} m²` : `${value.toFixed(value < 100 ? 2 : 0)} ha` }

function withPartitionResult(farm: FarmFeature, result: PartitionResult): FarmFeature {
  return {
    ...farm,
    properties: {
      ...farm.properties,
      partitionRevision: crypto.randomUUID(),
      expectedFieldCount: result.fields.length,
      partitionMetadataKnown: true,
      partitionCount: result.requestedCount,
      partitionMethod: result.method,
      partitionOrientation: result.orientation,
      partitionGridRows: result.gridLayout?.rows ?? null,
      partitionGridColumns: result.gridLayout?.columns ?? null,
      updatedAt: new Date().toISOString(),
    },
  }
}

interface ListProps {
  farms: FarmFeature[]
  fields: FieldFeature[]
  selectedFieldId: string | null
  onSelectFarm: (farm: FarmFeature) => void
  onSelectField: (field: FieldFeature) => void
  onDraw: () => void
  onDemo: () => void
  onImport: () => void
  onExport: () => void
}

function FarmListPanel({ farms, fields, selectedFieldId, onSelectFarm, onSelectField, onDraw, onDemo, onImport, onExport }: ListProps) {
  const { t } = useI18n();

  return <section className="flex h-full min-h-0 flex-col bg-background" aria-labelledby="farms-title">
    <div className="border-b px-4 py-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">{t("Farm workspace")}</p><h2 id="farms-title" className="text-base font-semibold">{t("Farms")}</h2></div><span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">{farms.length}</span></div><Button type="button" onClick={onDraw} className="mt-4 w-full"><Plus /> {t(" Draw farm boundary")}</Button><div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant="outline" size="sm" onClick={onImport}><FileUp /> {t(" Import")}</Button><Button type="button" variant="outline" size="sm" onClick={onExport} disabled={!farms.length}><Download /> {t(" Export")}</Button></div></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{farms.length === 0 ? <div className="mx-2 mt-4 border border-dashed p-4 text-center"><Pentagon className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{t("No farm boundary yet")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("Draw the complete farm range. The system will generate candidate fields inside it.")}</p><Button type="button" variant="outline" size="sm" onClick={onDemo} className="mt-4"><Sparkles /> {t(" Load demo farm")}</Button></div> : farms.map((farm) => { const children = fields.filter((field) => field.properties.farmId === farm.properties.id).sort((a, b) => a.properties.partitionIndex - b.properties.partitionIndex); return <div key={farm.properties.id} className="mb-2 border"><button type="button" onClick={() => onSelectFarm(farm)} className="flex w-full items-center justify-between gap-2 bg-muted/60 px-3 py-3 text-left"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{farm.properties.name}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{formatArea(featureAreaHectares(farm))} · {children.length} {t(" fields")}</span></span><span className={cn("border px-1.5 py-0.5 text-[10px]", farm.properties.partitionStatus === "confirmed" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>{t(farm.properties.partitionStatus)}</span></button><div className="divide-y">{children.map((field) => <button key={field.properties.id} type="button" onClick={() => onSelectField(field)} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs", selectedFieldId === field.properties.id ? "bg-accent" : "hover:bg-muted/50")}><span className="flex min-w-0 items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full", field.properties.status === "confirmed" ? "bg-emerald-600" : "bg-amber-500")} /><span className="truncate">{field.properties.name}</span></span><span className="text-muted-foreground">{formatArea(featureAreaHectares(field))}</span></button>)}</div></div> })}</div>
    {farms.length > 0 && <div className="border-t p-3"><Button type="button" variant="ghost" size="sm" onClick={onDemo} className="w-full justify-start"><Sparkles /> {t(" Add demo farm")}</Button></div>}
  </section>
}

function PartitionPanel({ farm, fields, busy, onCount, onMethod, onOrientation, onRegenerate, onConfirm, onCancel }: { farm: FarmFeature; fields: FieldFeature[]; busy: boolean; onCount: (count: number) => void; onMethod: (method: PartitionMethod) => void; onOrientation: (orientation: PartitionOrientation) => void; onRegenerate: () => void; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();

  const validation = validateCandidatePartition(farm, fields)
  const grid = farm.properties.partitionMethod === "regular-grid"
  const cardinal = farm.properties.partitionOrientation === "cardinal"
  return <section className="border-b"><div className="px-4 py-4"><p className="text-xs font-medium text-primary">{t("Candidate partition")}</p><h2 className="text-base font-semibold">{farm.properties.name}</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-muted-foreground">{t("Farm area")}</dt><dd className="mt-1 font-semibold">{formatArea(featureAreaHectares(farm))}</dd></div><div><dt className="text-muted-foreground">{t("Generated fields")}</dt><dd className="mt-1 font-semibold">{fields.length}</dd></div>{grid && farm.properties.partitionGridRows && farm.properties.partitionGridColumns && <div className="col-span-2"><dt className="text-muted-foreground">{t("Grid layout")}</dt><dd className="mt-1 font-semibold">{farm.properties.partitionGridRows} × {farm.properties.partitionGridColumns}</dd></div>}</dl><fieldset className="mt-5" disabled={busy}><legend className="text-xs font-medium">{t("Partition method")}</legend><div className="mt-2 grid grid-cols-2 border p-0.5"><button type="button" aria-pressed={!grid} onClick={() => onMethod("equal-area-strips")} className={cn("min-h-9 px-2 text-xs font-medium disabled:cursor-wait disabled:opacity-60", !grid && "bg-foreground text-background")}>{t("Equal-area strips")}</button><button type="button" aria-pressed={grid} onClick={() => onMethod("regular-grid")} className={cn("min-h-9 px-2 text-xs font-medium disabled:cursor-wait disabled:opacity-60", grid && "bg-foreground text-background")}>{t("Regular grid")}</button></div></fieldset><fieldset className="mt-4" disabled={busy}><legend className="text-xs font-medium">{t("Partition orientation")}</legend><div className="mt-2 grid grid-cols-2 border p-0.5"><button type="button" aria-pressed={!cardinal} onClick={() => onOrientation("farm-axis")} className={cn("min-h-9 px-2 text-xs font-medium disabled:cursor-wait disabled:opacity-60", !cardinal && "bg-foreground text-background")}>{t("Farm long axis")}</button><button type="button" aria-pressed={cardinal} onClick={() => onOrientation("cardinal")} className={cn("min-h-9 px-2 text-xs font-medium disabled:cursor-wait disabled:opacity-60", cardinal && "bg-foreground text-background")}>{t("Map axes")}</button></div><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{cardinal ? "Aligned to east-west and north-south map axes." : "Aligned to the farm shape's computed PCA long axis."}</p></fieldset><label className="mt-5 block text-xs font-medium">{t("Target field count ")}<span className="float-right text-base font-semibold text-primary">{farm.properties.partitionCount}</span><input type="range" min="2" max="12" step="1" value={farm.properties.partitionCount} disabled={busy} onChange={(event) => onCount(Number(event.target.value))} className="mt-3 w-full accent-primary disabled:cursor-wait" aria-label={t("Target field count")} /><span className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>2</span><span>12</span></span></label><Button type="button" variant="outline" size="sm" onClick={onRegenerate} disabled={busy} className="mt-3 w-full"><RefreshCw className={cn(busy && "animate-spin")} /> {t(" Regenerate candidates")}</Button><div className="mt-4 flex gap-2 border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t("Rule-generated candidates do not represent remotely detected field boundaries. Edit and review before confirming.")}</div>{grid && fields.length !== farm.properties.partitionCount && <p className="mt-3 border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">{t("The complete regular grid and farm-edge clipping produced ")}{fields.length} {t(" fields for a target of ")}{farm.properties.partitionCount}.</p>}{!grid && fields.length > farm.properties.partitionCount && <p className="mt-3 border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">{t("Complex geometry created ")}{fields.length} {t(" components for a target of ")}{farm.properties.partitionCount}{t("; no area was discarded.")}</p>}{!validation.valid && <p className="mt-3 border border-red-300 bg-red-50 p-2 text-xs text-red-800">{t(validation.errors[0])}</p>}</div><div className="grid grid-cols-2 gap-2 border-t p-3"><Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>{t("Cancel farm")}</Button><Button type="button" size="sm" onClick={onConfirm} disabled={busy || !validation.valid}><Check /> {t(" Confirm all")}</Button></div></section>
}

function FieldDetails({ field, observations, onDelete }: { field: FieldFeature | null; observations: FieldObservation[]; onDelete: () => void }) {
  const { t } = useI18n();

  if (!field) return <section className="border-b px-4 py-6 text-center"><p className="text-sm font-medium">{t("Select a field")}</p><p className="mt-1 text-xs text-muted-foreground">{t("Candidate geometry or confirmed evidence will appear here.")}</p></section>
  const [lng, lat] = featureCentroid(field); const confirmed = field.properties.status === "confirmed"
  return <section className="border-b"><div className="px-4 py-4"><div className="flex justify-between gap-2"><div><p className="text-xs text-muted-foreground">{t("Selected field")}</p><h2 className="text-base font-semibold">{field.properties.name}</h2></div><span className={cn("h-fit border px-2 py-1 text-[10px]", confirmed ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>{t(field.properties.status)}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-muted-foreground">{t("Area")}</dt><dd className="mt-1">{formatArea(featureAreaHectares(field))}</dd></div><div><dt className="text-muted-foreground">{t("Boundary")}</dt><dd className="mt-1 capitalize">{field.properties.boundarySource}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">{t("Centroid")}</dt><dd className="mt-1 font-mono text-[11px]">{lat.toFixed(5)}, {lng.toFixed(5)}</dd></div></dl></div>{confirmed && observations.length > 0 ? <div className="border-t px-4 py-4"><div className="flex justify-between"><h3 className="text-sm font-semibold">{t("Field indicators")}</h3><span className="border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800">{t("DEMO DATA")}</span></div><div className="mt-3 space-y-3">{observations.map((item) => <div key={item.id} className="border-l-2 border-primary pl-3"><div className="flex justify-between gap-2 text-xs"><span className="text-muted-foreground">{item.metric}</span><strong>{item.value} {item.unit}</strong></div><p className="mt-1 text-[10px] text-muted-foreground">{item.sourceProduct} · {item.spatialSupport === "regional-background" ? "regional background" : `${item.nativeResolutionMeters} m support`}</p></div>)}</div></div> : <div className="border-t bg-muted/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{t("GIBS is a visual reference. Field observations require prepared scientific data; no measurements are inferred from the image.")}</div>}<div className="border-t p-3"><Button type="button" variant="ghost" size="sm" onClick={onDelete} className="w-full justify-start text-red-700"><Trash2 /> {t(" Delete ")}{confirmed ? "field" : "candidate"}</Button></div></section>
}

function LayersPanel({ layers, zoom, onChange }: { layers: Record<string, LayerState>; zoom: number; onChange: (id: string, state: LayerState) => void }) {
  const { t } = useI18n();

  const visible = GIBS_LAYERS.filter((layer) => layers[layer.id]?.visible)
  return <section><div className="border-b px-4 py-4"><p className="text-xs text-muted-foreground">{t("Visualization")}</p><h2 className="text-base font-semibold">{t("NASA layers")}</h2></div>{GIBS_LAYERS.map((layer) => { const state = layers[layer.id] ?? { visible: false, opacity: 0.7 }; return <div key={layer.id} className="border-b px-4 py-4"><div className="flex gap-3"><button type="button" aria-label={t(state.visible ? "Hide {layer}" : "Show {layer}", {layer:t(layer.title)})} onClick={() => onChange(layer.id, { ...state, visible: !state.visible })}>{state.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</button><div className="min-w-0 flex-1"><p className="text-sm font-medium">{t(layer.title)}</p><p className="mt-1 text-xs text-muted-foreground">{t(layer.nativeResolutionLabel)}</p></div></div>{state.visible && <div className="mt-3 pl-7">{layer.legendUrl && <img src={layer.legendUrl} alt={t("{layer} legend", {layer:t(layer.title)})} className="w-full border bg-white p-1" />}<label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">{t("Opacity")}<input type="range" min="0.1" max="1" step="0.05" value={state.opacity} onChange={(event) => onChange(layer.id, { ...state, opacity: Number(event.target.value) })} className="min-w-0 flex-1 accent-primary" /></label></div>}</div> })}{visible.length > 0 && zoom > Math.min(...visible.map((layer) => layer.maxNativeZoom)) && <div className="m-4 flex gap-2 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><AlertTriangle className="size-4" />{t("SMAP is regional context, not within-field variation.")}</div>}</section>
}

function Timeline({ date, playing, onDate, onPlaying }: { date: string; playing: boolean; onDate: (date: string) => void; onPlaying: (value: boolean) => void }) {
  const { t } = useI18n();

  return <div className="flex h-[72px] shrink-0 items-center gap-3 border-t bg-neutral-950 px-3 text-white"><Button type="button" size="icon" variant="ghost" onClick={() => onPlaying(!playing)} className="text-white" aria-label={t(playing ? "Pause timeline" : "Play timeline")}>{playing ? <Pause /> : <Play />}</Button><Button type="button" size="icon" variant="ghost" onClick={() => onDate(shiftDate(date, -1))} aria-label={t("上一天的 GIBS 图层")} className="hidden text-white sm:inline-flex"><ChevronLeft /></Button><div className="min-w-0 flex-1"><p className="text-[10px] text-neutral-400">{t("GIBS display date · 图层日期")}</p><input aria-label={t("GIBS 显示日期时间轴")} type="range" min={new Date("2015-03-31T12:00:00Z").getTime()} max={new Date(`${TODAY}T12:00:00Z`).getTime()} step={86_400_000} value={new Date(`${date}T12:00:00Z`).getTime()} onChange={(event) => onDate(toIsoDate(new Date(Number(event.target.value))))} className="mt-2 w-full accent-emerald-500" /></div><Button type="button" size="icon" variant="ghost" onClick={() => onDate(shiftDate(date, 1))} aria-label={t("下一天的 GIBS 图层")} disabled={date >= TODAY} className="hidden text-white sm:inline-flex"><ChevronRight /></Button><label className="flex h-10 items-center gap-2 border border-white/20 px-2 text-xs"><CalendarDays className="hidden size-4 sm:block" /><input aria-label={t("GIBS 显示日期")} type="date" min="2015-03-31" max={TODAY} value={date} onChange={(event) => onDate(event.target.value)} className="w-[7.2rem] bg-transparent [color-scheme:dark]" /></label></div>
}

export function FieldsWorkspace() {
  const { t } = useI18n();

  const { session, ready } = useWorkspaceSession()
  if (!ready) return <FieldsShell><p className="m-auto" role="status">{t("正在确认登录状态…")}</p></FieldsShell>
  if (session.error && !(session.error instanceof ApiError && session.error.status === 401)) return <FieldsShell><div className="m-auto p-6" role="alert"><p>{t("登录状态暂时无法确认，请重试。")}</p><Button onClick={() => void session.refetch()}>{t("重新连接")}</Button></div></FieldsShell>
  const user = session.data?.email_verified ? session.data : null
  return <OwnedFieldsWorkspace key={user?.id ?? "anonymous"} owner={user} unverified={Boolean(session.data && !session.data.email_verified)} />
}

function OwnedFieldsWorkspace({ owner, unverified }: { owner: AuthUser | null; unverified: boolean }) {
  const { t } = useI18n();

  const ownerId = owner?.id ?? null
  const local = useOwnedWorkspace(ownerId), { store } = local
  const client = useQueryClient()
  const [settings, setSettings] = useState(() => loadSettings(ownerId))
  const farms = local.workspace?.farms ?? null, fields = local.workspace?.fields ?? []
  function setFarms(value: FarmFeature[] | ((current: FarmFeature[] | null) => FarmFeature[])) { store.update(w => ({ ...w, farms: typeof value === "function" ? value(w.farms) : value })) }
  function setFields(value: FieldFeature[]) { store.update(w => ({ ...w, fields: value })) }
  const [formDirty, setFormDirty] = useState(false)
  const onFormDirty = useCallback((dirty: boolean) => setFormDirty(dirty), [])
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [coordinate, setCoordinate] = useState<[number, number]>([settings.longitude, settings.latitude])
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [partitionBusy, setPartitionBusy] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<"farms" | "layers" | "details" | null>(null)
  const mobileTrigger = useRef<HTMLElement | null>(null)
  function showMobilePanel(panel: "farms" | "layers" | "details") { mobileTrigger.current = document.activeElement as HTMLElement; setMobilePanel(panel) }
  const mapRef = useRef<FieldMapHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => { try { localStorage.setItem(`${SETTINGS_KEY}:${ownerId ?? "anonymous"}`, JSON.stringify(settings)) } catch { /* Geometry persistence has its own visible error state. */ } }, [settings, ownerId])
  useEffect(() => { if (!playing) return; const timer = window.setInterval(() => setSettings((current) => ({ ...current, date: current.date >= TODAY ? "2015-03-31" : shiftDate(current.date, 1) })), 900); return () => window.clearInterval(timer) }, [playing])
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(null), 5000); return () => window.clearTimeout(timer) }, [message])

  const selectedFarm = farms?.find((farm) => farm.properties.id === selectedFarmId) ?? null
  const selectedField = fields.find((field) => field.properties.id === selectedFieldId) ?? null
  const selectedFarmFields = selectedFarm ? fields.filter((field) => field.properties.farmId === selectedFarm.properties.id) : []
  const context = useFieldsContext(ownerId, selectedField, formDirty)
  const requestedField = context.navigation.search.get("field") ?? (context.navigation.search.get("plan") ? context.run.data?.field_snapshots[0]?.id : null)
  useEffect(() => {
    if (!requestedField || !local.workspace) return
    const found = local.workspace.fields.find(f => f.properties.backendFieldId === requestedField)
    if (found) { setSelectedFarmId(found.properties.farmId); setSelectedFieldId(found.properties.id) }
  }, [requestedField, local.workspace])
  function selectLocal(id: string | null) {
    const next = fields.find(f => f.properties.id === id)
    setSelectedFieldId(id); setFormDirty(false)
    if (next) setSelectedFarmId(next.properties.farmId)
    context.navigation.navigate({ field: next?.properties.backendFieldId ?? null, run: null, option: null, plan: null, compare: null, compareOption: null })
  }

  const observations = useMemo(() => selectedField?.properties.status === "confirmed" && selectedFarm?.properties.boundarySource === "synthetic" ? createDemoObservations(selectedField, settings.date) : [], [selectedField, selectedFarm, settings.date])
  useEffect(() => { if (observations.length) putObservations(observations, ownerId).catch(() => undefined) }, [observations, ownerId])

  function installFarm(farm: FarmFeature, nextFields: FieldFeature[]) {
    const allFields = [...fields, ...nextFields]
    setFarms((current) => [...(current ?? []), farm]); setFields(allFields); setSelectedFarmId(farm.properties.id); setSelectedFieldId(nextFields[0]?.properties.id ?? null)
    window.setTimeout(() => { mapRef.current?.replaceFields(allFields); if (nextFields[0]) mapRef.current?.selectField(nextFields[0]) }, 50)
  }
  function createFarm(geometry: Polygon, source: "drawn" | "imported" | "synthetic" = "drawn", name?: string) {
    try { const farm = createFarmFeature(geometry, source, (farms?.length ?? 0) + 1); if (name) farm.properties.name = name; const result = partitionFarm(farm, 4); installFarm(withPartitionResult(farm, result), result.fields); setMessage(t("{count} candidate fields generated. Review them before confirming.", {count:result.fields.length})) } catch (error) { setMessage(error instanceof Error ? error.message : "Candidates could not be generated.") }
  }
  function loadDemo() { const demo = createDemoFarm((farms?.length ?? 0) + 1); installFarm({ ...demo.farm, properties: { ...demo.farm.properties, partitionRevision: crypto.randomUUID(), expectedFieldCount: demo.fields.length } }, demo.fields); setMessage("Demo farm and four candidate fields added in northeastern New Mexico.") }
  async function regenerate() {
    if (!selectedFarm || !farms) return
    setPartitionBusy(true)
    try { const result = partitionFarm(selectedFarm, selectedFarm.properties.partitionCount, selectedFarm.properties.partitionMethod, selectedFarm.properties.partitionOrientation); const updatedFarm = withPartitionResult(selectedFarm, result); const updatedFarms = farms.map((farm) => farm.properties.id === updatedFarm.properties.id ? updatedFarm : farm); const next = [...fields.filter((field) => field.properties.farmId !== selectedFarm.properties.id), ...result.fields]; setFarms(updatedFarms); setFields(next); setSelectedFieldId(result.fields[0]?.properties.id ?? null); mapRef.current?.replaceFields(next); await store.flush(); setMessage(t("{count} candidates regenerated{extra}.", {count:result.fields.length, extra:result.hasExtraParts ? t("; complex geometry created extra components") : ""})) } catch (error) { setMessage(error instanceof Error ? error.message : "Partition could not be regenerated.") } finally { setPartitionBusy(false) }
  }
  async function changePartitionMethod(method: PartitionMethod) {
    if (!selectedFarm || !farms || selectedFarm.properties.partitionStatus !== "draft" || selectedFarm.properties.partitionMethod === method) return
    setPartitionBusy(true)
    try { const result = partitionFarm(selectedFarm, selectedFarm.properties.partitionCount, method, selectedFarm.properties.partitionOrientation); const updatedFarm = withPartitionResult(selectedFarm, result); const updatedFarms = farms.map((farm) => farm.properties.id === updatedFarm.properties.id ? updatedFarm : farm); const next = [...fields.filter((field) => field.properties.farmId !== selectedFarm.properties.id), ...result.fields]; setFarms(updatedFarms); setFields(next); setSelectedFieldId(result.fields[0]?.properties.id ?? null); mapRef.current?.replaceFields(next); await store.flush(); setMessage(t("{method} generated {count} candidates.", {method:t(method === "regular-grid" ? "Regular grid" : "Equal-area strips"), count:result.fields.length})) } catch (error) { setMessage(error instanceof Error ? error.message : "Partition method could not be changed.") } finally { setPartitionBusy(false) }
  }
  async function changePartitionOrientation(orientation: PartitionOrientation) {
    if (!selectedFarm || !farms || selectedFarm.properties.partitionStatus !== "draft" || selectedFarm.properties.partitionOrientation === orientation) return
    setPartitionBusy(true)
    try { const result = partitionFarm(selectedFarm, selectedFarm.properties.partitionCount, selectedFarm.properties.partitionMethod, orientation); const updatedFarm = withPartitionResult(selectedFarm, result); const updatedFarms = farms.map((farm) => farm.properties.id === updatedFarm.properties.id ? updatedFarm : farm); const next = [...fields.filter((field) => field.properties.farmId !== selectedFarm.properties.id), ...result.fields]; setFarms(updatedFarms); setFields(next); setSelectedFieldId(result.fields[0]?.properties.id ?? null); mapRef.current?.replaceFields(next); await store.flush(); setMessage(t("{orientation} orientation generated {count} candidates.", {orientation:t(orientation === "cardinal" ? "Map axes" : "Farm long axis"), count:result.fields.length})) } catch (error) { setMessage(error instanceof Error ? error.message : "Partition orientation could not be changed.") } finally { setPartitionBusy(false) }
  }
  async function confirmPartition() {
    if (!selectedFarm || !farms) return
    const validation = validateCandidatePartition(selectedFarm, selectedFarmFields); if (!validation.valid) { setMessage(validation.errors[0]); return }
    const now = new Date().toISOString(); const confirmedFields = fields.map((field) => field.properties.farmId === selectedFarm.properties.id ? { ...field, properties: { ...field.properties, status: "confirmed" as const, syncStatus: "needs-details" as const, farmerConfirmed: true, updatedAt: now } } : field); const confirmedFarm = { ...selectedFarm, properties: { ...selectedFarm.properties, partitionStatus: "confirmed" as const, updatedAt: now } }; const confirmedFarms = farms.map((farm) => farm.properties.id === confirmedFarm.properties.id ? confirmedFarm : farm); store.update(() => ({ farms: confirmedFarms, fields: confirmedFields })); await store.flush(); mapRef.current?.replaceFields(confirmedFields); setMessage("Boundaries confirmed. Complete field details before synchronizing and planning.")
  }
  function cancelFarm() { if (!selectedFarm || !farms) return; const next = fields.filter((field) => field.properties.farmId !== selectedFarm.properties.id); setFarms(farms.filter((farm) => farm.properties.id !== selectedFarm.properties.id)); setFields(next); setSelectedFarmId(null); setSelectedFieldId(null); mapRef.current?.replaceFields(next) }
  function deleteField() { setMessage(selectedField?.properties.status === "confirmed" ? "Confirmed fields cannot be deleted individually." : "Candidates belong to the complete partition. Regenerate or cancel the farm instead.") }
  async function importFile(file: File) {
    try { if (file.size > 5_000_000) throw new Error("GeoJSON files must be smaller than 5 MB."); const imported = parseFarmGeoJson(JSON.parse(await file.text()) as unknown, (farms?.length ?? 0) + 1); let nextFarms = [...(farms ?? [])]; let nextFields = [...fields]; for (const farm of imported) { const generated = partitionFarm(farm, farm.properties.partitionCount, farm.properties.partitionMethod); nextFarms = [...nextFarms, withPartitionResult(farm, generated)]; nextFields = [...nextFields, ...generated.fields] } setFarms(nextFarms); setFields(nextFields); mapRef.current?.replaceFields(nextFields); setSelectedFarmId(imported[0]?.properties.id ?? null); const first = nextFields.find(f => f.properties.farmId === imported[0]?.properties.id); if (first) window.setTimeout(() => mapRef.current?.selectField(first), 50); setMessage(t("{count} farms imported and partitioned.", {count:imported.length})) } catch (error) { setMessage(error instanceof Error ? error.message : "GeoJSON could not be imported.") } finally { if (importRef.current) importRef.current.value = "" }
  }
  function exportWorkspace() { if (!farms?.length) return; const data = JSON.stringify({ type: "FeatureCollection", features: [...farms, ...fields] }, null, 2); const url = URL.createObjectURL(new Blob([data], { type: "application/geo+json" })); const link = document.createElement("a"); link.href = url; link.download = "field-shift-farms-and-fields.geojson"; link.click(); URL.revokeObjectURL(url) }
  function setDate(date: string) { if (date) setSettings((current) => ({ ...current, date: date < "2015-03-31" ? "2015-03-31" : date > TODAY ? TODAY : date })) }
  function drawFarm() { mapRef.current?.startFarmDrawing() }
  function openImport() { importRef.current?.click() }
  function selectFarm(farm: FarmFeature) { setSelectedFarmId(farm.properties.id); selectLocal(null) }
  function selectField(field: FieldFeature) { selectLocal(field.properties.id); mapRef.current?.selectField(field) }
  if (farms === null) return <FieldsShell user={owner}><div className="m-auto p-4">{local.error ? <><p role="alert">{t(local.error)}</p><Button onClick={() => void store.start()}>{t("重试读取本机草稿")}</Button></> : <p role="status">{t("正在读取农场…")}</p>}</div></FieldsShell>

  const changeLayer = (id: string, state: LayerState) => setSettings((current) => ({ ...current, layers: { ...current.layers, [id]: state } }))
  const showPartition = selectedFarm?.properties.partitionStatus === "draft"
  function changePartitionCount(count: number) {
    if (!selectedFarm) return
    setFarms((current) => current?.map((farm) => farm.properties.id === selectedFarm.properties.id ? { ...farm, properties: { ...farm.properties, partitionCount: count } } : farm) ?? [])
  }
  const syncPanel = <WorkspaceSyncPanel store={store} restoring={local.restoring} remoteError={local.remoteError} farm={selectedFarm} fields={selectedFarmFields} syncing={Boolean(selectedFarm && local.syncing.includes(selectedFarm.properties.id))} />
  const completion = selectedFarm && selectedField && <FieldCompletionPanel key={selectedField.properties.id} farm={selectedFarm} field={selectedField} ownerId={ownerId} store={store} syncing={local.syncing.includes(selectedFarm.properties.id)} plannerHref={context.navigation.href({ field: selectedField.properties.backendFieldId ?? null }, "/field-shift/rotation")} onDirtyChange={onFormDirty} onSaved={saved => { context.navigation.navigate({ field: saved.id }); client.setQueryData<typeof saved>(["field-shift", ownerId, "field", saved.id], current => current && current.version > saved.version ? current : saved); void client.invalidateQueries({ queryKey: ["field-shift", ownerId, "fields"] }) }} />
  const evidence = <FieldsEvidencePanel context={context} ownerId={ownerId} mapRef={mapRef} onMapInteraction={() => setMobilePanel(null)} />
  return <FieldsShell user={owner} fieldId={selectedField?.properties.backendFieldId} plannerHref={context.navigation.href({}, "/field-shift/rotation")}>
    {unverified && <p role="status" className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-950">{t("请先验证邮箱。此时绘制的内容保留为匿名本机草稿。")}</p>}
    {local.error && <p role="alert" className="border-b bg-red-50 px-4 py-2 text-xs text-red-800">{t(local.error)}</p>}
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-4"><div><h1 className="text-lg font-semibold">{t("Farm partition map")}</h1><p className="hidden text-xs text-muted-foreground sm:block">{t("Draw a farm range, review generated fields, then confirm the complete partition.")}</p></div><div className="flex items-center gap-2"><div className="hidden border p-0.5 sm:flex"><button type="button" onClick={() => setSettings((current) => ({ ...current, basemap: "satellite" }))} className={cn("flex h-8 items-center gap-1 px-3 text-xs", settings.basemap === "satellite" && "bg-foreground text-background")}><Satellite /> {t(" Satellite")}</button><button type="button" onClick={() => setSettings((current) => ({ ...current, basemap: "streets" }))} className={cn("flex h-8 items-center gap-1 px-3 text-xs", settings.basemap === "streets" && "bg-foreground text-background")}><MapIcon /> {t(" Streets")}</button></div><Button type="button" size="sm" onClick={drawFarm} aria-label={t("Add farm")}><Plus /><span className="hidden sm:inline">{t("Add farm")}</span></Button></div></header>
    <main className="relative flex min-h-0 flex-1 overflow-hidden"><aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-r md:flex">{syncPanel}<div className="min-h-64 flex-1"><FarmListPanel farms={farms} fields={fields} selectedFieldId={selectedFieldId} onSelectFarm={selectFarm} onSelectField={selectField} onDraw={drawFarm} onDemo={loadDemo} onImport={openImport} onExport={exportWorkspace} /></div></aside><div className="flex min-w-0 flex-1 flex-col"><div className="relative isolate min-h-0 flex-1"><FieldMap ref={mapRef} selection={context.selection.data} scienceLayer={context.manifest.data} onQuery={context.selectRegion} onCancelQuery={context.cancelSelection} farms={farms} fields={fields} selectedFieldId={selectedFieldId} settings={settings} layers={settings.layers} date={settings.date} basemap={settings.basemap} onFieldsChange={setFields} onFarmCreated={(geometry) => createFarm(geometry)} onSelectField={selectLocal} onViewChange={(view) => setSettings((current) => ({ ...current, ...view }))} onCoordinateChange={setCoordinate} onError={setMessage} />{ownerId && <div className="fields-assistant"><AssistantDock ownerId={ownerId} context={context.context} contextLabel={context.contextLabel} contextPending={context.contextPending} onAction={action => { if (action === "open_planner" || action === "edit_conditions") context.navigation.navigate({ plan: null }, "/field-shift/rotation"); else if (action === "choose_field") showMobilePanel("farms"); else showMobilePanel("layers") }} /></div>}<div className="absolute bottom-3 right-14 z-10 hidden bg-white/90 px-2 py-1 font-mono text-[10px] text-neutral-950 sm:block">{t("Cursor ")}{coordinate[1].toFixed(5)}, {coordinate[0].toFixed(5)} {t(" · z")}{settings.zoom.toFixed(1)}</div><div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1 border bg-white p-1 shadow-lg xl:hidden"><Button type="button" size="sm" variant="ghost" onClick={() => showMobilePanel("farms")}><Pentagon /> {t(" Farms")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => showMobilePanel("layers")}><Layers3 /> {t(" Data")}</Button><Button type="button" size="sm" variant="ghost" disabled={!selectedFarm && !selectedField} onClick={() => showMobilePanel("details")}><Database /> {t(" Details")}</Button></div></div><Timeline date={settings.date} playing={playing} onDate={setDate} onPlaying={setPlaying} /></div><aside className="hidden w-80 shrink-0 overflow-y-auto border-l bg-background xl:block">{showPartition && selectedFarm && <PartitionPanel farm={selectedFarm} fields={selectedFarmFields} busy={partitionBusy} onCount={changePartitionCount} onMethod={changePartitionMethod} onOrientation={changePartitionOrientation} onRegenerate={regenerate} onConfirm={confirmPartition} onCancel={cancelFarm} />}<FieldDetails field={selectedField} observations={observations} onDelete={deleteField} />{mobilePanel !== "details" && completion}{mobilePanel !== "layers" && evidence}<LayersPanel layers={settings.layers} zoom={settings.zoom} onChange={changeLayer} /></aside>
      <Sheet open={Boolean(mobilePanel)} onOpenChange={open => { if (!open) setMobilePanel(null) }}><SheetContent side="bottom" showCloseButton={false} className="fields-app max-h-[80dvh] gap-0 overflow-y-auto bg-background" onCloseAutoFocus={event => { event.preventDefault(); mobileTrigger.current?.focus() }}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background px-4 py-2"><SheetTitle>{mobilePanel === "farms" ? t("农场与同步") : mobilePanel === "details" ? t("地块资料") : t("科学资料与图层")}</SheetTitle><SheetDescription className="sr-only">{t("核对当前农场、地块与科学资料。关闭面板返回地图。")}</SheetDescription><SheetClose asChild><Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t("关闭")}><X aria-hidden="true" /></Button></SheetClose></div>
        {mobilePanel === "farms" && <div>{syncPanel}<div className="h-[30rem]"><FarmListPanel farms={farms} fields={fields} selectedFieldId={selectedFieldId} onSelectFarm={selectFarm} onSelectField={selectField} onDraw={drawFarm} onDemo={loadDemo} onImport={openImport} onExport={exportWorkspace} /></div></div>}{mobilePanel === "layers" && <>{evidence}<LayersPanel layers={settings.layers} zoom={settings.zoom} onChange={changeLayer} /></>}{mobilePanel === "details" && <>{showPartition && selectedFarm && <PartitionPanel farm={selectedFarm} fields={selectedFarmFields} busy={partitionBusy} onCount={changePartitionCount} onMethod={changePartitionMethod} onOrientation={changePartitionOrientation} onRegenerate={regenerate} onConfirm={confirmPartition} onCancel={cancelFarm} />}<FieldDetails field={selectedField} observations={observations} onDelete={deleteField} />{completion}</>}
      </SheetContent></Sheet>
    </main><input ref={importRef} type="file" accept=".geojson,.json,application/geo+json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />{message && <div role="status" className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white"><span>{t(message)}</span><button type="button" onClick={() => setMessage(null)} aria-label={t("Dismiss message")}><X className="size-4" /></button></div>}
  </FieldsShell>
}
