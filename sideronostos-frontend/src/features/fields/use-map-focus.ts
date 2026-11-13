"use client";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { RegionSelection } from "@/lib/api/rotation-types";
import type { FieldFeature } from "@/types/workspace";
import { featureBounds } from "./geometry";

export function useMapFocus(
  mapRef: RefObject<MapRef | null>,
  fields: FieldFeature[],
  fieldId: string | null,
  selection: RegionSelection | null | undefined,
) {
  const current = useRef({ fields, fieldId, selection }),
    focused = useRef<string | null>(null);
  const focus = useCallback(() => {
    const { fieldId, fields, selection } = current.current;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (selection) {
      const key = `aoi:${selection.id}:${selection.revision}`;
      if (focused.current === key) return;
      if (selection.geometry.type === "Point") {
        map.easeTo({
          center: selection.geometry.coordinates,
          zoom: Math.max(map.getZoom(), 8),
          duration: 700,
        });
      } else {
        const ring = selection.geometry.coordinates[0];
        const xs = ring.map((point) => point[0]),
          ys = ring.map((point) => point[1]);
        map.fitBounds(
          [
            [Math.min(...xs), Math.min(...ys)],
            [Math.max(...xs), Math.max(...ys)],
          ],
          { padding: 60, maxZoom: 12, duration: 700 },
        );
      }
      focused.current = key;
      return;
    }
    if (!fieldId) {
      focused.current = null;
      return;
    }
    const field = fields.find((item) => item.properties.id === fieldId);
    if (!field || focused.current === `field:${fieldId}`) return;
    const [west, south, east, north] = featureBounds(field);
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 90, maxZoom: 16, duration: 700 },
    );
    focused.current = `field:${fieldId}`;
  }, [mapRef]);
  useEffect(() => {
    current.current = { fields, fieldId, selection };
    focus();
  }, [fields, fieldId, selection, focus]);
  return focus;
}
