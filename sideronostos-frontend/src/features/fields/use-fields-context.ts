"use client"
import { useI18n } from "@/lib/i18n/provider"
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/rotation"
import type { Geometry, RegionSelection } from "@/lib/api/rotation-types"
import type { FieldFeature } from "@/types/workspace"
import { buildAssistantContext } from "@/components/rotation/assistant-context"
import { allOptions } from "@/components/rotation/results"
import { observationWindow } from "@/components/rotation/workspace-state"
import { useScienceQueries } from "@/components/rotation/use-science-queries"
import { useWorkspaceNavigation } from "@/components/rotation/use-workspace-navigation"

export function useFieldsContext(ownerId: string | null, field: FieldFeature | null, formDirty: boolean) {
  const { t } = useI18n();
  const navigation = useWorkspaceNavigation("/fields"), { search } = navigation, client = useQueryClient()
  const window = observationWindow(search.get("obsStart"), search.get("obsEnd"))
  const science = useScienceQueries(ownerId, search.get("selection"), search.get("layer") ?? "", window.dates)
  const runId = search.get("run"), planId = search.get("plan")
  const run = useQuery({ queryKey: ["rotation", ownerId, "run", runId], queryFn: () => api.getRun(runId!), enabled: Boolean(ownerId && runId), retry: false,
    refetchInterval: q => ["pending", "running"].includes(q.state.data?.status ?? "") ? 1800 : false })
  const saved = useQuery({ queryKey: ["rotation", ownerId, "plan", planId], queryFn: () => api.getRotationPlan(planId!), enabled: Boolean(ownerId && planId), retry: false })
  const hasRun = Boolean(run.data && (!planId || saved.data?.run_id === run.data.id))
  const option = run.data && allOptions(run.data).find(o => o.id === (planId ? saved.data?.option_id : search.get("option")))
  const [selecting, setSelecting] = useState(false), [error, setError] = useState<string | null>(null)
  const flight = useRef({ sequence: 0, active: true, controller: null as AbortController | null })
  const selectionBasis = `${search.get("field")}:${search.get("selection")}:${search.get("obsStart")}:${search.get("obsEnd")}:${runId}:${planId}`
  useEffect(() => {
    const current = flight.current; current.active = true
    return () => { current.active = false; current.sequence++; current.controller?.abort() }
  }, [])
  useEffect(() => {
    // An external Back/Forward navigation invalidates any unfinished selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelecting(false)
    const current = flight.current
    return () => { current.sequence++; current.controller?.abort() }
  }, [selectionBasis])
  function cancelSelection() { flight.current.sequence++; flight.current.controller?.abort(); setSelecting(false) }
  function navigate(patch: Record<string, string | null>, nextPath?: "/fields" | "/field-shift/map" | "/field-shift/rotation") {
    cancelSelection(); navigation.navigate(patch, nextPath)
  }
  async function selectRegion(kind: RegionSelection["kind"], geometry: Geometry) {
    if (!ownerId) { setError("登录并验证邮箱后可查询科学数据。绘图草稿仍可在本机使用。"); return false }
    cancelSelection(); const request = ++flight.current.sequence
    const controller = new AbortController(); flight.current.controller = controller
    setSelecting(true); setError(null)
    try {
      const selection = await api.createSelection(kind, geometry, navigation.revision + 1, controller.signal)
      if (!flight.current.active || request !== flight.current.sequence) return false
      client.setQueryData(["rotation", ownerId, "selection", selection.id], selection)
      navigation.navigate({ selection: selection.id })
      return true
    } catch (cause) {
      if (flight.current.active && request === flight.current.sequence) setError(cause instanceof Error ? cause.message : "选区未保存，请检查边界并重试。")
      return false
    } finally { if (flight.current.active && request === flight.current.sequence) setSelecting(false) }
  }
  const boundField = field?.properties.backendFieldId && field.properties.backendVersion
    ? [{ id: field.properties.backendFieldId, expected_version: field.properties.backendVersion }] : []
  const dirty = formDirty || Boolean(field?.properties.details && field.properties.syncStatus !== "synced")
  const stale = Boolean(hasRun && field?.properties.backendFieldId && run.data?.field_snapshots.some(f => f.id === field.properties.backendFieldId && f.version !== field.properties.backendVersion))
  const context = buildAssistantContext({ page: "map", revision: navigation.revision, fields: boundField,
    selection: science.selection.data ? { id: science.selection.data.id, revision: science.selection.data.revision } : null, dates: window.dates,
    runId: hasRun ? run.data!.id : null, optionId: option?.id, compareRunId: search.get("compare"), compareOptionId: search.get("compareOption"), saved: Boolean(planId), changes: dirty || stale ? ["fields"] : [] })
  const contextPending = selecting || Boolean((runId || planId) && !hasRun) || Boolean(search.get("selection") && !science.selection.data)
  const contextLabel = [hasRun ? t("历史计算：{fields}", { fields: run.data!.field_snapshots.map(f => f.name).join(", ") }) : field?.properties.name ?? t("未选择经营地块"),
    science.selection.data ? t("临时选区 {coordinates}", { coordinates: science.selection.data.center.map(v => v.toFixed(4)).join(", ") }) : t("未选临时区域"),
    window.dates ? `${window.dates.start}—${window.dates.end}` : t("全部已发布观测"), dirty ? t("资料有未保存修改") : ""].filter(Boolean).join(" · ")
  return { ...science, navigation: { ...navigation, navigate }, window, selectRegion, cancelSelection, selecting, error, context, contextLabel, contextPending, run, saved }
}
export type FieldsContext = ReturnType<typeof useFieldsContext>
