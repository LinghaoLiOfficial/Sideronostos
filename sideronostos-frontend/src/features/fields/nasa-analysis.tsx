"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { NASAAnalysisMap } from "@/features/fields/nasa-analysis-map"
import type { NASAAnalysisData } from "@/features/fields/nasa-analysis-types"

function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, Math.floor(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

function LineChart({ title, points, series, unit, formatDate, uncertaintyKey }: {
  title: string
  points: Array<Record<string, number | string | null>>
  series: Array<{ key: string; label: string; color: string }>
  unit: string
  formatDate: (value: string) => string
  uncertaintyKey?: string
}) {
  const { ref, width } = useChartWidth()
  const height = 260
  const plot = { left: 48, right: width - 12, top: 18, bottom: height - 42 }
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
  const x = (index: number) => plot.left + (points.length <= 1 ? 0 : index / (points.length - 1)) * (plot.right - plot.left)
  const y = (value: number) => plot.bottom - ((value - minimum) / range) * (plot.bottom - plot.top)
  const ticks = [minimum, minimum + range / 2, maximum]
  const labelCount = Math.min(6, points.length)
  const labels = Array.from({ length: labelCount }, (_, index) => Math.round(index * (points.length - 1) / Math.max(labelCount - 1, 1)))
  return <section ref={ref} className="min-w-0 space-y-2" aria-label={title}>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs text-muted-foreground">{unit}</span></div>
    <svg role="img" aria-label={title + ", " + unit} viewBox={"0 0 " + width + " " + height} className="block h-auto w-full overflow-visible">
      <title>{title}</title>
      {ticks.map((value) => <g key={value}><line x1={plot.left} x2={plot.right} y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.14" /><text x={plot.left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.72">{value.toFixed(1)}</text></g>)}
      <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} stroke="currentColor" opacity="0.45" />
      <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke="currentColor" opacity="0.45" />
      {series.map((item) => <g key={item.key}>
        <polyline fill="none" stroke={item.color} strokeWidth="2" points={points.flatMap((point, index) => typeof point[item.key] === "number" ? [x(index) + "," + y(point[item.key] as number)] : []).join(" ")} />
        {points.map((point, index) => {
          const value = point[item.key]
          const uncertainty = uncertaintyKey ? point[uncertaintyKey] : null
          if (typeof value !== "number") return null
          return <g key={item.key + "-" + index}>
            {typeof uncertainty === "number" && <><line x1={x(index)} x2={x(index)} y1={y(value - uncertainty)} y2={y(value + uncertainty)} stroke={item.color} opacity="0.7" /><line x1={x(index) - 3} x2={x(index) + 3} y1={y(value - uncertainty)} y2={y(value - uncertainty)} stroke={item.color} opacity="0.7" /><line x1={x(index) - 3} x2={x(index) + 3} y1={y(value + uncertainty)} y2={y(value + uncertainty)} stroke={item.color} opacity="0.7" /></>}
            <circle cx={x(index)} cy={y(value)} r="2.5" fill={item.color}><title>{String(point.month ?? point.date) + " · " + item.label + ": " + value.toFixed(1) + (typeof uncertainty === "number" ? " ± " + uncertainty.toFixed(1) : "") + " " + unit}</title></circle>
          </g>
        })}
      </g>)}
      {labels.map((index) => <text key={index} x={x(index)} y={height - 14} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.72">{formatDate(String(points[index].month ?? points[index].date ?? ""))}</text>)}
    </svg>
    {series.length > 1 && <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">{series.map((item) => <span key={item.key} className="flex items-center gap-2"><i className="h-0.5 w-4" style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>}
    {uncertaintyKey && <p className="text-xs text-muted-foreground">Vertical bars show reported observation uncertainty.</p>}
  </section>
}

function SummaryStat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="border-b py-3 sm:border-b-0 sm:border-l sm:pl-4 first:sm:border-l-0 first:sm:pl-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>
}

function DataView({ data }: { data: NASAAnalysisData }) {
  const latest = data.annual.at(-1)
  return <div className="h-full overflow-y-auto">
    <div className="mx-auto w-full max-w-[1440px] space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase text-primary">Historical observations · Iowa</p><h2 className="mt-1 text-xl font-semibold">Iowa benchmark summary</h2></div><p className="text-sm text-muted-foreground">{data.period.start} — {data.period.end}</p></div>
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
      <NASAAnalysisMap data={data} />
      <section className="grid gap-8 lg:grid-cols-2">
        <LineChart title="GRACE/GRACE-FO liquid water equivalent anomaly" points={data.grace.rows} series={[{ key: "lwe_cm", label: "Mascon anomaly", color: "#92b9e6" }]} unit="cm LWE" formatDate={(value) => value.slice(2, 7)} uncertaintyKey="uncertainty_cm" />
        <div className="space-y-3 text-sm leading-6"><h2 className="text-base font-semibold">Coverage and interpretation</h2><p className="text-muted-foreground">POWER covers {data.coverage.power_days.toLocaleString()} of {data.coverage.expected_days.toLocaleString()} expected days. GPM has complete daily coverage for {data.coverage.gpm_days_with_full_grid.toLocaleString()} days across {data.coverage.gpm_unique_cells} grid cells.</p><p className="text-muted-foreground">GRACE nearest mascon center: {data.grace.coordinates.nearest_grid_latitude.toFixed(2)}° N, {Math.abs(data.grace.coordinates.nearest_grid_longitude > 180 ? data.grace.coordinates.nearest_grid_longitude - 360 : data.grace.coordinates.nearest_grid_longitude).toFixed(2)}° W; effective support is about {data.grace.coordinates.effective_mascon_resolution_degrees.toFixed(0)}°.</p><ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{data.interpretation_limits.map((limit) => <li key={limit}>{limit}</li>)}</ul></div>
      </section>
      <p className="border-t pt-4 text-xs text-muted-foreground">Sources: NASA POWER, GPM IMERG Final Daily V07, SRTMGL1.003, GRACE/GRACE-FO JPL Mascon. Historical engineering benchmark only; not a future planting recommendation.</p>
    </div>
  </div>
}

export function NASAAnalysis() {
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
  return <DataView data={data} />
}
