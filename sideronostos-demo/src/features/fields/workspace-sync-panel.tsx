"use client"
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react"
import { getFarm, type ServerFarm } from "@/lib/api/farms"
import { Button } from "@/components/ui/button"
import { getLegacyWorkspace, getStoredWorkspace } from "./storage"
import type { OwnedWorkspace } from "./owned-workspace"
import type { FarmFeature, FieldFeature } from "@/types/workspace"

export function WorkspaceSyncPanel({ store, restoring, remoteError, workspaceRemoteError, remoteConflict, accountWorkspace = false, onResolveRemote, onReloadRemote, onRestoreSample, farm, fields, syncing }: {
  store: OwnedWorkspace; restoring: boolean; remoteError: string | null; farm: FarmFeature | null; fields: FieldFeature[]; syncing: boolean
  workspaceRemoteError?: string | null; remoteConflict?: boolean; accountWorkspace?: boolean
  onResolveRemote?: (choice: "reload" | "keep-local") => Promise<void>
  onReloadRemote?: () => Promise<void>
  onRestoreSample?: () => Promise<void>
}) {
  const { t } = useI18n();

  const [archives, setArchives] = useState({ anonymous: 0, legacy: 0, unrecognized: 0 })
  const [review, setReview] = useState<ServerFarm | null>(null)
  const [notice, setNotice] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [legacyCount, setLegacyCount] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([getLegacyWorkspace(), getStoredWorkspace()]).then(([legacy, anonymous]) => {
      if (active) {
        setArchives({ anonymous: anonymous.farms.length, legacy: legacy.farms.length, unrecognized: legacy.unrecognizedCount })
        setLegacyCount(legacy.farms.length + legacy.fields.length)
      }
    }).catch(() => { if (active) setNotice(t("本机旧档案暂时无法读取。")) })
    return () => { active = false }
  }, [store, t])
  async function importDrafts(source: "legacy" | "anonymous") {
    setBusy(true); setNotice(null)
    try { await store.importDrafts(source); setNotice(t("已复制可识别的农场草稿，原记录保留。请逐块核对后保存。")) }
    catch (error) { setNotice(error instanceof Error ? error.message : t("导入失败")) }
    finally { setBusy(false) }
  }
  async function exportArchive() {
    try {
      const archive = await getLegacyWorkspace()
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive.raw, null, 2)], { type: "application/json" }))
      const link = document.createElement("a"); link.href = url; link.download = "field-shift-legacy-archive.json"; link.click(); URL.revokeObjectURL(url)
    } catch { setNotice(t("旧档案导出失败，请重试。")) }
  }
  async function migrateLegacy() {
    if (!window.confirm(t("确认将可识别的旧农场和地块复制到当前账号，并在账号工作区保存成功后清理旧数据？未识别的 {count} 条记录也会被跳过并清理。", { count: archives.unrecognized }))) return
    setBusy(true); setNotice(null)
    try {
      await store.migrateLegacyAndClear()
      setLegacyCount(0)
      setArchives(current => ({ ...current, legacy: 0, unrecognized: 0 }))
      setNotice(t("旧数据迁移并保存成功；旧记录已清理，跳过 {count} 条无法识别的记录。", { count: archives.unrecognized }))
    } catch (error) {
      setNotice(error instanceof Error ? `${t("迁移未完成，旧数据仍保留：")}${error.message}` : t("迁移未完成，旧数据仍保留。"))
    } finally { setBusy(false) }
  }
  const ready = fields.filter(f => f.properties.details && f.properties.status === "confirmed" && f.properties.syncStatus !== "synced")
  const saved = fields.filter(f => f.properties.syncStatus === "synced").length
  return <section className="shrink-0 border-b px-4 py-3 text-xs leading-5" aria-label={t("账户与同步状态")}>
    <p>{store.ownerId ? t("当前账户的农场") : t("匿名本机草稿 · 登录后可选择复制到账号")}</p>
    {accountWorkspace && <div className="mt-2 border bg-muted/30 p-3">
      <p>{t("账号工作区版本：")}{store.getSnapshot().remoteVersion ?? "—"}</p>
      {workspaceRemoteError && <div className="mt-2 space-y-2" role="alert"><p>{t(workspaceRemoteError)}</p>{remoteConflict ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await onResolveRemote?.("reload"); setNotice(t("已重新载入服务器工作区。")) } catch (error) { setNotice(error instanceof Error ? error.message : t("重新载入失败")) } finally { setBusy(false) } }}>{t("重新载入服务器版本")}</Button><Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onResolveRemote?.("keep-local"); setNotice(t("本机工作区已保存为服务器新版本。")) } catch (error) { setNotice(error instanceof Error ? error.message : t("保存失败")) } finally { setBusy(false) } }}>{t("确认保留本机版本")}</Button></div> : <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await onReloadRemote?.(); setNotice(t("账号工作区已重新载入。")) } catch (error) { setNotice(error instanceof Error ? error.message : t("重新载入失败")) } finally { setBusy(false) } }}>{t("重试/重新载入账号工作区")}</Button>}</div>}
    </div>}
    {store.ownerId && <Button size="sm" variant="outline" className="mt-2 w-full" disabled={restoring} onClick={() => void store.refresh()}>{restoring ? t("正在读取云端农场…") : t("从账户刷新农场")}</Button>}
    {accountWorkspace && onRestoreSample && <Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy || restoring} onClick={async () => {
      setBusy(true)
      try { await onRestoreSample(); setNotice(t("Iowa 基准工作区已恢复。")) }
      catch (error) { setNotice(error instanceof Error ? error.message : t("恢复样本失败")) }
      finally { setBusy(false) }
    }}>{t("恢复 Iowa 基准工作区")}</Button>}
    {remoteError && <p role="alert" className="mt-2 text-red-700">{t("云端读取未完成：")}{t(remoteError)}{t("。本机草稿保留。")}</p>}
    {farm?.properties.syncError && <div role="alert" className="my-2 rounded border p-2"><p>{t(farm.properties.syncError)}</p>{farm.properties.backendFarmId && <>
      <Button size="sm" variant="outline" disabled={busy || syncing} onClick={async () => { setBusy(true); try { setReview(await getFarm(farm.properties.backendFarmId!, undefined, store.ownerId ?? undefined)) } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("读取失败")) } finally { setBusy(false) } }}>{t("查看服务器农场")}</Button>
      {review && review.id === farm.properties.backendFarmId && <div className="mt-2"><p>{t("服务器：")}{review.name} {t(" · 版本 ")}{review.version} {t(" · 已保存 ")}{review.fields.length} {t(" 块地。采用它之前，会将当前本机边界与资料复制为独立草稿。")}</p><Button size="sm" className="mt-2 h-auto whitespace-normal" disabled={busy || syncing} onClick={async () => { setBusy(true); try { await store.adoptServerFarm(review); setReview(null); setNotice(t("已采用服务器农场；本机副本可在列表中核对。")) } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("恢复失败")) } finally { setBusy(false) } }}>{t("已核对：采用服务器版本并保留本机副本")}</Button></div>}
    </>}</div>}
    {farm?.properties.partitionStatus === "confirmed" && <div className="mt-3 border-t pt-2"><p>{saved} / {farm.properties.expectedFieldCount ?? fields.length} {t(" 块已同步；")}{Math.max(farm.properties.expectedFieldCount ?? fields.length, fields.length) - fields.filter(f => f.properties.details).length} {t(" 块资料待补齐。")}</p>
      {(farm.properties.expectedFieldCount ?? 0) > fields.length && <p>{t("此设备仅收到已保存的边界；剩余边界请在原设备保存或导出后导入。")}</p>}
      <p className="text-muted-foreground">{t("同步不代表已具备模型所需全部资料。")}</p>
      {store.ownerId && (ready.length > 0 || farm.properties.pendingSync) && <Button size="sm" className="mt-2 w-full" disabled={syncing} onClick={async () => {
        setNotice(null); try { const response = await store.synchronize(farm.properties.id, ready.map(f => f.properties.id)); setNotice(response?.complete ? t("本次提交已同步。请继续检查尚未提交的地块与计算资料。") : t("部分地块未同步，请逐项查看提示。")) }
        catch (error) { setNotice(error instanceof Error ? error.message : t("同步未完成")) }
      }}>{syncing ? t("正在同步…") : farm.properties.pendingSync ? t("重试上次保存") : t("同步已填写的 {0} 块地", { "0": ready.length })}</Button>}
    </div>}
    {(archives.anonymous + legacyCount + archives.unrecognized > 0) && <details className="mt-3"><summary className="cursor-pointer">{t("本机草稿与旧版档案")}</summary><p className="my-2">{t("复制需由你选择；不会自动将共享浏览器中的草稿归入账号。")}</p>
      {store.ownerId && archives.anonymous > 0 && <Button size="sm" variant="outline" disabled={busy} className="mb-2 w-full" onClick={() => void importDrafts("anonymous")}>{t("复制匿名农场（")}{archives.anonymous}）</Button>}
      {store.ownerId && archives.legacy > 0 && (accountWorkspace
        ? <Button size="sm" variant="outline" disabled={busy || !store.getSnapshot().remoteVersion} className="mb-2 w-full" onClick={() => void migrateLegacy()}>{t("迁移 {count} 个旧农场并清理旧数据", { count: archives.legacy })}</Button>
        : <Button size="sm" variant="outline" disabled={busy} className="mb-2 w-full" onClick={() => void importDrafts("legacy")}>{t("复制旧版农场（")}{archives.legacy}）</Button>)}
      {archives.unrecognized > 0 && <p>{t(accountWorkspace ? "有 {count} 条旧记录无法识别；执行旧版数据迁移/清理时会跳过这些记录。" : "有 {count} 条旧记录不能自动识别，原始记录仍保留。", { count: archives.unrecognized })}</p>}
      {(archives.legacy + archives.unrecognized > 0) && <Button size="sm" variant="ghost" className="w-full" onClick={() => void exportArchive()}>{t("导出旧版原始档案")}</Button>}
    </details>}
    {notice && <p role="status" className="mt-2">{t(notice)}</p>}
  </section>
}
