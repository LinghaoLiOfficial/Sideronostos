"use client"
/* eslint-disable react-hooks/set-state-in-effect -- Reconcile owned deep links with asynchronously restored farm identities. */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useMemo, useRef, useState } from "react"
import type { Polygon } from "geojson"
import { CalendarDays, ChevronLeft, ChevronRight, Database, Download, Eye, EyeOff, FileUp, Layers3, Pentagon, Pause, Play, Plus, Trash2, X } from "lucide-react"

import { ApiError, type AuthUser } from "@/lib/api/client"
import { useWorkspaceSession } from "@/components/rotation/use-workspace-session"
import { useFieldsContext } from "./use-fields-context"
import { useOwnedWorkspace } from "./use-owned-workspace"
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { NASA_REMOTE_SENSING_LAYERS, shiftDate, toIsoDate } from "@/data/gibs-layers"
import { createDemoObservations } from "@/features/fields/demo-data"
import { DEMO_FARM_ID } from "@/lib/demo/data"
import { sortFarmsWithIowaFirst } from "@/features/fields/farm-data-scope"
import { createFarmFeature, featureAreaHectares, featureCentroid, parseFarmGeoJson } from "@/features/fields/geometry"
import { FieldMap, type FieldMapHandle } from "@/features/fields/field-map"
import { FieldsShell } from "@/features/fields/fields-shell"
import { PartitionConfirmationPanel } from "./partition-confirmation-panel"
import { partitionFarm, validateCandidatePartition, type PartitionResult } from "@/features/fields/partition"
import { deleteStoredFarm, putObservations } from "@/features/fields/storage"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { FarmFeature, FieldFeature, FieldObservation, LayerState, WorkspaceSettings } from "@/types/workspace"

const SETTINGS_KEY = "field-shift.workspace.v1"
const TODAY = toIsoDate(new Date())
const DEFAULT_DATE = TODAY < "2026-11-06" ? TODAY : "2026-11-06"
const defaultSettings: WorkspaceSettings = { version: 1, longitude: 8, latitude: 22, zoom: 1.5, basemap: "satellite", date: DEFAULT_DATE, layers: {} }

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
  onImport: () => void
  onExport: () => void
  onRequestDelete: (farm: FarmFeature) => void
}

