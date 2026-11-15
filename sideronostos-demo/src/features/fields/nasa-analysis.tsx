"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, MapPin, Pentagon, RefreshCw } from "lucide-react"
import { CartesianGrid, ErrorBar, Line, LineChart as RechartsLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/client"
import { useWorkspaceSession } from "@/components/rotation/use-workspace-session"
import { featureAreaHectares, featureCentroid } from "@/features/fields/geometry"
import type { NASAAnalysisData } from "@/features/fields/nasa-analysis-types"
import { useOwnedWorkspace } from "@/features/fields/use-owned-workspace"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/locale"
import { hasSampleFarmData, sortFarmsWithIowaFirst } from "./farm-data-scope"
import type { FarmFeature, FieldFeature } from "@/types/workspace"

function LineChart({ title, points, series, unit, formatDate, uncertaintyKey }: {
  title: string
  points: Array<Record<string, number | string | null>>
  series: Array<{ key: string; label: string; color: string }>
  unit: string
  formatDate: (value: string) => string
  uncertaintyKey?: string
}) {
  const values = points.flatMap((point) => series.flatMap((item) => {
    const value = point[item.key]
    const uncertainty = uncertaintyKey ? point[uncertaintyKey] : null
    if (typeof value !== "number" || !Number.isFinite(value)) return []
    return typeof uncertainty === "number" && Number.isFinite(uncertainty)
      ? [value - uncertainty, value + uncertainty]
      : [value]
  }))
  if (!points.length || !values.length) return <section><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 text-sm text-muted-foreground">No valid observations in this period.</p></section>
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = maximum - minimum || 1
  const dateKey = "month" in points[0] ? "month" : "date"
  return <section className="min-w-0 space-y-2" aria-label={title}>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs text-muted-foreground">{unit}</span></div>
    <div className="h-[260px] min-w-0" role="img" aria-label={title + ", " + unit}>
      <ResponsiveContainer width="100%" height="100%" minWidth={300} minHeight={220}>
        <RechartsLineChart data={points} margin={{ top: 12, right: 12, bottom: 6, left: 4 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.14} />
          <XAxis dataKey={dateKey} tickFormatter={(value) => formatDate(String(value))} minTickGap={24} tick={{ fontSize: 11 }} axisLine={{ stroke: "currentColor", strokeOpacity: 0.4 }} tickLine={false} />
          <YAxis domain={[minimum - range * 0.05, maximum + range * 0.05]} tickFormatter={(value) => Number(value).toFixed(1)} width={48} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0].payload as Record<string, number | string | null>
              return <div className="border border-border bg-background px-3 py-2 text-xs shadow-md">
                <p className="mb-1 font-medium">{formatDate(String(label ?? ""))}</p>
                {payload.map((entry) => {
                  const value = typeof entry.value === "number" ? entry.value : Number(entry.value)
                  const uncertainty = uncertaintyKey ? point[uncertaintyKey] : null
                  return <p key={String(entry.dataKey)} className="tabular-nums" style={{ color: entry.color }}>
                    {String(entry.name)}: {value.toFixed(2)} {unit}
                    {typeof uncertainty === "number" ? ` ± ${uncertainty.toFixed(2)} ${unit}` : ""}
                  </p>
                })}
              </div>
            }}
          />
          {series.map((item) => <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2} connectNulls={false} dot={{ r: 3, fill: item.color }} activeDot={{ r: 5 }}>
            {uncertaintyKey ? <ErrorBar dataKey={uncertaintyKey} direction="y" width={4} stroke={item.color} /> : null}
          </Line>)}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
    {series.length > 1 && <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">{series.map((item) => <span key={item.key} className="flex items-center gap-2"><i className="h-0.5 w-4" style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>}
    {uncertaintyKey && <p className="text-xs text-muted-foreground">Vertical bars show reported observation uncertainty.</p>}
  </section>
}

function SummaryStat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="border-b py-3 sm:border-b-0 sm:border-l sm:pl-4 first:sm:border-l-0 first:sm:pl-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>
}

function formatArea(value: number) {
  return value < 1 ? `${Math.round(value * 10_000).toLocaleString()} m²` : `${value.toFixed(value < 100 ? 2 : 0)} ha`
}

