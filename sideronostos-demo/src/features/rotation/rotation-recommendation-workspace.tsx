"use client"

import { useState } from "react"
import { NasaRotationWorkspace } from "@/components/rotation/nasa-rotation-workspace"
import { useWorkspaceSession } from "@/components/rotation/use-workspace-session"
import { useOwnedWorkspace } from "@/features/fields/use-owned-workspace"
import { hasSampleFarmData, sortFarmsWithIowaFirst } from "@/features/fields/farm-data-scope"
import { useLocale } from "@/lib/i18n/locale"
import { ApiError } from "@/lib/api/client"
import { FarmSelector } from "./local-knowledge-workspace"

export function RotationRecommendationWorkspace() {
  const { session, ready } = useWorkspaceSession()
  const en = useLocale() === "en"
  if (!ready) return <p role="status">{en ? "Loading farms…" : "正在加载农场…"}</p>
  if (session.error && !(session.error instanceof ApiError && session.error.status === 401)) {
    return <p role="alert">{en ? "Farm workspace is unavailable." : "农场工作区暂不可用。"}</p>
  }
  const ownerId = session.data?.email_verified ? session.data.id : null
  return <OwnedRotationRecommendationWorkspace key={ownerId ?? "anonymous"} ownerId={ownerId} />
}

function OwnedRotationRecommendationWorkspace({ ownerId }: { ownerId: string | null }) {
  const local = useOwnedWorkspace(ownerId, Boolean(ownerId))
  const en = useLocale() === "en"
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null)
  const farms = sortFarmsWithIowaFirst(local.workspace?.farms ?? [])
  const fields = local.workspace?.fields ?? []
  const farm = farms.find(item => item.properties.id === selectedFarmId) ?? farms[0] ?? null
  if (!local.workspace) return <p role="status">{en ? "Loading farms…" : "正在加载农场…"}</p>
  return <main className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
    <FarmSelector farms={farms} fields={fields} selectedFarmId={farm?.properties.id ?? null} onSelect={setSelectedFarmId} en={en} scope={en ? "Rotation recommendation scope" : "轮作推荐范围"} />
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-live="polite">
      {farm && hasSampleFarmData(farm)
        ? <NasaRotationWorkspace key={farm.properties.id} farmId={farm.properties.id} hideHeader hideMap hideReleaseBar compactReleaseBar />
        : <p role="status" className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{farm
          ? (en ? "This farm has no rotation recommendations yet." : "该农场暂无轮作推荐数据。")
          : (en ? "Select a farm to view rotation recommendations." : "请选择农场以查看轮作推荐。")}</p>}
    </section>
  </main>
}