function FarmListPanel({ farms, fields, selectedFieldId, onSelectFarm, onSelectField, onDraw, onImport, onExport, onRequestDelete }: ListProps) {
  const { t } = useI18n();
  return <TooltipProvider><section className="si-cream-surface flex h-full min-h-0 flex-col bg-background" aria-labelledby="farms-title">
    <div className="border-b px-4 py-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">{t("Farm workspace")}</p><h2 id="farms-title" className="text-base font-semibold">{t("Farms")}</h2></div><span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">{farms.length}</span></div><Button type="button" onClick={onDraw} className="mt-4 w-full"><Plus />{t("Add farm")}</Button><div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant="outline" size="sm" onClick={onImport}><FileUp />{t("Import")}</Button><Button type="button" variant="outline" size="sm" onClick={onExport} disabled={!farms.length}><Download />{t("Export")}</Button></div></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{farms.length === 0 ? <div className="mx-2 mt-4 border border-dashed p-4 text-center"><Pentagon className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{t("No farm boundary yet")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("Draw the complete farm range. The system will generate candidate fields inside it.")}</p></div> : farms.map((farm) => { const children = fields.filter((field) => field.properties.farmId === farm.properties.id).sort((a, b) => a.properties.partitionIndex - b.properties.partitionIndex); return <div key={farm.properties.id} className="mb-2 border"><div className="flex items-stretch bg-muted/60"><button type="button" onClick={() => onSelectFarm(farm)} className="flex min-w-0 flex-1 items-center justify-between gap-2 bg-transparent px-3 py-3 text-left"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{farm.properties.name}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{formatArea(featureAreaHectares(farm))} · {children.length} {t("fields")}</span></span></button><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" aria-label={t("Delete {name}", { name: farm.properties.name })} onClick={() => onRequestDelete(farm)} className="flex h-auto min-h-full w-14 shrink-0 self-stretch items-center justify-center rounded-none bg-transparent p-0 text-destructive hover:bg-muted/60"><Trash2 /></Button></TooltipTrigger><TooltipContent>{t("Delete farm")}</TooltipContent></Tooltip></div><div className="divide-y">{children.map((field) => <button key={field.properties.id} type="button" onClick={() => onSelectField(field)} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs", selectedFieldId === field.properties.id ? "bg-accent" : "hover:bg-muted/50")}><span className="flex min-w-0 items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full", field.properties.status === "confirmed" ? "bg-emerald-600" : "bg-amber-500")} /><span className="truncate">{field.properties.name}</span></span><span className="text-muted-foreground">{formatArea(featureAreaHectares(field))}</span></button>)}</div></div> })}</div>
  </section></TooltipProvider>
}

function FieldDetails({ field, observations }: { field: FieldFeature | null; observations: FieldObservation[] }) {
  const { t } = useI18n();

  if (!field) return <section className="border-b px-4 py-6 text-center"><p className="text-sm font-medium">{t("Select a field")}</p><p className="mt-1 text-xs text-muted-foreground">{t("Candidate geometry or confirmed evidence will appear here.")}</p></section>
  const [lng, lat] = featureCentroid(field); const confirmed = field.properties.status === "confirmed"
  return <section className="border-b"><div className="px-4 py-4"><div><p className="text-sm font-semibold leading-5">{t("Selected field")}</p><h2 className="mt-1 text-sm font-medium text-foreground">{field.properties.name}</h2></div><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-muted-foreground">{t("Area")}</dt><dd className="mt-1">{formatArea(featureAreaHectares(field))}</dd></div><div><dt className="text-muted-foreground">{t("Centroid")}</dt><dd className="mt-1 font-mono text-[11px]">{lat.toFixed(5)}, {lng.toFixed(5)}</dd></div></dl></div>{confirmed && observations.length > 0 ? <div className="border-t px-4 py-4"><div><h3 className="text-sm font-semibold leading-5">{t("Field indicators")}</h3></div><div className="mt-3 space-y-3">{observations.map((item) => <div key={item.id} className="border-l-2 border-primary pl-3"><div className="flex justify-between gap-2 text-xs"><span className="text-muted-foreground">{item.metric}</span><strong>{item.value} {item.unit}</strong></div><p className="mt-1 text-[10px] text-muted-foreground">{item.sourceProduct} · {item.spatialSupport === "regional-background" ? "regional background" : `${item.nativeResolutionMeters} m support`}</p></div>)}</div></div> : null}</section>
}

function LayersPanel({ layers, onChange }: { layers: Record<string, LayerState>; onChange: (id: string, state: LayerState) => void }) {
  const { t } = useI18n();

  return <section><div className="border-b px-4 py-4"><p className="text-sm font-semibold leading-5">{t("Visualization")}</p><h2 className="mt-1 text-sm font-medium text-muted-foreground">{t("NASA remote-sensing layers")}</h2></div>{NASA_REMOTE_SENSING_LAYERS.map((layer) => { const state = layers[layer.id] ?? { visible: false, opacity: 0.7 }; return <div key={layer.id} className="border-b px-4 py-4"><div className="flex gap-3"><button type="button" aria-label={t(state.visible ? "Hide {layer}" : "Show {layer}", {layer:t(layer.title)})} onClick={() => onChange(layer.id, { ...state, visible: !state.visible })}>{state.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</button><div className="min-w-0 flex-1"><p className="text-sm font-medium">{t(layer.title)}</p><p className="mt-1 text-xs text-muted-foreground">{t(layer.nativeResolutionLabel)}</p></div></div>{state.visible && <div className="mt-3 pl-7">{layer.legendUrl && <img src={layer.legendUrl} alt={t("{layer} legend", {layer:t(layer.title)})} className="w-full border bg-white p-1" />}<label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">{t("Opacity")}<input type="range" min="0.1" max="1" step="0.05" value={state.opacity} onChange={(event) => onChange(layer.id, { ...state, opacity: Number(event.target.value) })} className="min-w-0 flex-1 accent-primary" /></label></div>}</div> })}</section>
}

function Timeline({ date, playing, onDate, onPlaying }: { date: string; playing: boolean; onDate: (date: string) => void; onPlaying: (value: boolean) => void }) {
  const { t } = useI18n();

  return <div className="flex h-[72px] shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-sidebar-foreground"><Button type="button" size="icon" variant="ghost" onClick={() => onPlaying(!playing)} aria-label={t(playing ? "Pause timeline" : "Play timeline")}>{playing ? <Pause /> : <Play />}</Button><Button type="button" size="icon" variant="ghost" onClick={() => onDate(shiftDate(date, -1))} aria-label={t("Previous display date")} className="hidden sm:inline-flex"><ChevronLeft /></Button><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{t("Display date")}</p><input aria-label={t("Display date timeline")} type="range" min={new Date("2015-03-31T12:00:00Z").getTime()} max={new Date(`${TODAY}T12:00:00Z`).getTime()} step={86_400_000} value={new Date(`${date}T12:00:00Z`).getTime()} onChange={(event) => onDate(toIsoDate(new Date(Number(event.target.value))))} className="mt-2 w-full accent-primary" /></div><Button type="button" size="icon" variant="ghost" onClick={() => onDate(shiftDate(date, 1))} aria-label={t("Next display date")} disabled={date >= TODAY} className="hidden sm:inline-flex"><ChevronRight /></Button><label className="flex h-10 items-center gap-2 border border-border px-2 text-xs"><CalendarDays className="hidden size-4 sm:block" /><input aria-label={t("Display date")} type="date" min="2015-03-31" max={TODAY} value={date} onChange={(event) => onDate(event.target.value)} className="w-[7.2rem] bg-transparent [color-scheme:dark]" /></label></div>
}

export function FieldsWorkspace({ embedded = false, remote = false }: { embedded?: boolean; remote?: boolean }) {
  const { t } = useI18n();

  const { session, ready } = useWorkspaceSession()
  if (!ready) return <FieldsShell embedded={embedded}><p className="m-auto" role="status">{t("正在确认登录状态…")}</p></FieldsShell>
  if (session.error && !(session.error instanceof ApiError && session.error.status === 401)) return <FieldsShell embedded={embedded}><div className="m-auto p-6" role="alert"><p>{t("登录状态暂时无法确认，请重试。")}</p><Button onClick={() => void session.refetch()}>{t("重新连接")}</Button></div></FieldsShell>
  const user = session.data?.email_verified ? session.data : null
  if (remote && !user) return <FieldsShell embedded={embedded}><div className="m-auto flex max-w-lg flex-col items-start gap-3 p-6"><p role="status">{t("登录并验证邮箱后可使用账号田地工作区。")}</p><Button asChild><a href={`/login?next=${encodeURIComponent("/si/field-management")}`}>{t("登录")}</a></Button></div></FieldsShell>
  return <OwnedFieldsWorkspace key={user?.id ?? "anonymous"} owner={user} unverified={Boolean(session.data && !session.data.email_verified)} embedded={embedded} remote={remote} />
}

function OwnedFieldsWorkspace({ owner, unverified, embedded, remote }: { owner: AuthUser | null; unverified: boolean; embedded: boolean; remote: boolean }) {
  const { t } = useI18n();

  const ownerId = owner?.id ?? null
  const local = useOwnedWorkspace(ownerId, remote), { store } = local
  const [settings, setSettings] = useState(() => loadSettings(ownerId))
  const farms = local.workspace ? sortFarmsWithIowaFirst(local.workspace.farms) : null, fields = local.workspace?.fields ?? []
  function setFarms(value: FarmFeature[] | ((current: FarmFeature[] | null) => FarmFeature[])) { store.update(w => ({ ...w, farms: typeof value === "function" ? value(w.farms) : value })) }
  function setFields(value: FieldFeature[]) { store.update(w => ({ ...w, fields: value })) }
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [coordinate, setCoordinate] = useState<[number, number]>([settings.longitude, settings.latitude])
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [farmToDelete, setFarmToDelete] = useState<FarmFeature | null>(null)
  const [farmDeleteError, setFarmDeleteError] = useState<string | null>(null)
  const [deletingFarm, setDeletingFarm] = useState(false)
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
  const context = useFieldsContext(ownerId, selectedField, false)
  const requestedField = context.navigation.search.get("field")
  useEffect(() => {
    if (!requestedField || !local.workspace) return
    const found = local.workspace.fields.find(f => f.properties.backendFieldId === requestedField)
    if (found) { setSelectedFarmId(found.properties.farmId); setSelectedFieldId(found.properties.id) }
  }, [requestedField, local.workspace])
  function selectLocal(id: string | null) {
    const next = fields.find(f => f.properties.id === id)
    setSelectedFieldId(id)
    if (next) setSelectedFarmId(next.properties.farmId)
    context.navigation.navigate({ field: next?.properties.backendFieldId ?? null, run: null, option: null, plan: null, compare: null, compareOption: null })
  }

  const observations = useMemo(() => selectedField?.properties.status === "confirmed" && selectedFarm?.properties.id === DEMO_FARM_ID ? createDemoObservations(selectedField, settings.date) : [], [selectedField, selectedFarm, settings.date])
  useEffect(() => { if (observations.length) putObservations(observations, ownerId).catch(() => undefined) }, [observations, ownerId])

  function installFarm(farm: FarmFeature, nextFields: FieldFeature[]) {
    const allFields = [...fields, ...nextFields]
    setFarms((current) => [...(current ?? []), farm]); setFields(allFields); setSelectedFarmId(farm.properties.id); setSelectedFieldId(nextFields[0]?.properties.id ?? null)
    window.setTimeout(() => { mapRef.current?.replaceFields(allFields); if (nextFields[0]) mapRef.current?.selectField(nextFields[0]) }, 50)
  }
  function createFarm(geometry: Polygon, source: "drawn" | "imported" | "synthetic" = "drawn", name?: string) {
    try { const farm = createFarmFeature(geometry, source, (farms?.length ?? 0) + 1); if (name) farm.properties.name = name; const result = partitionFarm(farm, 4); installFarm(withPartitionResult(farm, result), result.fields); setMessage(t("{count} candidate fields generated. Review them before confirming.", {count:result.fields.length})) } catch (error) { setMessage(error instanceof Error ? error.message : "Candidates could not be generated.") }
  }
  function confirmPartition() {
    if (!selectedFarm) return
    const farmFields = fields.filter(field => field.properties.farmId === selectedFarm.properties.id)
    const validation = validateCandidatePartition(selectedFarm, farmFields)
    if (!validation.valid) { setMessage(validation.errors.map(error => t(error)).join(" ")); return }
    const updatedAt = new Date().toISOString()
    store.update(workspace => ({
      farms: workspace.farms.map(farm => farm.properties.id !== selectedFarm.properties.id ? farm : {
        ...farm, properties: { ...farm.properties, partitionStatus: "confirmed", updatedAt },
      }),
      fields: workspace.fields.map(field => field.properties.farmId !== selectedFarm.properties.id ? field : {
        ...field, properties: { ...field.properties, status: "confirmed", farmerConfirmed: true, updatedAt },
      }),
    }))
    setMessage(t("Field boundaries confirmed."))
  }
  function requestFarmDeletion(farm: FarmFeature) {
    if (farm.properties.backendFarmId) {
      setMessage("Synced farm deletion is not available here yet. The account copy remains intact.")
      return
    }
    setFarmToDelete(farm)
  }
  async function confirmFarmDeletion() {
    if (!farmToDelete || !farms || deletingFarm) return
    const farmId = farmToDelete.properties.id
    const deletedFieldCount = fields.filter((field) => field.properties.farmId === farmId).length
    setDeletingFarm(true)
    setFarmDeleteError(null)
    try {
      await deleteStoredFarm(farmId, ownerId)
      const nextFarms = farms.filter((farm) => farm.properties.id !== farmId)
      const nextFields = fields.filter((field) => field.properties.farmId !== farmId)
      setFarms(nextFarms)
      setFields(nextFields)
      mapRef.current?.replaceFields(nextFields)
      if (selectedFarmId === farmId || fields.some((field) => field.properties.id === selectedFieldId && field.properties.farmId === farmId)) {
        setSelectedFarmId(null)
        setSelectedFieldId(null)
      }
      setFarmToDelete(null)
      setMessage(`${farmToDelete.properties.name} and its ${deletedFieldCount} field${deletedFieldCount === 1 ? "" : "s"} were deleted.`)
    } catch {
      setFarmDeleteError("Farm data could not be deleted. Nothing was changed; please try again.")
    } finally {
      setDeletingFarm(false)
    }
  }
  async function importFile(file: File) {
    try { if (file.size > 5_000_000) throw new Error("GeoJSON files must be smaller than 5 MB."); const imported = parseFarmGeoJson(JSON.parse(await file.text()) as unknown, (farms?.length ?? 0) + 1); let nextFarms = [...(farms ?? [])]; let nextFields = [...fields]; for (const farm of imported) { const generated = partitionFarm(farm, farm.properties.partitionCount, farm.properties.partitionMethod); nextFarms = [...nextFarms, withPartitionResult(farm, generated)]; nextFields = [...nextFields, ...generated.fields] } setFarms(nextFarms); setFields(nextFields); mapRef.current?.replaceFields(nextFields); setSelectedFarmId(imported[0]?.properties.id ?? null); const first = nextFields.find(f => f.properties.farmId === imported[0]?.properties.id); if (first) window.setTimeout(() => mapRef.current?.selectField(first), 50); setMessage(t("{count} farms imported and partitioned.", {count:imported.length})) } catch (error) { setMessage(error instanceof Error ? error.message : "GeoJSON could not be imported.") } finally { if (importRef.current) importRef.current.value = "" }
  }
  function exportWorkspace() { if (!farms?.length) return; const data = JSON.stringify({ type: "FeatureCollection", features: [...farms, ...fields] }, null, 2); const url = URL.createObjectURL(new Blob([data], { type: "application/geo+json" })); const link = document.createElement("a"); link.href = url; link.download = "field-shift-farms-and-fields.geojson"; link.click(); URL.revokeObjectURL(url) }
  function setDate(date: string) { if (date) setSettings((current) => ({ ...current, date: date < "2015-03-31" ? "2015-03-31" : date > TODAY ? TODAY : date })) }
  function drawFarm() { mapRef.current?.startFarmDrawing() }
  function openImport() { importRef.current?.click() }
  function selectFarm(farm: FarmFeature) { setSelectedFarmId(farm.properties.id); selectLocal(null) }
  function selectField(field: FieldFeature) { selectLocal(field.properties.id); mapRef.current?.selectField(field) }
  if (farms === null) return <FieldsShell user={owner} embedded={embedded}><div className="m-auto p-4">{local.error ? <><p role="alert">{t(local.error)}</p><Button onClick={() => void store.start()}>{t("重试读取本机草稿")}</Button></> : <p role="status">{t("正在读取农场…")}</p>}</div></FieldsShell>

  const changeLayer = (id: string, state: LayerState) => setSettings((current) => ({
    ...current,
    layers: Object.fromEntries(Object.entries({ ...current.layers, [id]: state }).map(([layerId, layerState]) => [
      layerId,
      layerId === id ? layerState : { ...layerState, visible: state.visible ? false : layerState.visible },
    ])),
  }))
  return <FieldsShell user={owner} fieldId={selectedField?.properties.backendFieldId} plannerHref={context.navigation.href({}, "/field-shift/rotation")} embedded={embedded}>
    {unverified && <p role="status" className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-950">{t("请先验证邮箱。此时绘制的内容保留为匿名本机草稿。")}</p>}
    {local.error && <p role="alert" className="border-b bg-red-50 px-4 py-2 text-xs text-red-800">{local.error}</p>}
    <>
    <main className="relative flex min-h-0 flex-1 overflow-hidden"><aside className="si-cream-surface hidden w-72 shrink-0 flex-col overflow-y-auto border-r md:flex"><div className="min-h-64 flex-1"><FarmListPanel farms={farms} fields={fields} selectedFieldId={selectedFieldId} onSelectFarm={selectFarm} onSelectField={selectField} onDraw={drawFarm} onImport={openImport} onExport={exportWorkspace} onRequestDelete={requestFarmDeletion} /></div></aside><div className="flex min-w-0 flex-1 flex-col"><div className="relative isolate min-h-0 flex-1"><FieldMap ref={mapRef} selection={context.selection.data} scienceLayer={context.manifest.data} onQuery={context.selectRegion} onCancelQuery={context.cancelSelection} farms={farms} fields={fields} selectedFieldId={selectedFieldId} settings={settings} layers={settings.layers} date={settings.date} basemap={settings.basemap} onFieldsChange={setFields} onFarmCreated={(geometry) => createFarm(geometry)} onSelectField={selectLocal} onViewChange={(view) => setSettings((current) => ({ ...current, ...view }))} onCoordinateChange={setCoordinate} onError={setMessage} /><div className="absolute bottom-3 right-14 z-10 hidden bg-[var(--si-cream)] px-2 py-1 font-mono text-[10px] text-[var(--si-cream-foreground)] sm:block">{t("Cursor")} {coordinate[1].toFixed(5)}, {coordinate[0].toFixed(5)} {t("· z")}{settings.zoom.toFixed(1)}</div><div className="si-cream-surface absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1 border bg-background p-1 shadow-lg xl:hidden"><Button type="button" size="sm" variant="ghost" onClick={() => showMobilePanel("farms")}><Pentagon />{t("Farms")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => showMobilePanel("layers")}><Layers3 />{t("Data")}</Button><Button type="button" size="sm" variant="ghost" disabled={!selectedFarm && !selectedField} onClick={() => showMobilePanel("details")}><Database />{t("Field details")}</Button></div></div><Timeline date={settings.date} playing={playing} onDate={setDate} onPlaying={setPlaying} /></div><aside className="si-cream-surface hidden w-80 shrink-0 overflow-y-auto border-l bg-background xl:block"><PartitionConfirmationPanel farm={selectedFarm} fields={fields} onConfirm={confirmPartition} /><FieldDetails field={selectedField} observations={observations} /><LayersPanel layers={settings.layers} onChange={changeLayer} /></aside>
      <Sheet open={Boolean(mobilePanel)} onOpenChange={open => { if (!open) setMobilePanel(null) }}><SheetContent side="bottom" showCloseButton={false} className="fields-app si-cream-surface max-h-[80dvh] gap-0 overflow-y-auto bg-background" onCloseAutoFocus={event => { event.preventDefault(); mobileTrigger.current?.focus() }}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background px-4 py-2"><SheetTitle>{t(mobilePanel === "farms" ? "农场与同步" : mobilePanel === "details" ? "地块资料" : "科学资料与图层")}</SheetTitle><SheetDescription className="sr-only">{t("核对当前农场、地块与科学资料。关闭面板返回地图。")}</SheetDescription><SheetClose asChild><Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t("关闭")}><X aria-hidden="true" /></Button></SheetClose></div>
        {mobilePanel === "farms" && <div><div className="h-[30rem]"><FarmListPanel farms={farms} fields={fields} selectedFieldId={selectedFieldId} onSelectFarm={selectFarm} onSelectField={selectField} onDraw={drawFarm} onImport={openImport} onExport={exportWorkspace} onRequestDelete={requestFarmDeletion} /></div></div>}{mobilePanel === "layers" && <LayersPanel layers={settings.layers} onChange={changeLayer} />}{mobilePanel === "details" && <><PartitionConfirmationPanel farm={selectedFarm} fields={fields} onConfirm={confirmPartition} /><FieldDetails field={selectedField} observations={observations} /></>}
      </SheetContent></Sheet>
    </main></><input ref={importRef} type="file" accept=".geojson,.json,application/geo+json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />{message && <div role="status" className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 border border-border bg-sidebar px-4 py-3 text-sm text-sidebar-foreground"><span>{message}</span><button type="button" onClick={() => setMessage(null)} aria-label={t("Dismiss message")}><X className="size-4" /></button></div>}
      <Dialog open={farmToDelete !== null} onOpenChange={(open) => { if (!open && !deletingFarm) { setFarmToDelete(null); setFarmDeleteError(null) } }}><DialogContent showCloseButton={!deletingFarm}><DialogHeader><DialogTitle>{t("Delete farm?")}</DialogTitle><DialogDescription>{t("This permanently deletes")} <strong>{farmToDelete?.properties.name}</strong>{t(", its")} {fields.filter((field) => field.properties.farmId === farmToDelete?.properties.id).length} {t("associated fields, and their observations. This action cannot be undone.")}</DialogDescription></DialogHeader>{farmDeleteError && <p role="alert" className="text-sm text-destructive">{farmDeleteError}</p>}<DialogFooter><Button type="button" variant="outline" disabled={deletingFarm} onClick={() => setFarmToDelete(null)}>{t("Cancel")}</Button><Button type="button" variant="destructive" disabled={deletingFarm} onClick={() => void confirmFarmDeletion()}><Trash2 />{t(deletingFarm ? "Deleting…" : "Delete farm")}</Button></DialogFooter></DialogContent></Dialog>
  </FieldsShell>
}
