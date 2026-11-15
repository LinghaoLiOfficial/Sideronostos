"use client"

import { useI18n } from "@/lib/i18n/provider";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import type { Feature, Geometry as GeoGeometry, Polygon } from "geojson"
import {
  Crosshair,
  Globe2,
  LocateFixed,
  MapPin,
  MousePointer2,
  Pentagon,
  Search,
} from "lucide-react"
import Map, {
  AttributionControl,
  FullscreenControl,
  GeolocateControl,
  Layer,
  NavigationControl,
  ScaleControl,
  Source,
  type MapRef,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre"
import { setWorkerUrl } from "maplibre-gl"
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw"
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter"

import { toFieldFeature } from "./map-feature"
import type { Geometry, LayerManifest, RegionSelection } from "@/lib/api/rotation-types"
import { ScienceRaster } from "./science-raster"
import { Button } from "@/components/ui/button"
import { buildGibsTileUrl, GIBS_LAYERS } from "@/data/gibs-layers"
import { featureBounds, validatePolygon } from "@/features/fields/geometry"
import { synchronizeSharedVertices, validateCandidatePartition } from "@/features/fields/partition"
import { cn } from "@/lib/utils"
import type { FarmFeature, FieldFeature, LayerState, WorkspaceSettings } from "@/types/workspace"

interface SearchResult {
  id: string
  place_name: string
  center: [number, number]
  bbox?: [number, number, number, number]
}

export interface FieldMapHandle {
  startFarmDrawing: () => void
  startSelecting: () => void
  selectField: (field: FieldFeature, fit?: boolean) => void
  deleteSelected: () => void
  replaceFields: (fields: FieldFeature[]) => void
  startQuery: (kind: "point" | "polygon") => void
  queryViewport: () => Promise<boolean>
  resetWorld: () => void
}

interface FieldMapProps {
  selection?: RegionSelection | null
  scienceLayer?: LayerManifest | null
  onCancelQuery?: () => void
  onQuery?: (kind: RegionSelection["kind"], geometry: Geometry) => Promise<boolean>
  farms: FarmFeature[]
  fields: FieldFeature[]
  selectedFieldId: string | null
  settings: WorkspaceSettings
  layers: Record<string, LayerState>
  date: string
  basemap: "satellite" | "streets"
  onFieldsChange: (fields: FieldFeature[]) => void
  onFarmCreated: (geometry: Polygon) => void
  onSelectField: (id: string | null) => void
  onViewChange: (view: Pick<WorkspaceSettings, "longitude" | "latitude" | "zoom">) => void
  onCoordinateChange: (coordinate: [number, number]) => void
  onError: (message: string) => void
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim()
const CUSTOM_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim()
const FALLBACK_STYLE = "https://demotiles.maplibre.org/style.json"

setWorkerUrl("/vendor/maplibre-gl-worker.mjs")

function mapStyleUrl(basemap: "satellite" | "streets") {
  if (CUSTOM_STYLE) return CUSTOM_STYLE
  if (!MAPTILER_KEY) return FALLBACK_STYLE
  const style = basemap === "satellite" ? "hybrid" : "streets-v2"
  return `https://api.maptiler.com/maps/${style}/style.json?key=${MAPTILER_KEY}`
}

function toDrawFeature(field: FieldFeature): GeoJSONStoreFeatures {
  return {
    ...field,
    id: field.properties.id,
    geometry: {
      type: "Polygon",
      coordinates: field.geometry.coordinates.map((ring) =>
        ring.map((coordinate) => coordinate.map((value) => Number(value.toFixed(7)))),
      ),
    },
    properties: { ...field.properties, mode: "polygon" },
  } as unknown as GeoJSONStoreFeatures
}


function SearchBox({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { t } = useI18n();

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!MAPTILER_KEY || query.trim().length < 3) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(
          `https://api.maptiler.com/geocoding/${encodeURIComponent(query.trim())}.json?key=${MAPTILER_KEY}&limit=5`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error("Search unavailable")
        const data = (await response.json()) as { features?: SearchResult[] }
        setResults(data.features ?? [])
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query])

  function choose(result: SearchResult) {
    if (result.bbox) {
      mapRef.current?.fitBounds(
        [[result.bbox[0], result.bbox[1]], [result.bbox[2], result.bbox[3]]],
        { padding: 80, duration: 900 },
      )
    } else {
      mapRef.current?.flyTo({ center: result.center, zoom: 12, duration: 900 })
    }
    setQuery(result.place_name)
    setResults([])
  }

  return (
    <div className="absolute left-3 top-3 z-10 w-[min(22rem,calc(100%-6rem))]">
      <div className="flex h-11 items-center border border-black/10 bg-white shadow-lg">
        <Search className="ml-3 size-4 shrink-0 text-neutral-500" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setResults([])
          }}
          placeholder={MAPTILER_KEY ? t("Search a place or farm") : t("地点搜索暂不可用")}
          disabled={!MAPTILER_KEY}
          aria-label={t("Search places")}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed"
        />
        {loading && <span className="mr-3 size-3 animate-spin rounded-full border-2 border-neutral-300 border-t-primary" />}
      </div>
      {results.length > 0 && (
        <div className="mt-1 overflow-hidden border border-black/10 bg-white shadow-xl">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onClick={() => choose(result)}
              className="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left text-sm text-neutral-800 last:border-b-0 hover:bg-neutral-100"
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="line-clamp-2">{result.place_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const FieldMap = forwardRef<FieldMapHandle, FieldMapProps>(function FieldMap(
  {
    farms,
    selection,
    scienceLayer,
    onQuery,
    onCancelQuery,
    fields,
    selectedFieldId,
    settings,
    layers,
    date,
    basemap,
    onFieldsChange,
    onFarmCreated,
    onSelectField,
    onViewChange,
    onCoordinateChange,
    onError,
  },
  ref,
) {
  const { t } = useI18n();

  const mapRef = useRef<MapRef>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  // MapLibre creates native control DOM outside React. Update only its control
  // labels when the language or control state changes; preserve the drawn map.
  useEffect(() => {
    const container = mapRef.current?.getContainer();
    if (!container) return;
    const updateLabels = () => {
      const labels: [string, string][] = [
        [".maplibregl-ctrl-zoom-in", "Zoom in"],
        [".maplibregl-ctrl-zoom-out", "Zoom out"],
        [".maplibregl-ctrl-fullscreen", "Enter fullscreen"],
        [".maplibregl-ctrl-shrink", "Exit fullscreen"],
        [".maplibregl-ctrl-geolocate", "Find my location"],
        [".maplibregl-ctrl-geolocate:disabled", "Location not available"],
        [".maplibregl-ctrl-attrib-button", "Toggle attribution"],
      ];
      for (const [selector, label] of labels) container.querySelectorAll(selector).forEach(button => {
        button.setAttribute("title", t(label)); button.setAttribute("aria-label", t(label));
      });
      container.querySelector("canvas")?.setAttribute("aria-label", t("Farm map"));
    };
    updateLabels();
    const observer = new MutationObserver(updateLabels);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled"] });
    return () => observer.disconnect();
  }, [t, mapLoaded]);
  const drawRef = useRef<TerraDraw | null>(null)
  const selectedIdRef = useRef<string | null>(selectedFieldId)
  const fieldsRef = useRef(fields)
  const farmsRef = useRef(farms)
  const onFarmCreatedRef = useRef(onFarmCreated)
  const onFieldsChangeRef = useRef(onFieldsChange)
  const onSelectFieldRef = useRef(onSelectField)
  const onErrorRef = useRef(onError)
  const replacingRef = useRef(false)
  const drawingFarmRef = useRef(false)
  const requestedModeRef = useRef<"select" | "polygon" | "static">("select")
  const [drawMode, setDrawMode] = useState<"select" | "polygon">("select")
  const [queryMode, setQueryMode] = useState<"point" | "polygon" | null>(null)
  const queryModeRef = useRef<"point" | "polygon" | null>(null)
  const [queryVertices, setQueryVertices] = useState<[number, number][]>([])
  const [queryBusy, setQueryBusy] = useState(false)
  const queryState = useRef({ active: true, revision: 0, busy: false })
  useEffect(() => { const state = queryState.current; state.active = true; return () => { state.active = false; state.revision++ } }, [])
  function leaveQuery() {
    onCancelQuery?.()
    queryState.current.revision++; queryModeRef.current = null; setQueryMode(null)
    setQueryVertices([]); drawingFarmRef.current = false
    requestedModeRef.current = "select"; drawRef.current?.setMode("select"); setDrawMode("select")
  }
  function startQuery(kind: "point" | "polygon") {
    queryState.current.revision++; queryModeRef.current = kind; setQueryMode(kind); setQueryVertices([])
    drawingFarmRef.current = false; requestedModeRef.current = "static"; drawRef.current?.setMode("static")
  }
  async function finishQuery() {
    if (!onQuery || queryVertices.length < 3 || queryState.current.busy) return
    const geometry: Geometry = { type: "Polygon", coordinates: [[...queryVertices, queryVertices[0]]] }
    const validation = validatePolygon({ type: "Feature", properties: {}, geometry })
    if (!validation.valid) { onError(validation.errors[0]); return }
    const revision = queryState.current.revision
    queryState.current.busy = true; setQueryBusy(true)
    try { const saved = await onQuery("polygon", geometry); if (saved && queryState.current.active && queryState.current.revision === revision) leaveQuery() }
    finally { queryState.current.busy = false; if (queryState.current.active) setQueryBusy(false) }
  }
  const queryGeometry: GeoGeometry | null = queryVertices.length > 2 ? { type: "Polygon", coordinates: [[...queryVertices, queryVertices[0]]] }
    : queryVertices.length > 1 ? { type: "LineString", coordinates: queryVertices } : queryVertices.length ? { type: "Point", coordinates: queryVertices[0] } : null


  useEffect(() => {
    selectedIdRef.current = selectedFieldId
  }, [selectedFieldId])

  useEffect(() => {
    fieldsRef.current = fields
  }, [fields])

  useEffect(() => {
    farmsRef.current = farms
  }, [farms])

  useEffect(() => {
    onFarmCreatedRef.current = onFarmCreated
    onFieldsChangeRef.current = onFieldsChange
    onSelectFieldRef.current = onSelectField
    onErrorRef.current = onError
  }, [onError, onFarmCreated, onFieldsChange, onSelectField])

  function snapshotFields() {
    const snapshot = drawRef.current?.getSnapshot() ?? []
    const next = snapshot
      .map((feature, index) => toFieldFeature(feature, index, fieldsRef.current))
      .filter((field): field is FieldFeature => field !== null)
    onFieldsChange(next)
  }

  const raiseBusinessLayers = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map?.isStyleLoaded()) return
    for (const layerId of [
      "td-polygon",
      "td-polygon-outline",
      "td-linestring",
      "td-point",
      "td-point-marker",
      "farm-boundaries-fill",
      "farm-boundaries-line",
      "query-aoi-fill", "query-aoi-line", "query-aoi-point", "query-draft-fill", "query-draft-line", "query-draft-point",
    ]) {
      if (map.getLayer(layerId)) map.moveLayer(layerId)
    }
  }, [])

  const replaceFields = useCallback((next: FieldFeature[]) => {
    const draw = drawRef.current
    if (!draw) return
    replacingRef.current = true
    draw.clear()
    const results = draw.addFeatures(next.map(toDrawFeature))
    replacingRef.current = false
    window.requestAnimationFrame(raiseBusinessLayers)
    const failure = results.find((result) => !result.valid)
    if (failure) onErrorRef.current(failure.reason ?? "One or more field boundaries could not be rendered.")
  }, [raiseBusinessLayers])

  useImperativeHandle(ref, () => ({
    startFarmDrawing() {
      leaveQuery()
      drawingFarmRef.current = true
      requestedModeRef.current = "polygon"
      drawRef.current?.setMode("polygon")
      setDrawMode("polygon")
    },
    startSelecting() {
      leaveQuery()
      requestedModeRef.current = "select"
      drawRef.current?.setMode("select")
      setDrawMode("select")
    },
    selectField(field, fit = true) {
      leaveQuery()
      const draw = drawRef.current
      if (draw) {
        const hasField = () => draw.getSnapshot().some((feature) => String(feature.id) === field.properties.id)
        if (!hasField()) {
          const next = fieldsRef.current.some((item) => item.properties.id === field.properties.id)
            ? fieldsRef.current
            : [...fieldsRef.current, field]
          replaceFields(next)
        }
        if (hasField()) draw.selectFeature(field.properties.id)
      }
      onSelectField(field.properties.id)
      if (fit) {
        const [west, south, east, north] = featureBounds(field)
        mapRef.current?.fitBounds([[west, south], [east, north]], { padding: 90, maxZoom: 16, duration: 700 })
      }
    },
    deleteSelected() {
      if (!selectedIdRef.current) return
      drawRef.current?.removeFeatures([selectedIdRef.current])
      onSelectField(null)
      snapshotFields()
    },
    replaceFields,
    startQuery,
    async queryViewport() {
      const bounds = mapRef.current?.getBounds()
      if (!bounds || !onQuery) return false
      const w = Math.max(-180, bounds.getWest()), e = Math.min(180, bounds.getEast()), s = Math.max(-85.051129, bounds.getSouth()), n = Math.min(85.051129, bounds.getNorth())
      return onQuery("viewport", { type: "Polygon", coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] })
    },
    resetWorld() {
      mapRef.current?.flyTo({ center: [8, 22], zoom: 1.5, duration: 800 })
    },
  }))

  function handleMapLoad() {
    setMapLoaded(true)
    const map = mapRef.current?.getMap()
    if (!map) return
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 7 }),
      modes: [
        new TerraDrawPolygonMode({
          showCoordinatePoints: true,
          keyEvents: { finish: "Enter", cancel: "Escape" },
          styles: {
            fillColor: (feature) => feature.properties.status === "confirmed" ? "#166534" : "#d97706",
            fillOpacity: 0.18,
            outlineColor: (feature) => feature.properties.status === "confirmed" ? "#166534" : "#d97706",
            outlineWidth: 2,
          },
        }),
        new TerraDrawSelectMode({
          styles: {
            selectedPolygonColor: "#0ea5e9",
            selectedPolygonFillOpacity: 0.2,
            selectedPolygonOutlineColor: "#0284c7",
            selectedPolygonOutlineWidth: 3,
          },
          flags: {
            polygon: {
              feature: {
                draggable: true,
                selfIntersectable: false,
                coordinates: { draggable: true, midpoints: true, deletable: true },
              },
            },
          },
        }),
      ],
    })
    drawRef.current = draw
    draw.start()
    draw.setMode(requestedModeRef.current)
    replaceFields(fields)
    draw.on("finish", (id) => {
      const feature = draw.getSnapshotFeature(id)
      if (!feature || feature.geometry.type !== "Polygon") return
      const validation = validatePolygon(feature as unknown as Feature<Polygon>)
      if (!validation.valid) {
        draw.removeFeatures([id])
        onError(validation.errors[0])
        return
      }
      if (!drawingFarmRef.current) return
      const geometry = feature.geometry as Polygon
      replacingRef.current = true
      draw.removeFeatures([id])
      replacingRef.current = false
      drawingFarmRef.current = false
      requestedModeRef.current = "select"
      draw.setMode("select")
      setDrawMode("select")
      onFarmCreatedRef.current(geometry)
    })
    draw.on("change", (ids, type) => {
      if (replacingRef.current || type === "create" || drawingFarmRef.current || queryModeRef.current) return
      const snapshot = draw.getSnapshot()
        .map((feature, index) => toFieldFeature(feature, index, fieldsRef.current))
        .filter((field): field is FieldFeature => field !== null)
      const changedId = String(ids[0] ?? "")
      const previousChanged = fieldsRef.current.find((field) => field.properties.id === changedId)
      if (previousChanged && JSON.stringify(toDrawFeature(previousChanged).geometry) === JSON.stringify(draw.getSnapshotFeature(changedId)?.geometry)) return
      if (previousChanged?.properties.status === "confirmed") {
        replaceFields(fieldsRef.current)
        onErrorRef.current("Confirmed field boundaries are locked. Create a new draft partition to revise them.")
        return
      }
      const synced = synchronizeSharedVertices(fieldsRef.current, snapshot, changedId).map((field) =>
        field.properties.id === changedId
          ? { ...field, properties: { ...field.properties, boundarySource: "edited" as const, updatedAt: new Date().toISOString() } }
          : field,
      )
      const changed = synced.find((field) => field.properties.id === changedId)
      const farm = farmsRef.current.find((item) => item.properties.id === changed?.properties.farmId)
      const farmFields = farm ? synced.filter((field) => field.properties.farmId === farm.properties.id) : []
      if (farm && !validateCandidatePartition(farm, farmFields).valid) {
        replaceFields(fieldsRef.current)
        onErrorRef.current("That edit would create a gap, overlap, or boundary outside the farm, so it was reverted.")
        return
      }
      fieldsRef.current = synced
      replaceFields(synced)
      onFieldsChangeRef.current(synced)
    })
    draw.on("select", (id) => { if (!replacingRef.current && !queryModeRef.current) onSelectFieldRef.current(String(id)) })
    draw.on("deselect", () => { if (!replacingRef.current && !queryModeRef.current) onSelectFieldRef.current(null) })
  }

  useEffect(() => () => {
    if (drawRef.current?.enabled) drawRef.current.stop()
    drawRef.current = null
  }, [])

  useEffect(() => {
    if (drawRef.current) replaceFields(fields)
  }, [fields, replaceFields])

  useEffect(() => {
    const map = mapRef.current?.getMap()
    const frame = window.requestAnimationFrame(raiseBusinessLayers)
    const onIdle = () => raiseBusinessLayers()
    map?.once("idle", onIdle)
    return () => {
      window.cancelAnimationFrame(frame)
      map?.off("idle", onIdle)
    }
  }, [basemap, date, farms, fields, layers, raiseBusinessLayers])

  function handleMoveEnd(event: ViewStateChangeEvent) {
    onViewChange({
      longitude: event.viewState.longitude,
      latitude: event.viewState.latitude,
      zoom: event.viewState.zoom,
    })
  }

  return (
    <div className="relative size-full overflow-hidden bg-neutral-200" data-testid="field-map">
      <Map
        key={mapStyleUrl(basemap)}
        ref={mapRef}
        initialViewState={{
          longitude: settings.longitude,
          latitude: settings.latitude,
          zoom: settings.zoom,
        }}
        mapStyle={mapStyleUrl(basemap)}
        maxZoom={20}
        minZoom={1}
        renderWorldCopies={false}
        attributionControl={false}
        onLoad={handleMapLoad}
        onClick={event => {
          if (!queryModeRef.current || queryState.current.busy) return
          const point: [number, number] = [event.lngLat.lng, event.lngLat.lat]
          if (queryModeRef.current === "point") void onQuery?.("point", { type: "Point", coordinates: point })
          else setQueryVertices(old => { if (old.length >= 200) { onError(t("临时选区最多 200 个顶点。")); return old } return [...old, point] })
        }}
        onMoveEnd={handleMoveEnd}
        onMouseMove={(event) => onCoordinateChange([event.lngLat.lng, event.lngLat.lat])}
        onError={(event) => {
          const message = event.error?.message ?? "A map resource failed to load."
          if (!message.includes("404")) onError(message)
        }}
      >
        {GIBS_LAYERS.map((layer) => {
          const state = layers[layer.id]
          if (!state?.visible) return null
          const sourceId = `gibs-${layer.id}-${date}`
          return (
            <Source
              key={sourceId}
              id={sourceId}
              type="raster"
              tiles={[buildGibsTileUrl(layer, date)]}
              tileSize={256}
              maxzoom={layer.maxNativeZoom}
              attribution={layer.attribution}
            >
              <Layer
                id={`${sourceId}-layer`}
                type="raster"
                paint={{ "raster-opacity": state.opacity, "raster-fade-duration": 180 }}
              />
            </Source>
          )
        })}
        {scienceLayer && <ScienceRaster key={scienceLayer.id} layer={scienceLayer} />}
        {farms.length > 0 && (
          <Source
            id="farm-boundaries"
            type="geojson"
            data={{ type: "FeatureCollection", features: farms }}
          >
            <Layer
              id="farm-boundaries-fill"
              type="fill"
              paint={{ "fill-color": "#14532d", "fill-opacity": 0.06 }}
            />
            <Layer
              id="farm-boundaries-line"
              type="line"
              paint={{ "line-color": "#14532d", "line-width": 3, "line-dasharray": [3, 2] }}
            />
          </Source>
        )}
        {selection && <QueryShape id="query-aoi" geometry={selection.geometry} />}
        {queryGeometry && <QueryShape id="query-draft" geometry={queryGeometry} />}
        <NavigationControl position="bottom-right" showCompass={false} />
        <GeolocateControl position="bottom-right" trackUserLocation />
        <FullscreenControl position="bottom-right" />
        <ScaleControl position="bottom-left" unit="metric" />
        <AttributionControl position="top-right" compact />
      </Map>

      <SearchBox mapRef={mapRef} />
      {queryMode && <div className="absolute left-3 right-14 top-16 z-20 max-w-sm rounded border bg-background p-3 shadow-lg" role="region" aria-label={t("临时提问选区工具")}><p className="text-sm font-medium">{queryMode === "polygon" ? t("临时提问区域 · {0} 个顶点", { "0": queryVertices.length }) : t("点击地图选择提问位置")}</p><p className="my-1 text-xs">{t("农场与经营地块边界保持锁定。")}</p><div className="flex flex-wrap gap-2">{queryMode === "polygon" && <><Button size="sm" disabled={queryBusy || queryVertices.length < 3} onClick={() => void finishQuery()}>{t("确认提问区域")}</Button><Button size="sm" variant="outline" disabled={queryBusy || !queryVertices.length} onClick={() => setQueryVertices(v => v.slice(0, -1))}>{t("撤回顶点")}</Button></>}<Button size="sm" variant="ghost" disabled={queryBusy} onClick={leaveQuery}>{t("结束提问选区")}</Button></div></div>}


      <div className={cn("absolute left-3 top-16 z-10 flex flex-col gap-1 border border-black/10 bg-white p-1 text-neutral-900 shadow-lg", queryMode && "hidden")}>
        <Button
          type="button"
          size="icon"
          variant={drawMode === "select" ? "default" : "ghost"}
          title={t("Select and edit fields")}
          aria-label={t("Select and edit fields")}
          onClick={() => {
            leaveQuery()
            drawRef.current?.setMode("select")
            requestedModeRef.current = "select"
            setDrawMode("select")
          }}
          className="size-9 rounded-sm"
        >
          <MousePointer2 className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={drawMode === "polygon" ? "default" : "ghost"}
          title={t("Draw farm boundary")}
          aria-label={t("Draw farm boundary")}
          onClick={() => {
            leaveQuery()
            drawingFarmRef.current = true
            requestedModeRef.current = "polygon"
            drawRef.current?.setMode("polygon")
            setDrawMode("polygon")
          }}
          className="size-9 rounded-sm"
        >
          <Pentagon className="size-4" />
        </Button>
        <div className="my-0.5 border-t" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title={t("World view")}
          aria-label={t("World view")}
          onClick={() => mapRef.current?.flyTo({ center: [8, 22], zoom: 1.5, duration: 800 })}
          className="size-9 rounded-sm"
        >
          <Globe2 className="size-4" />
        </Button>
      </div>

      <div className="absolute bottom-20 xl:bottom-8 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-2 border border-black/10 bg-white/95 px-3 py-2 text-xs text-neutral-700 shadow-lg backdrop-blur md:flex">
        {drawMode === "polygon" ? (
          <><Crosshair className="size-4 text-primary" /> {t(" Draw the farm boundary; click the first point to finish")}</>
        ) : (
          <><LocateFixed className="size-4 text-primary" /> {t(" Select a candidate field to inspect or edit shared boundaries")}</>
        )}
      </div>

      {!MAPTILER_KEY && (
        <div className={cn(
          "absolute right-3 top-3 z-10 hidden border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow md:block",
          "max-w-56",
        )}>
          {t("备用底图 · 卫星底图与地点搜索暂不可用，仍可通过边界文件或坐标选区。")}</div>
      )}
    </div>
  )
})

function QueryShape({ id, geometry }: { id: string; geometry: GeoGeometry }) {
  return <Source id={id} type="geojson" data={{ type: "Feature", properties: {}, geometry }}>
    <Layer id={`${id}-fill`} type="fill" filter={["==", ["geometry-type"], "Polygon"]} paint={{ "fill-color": "#7c3aed", "fill-opacity": 0.15 }} />
    <Layer id={`${id}-line`} type="line" filter={["!=", ["geometry-type"], "Point"]} paint={{ "line-color": "#7c3aed", "line-width": 3, "line-dasharray": [2, 2] }} />
    <Layer id={`${id}-point`} type="circle" filter={["==", ["geometry-type"], "Point"]} paint={{ "circle-color": "#7c3aed", "circle-radius": 7, "circle-stroke-color": "#fff", "circle-stroke-width": 2 }} />
  </Source>
}
