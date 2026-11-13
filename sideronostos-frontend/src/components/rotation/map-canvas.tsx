"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Check,
  Crosshair,
  LocateFixed,
  Pentagon,
  Undo2,
  X,
} from "lucide-react";
import { apiBlob } from "@/lib/api/client";
import type { Field } from "@/lib/api/field-shift-types";
import type {
  Geometry,
  LayerManifest,
  RegionSelection,
} from "@/lib/api/rotation-types";
import styles from "./rotation.module.css";

type Props = {
  fields: Field[];
  selectedField?: Field;
  selection: RegionSelection | null;
  layer: LayerManifest | null;
  onSelect: (
    kind: RegionSelection["kind"],
    geometry: Geometry,
  ) => Promise<boolean>;
  onField: (field: Field) => void;
};
export function MapCanvas(props: Props) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<Leaflet.Map | null>(null),
    library = useRef<typeof Leaflet | null>(null);
  const current = useRef(props);
  const mounted = useRef(true),
    polygonBusy = useRef(false);
  const [savingPolygon, setSavingPolygon] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    current.current = props;
  }, [props]);
  const [ready, setReady] = useState(false),
    [mode, setMode] = useState<"point" | "polygon">("point"),
    [vertices, setVertices] = useState<[number, number][]>([]);
  const modeRef = useRef(mode);
  useLayoutEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [longitude, setLongitude] = useState("-93.5"),
    [latitude, setLatitude] = useState("42");
  const [mapError, setMapError] = useState<string | null>(null),
    [tileError, setTileError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void import("leaflet")
      .then((L) => {
        if (disposed || !element.current) return;
        library.current = L;
        const instance = L.map(element.current, {
          zoomControl: false,
          attributionControl: false,
          minZoom: 2,
          maxZoom: 18,
          worldCopyJump: false,
        }).setView([42, -93.5], 7);
        map.current = instance;
        L.control.zoom({ position: "bottomleft" }).addTo(instance);
        L.control
          .attribution({ position: "bottomleft", prefix: false })
          .addTo(instance);
        const base = L.tileLayer(
          process.env.NEXT_PUBLIC_BASEMAP_TILE_URL ??
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18,
            noWrap: true,
          },
        );
        base.on("tileerror", () => {
          if (!disposed) setMapError("底图暂时无法加载，仍可用坐标选择位置。");
        });
        base.addTo(instance);
        instance.on("click", (event: Leaflet.LeafletMouseEvent) => {
          if (polygonBusy.current) return;
          const lon = Math.max(-180, Math.min(180, event.latlng.lng)),
            lat = event.latlng.lat;
          setLongitude(lon.toFixed(6));
          setLatitude(lat.toFixed(6));
          if (modeRef.current === "polygon")
            setVertices((old) =>
              old.length < 200 ? [...old, [lon, lat]] : old,
            );
          else
            current.current.onSelect("point", {
              type: "Point",
              coordinates: [lon, lat],
            });
        });
        const resize = new ResizeObserver(() =>
          instance.invalidateSize({ pan: false }),
        );
        resize.observe(element.current);
        instance.on("unload", () => resize.disconnect());
        setReady(true);
      })
      .catch(() => {
        if (!disposed)
          setMapError("地图未能加载，请稍后重试；坐标选区仍可使用。");
      });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const L = library.current,
      instance = map.current;
    if (!ready || !L || !instance) return;
    const group = L.featureGroup().addTo(instance);
    for (const field of props.fields) {
      const label = document.createElement("span");
      label.textContent = field.name;
      const selected = field.id === props.selectedField?.id;
      const point = L.circleMarker([field.latitude, field.longitude], {
        radius: selected ? 9 : 6,
        color: selected ? "#294f31" : "#fff",
        weight: 2,
        fillColor: selected ? "#c7ed9a" : "#556a49",
        fillOpacity: 1,
      });
      const boundary =
        field.geometry?.type === "Polygon"
          ? L.geoJSON(field.geometry, {
              style: {
                color: "#567647",
                weight: selected ? 3 : 1.5,
                fillOpacity: 0.12,
              },
            })
          : point;
      boundary
        .bindTooltip(label, { direction: "top" })
        .on("click", (e: Leaflet.LeafletMouseEvent) => {
          if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
          current.current.onField(field);
        })
        .addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [props.fields, props.selectedField?.id, ready]);
  useEffect(() => {
    // A restored geographic query owns the viewport even if the field list
    // arrives later. Clearing the query returns focus to the operating field.
    if (ready && props.selectedField && !props.selection)
      map.current?.setView(
        [props.selectedField.latitude, props.selectedField.longitude],
        11,
        { animate: false },
      );
  }, [props.selectedField, props.selection, ready]);
  useEffect(() => {
    const L = library.current,
      instance = map.current;
    if (!ready || !L || !instance || !props.selection) return;
    const geometry = props.selection.geometry;
    const selected =
      geometry.type === "Point"
        ? L.circleMarker([geometry.coordinates[1], geometry.coordinates[0]], {
            radius: 10,
            color: "#7962ce",
            weight: 3,
            fillOpacity: 0.16,
          })
        : L.geoJSON(geometry, {
            style: {
              color: "#7962ce",
              weight: 2,
              fillOpacity: 0.12,
              dashArray: "5 4",
            },
          });
    selected.addTo(instance);
    // Restore the queried location as well as its outline after a reload.
    // The query can be separate from the selected operating field.
    if (geometry.type === "Point") {
      instance.setView(
        [geometry.coordinates[1], geometry.coordinates[0]],
        Math.max(instance.getZoom(), 8),
        { animate: false },
      );
    } else {
      const bounds = L.geoJSON(geometry).getBounds();
      if (bounds.isValid())
        instance.fitBounds(bounds, {
          padding: [36, 36],
          maxZoom: 12,
          animate: false,
        });
    }
    return () => {
      selected.remove();
    };
  }, [props.selection, ready]);
  useEffect(() => {
    const L = library.current,
      instance = map.current;
    if (!ready || !L || !instance || !vertices.length) return;
    const group = L.featureGroup().addTo(instance),
      latlngs = vertices.map(([lon, lat]) => [lat, lon] as [number, number]);
    L.polyline(latlngs, {
      color: "#7962ce",
      weight: 2,
      dashArray: "4 5",
    }).addTo(group);
    for (const point of latlngs)
      L.circleMarker(point, {
        radius: 4,
        color: "#7962ce",
        fillOpacity: 1,
      }).addTo(group);
    return () => {
      group.remove();
    };
  }, [vertices, ready]);
  useEffect(() => {
    const L = library.current,
      instance = map.current,
      manifest = props.layer;
    if (!ready || !L || !instance || !manifest) return;
    let removed = false;
    const resources = new Map<
      HTMLImageElement,
      { abort: AbortController; url?: string }
    >();
    setTileError(false);
    const Raster = L.GridLayer.extend({
      createTile(coords: Leaflet.Coords, done: Leaflet.DoneCallback) {
        const tile = document.createElement("img");
        tile.alt = "";
        tile.setAttribute("role", "presentation");
        tile.style.imageRendering = "pixelated";
        const abort = new AbortController();
        resources.set(tile, { abort });
        const path = manifest.tiles[0]
          .replace("{z}", String(coords.z))
          .replace("{x}", String(coords.x))
          .replace("{y}", String(coords.y));
        void apiBlob(path, { signal: abort.signal })
          .then((blob) => {
            if (removed || abort.signal.aborted) return;
            const url = URL.createObjectURL(blob);
            resources.set(tile, { abort, url });
            tile.onload = () => done(undefined, tile);
            tile.onerror = () =>
              done(new Error("Scientific tile failed"), tile);
            tile.src = url;
          })
          .catch((error) => {
            if (!removed && !abort.signal.aborted) {
              setTileError(true);
              done(
                error instanceof Error
                  ? error
                  : new Error("Scientific tile failed"),
                tile,
              );
            }
          });
        return tile;
      },
    }) as typeof Leaflet.GridLayer;
    const layer = new Raster({
      tileSize: manifest.tile_size,
      minZoom: manifest.minzoom,
      maxNativeZoom: manifest.maxzoom,
      maxZoom: 18,
      opacity: 0.65,
      noWrap: true,
    });
    layer.on("tileunload", (event: Leaflet.TileEvent) => {
      const tile = event.tile as HTMLImageElement,
        item = resources.get(tile);
      item?.abort.abort();
      if (item?.url) URL.revokeObjectURL(item.url);
      resources.delete(tile);
    });
    layer.addTo(instance);
    return () => {
      removed = true;
      layer.remove();
      for (const item of resources.values()) {
        item.abort.abort();
        if (item.url) URL.revokeObjectURL(item.url);
      }
      resources.clear();
    };
  }, [props.layer, ready]);
  function coordinates(event: FormEvent) {
    event.preventDefault();
    if (polygonBusy.current) return;
    const lon = Number(longitude),
      lat = Number(latitude);
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90
    )
      return;
    map.current?.setView([lat, lon], 8, { animate: false });
    if (mode === "polygon")
      setVertices((old) => (old.length < 200 ? [...old, [lon, lat]] : old));
    else props.onSelect("point", { type: "Point", coordinates: [lon, lat] });
  }
  async function finishPolygon() {
    if (vertices.length < 3 || polygonBusy.current) return;
    polygonBusy.current = true;
    setSavingPolygon(true);
    try {
      const accepted = await props.onSelect("polygon", {
        type: "Polygon",
        coordinates: [[...vertices, vertices[0]]],
      });
      if (mounted.current && accepted) {
        setVertices([]);
        setMode("point");
      }
    } finally {
      polygonBusy.current = false;
      if (mounted.current) setSavingPolygon(false);
    }
  }
  function useViewport() {
    const bounds = map.current?.getBounds();
    if (!bounds) return;
    props.onSelect("viewport", {
      type: "Polygon",
      coordinates: [
        [
          [bounds.getWest(), bounds.getSouth()],
          [bounds.getEast(), bounds.getSouth()],
          [bounds.getEast(), bounds.getNorth()],
          [bounds.getWest(), bounds.getNorth()],
          [bounds.getWest(), bounds.getSouth()],
        ],
      ],
    });
  }
  return (
    <>
      <div
        className={styles.mapCanvas}
        ref={element}
        aria-label="农田地图"
        role="region"
      />
      <div className={styles.mapTools}>
        <div className={styles.toolRow}>
          <button
            type="button"
            disabled={savingPolygon}
            aria-pressed={mode === "point"}
            onClick={() => {
              setMode("point");
              setVertices([]);
            }}
          >
            <Crosshair size={16} />
            选点
          </button>
          <button
            type="button"
            disabled={savingPolygon}
            aria-pressed={mode === "polygon"}
            onClick={() => setMode("polygon")}
          >
            <Pentagon size={16} />
            画区域
          </button>
          <button
            type="button"
            disabled={!ready || savingPolygon}
            onClick={useViewport}
          >
            <LocateFixed size={16} />
            采用当前视野
          </button>
        </div>
        {mode === "polygon" && (
          <div className={styles.drawingTools}>
            <p>依次点击边界位置，至少三个顶点。{vertices.length} / 200</p>
            <button
              type="button"
              disabled={savingPolygon || !vertices.length}
              onClick={() => setVertices((old) => old.slice(0, -1))}
            >
              <Undo2 size={15} />
              撤回
            </button>
            <button
              type="button"
              disabled={savingPolygon || vertices.length < 3}
              onClick={finishPolygon}
            >
              <Check size={15} />
              {savingPolygon ? "正在核对区域…" : "完成区域"}
            </button>
            <button
              type="button"
              disabled={savingPolygon}
              onClick={() => {
                setVertices([]);
                setMode("point");
              }}
            >
              <X size={15} />
              取消
            </button>
          </div>
        )}
        <details className={styles.coordinateTools}>
          <summary>用坐标定位</summary>
          <form onSubmit={coordinates}>
            <label>
              经度
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                required
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
              />
            </label>
            <label>
              纬度
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                required
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
              />
            </label>
            <button type="submit" disabled={savingPolygon}>
              {mode === "polygon" ? "加入顶点" : "选择位置"}
            </button>
          </form>
        </details>
        {mapError && (
          <p className={styles.mapWarning} role="status">
            {mapError}
          </p>
        )}
        {tileError && (
          <p className={styles.mapWarning} role="status">
            部分科学图层未能加载，空白不能视为无水分。
          </p>
        )}
      </div>
      {props.layer && (
        <div className={styles.mapLegend}>
          <strong>表层土壤水分 · {props.layer.pass}</strong>
          <span>{props.layer.start.slice(0, 10)} · m³/m³</span>
          <div
            style={{
              background: `linear-gradient(to right,${props.layer.legend.colors.join(",")})`,
            }}
          />
          <p>
            <span>{props.layer.legend.min}</span>
            <span>{props.layer.legend.max}</span>
          </p>
          <small>
            原生格网显示 · 空白为缺测或未覆盖
            <br />
            区域背景，不能看作地块实测
          </small>
        </div>
      )}
    </>
  );
}
