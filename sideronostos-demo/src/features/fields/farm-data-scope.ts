import { DEMO_FARM_ID } from "@/lib/demo/data"
import type { FarmFeature } from "@/types/workspace"

// The bundled reports and knowledge profile belong to this sample farm only.
export function hasSampleFarmData(farm: FarmFeature) {
  return farm.properties.id === DEMO_FARM_ID
}

export function sortFarmsWithIowaFirst(farms: FarmFeature[]) {
  return [...farms].sort((left, right) => {
    const leftIsIowa = left.properties.id === DEMO_FARM_ID
    const rightIsIowa = right.properties.id === DEMO_FARM_ID
    return Number(rightIsIowa) - Number(leftIsIowa)
  })
}
