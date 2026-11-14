"use client"
import { useEffect, useState } from "react"
import { getFarm, type ServerFarm } from "@/lib/api/farms"
import { Button } from "@/components/ui/button"
import { getLegacyWorkspace, getStoredWorkspace } from "./storage"
import type { OwnedWorkspace } from "./owned-workspace"
import type { FarmFeature, FieldFeature } from "@/types/workspace"

export function WorkspaceSyncPanel({ store, restoring, remoteError, farm, fields, syncing }: {
  store: OwnedWorkspace; restoring: boolean; remoteError: string | null; farm: FarmFeature | null; fields: FieldFeature[]; syncing: boolean
}) {
  const [archives, setArchives] = useState({ anonymous: 0, legacy: 0, unrecognized: 0 })
  const [review, setReview] = useState<ServerFarm | null>(null)
  const [notice, setNotice] = useState<string | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([getLegacyWorkspace(), getStoredWorkspace()]).then(([legacy, anonymous]) => {
      if (active) setArchives({ anonymous: anonymous.farms.length, legacy: legacy.farms.length, unrecognized: legacy.unrecognizedCount })
    }).catch(() => { if (active) setNotice("本机旧档案暂时无法读取。") })
    return () => { active = false }
  }, [store])
  async function importDrafts(source: "legacy" | "anonymous") {
    setBusy(true); setNotice(null)
    try { await store.importDrafts(source); setNotice("已复制可识别的农场草稿，原记录保留。请逐块核对后保存。") }
    catch (error) { setNotice(error instanceof Error ? error.message : "导入失败") }
    finally { setBusy(false) }
  }
  async function exportArchive() {
    try {
      const archive = await getLegacyWorkspace()
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive.raw, null, 2)], { type: "application/json" }))
      const link = document.createElement("a"); link.href = url; link.download = "field-shift-legacy-archive.json"; link.click(); URL.revokeObjectURL(url)
    } catch { setNotice("旧档案导出失败，请重试。") }
  }
  const ready = fields.filter(f => f.properties.details && f.properties.status === "confirmed" && f.properties.syncStatus !== "synced")
  const saved = fields.filter(f => f.properties.syncStatus === "synced").length
  return <section className="shrink-0 border-b px-4 py-3 text-xs leading-5" aria-label="账户与同步状态">
    <p>{store.ownerId ? "当前账户的农场" : "匿名本机草稿 · 登录后可选择复制到账号"}</p>
    {store.ownerId && <Button size="sm" variant="outline" className="mt-2 w-full" disabled={restoring} onClick={() => void store.refresh()}>{restoring ? "正在读取云端农场…" : "从账户刷新农场"}</Button>}
    {remoteError && <p role="alert" className="mt-2 text-red-700">云端读取未完成：{remoteError}。本机草稿保留。</p>}
    {farm?.properties.syncError && <div role="alert" className="my-2 rounded border p-2"><p>{farm.properties.syncError}</p>{farm.properties.backendFarmId && <>
      <Button size="sm" variant="outline" disabled={busy || syncing} onClick={async () => { setBusy(true); try { setReview(await getFarm(farm.properties.backendFarmId!, undefined, store.ownerId ?? undefined)) } catch (cause) { setNotice(cause instanceof Error ? cause.message : "读取失败") } finally { setBusy(false) } }}>查看服务器农场</Button>
      {review && review.id === farm.properties.backendFarmId && <div className="mt-2"><p>服务器：{review.name} · 版本 {review.version} · 已保存 {review.fields.length} 块地。采用它之前，会将当前本机边界与资料复制为独立草稿。</p><Button size="sm" className="mt-2 h-auto whitespace-normal" disabled={busy || syncing} onClick={async () => { setBusy(true); try { await store.adoptServerFarm(review); setReview(null); setNotice("已采用服务器农场；本机副本可在列表中核对。") } catch (cause) { setNotice(cause instanceof Error ? cause.message : "恢复失败") } finally { setBusy(false) } }}>已核对：采用服务器版本并保留本机副本</Button></div>}
    </>}</div>}
    {farm?.properties.partitionStatus === "confirmed" && <div className="mt-3 border-t pt-2"><p>{saved} / {farm.properties.expectedFieldCount ?? fields.length} 块已同步；{Math.max(farm.properties.expectedFieldCount ?? fields.length, fields.length) - fields.filter(f => f.properties.details).length} 块资料待补齐。</p>
      {(farm.properties.expectedFieldCount ?? 0) > fields.length && <p>此设备仅收到已保存的边界；剩余边界请在原设备保存或导出后导入。</p>}
      <p className="text-muted-foreground">同步不代表已具备模型所需全部资料。</p>
      {store.ownerId && (ready.length > 0 || farm.properties.pendingSync) && <Button size="sm" className="mt-2 w-full" disabled={syncing} onClick={async () => {
        setNotice(null); try { const response = await store.synchronize(farm.properties.id, ready.map(f => f.properties.id)); setNotice(response?.complete ? "本次提交已同步。请继续检查尚未提交的地块与计算资料。" : "部分地块未同步，请逐项查看提示。") }
        catch (error) { setNotice(error instanceof Error ? error.message : "同步未完成") }
      }}>{syncing ? "正在同步…" : farm.properties.pendingSync ? "重试上次保存" : `同步已填写的 ${ready.length} 块地`}</Button>}
    </div>}
    {(archives.anonymous + archives.legacy + archives.unrecognized > 0) && <details className="mt-3"><summary className="cursor-pointer">本机草稿与旧版档案</summary><p className="my-2">复制需由你选择；不会自动将共享浏览器中的草稿归入账号。</p>
      {store.ownerId && archives.anonymous > 0 && <Button size="sm" variant="outline" disabled={busy} className="mb-2 w-full" onClick={() => void importDrafts("anonymous")}>复制匿名农场（{archives.anonymous}）</Button>}
      {store.ownerId && archives.legacy > 0 && <Button size="sm" variant="outline" disabled={busy} className="mb-2 w-full" onClick={() => void importDrafts("legacy")}>复制旧版农场（{archives.legacy}）</Button>}
      {archives.unrecognized > 0 && <p>有 {archives.unrecognized} 条旧记录不能自动识别，原始记录仍保留。</p>}
      {(archives.legacy + archives.unrecognized > 0) && <Button size="sm" variant="ghost" className="w-full" onClick={() => void exportArchive()}>导出旧版原始档案</Button>}
    </details>}
    {notice && <p role="status" className="mt-2">{notice}</p>}
  </section>
}
