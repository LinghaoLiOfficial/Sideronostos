import { describe, expect, it } from "vitest"

import { buildGibsTileUrl, clampLayerDate, NASA_REMOTE_SENSING_LAYERS, shiftDate } from "@/data/gibs-layers"
import type { GibsLayerConfig } from "@/types/workspace"

describe("GIBS layer configuration", () => {
  const layer: GibsLayerConfig = {
    id: "test-layer",
    title: "Test layer",
    description: "Test layer",
    layerId: "TEST_LAYER",
    format: "png",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    minDate: "2015-03-31",
    maxDate: "today",
    defaultDate: "2024-06-01",
    maxNativeZoom: 6,
    nativeResolutionLabel: "test grid",
    unit: "unit",
    legendUrl: null,
    attribution: "test",
  }

  it("exposes the farm-relevant NASA visualization layers", () => {
    expect(NASA_REMOTE_SENSING_LAYERS.map((layer) => layer.id)).toEqual([
      "modis-true-color",
      "modis-ndvi",
      "modis-evi",
      "imerg-precipitation",
      "smap-day",
      "smap-night",
    ])
  })

  it("uses local assets for every configured legend", () => {
    expect(NASA_REMOTE_SENSING_LAYERS.filter((layer) => layer.legendUrl).every((layer) => layer.legendUrl?.startsWith("/images/"))).toBe(true)
  })

  it("uses one compact attribution for all NASA data sources", () => {
    expect(new Set(NASA_REMOTE_SENSING_LAYERS.map((layer) => layer.attribution))).toEqual(new Set(["NASA Data"]))
  })

  it("builds the EPSG:3857 REST tile template", () => {
    const url = buildGibsTileUrl(layer, "2024-06-01")
    expect(url).toContain("TEST_LAYER/default/2024-06-01/GoogleMapsCompatible_Level6")
    expect(url).toMatch(/\{z\}\/\{y\}\/\{x\}\.png$/)
  })

  it("shifts and clamps daily dates", () => {
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29")
    expect(clampLayerDate("2014-01-01", layer)).toBe("2015-03-31")
  })
})