function DataView({ data, farm, fieldCount = 0 }: { data: NASAAnalysisData; farm?: FarmFeature; fieldCount?: number }) {
  const latest = data.annual.at(-1)
  const center = farm ? featureCentroid(farm) : null
  return <div className="h-full overflow-y-auto">
    <div className="si-cream-surface min-h-full w-full space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase text-muted-foreground">{farm ? `Selected farm · ${farm.properties.name}` : "Historical observations · Iowa"}</p><h2 className="mt-1 text-xl font-semibold">{farm ? `${farm.properties.name} remote sensing report` : "Iowa benchmark summary"}</h2></div><p className="text-sm text-muted-foreground">{data.period.start} — {data.period.end}</p></div>
        {farm && center ? <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-y py-3 text-xs text-muted-foreground" aria-label="Selected farm context"><span>{formatArea(featureAreaHectares(farm))}</span><span>{fieldCount} {fieldCount === 1 ? "field" : "fields"}</span><span>{center[1].toFixed(4)}, {center[0].toFixed(4)}</span><span>Iowa historical benchmark</span></div> : null}
        <div className="mt-5 grid gap-x-5 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryStat label="GPM precipitation · 2024" value={(latest?.rain_mm.toFixed(0) ?? "—") + " mm"} note="Annual accumulation · IMERG daily" />
          <SummaryStat label="POWER reference ET₀ · 2024" value={(latest?.et0_mm.toFixed(0) ?? "—") + " mm"} note="Daily estimates summed by year" />
          <SummaryStat label="Mean air temperature · 2024" value={(latest?.tmean_c.toFixed(1) ?? "—") + "°C"} note="POWER point-support daily mean" />
          <SummaryStat label="SRTM mean elevation" value={data.terrain.mean_elevation_m.toFixed(0) + " m"} note={data.terrain.min_elevation_m.toFixed(0) + "–" + data.terrain.max_elevation_m.toFixed(0) + " m in AOI"} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-xs">
            <caption className="sr-only">Annual NASA weather summary</caption>
            <thead className="border-b text-muted-foreground"><tr><th className="py-2 pr-4 font-medium">Year</th><th className="py-2 pr-4 text-right font-medium">GPM rain (mm)</th><th className="py-2 pr-4 text-right font-medium">POWER ET₀ (mm)</th><th className="py-2 pr-4 text-right font-medium">Mean temp (°C)</th><th className="py-2 text-right font-medium">Daily coverage</th></tr></thead>
            <tbody>{data.annual.map((row) => <tr key={row.year} className="border-b"><th scope="row" className="py-2 pr-4 font-medium">{row.year}</th><td className="py-2 pr-4 text-right tabular-nums">{row.rain_mm.toFixed(1)}</td><td className="py-2 pr-4 text-right tabular-nums">{row.et0_mm.toFixed(1)}</td><td className="py-2 pr-4 text-right tabular-nums">{row.tmean_c.toFixed(1)}</td><td className="py-2 text-right">{row.gpm_complete && row.power_complete ? "Complete" : "Incomplete"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <div><p className="text-xs text-muted-foreground">Monthly aggregates</p><h2 className="text-base font-semibold">Weather and water balance context</h2></div>
        <div className="grid gap-8 lg:grid-cols-2">
          <LineChart title="Precipitation and reference ET₀" points={data.monthly} series={[{ key: "rain_mm", label: "GPM precipitation", color: "#78c9c1" }, { key: "et0_mm", label: "POWER reference ET₀", color: "#e7c77b" }]} unit="mm / month" formatDate={(value) => value.slice(2)} />
          <LineChart title="Mean air temperature" points={data.monthly} series={[{ key: "tmean_c", label: "POWER monthly mean", color: "#d8a386" }]} unit="°C" formatDate={(value) => value.slice(2)} />
        </div>
        <p className="max-w-4xl text-xs leading-5 text-muted-foreground">Precipitation minus reference ET₀ is a regional climatic indicator, not crop water stress or irrigation demand. POWER is point support and is not interpolated to a raster.</p>
      </section>
      <section className="grid gap-8 lg:grid-cols-2">
        <LineChart title="GRACE/GRACE-FO liquid water equivalent anomaly" points={data.grace.rows} series={[{ key: "lwe_cm", label: "Mascon anomaly", color: "#92b9e6" }]} unit="cm LWE" formatDate={(value) => value.slice(2, 7)} uncertaintyKey="uncertainty_cm" />
        <div className="space-y-3 text-sm leading-6"><h2 className="text-base font-semibold">Coverage and interpretation</h2><p className="text-muted-foreground">POWER covers {data.coverage.power_days.toLocaleString()} of {data.coverage.expected_days.toLocaleString()} expected days. GPM has complete daily coverage for {data.coverage.gpm_days_with_full_grid.toLocaleString()} days across {data.coverage.gpm_unique_cells} grid cells.</p><p className="text-muted-foreground">GRACE nearest mascon center: {data.grace.coordinates.nearest_grid_latitude.toFixed(2)}° N, {Math.abs(data.grace.coordinates.nearest_grid_longitude > 180 ? data.grace.coordinates.nearest_grid_longitude - 360 : data.grace.coordinates.nearest_grid_longitude).toFixed(2)}° W; effective support is about {data.grace.coordinates.effective_mascon_resolution_degrees.toFixed(0)}°.</p><ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{data.interpretation_limits.map((limit) => <li key={limit}>{limit}</li>)}</ul></div>
      </section>
      <p className="border-t pt-4 text-xs text-muted-foreground">Sources: NASA POWER, GPM IMERG Final Daily V07, SRTMGL1.003, GRACE/GRACE-FO JPL Mascon. Historical Iowa engineering benchmark shown in the context of the selected farm; not a farm-specific live observation or future planting recommendation.</p>
    </div>
  </div>
}

export function NASAAnalysis({ farm, fieldCount }: { farm?: FarmFeature; fieldCount?: number } = {}) {
  const [data, setData] = useState<NASAAnalysisData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/nasa-analysis", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as NASAAnalysisData | { error?: string }
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "NASA analysis could not be loaded.")
        setData(body as NASAAnalysisData)
        setError(null)
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "NASA analysis could not be loaded.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [retry])
  if (loading) return <div className="flex flex-1 items-center justify-center" role="status">Loading NASA analysis…</div>
  if (error || !data) return <div className="m-auto flex max-w-xl flex-col items-start gap-3 px-6 py-10" role="alert"><AlertTriangle className="size-5 text-amber-500" /><h2 className="text-base font-semibold">NASA analysis is unavailable</h2><p className="text-sm text-muted-foreground">{error ?? "No analysis data is available."}</p><Button type="button" variant="outline" onClick={() => { setLoading(true); setRetry((value) => value + 1) }}><RefreshCw /> Retry</Button></div>
  return <DataView data={data} farm={farm} fieldCount={fieldCount} />
}

function FarmSelector({ farms, fields, selectedFarmId, onSelect }: {
  farms: FarmFeature[]
  fields: FieldFeature[]
  selectedFarmId: string | null
  onSelect: (farmId: string) => void
}) {
  return <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-sidebar-border bg-[var(--site-black-overlay)] text-sidebar-foreground md:w-[clamp(16rem,18vw,22rem)] md:border-b-0 md:border-r" aria-labelledby="remote-sensing-farms-title">
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-5"><div><p className="text-xs text-muted-foreground">Remote sensing scope</p><h2 id="remote-sensing-farms-title" className="mt-0.5 text-lg font-semibold tracking-tight">Farms</h2></div><span className="rounded-full bg-sidebar-accent px-2.5 py-1 text-xs font-semibold">{farms.length}</span></div>
    <div className="flex max-h-[min(34vh,20rem)] min-h-0 gap-1 overflow-y-auto overscroll-contain p-3 md:flex-1 md:max-h-none md:flex-col">
      {farms.length ? farms.map((farm) => {
        const count = fields.filter((field) => field.properties.farmId === farm.properties.id).length
        const selected = farm.properties.id === selectedFarmId
        return <button key={farm.properties.id} type="button" aria-pressed={selected} onClick={() => onSelect(farm.properties.id)} className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary", selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/70")}>
          <MapPin className="size-4 shrink-0" /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{farm.properties.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{formatArea(featureAreaHectares(farm))} · {count} {count === 1 ? "field" : "fields"}</span></span>
        </button>
      }) : <div className="m-1 border border-dashed border-sidebar-border p-4 text-center"><Pentagon className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No farms available</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Add or restore a farm in Field management first.</p></div>}
    </div>
  </aside>
}

function OwnedRemoteSensingWorkspace({ ownerId }: { ownerId: string | null }) {
  const en = useLocale() === "en"
  const local = useOwnedWorkspace(ownerId, Boolean(ownerId))
  const farms = sortFarmsWithIowaFirst(local.workspace?.farms ?? [])
  const fields = local.workspace?.fields ?? []
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null)
  const selectedFarm = farms.find((farm) => farm.properties.id === selectedFarmId) ?? farms[0] ?? null
  const selectedFields = selectedFarm ? fields.filter((field) => field.properties.farmId === selectedFarm.properties.id) : []

  if (!local.workspace) return <div className="flex flex-1 items-center justify-center" role="status">Loading farms…</div>
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
    <FarmSelector farms={farms} fields={fields} selectedFarmId={selectedFarm?.properties.id ?? null} onSelect={setSelectedFarmId} />
    <section className="min-h-0 min-w-0 flex-1" aria-live="polite">
      {selectedFarm ? hasSampleFarmData(selectedFarm) ? <NASAAnalysis key={selectedFarm.properties.id} farm={selectedFarm} fieldCount={selectedFields.length} /> : <p role="status" className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{en ? "This farm has no remote sensing analysis data yet." : "该农场暂无遥感分析数据。"}</p> : <div className="flex h-full items-center justify-center px-6 text-center"><div><Pentagon className="mx-auto size-6 text-muted-foreground" /><h2 className="mt-3 text-base font-semibold">Select a farm to view its report</h2><p className="mt-1 text-sm text-muted-foreground">Farm reports appear here after a farm is available in Field management.</p></div></div>}
    </section>
  </div>
}

export function RemoteSensingWorkspace() {
  const { session, ready } = useWorkspaceSession()
  if (!ready) return <div className="flex flex-1 items-center justify-center" role="status">Checking farm workspace…</div>
  if (session.error && !(session.error instanceof ApiError && session.error.status === 401)) return <div className="m-auto max-w-lg px-6 py-10" role="alert"><h2 className="text-base font-semibold">Farm workspace is unavailable</h2><p className="mt-2 text-sm text-muted-foreground">The account could not be loaded. Please retry after the connection is restored.</p></div>
  const ownerId = session.data?.email_verified ? session.data.id : null
  return <OwnedRemoteSensingWorkspace key={ownerId ?? "anonymous"} ownerId={ownerId} />
}
