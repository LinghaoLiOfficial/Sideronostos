"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Register an external map protocol before publishing its source. */
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import { addProtocol, removeProtocol } from "maplibre-gl";
import { Layer, Source } from "react-map-gl/maplibre";
import { apiBlob } from "@/lib/api/client";
import type { LayerManifest } from "@/lib/api/rotation-types";

/** Each retry receives a new protocol, so late tiles cannot enter the new source. */
export function ScienceRaster({ layer }: { layer: LayerManifest }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <RasterAttempt
      key={`${layer.id}:${attempt}`}
      layer={layer}
      retry={() => setAttempt((value) => value + 1)}
    />
  );
}

/** Authenticated tiles stay on the configured API; credentials never go to GIBS/basemaps. */
function RasterAttempt({
  layer,
  retry,
}: {
  layer: LayerManifest;
  retry: () => void;
}) {
  const { t } = useI18n();

  const [protocol] = useState(
    () => `fieldscience${crypto.randomUUID().replaceAll("-", "")}`,
  );
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const pending = new Set<AbortController>();
    addProtocol(protocol, async (request, controller) => {
      if (!active) throw new Error("Science layer was closed");
      const path = request.url.slice(`${protocol}://`.length);
      if (!path.startsWith("/agri-data/layers/"))
        throw new Error("Unexpected science tile path");
      pending.add(controller);
      try {
        const blob = await apiBlob(path, { signal: controller.signal });
        const data = await blob.arrayBuffer();
        if (!active || controller.signal.aborted)
          throw new Error("Science layer was closed or aborted");
        return { data };
      } catch (error) {
        if (active && !controller.signal.aborted) setFailed(true);
        throw error;
      } finally {
        pending.delete(controller);
      }
    });
    setReady(true);
    return () => {
      active = false;
      for (const controller of pending) controller.abort();
      pending.clear();
      removeProtocol(protocol);
    };
  }, [protocol]);
  if (!ready) return null;
  return (
    <>
      <Source
        id="prepared-science"
        type="raster"
        tiles={layer.tiles.map((path) => `${protocol}://${path}`)}
        tileSize={layer.tile_size}
        minzoom={layer.minzoom}
        maxzoom={layer.maxzoom}
        bounds={layer.bounds}
      >
        <Layer
          id="prepared-science-raster"
          type="raster"
          paint={{ "raster-opacity": 0.75, "raster-resampling": "nearest" }}
        />
      </Source>
      {failed && (
        <div
          role="alert"
          className="absolute left-1/2 top-20 z-20 w-[min(90%,24rem)] -translate-x-1/2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 shadow"
        >
          <p>
            {t("科学图层加载失败，地图中的空白不代表没有有效观测。可重试或在科学资料面板关闭此图层。")}</p>
          <button type="button" className="mt-2 underline" onClick={retry}>
            {t("重试科学图层")}</button>
        </div>
      )}
    </>
  );
}
