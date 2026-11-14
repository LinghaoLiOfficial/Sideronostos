import { ApiError } from "@/lib/api/client"
import { copyLocalFarm } from "./local-copy"
import { restoreFarms, syncFarm, type ServerFarm } from "@/lib/api/farms"
import type { Field, FieldInput } from "@/lib/api/field-shift-types"
import type { FarmFeature, FieldFeature } from "@/types/workspace"
import { applyFarmSync, buildFarmSync, inputFromField, managedInput, mergeRemoteFarms } from "./farm-sync"
import { getStoredWorkspace, importLocalWorkspace, replaceStoredWorkspace } from "./storage"

export type FarmWorkspace = { farms: FarmFeature[]; fields: FieldFeature[] }
type Snapshot = { workspace: FarmWorkspace | null; error: string | null; remoteError: string | null; restoring: boolean; syncing: string[] }
const message = (cause: unknown) => cause instanceof Error ? cause.message : "操作未完成，请重试。"

/** One instance per mounted owner. Every queued write captures that immutable owner. */
export class OwnedWorkspace {
  private state: Snapshot = { workspace: null, error: null, remoteError: null, restoring: false, syncing: [] }
  private listeners = new Set<() => void>()
  private active = false
  private epoch = 0
  private refreshRevision = 0
  private queue: Promise<void> = Promise.resolve()
  private requests = new Set<AbortController>()
  constructor(readonly ownerId: string | null) {}
  getSnapshot = () => this.state
  subscribe = (notify: () => void) => { this.listeners.add(notify); return () => { this.listeners.delete(notify) } }
  private publish(change: Partial<Snapshot>) {
    this.state = { ...this.state, ...change }; this.listeners.forEach(notify => notify())
  }
  private scoped(workspace: FarmWorkspace): FarmWorkspace {
    for (const feature of [...workspace.farms, ...workspace.fields]) if (feature.properties.ownerUserId !== undefined && feature.properties.ownerUserId !== this.ownerId) throw new Error("账号不匹配，请使用显式草稿导入。")
    return { farms: workspace.farms.map(f => ({ ...f, properties: { ...f.properties, ownerUserId: this.ownerId } })),
      fields: workspace.fields.map(f => ({ ...f, properties: { ...f.properties, ownerUserId: this.ownerId } })) }
  }
  private store(workspace: FarmWorkspace) {
    const scoped = this.scoped(workspace)
    this.publish({ workspace: scoped })
    const write = this.queue.catch(() => undefined).then(() => replaceStoredWorkspace(scoped.farms, scoped.fields, this.ownerId))
    this.queue = write
    // Observe failures even for synchronous edits. Callers can still await the rejecting write.
    void write.then(() => { if (this.active) this.publish({ error: null }) }, cause => { if (this.active) this.publish({ error: `本机保存失败：${message(cause)}` }) })
    return write
  }
  async start() {
    this.active = true; const epoch = ++this.epoch
    try {
      const workspace = await getStoredWorkspace(this.ownerId)
      if (!this.active || epoch !== this.epoch) return
      this.publish({ workspace: this.scoped(workspace), error: null })
      await this.refresh()
    } catch (cause) { if (this.active && epoch === this.epoch) this.publish({ error: message(cause) }) }
  }
  dispose() {
    this.active = false; this.epoch++; this.refreshRevision++
    this.requests.forEach(controller => controller.abort()); this.requests.clear()
    // Existing durable writes finish in the old owner's scope. Never cancel or relabel them.
  }
  update(change: (current: FarmWorkspace) => FarmWorkspace) {
    if (!this.active || !this.state.workspace) throw new Error("请等待工作区载入。")
    void this.store(change(this.state.workspace)).catch(() => undefined)
  }
  async flush() { await this.queue }
  async refresh() {
    if (!this.ownerId || !this.active || !this.state.workspace) return
    const revision = ++this.refreshRevision, epoch = this.epoch, controller = new AbortController()
    this.requests.add(controller); this.publish({ restoring: true, remoteError: null })
    try {
      const farms = await restoreFarms(controller.signal, this.ownerId)
      if (this.active && epoch === this.epoch && revision === this.refreshRevision && this.state.workspace) {
        await this.store(mergeRemoteFarms(this.state.workspace, farms, this.ownerId))
      }
    } catch (cause) {
      if (this.active && epoch === this.epoch && revision === this.refreshRevision) this.publish({ remoteError: message(cause) })
    } finally {
      this.requests.delete(controller)
      if (this.active && epoch === this.epoch && revision === this.refreshRevision) this.publish({ restoring: false })
    }
  }
  async importDrafts(source: "legacy" | "anonymous") {
    if (!this.ownerId || !this.state.workspace) throw new Error("请先登录。")
    const epoch = this.epoch
    await this.flush()
    const imported = await importLocalWorkspace(this.ownerId, source)
    if (!this.active || epoch !== this.epoch || !this.state.workspace) return
    // Keep edits made while import was loading; only append newly copied identities.
    const current = this.state.workspace
    await this.store({ farms: [...current.farms, ...imported.farms.filter(f => !current.farms.some(c => c.properties.id === f.properties.id))],
      fields: [...current.fields, ...imported.fields.filter(f => !current.fields.some(c => c.properties.id === f.properties.id))] })
  }
  async adoptServerFarm(server: ServerFarm) {
    if (!this.ownerId || !this.active || !this.state.workspace) throw new Error("请先载入账户工作区。")
    const workspace = this.state.workspace
    const local = workspace.farms.find(f => f.properties.backendFarmId === server.id || f.properties.id === server.local_id)
    if (!local || this.state.syncing.includes(local.properties.id)) throw new Error("请等待同步结束后核对农场。")
    const copy = copyLocalFarm(local, workspace.fields, this.ownerId)
    copy.farm.properties.name = `${copy.farm.properties.name.slice(0, 105)}（本机保留副本）`
    const remaining = { farms: workspace.farms.filter(f => f !== local), fields: workspace.fields.filter(f => f.properties.farmId !== local.properties.id) }
    const restored = mergeRemoteFarms(remaining, [server], this.ownerId)
    await this.store({ farms: [...restored.farms, copy.farm], fields: [...restored.fields, ...copy.fields] })
  }
  editDetails(localId: string, value: FieldInput, expectedVersion?: number) {
    this.update(w => ({ ...w, fields: w.fields.map(f => f.properties.id !== localId ? f : {
      ...f, properties: { ...f.properties, name: value.name, details: managedInput(f, value),
        backendVersion: f.properties.backendFieldId ? expectedVersion ?? f.properties.backendVersion : undefined,
        syncStatus: "needs-details", syncError: null },
    }) }))
  }
  acceptSavedField(localId: string, saved: Field) {
    this.update(w => ({ ...w, fields: w.fields.map(f => f.properties.id !== localId || (f.properties.backendVersion ?? 0) > saved.version ? f : {
      ...f, properties: { ...f.properties, name: saved.name, details: inputFromField(saved), backendFieldId: saved.id,
        backendVersion: saved.version, syncStatus: "synced", syncError: null },
    }) }))
  }
  async synchronize(farmId: string, fieldIds?: string[]) {
    if (!this.ownerId || !this.active || !this.state.workspace) throw new Error("登录并验证邮箱后才能同步。")
    if (this.state.syncing.includes(farmId)) throw new Error("这个农场正在同步，请等待结果。")
    const workspace = this.state.workspace, farm = workspace.farms.find(f => f.properties.id === farmId)
    if (!farm) throw new Error("农场已不存在。")
    const request = farm.properties.pendingSync ?? buildFarmSync(farm, workspace.fields.filter(f => !fieldIds || fieldIds.includes(f.properties.id)), crypto.randomUUID(), this.ownerId)
    const epoch = this.epoch, controller = new AbortController()
    this.requests.add(controller); this.publish({ syncing: [...this.state.syncing, farmId] })
    try {
      await this.store({ ...workspace, farms: workspace.farms.map(f => f !== farm ? f : { ...f, properties: { ...f.properties, pendingSync: request, syncError: null } }),
        fields: workspace.fields.map(f => request.fields.some(i => i.local_id === f.properties.id) ? { ...f, properties: { ...f.properties, syncStatus: "pending", syncError: null } } : f) })
      if (!this.active || epoch !== this.epoch) return
      const result = await syncFarm(request, controller.signal, this.ownerId)
      if (!this.active || epoch !== this.epoch || !this.state.workspace) return
      await this.store(applyFarmSync(this.state.workspace, request, result))
      // A replay receipt can be older than current server state. Reconcile before editing again.
      await this.refresh()
      return result
    } catch (cause) {
      if (this.active && epoch === this.epoch && this.state.workspace) {
        // Definitive 4xx rejects were not committed. Uncertain network/server failures keep the receipt key.
        const rejected = cause instanceof ApiError && cause.status >= 400 && cause.status < 500
        await this.store({ ...this.state.workspace,
          farms: this.state.workspace.farms.map(f => f.properties.id !== farmId ? f : { ...f, properties: { ...f.properties,
            pendingSync: rejected ? undefined : request, syncError: message(cause) } }),
          fields: this.state.workspace.fields.map(f => request.fields.some(i => i.local_id === f.properties.id) ? {
            ...f, properties: { ...f.properties, syncStatus: rejected ? "error" : "pending", syncError: message(cause) },
          } : f),
        }).catch(() => undefined)
      }
      throw cause
    } finally {
      this.requests.delete(controller)
      if (this.active && epoch === this.epoch) this.publish({ syncing: this.state.syncing.filter(id => id !== farmId) })
    }
  }
}
