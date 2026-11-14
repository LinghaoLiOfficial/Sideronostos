"use client"
import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { FieldForm } from "@/components/field-shift/field-form"
import { HistoryEditor } from "@/components/rotation/history-editor"
import { ApiError } from "@/lib/api/client"
import { getField, listProfiles } from "@/lib/api/field-shift"
import { listRotationProfiles } from "@/lib/api/rotation"
import type { Field } from "@/lib/api/field-shift-types"
import type { FarmFeature, FieldFeature } from "@/types/workspace"
import { managedInput } from "./farm-sync"
import type { OwnedWorkspace } from "./owned-workspace"
import { Button } from "@/components/ui/button"

export function FieldCompletionPanel({ farm, field, ownerId, store, syncing, plannerHref, onDirtyChange, onSaved }: {
  farm: FarmFeature; field: FieldFeature; ownerId: string | null; store: OwnedWorkspace; syncing: boolean; plannerHref: string
  onDirtyChange: (dirty: boolean) => void; onSaved: (field: Field) => void
}) {
  const { t } = useI18n();

  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const profiles = useQuery({ queryKey: ["field-shift", "profiles"], queryFn: listProfiles })
  const rotationProfiles = useQuery({ queryKey: ["rotation", ownerId, "profiles"], queryFn: listRotationProfiles, enabled: Boolean(ownerId) })
  const [retryError, setRetryError] = useState<string | null>(null)
  const historyDirty = useCallback((_id: string, dirty: boolean) => onDirtyChange(dirty), [onDirtyChange])
  const value = useMemo<Field>(() => ({ ...managedInput(field, field.properties.details ?? {
    name: field.properties.name, area_ha: 1, latitude: 0, longitude: 0, profile_id: profiles.data?.items[0]?.id ?? "",
    soil_texture: "unknown", irrigation_available: false, history: [],
  }), id: field.properties.backendFieldId ?? `local:${field.properties.id}`, version: field.properties.backendVersion ?? 1,
    created_at: field.properties.createdAt, updated_at: field.properties.updatedAt }), [field, profiles.data])
  const historyProfile = rotationProfiles.data?.items.find(p => p.id === value.profile_id)
  if (field.properties.status !== "confirmed") return null
  const pending = Boolean(farm.properties.pendingSync)
  const synced = field.properties.syncStatus === "synced"
  return <section className="border-b p-4" aria-label={t("地块资料与同步")}>
    <h3 className="text-sm font-semibold">{t("地块资料 / Field details")}</h3>
    <p role="status" className="my-2 text-xs leading-5">{synced ? t("已同步到账户；计算前仍需检查气象、参数与经营条件。") : pending ? t("上次保存结果尚待核对，重试将沿用原请求。") : t("边界已确认。补齐资料并保存后才能用于轮作规划。")}</p>
    {(farm.properties.syncError || field.properties.syncError || retryError) && <p role="alert" className="my-2 text-xs text-red-700">{t(retryError ?? field.properties.syncError ?? farm.properties.syncError ?? "")}</p>}
    {!ownerId ? <Link className="text-sm underline" href={`/login?next=${encodeURIComponent(typeof window === "undefined" ? "/fields" : window.location.pathname + window.location.search)}`}>{t("登录并验证邮箱后保存资料")}</Link> : <>
      {pending && <Button className="my-2 w-full" disabled={syncing} onClick={async () => { setRetryError(null); try { await store.synchronize(farm.properties.id) } catch (error) { setRetryError(error instanceof Error ? error.message : t("同步未完成")) } }}>{t("核对并重试上次保存")}</Button>}
      {profiles.isPending && <p role="status">{t("正在加载地区配置…")}</p>}
      {profiles.isError && <div role="alert"><p>{t("地区配置未载入，暂时无法保存。")}</p><Button onClick={() => void profiles.refetch()}>{t("重试")}</Button></div>}
      {profiles.data && !profiles.data.items.length && <p role="alert">{t("尚无可用地区配置。")}</p>}
      {Boolean(profiles.data?.items.length) && <FieldForm key={`${field.properties.id}:${field.properties.backendVersion ?? 0}`} draftKey={`field-shift:${ownerId}:managed:${field.properties.id}:v1`} field={value} profiles={profiles.data!.items} userId={ownerId} geometryLocked externallySaved={synced} externalConflict={field.properties.syncStatus === "conflict"} onDirtyChange={onDirtyChange}
        onReload={field.properties.backendFieldId ? () => getField(field.properties.backendFieldId!) : undefined}
        onSave={async (input, expectedVersion) => {
          if (pending) throw new Error(t("先核对上次保存结果，再提交当前修改。当前输入已保留。"))
          store.editDetails(field.properties.id, { ...input, history_events: field.properties.details?.history_events ?? [] }, expectedVersion)
          const response = await store.synchronize(farm.properties.id, [field.properties.id])
          const item = response?.items.find(i => i.local_id === field.properties.id)
          if (!item?.field) throw new ApiError(item?.status === "conflict" ? 409 : 422, { code: "farm_sync", message: item?.error ?? t("保存未完成，请重试。"), request_id: "farm-sync", details: null })
          if (mounted.current) onSaved(item.field)
        }} />}
      {synced && historyProfile && <HistoryEditor key={`${value.id}:${value.version}`} field={value} profile={historyProfile} onDirtyChange={historyDirty} onSaved={saved => { store.acceptSavedField(field.properties.id, saved); if (mounted.current) onSaved(saved) }} />}
      {field.properties.backendFieldId && <Link className="mt-4 block text-sm font-medium underline" href={plannerHref}>{t("查看经营条件与轮作规划 →")}</Link>}
      {synced && !historyProfile && <p className="mt-2 text-xs text-muted-foreground">{t("更精细的前茬日期可在轮作规划中按选定参数包补充。")}</p>}
    </>}
  </section>
}
