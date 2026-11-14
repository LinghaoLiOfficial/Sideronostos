import type { FeatureCollection, Polygon } from "geojson"

export interface NASAAnalysisData {
  period: { start: string; end: string }
  coverage: { expected_days: number; power_days: number; gpm_days_with_full_grid: number; gpm_unique_cells: number }
  annual: Array<{ year: number; tmean_c: number; et0_mm: number; rain_mm: number; rain_minus_et0_mm: number; power_complete: boolean; gpm_complete: boolean }>
  monthly: Array<{ month: string; tmean_c: number; et0_mm: number; rain_mm: number; rain_minus_et0_mm: number }>
  grace: {
    coordinates: { nearest_grid_latitude: number; nearest_grid_longitude: number; effective_mascon_resolution_degrees: number }
    rows: Array<{ date: string; lwe_cm: number | null; uncertainty_cm: number | null }>
  }
  terrain: { min_elevation_m: number; max_elevation_m: number; mean_elevation_m: number; bounds: [number, number, number, number] }
  interpretation_limits: string[]
  gpm_grid: FeatureCollection<Polygon, { mean_annual_rain_mm: number }>
  fields: FeatureCollection<Polygon, { field_id: string; area_ha: number }>
}
