import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MapRef } from "react-map-gl/maplibre";
import type { RegionSelection } from "@/lib/api/rotation-types";
import { createDemoFarm } from "./demo-data";
import { useMapFocus } from "./use-map-focus";
afterEach(cleanup);
const point = {
  id: "aoi",
  revision: 1,
  geometry: { type: "Point", coordinates: [-96.67, 43.86] },
} as RegionSelection;
function setup() {
  const map = { fitBounds: vi.fn(), easeTo: vi.fn(), getZoom: () => 4 };
  return { map, ref: { current: { getMap: () => map } as unknown as MapRef } };
}
it("focuses the restored AOI instead of letting late field data pull the viewport away", () => {
  const { map, ref } = setup(),
    { fields } = createDemoFarm();
  const { rerender } = renderHook(
    ({ readyFields }) =>
      useMapFocus(ref, readyFields, fields[0].properties.id, point),
    { initialProps: { readyFields: [] as typeof fields } },
  );
  expect(map.easeTo).toHaveBeenCalledWith(
    expect.objectContaining({ center: [-96.67, 43.86], zoom: 8 }),
  );
  rerender({ readyFields: fields });
  expect(map.fitBounds).not.toHaveBeenCalled();
  expect(map.easeTo).toHaveBeenCalledTimes(1);
});
it("restores a polygon when the map loads and returns to the same field after clearing it", () => {
  const { map, ref } = setup(),
    { fields } = createDemoFarm();
  const ready = ref.current;
  ref.current = null as unknown as MapRef;
  const polygon = {
    id: "polygon",
    revision: 2,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-100, 40],
          [-99, 40],
          [-99, 41],
          [-100, 41],
          [-100, 40],
        ],
      ],
    },
  } as RegionSelection;
  const { result, rerender } = renderHook(
    ({ selection }) =>
      useMapFocus(ref, fields, fields[0].properties.id, selection),
    { initialProps: { selection: polygon as RegionSelection | null } },
  );
  expect(map.fitBounds).not.toHaveBeenCalled();
  ref.current = ready;
  act(() => result.current());
  expect(map.fitBounds).toHaveBeenLastCalledWith(
    [
      [-100, 40],
      [-99, 41],
    ],
    expect.objectContaining({ maxZoom: 12 }),
  );
  rerender({ selection: null });
  expect(map.fitBounds).toHaveBeenCalledTimes(2);
  expect(map.fitBounds).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ maxZoom: 16 }),
  );
});
