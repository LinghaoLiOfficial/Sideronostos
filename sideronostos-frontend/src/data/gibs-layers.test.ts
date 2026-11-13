import { describe, expect, it } from "vitest"

import { buildGibsTileUrl, clampLayerDate, GIBS_LAYERS, shiftDate } from "@/data/gibs-layers"

describe("GIBS layer configuration", () => {
  it("builds the EPSG:3857 REST tile template", () => {
    const url = buildGibsTileUrl(GIBS_LAYERS[0], "2024-06-01")
    expect(url).toContain("SMAP_L3_Passive_Day_Soil_Moisture/default/2024-06-01/GoogleMapsCompatible_Level6")
    expect(url).toMatch(/\{z\}\/\{y\}\/\{x\}\.png$/)
  })

  it("shifts and clamps daily dates", () => {
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29")
    expect(clampLayerDate("2014-01-01", GIBS_LAYERS[0])).toBe("2015-03-31")
  })
})
