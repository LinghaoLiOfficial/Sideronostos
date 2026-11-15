"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiBlob } from "@/lib/api/client";
import * as api from "@/lib/api/rotation";
import type { Field } from "@/lib/api/field-shift-types";
import type { NasaDataRelease } from "@/lib/api/rotation-types";
import styles from "./nasa-rotation.module.css";

type Props = { release: NasaDataRelease; fields: Field[] };

export function NasaReleaseMap({ release, fields }: Props) {
  const [layerId, setLayerId] = useState(release.layers[0]?.id ?? "");
  const [tileError, setTileError] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const manifest = useQuery({
    queryKey: ["nasa-rotation", "layer", release.id, layerId],
    queryFn: () => api.getLayerManifest(`${release.id}:${layerId}`),
    enabled: Boolean(layerId),
  });

  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !element.current) return;
      library.current = L;
      const instance = L.map(element.current, { minZoom: 2, maxZoom: 18 }).fitBounds(
        [[release.bounds[1], release.bounds[0]], [release.bounds[3], release.bounds[2]]],
        { padding: [24, 24], maxZoom: 13 },
      );
      map.current = instance;
      L.tileLayer(process.env.NEXT_PUBLIC_BASEMAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
        noWrap: true,
      }).addTo(instance);
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      const resize = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
      resize.observe(element.current);
      instance.on("unload", () => resize.disconnect());
    }).catch(() => setTileError(true));
    return () => { disposed = true; map.current?.remove(); map.current = null; };
  }, [release.bounds]);

  useEffect(() => {
    const L = library.current, instance = map.current;
    if (!L || !instance) return;
    const group = L.featureGroup().addTo(instance);
    L.rectangle([[release.bounds[1], release.bounds[0]], [release.bounds[3], release.bounds[2]]], {
      color: "#4c7044", weight: 2, dashArray: "5 4", fillOpacity: 0.03,
    }).bindTooltip("NASA release applicability bounds").addTo(group);
    for (const field of fields) {
      const shape = field.geometry?.type === "Polygon"
        ? L.geoJSON(field.geometry, { style: { color: "#fff4b8", weight: 2, fillColor: "#d6b93f", fillOpacity: .28 } })
        : L.circleMarker([field.latitude, field.longitude], { radius: 6, color: "#fff4b8", fillColor: "#d6b93f", fillOpacity: 1 });
      shape.bindTooltip(`${field.name} · ${field.area_ha.toFixed(1)} ha`).addTo(group);
    }
    return () => { group.remove(); };
  }, [fields, release.bounds]);

  useEffect(() => {
    const L = library.current, instance = map.current, value = manifest.data;
    if (!L || !instance || !value) return;
    let removed = false;
    const resources = new Map<HTMLImageElement, { abort: AbortController; url?: string }>();
    setTileError(false);
    const Raster = L.GridLayer.extend({
      createTile(coords: Leaflet.Coords, done: Leaflet.DoneCallback) {
        const tile = document.createElement("img");
        tile.alt = ""; tile.setAttribute("role", "presentation");
        const abort = new AbortController(); resources.set(tile, { abort });
        const path = value.tiles[0].replace("{z}", String(coords.z)).replace("{x}", String(coords.x)).replace("{y}", String(coords.y));
        void apiBlob(path, { signal: abort.signal }).then((blob) => {
          if (removed || abort.signal.aborted) return;
          const url = URL.createObjectURL(blob); resources.set(tile, { abort, url });
          tile.onload = () => done(undefined, tile);
          tile.onerror = () => done(new Error("Scientific tile failed"), tile);
          tile.src = url;
        }).catch((error) => { if (!removed && !abort.signal.aborted) { setTileError(true); done(error instanceof Error ? error : new Error("Scientific tile failed"), tile); } });
        return tile;
      },
    }) as typeof Leaflet.GridLayer;
    const layer = new Raster({ tileSize: value.tile_size, minZoom: value.minzoom, maxNativeZoom: value.maxzoom, maxZoom: 18, opacity: .68, noWrap: true });
    layer.on("tileunload", (event: Leaflet.TileEvent) => {
      const tile = event.tile as HTMLImageElement, item = resources.get(tile);
      item?.abort.abort(); if (item?.url) URL.revokeObjectURL(item.url); resources.delete(tile);
    });
    layer.addTo(instance);
    return () => { removed = true; layer.remove(); for (const item of resources.values()) { item.abort.abort(); if (item.url) URL.revokeObjectURL(item.url); } resources.clear(); };
  }, [manifest.data]);

  const selected = release.layers.find((layer) => layer.id === layerId);
  return <section className={styles.mapSection} aria-labelledby="release-map-heading">
    <div className={styles.mapHeader}><div><h2 id="release-map-heading">NASA release 图层</h2><p>本地图只读取已发布的本地 COG，不在浏览器中请求 NASA。</p></div><label>图层<select value={layerId} onChange={(event) => setLayerId(event.target.value)} disabled={!release.layers.length}>{release.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.id}</option>)}</select></label></div>
    <div className={styles.mapCanvas} ref={element} role="region" aria-label="NASA 数据图层与 Iowa benchmark 地块" />
    {selected && <div className={styles.layerMeta}><span>{selected.product.toUpperCase()}</span><span>{selected.unit}</span><span>{selected.time ?? `${release.start} — ${release.end}`}</span><span>{selected.spatial_support ?? selected.native_resolution ?? selected.resolution ?? "见 release manifest"}</span></div>}
    {manifest.data && <div className={styles.legend}><div style={{ background: `linear-gradient(to right, ${manifest.data.legend.colors.join(",")})` }} /><span>{manifest.data.legend.min}</span><span>{manifest.data.legend.max}</span></div>}
    {(tileError || manifest.isError) && <p className={styles.error} role="alert">科学图层未能加载；空白表示缺测、未覆盖或本地资源不可用，不能解释为数值为零。</p>}
    <p className={styles.mapLimit}>可视化重采样不会提高原生信息尺度。GPM、SMAP 和 GRACE 是区域背景，不代表田块内精细测量。</p>
  </section>;
}
