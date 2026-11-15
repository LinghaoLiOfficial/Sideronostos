import { ApiError } from "@/lib/api/client"
import { getFieldWorkspace, restoreFieldWorkspaceSample, saveFieldWorkspace, type FieldWorkspace } from "@/lib/api/field-workspace"
import { copyLocalFarm } from "./local-copy"
import { restoreFarms, syncFarm, type ServerFarm } from "@/lib/api/farms"
import type { Field, FieldInput } from "@/lib/api/field-shift-types"
import type { FarmFeature, FieldFeature } from "@/types/workspace"
import { applyFarmSync, buildFarmSync, inputFromField, managedInput, mergeRemoteFarms } from "./farm-sync"
import { clearLegacyWorkspaceData, getStoredWorkspace, importLocalWorkspace, replaceStoredWorkspace } from "./storage"
import { isDemoMode } from "@/lib/demo-mode"
import { demoWorkspace } from "@/lib/demo/data"

export type FarmWorkspace = { farms: FarmFeature[]; fields: FieldFeature[] }
type Snapshot = { workspace: FarmWorkspace | null; error: string | null; remoteError: string | null; workspaceRemoteError: string | null; remoteConflict: boolean; remoteVersion: number | null; restoring: boolean; syncing: string[] }
const message = (cause: unknown) => cause instanceof Error ? cause.message : "操作未完成，请重试。"

function accountWorkspaceForOwner(workspace: FieldWorkspace, ownerId: string): FarmWorkspace {
  return {
    farms: workspace.farms.map(farm => ({ ...farm, properties: { ...farm.properties, ownerUserId: ownerId } })),
    fields: workspace.fields.map(field => ({ ...field, properties: { ...field.properties, ownerUserId: ownerId } })),
  }
}

function appendUnique<T extends { properties: { id: string } }>(current: T[], incoming: T[]) {
  const result = [...current]
  const seen = new Set(result.map(item => item.properties.id))
  for (const item of incoming) if (!seen.has(item.properties.id)) {
    result.push(item)
    seen.add(item.properties.id)
  }
  return result
}

function mergeAccountWorkspace(local: FarmWorkspace, remote: FieldWorkspace, ownerId: string) {
  const account = accountWorkspaceForOwner(remote, ownerId)
  const farmsById = new Map(account.farms.map(farm => [farm.properties.id, farm]))
  const fieldsById = new Map(account.fields.map(field => [field.properties.id, field]))
  let conflict = false
  const conflictedFarmIds = new Set<string>()
  for (const farm of local.farms) {
    const current = farmsById.get(farm.properties.id)
    if (!current) { farmsById.set(farm.properties.id, farm); continue }
    if (JSON.stringify(current.geometry) !== JSON.stringify(farm.geometry)) {
      const existingCopy = local.farms.find(candidate => candidate.properties.conflictOfFarmId === farm.properties.id)
      const copied = existingCopy
        ? { farm: existingCopy, fields: local.fields.filter(field => field.properties.farmId === existingCopy.properties.id) }
        : copyLocalFarm(farm, local.fields, ownerId)
      if (!existingCopy) {
        copied.farm.properties.name = `${copied.farm.properties.name.slice(0, 105)}（本机冲突副本）`
        copied.farm.properties.conflictOfFarmId = farm.properties.id
      }
      farmsById.set(copied.farm.properties.id, copied.farm)
      copied.fields.forEach(field => fieldsById.set(field.properties.id, field))
      conflictedFarmIds.add(farm.properties.id)
      conflict = true
      continue
    }
    farmsById.set(farm.properties.id, {
      ...current, ...farm,
      properties: { ...current.properties, ...farm.properties, ownerUserId: ownerId },
    })
  }
  for (const field of local.fields) {
    if (conflictedFarmIds.has(field.properties.farmId)) continue
    const current = fieldsById.get(field.properties.id)
    if (!current) { fieldsById.set(field.properties.id, field); continue }
    if (JSON.stringify(current.geometry) !== JSON.stringify(field.geometry)
      || current.properties.farmId !== field.properties.farmId) {
      const id = crypto.randomUUID()
      fieldsById.set(id, { ...field, id, properties: { ...field.properties, id, ownerUserId: ownerId } })
      conflict = true
      continue
    }
    fieldsById.set(field.properties.id, {
      ...current, ...field,
      properties: { ...current.properties, ...field.properties, ownerUserId: ownerId },
    })
  }
  return { workspace: { farms: [...farmsById.values()], fields: [...fieldsById.values()] }, conflict }
}

function sameWorkspace(left: FarmWorkspace, right: FarmWorkspace) {
  const withoutOwner = <T extends { properties: object }>(items: T[]) => items.map(item => ({
    ...item,
    properties: Object.fromEntries(Object.entries(item.properties).filter(([key]) => key !== "ownerUserId")),
  }))
  return JSON.stringify({ farms: withoutOwner(left.farms), fields: withoutOwner(left.fields) })
    === JSON.stringify({ farms: withoutOwner(right.farms), fields: withoutOwner(right.fields) })
}

/** One instance per mounted owner. Every queued write captures that immutable owner. */
export class OwnedWorkspace {
  private state: Snapshot = { workspace: null, error: null, remoteError: null, workspaceRemoteError: null, remoteConflict: false, remoteVersion: null, restoring: false, syncing: [] }
  private listeners = new Set<() => void>()
  private active = false
  private epoch = 0
  private refreshRevision = 0
  private queue: Promise<void> = Promise.resolve()
  private remoteQueue: Promise<void> = Promise.resolve()
  private requests = new Set<AbortController>()
  private remoteReady = false
  private remoteConflict = false
  private initializedFrom: string | null = null
  constructor(readonly ownerId: string | null, private readonly accountWorkspace = false) {}
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
  private store(workspace: FarmWorkspace, persistRemote = true) {
    const scoped = this.scoped(workspace)
    this.publish({ workspace: scoped })
    const write = this.queue.catch(() => undefined).then(() => replaceStoredWorkspace(scoped.farms, scoped.fields, this.ownerId))
    this.queue = write
    // Observe failures even for synchronous edits. Callers can still await the rejecting write.
    void write.then(() => { if (this.active) this.publish({ error: null }) }, cause => { if (this.active) this.publish({ error: `本机保存失败：${message(cause)}` }) })
    if (!persistRemote || !this.accountWorkspace || !this.remoteReady) return write
    const epoch = this.epoch
    const remoteWrite = this.remoteQueue.catch(() => undefined).then(async () => {
      await write
      if (!this.active || epoch !== this.epoch || this.remoteConflict || this.state.workspaceRemoteError) return
      const version = this.state.remoteVersion
      if (version === null) return
      try {
        const saved = await saveFieldWorkspace(version, scoped.farms, scoped.fields, this.initializedFrom)
        if (!this.active || epoch !== this.epoch) return
        this.initializedFrom = saved.initialized_from
        this.publish({ remoteVersion: saved.version, workspaceRemoteError: null })
      } catch (cause) {
        if (!this.active || epoch !== this.epoch) return
        this.remoteConflict = true
        this.publish({
          remoteConflict: true,
          workspaceRemoteError: cause instanceof ApiError && cause.status === 409
            ? "账号工作区已在其他页面更新。当前本机内容已保留，请重新载入服务器版本或确认以本机版本覆盖。"
            : `账号工作区保存结果未能确认：${message(cause)}。当前本机内容已保留，请先重新载入服务器版本确认状态。`,
        })
        throw cause
      }
    })
    this.remoteQueue = remoteWrite
    return remoteWrite
  }
  async start() {
    this.active = true; const epoch = ++this.epoch
    try {
      if (isDemoMode()) {
        const stored = await getStoredWorkspace(this.ownerId)
        const seed = demoWorkspace()
        const hasCurrentSample = stored.farms.some((farm) => farm.properties.id === seed.farms[0]?.properties.id && farm.properties.sampleVersion === seed.farms[0]?.properties.sampleVersion)
        const hasLegacySample = stored.farms.some((farm) => farm.properties.id === seed.farms[0]?.properties.id && Boolean(farm.properties.sampleVersion))
        const source = hasCurrentSample || hasLegacySample ? {
          farms: [...stored.farms.filter((farm) => farm.properties.id !== seed.farms[0]?.properties.id), ...seed.farms],
          fields: [...stored.fields.filter((field) => field.properties.farmId !== seed.farms[0]?.properties.id), ...seed.fields],
        } : stored.farms.length ? stored : seed
        const scoped = this.scoped(source)
        if (!this.active || epoch !== this.epoch) return
        this.publish({ workspace: scoped, error: null, remoteError: null, workspaceRemoteError: null, remoteConflict: false, remoteVersion: null, restoring: false, syncing: [] })
        await replaceStoredWorkspace(scoped.farms, scoped.fields, this.ownerId)
        return
      }
      const workspace = await getStoredWorkspace(this.ownerId)
      if (!this.active || epoch !== this.epoch) return
      this.publish({ workspace: this.scoped(workspace), error: null })
      if (this.accountWorkspace && this.ownerId) await this.startAccountWorkspace(workspace, epoch)
      if (!this.active || epoch !== this.epoch) return
      await this.refresh()
    } catch (cause) { if (this.active && epoch === this.epoch) this.publish({ error: message(cause) }) }
  }
  private async startAccountWorkspace(local: FarmWorkspace, epoch: number) {
    this.publish({ restoring: true, workspaceRemoteError: null })
    try {
      const remote = await getFieldWorkspace()
      if (!this.active || epoch !== this.epoch) return
      this.initializedFrom = remote.initialized_from
      this.remoteReady = true
      this.remoteConflict = false
      const merged = mergeAccountWorkspace(local, remote, this.ownerId!)
      this.publish({
        workspace: merged.workspace,
        remoteVersion: remote.version,
        remoteConflict: merged.conflict,
        workspaceRemoteError: merged.conflict
          ? "本机草稿与账号工作区存在相同标识但不同边界的记录。两份内容都已保留，请选择重新载入服务器版本或确认以本机版本覆盖。"
          : null,
      })
      this.remoteConflict = merged.conflict
      await replaceStoredWorkspace(merged.workspace.farms, merged.workspace.fields, this.ownerId)
      if (!merged.conflict && !sameWorkspace(merged.workspace, remote)) {
        await this.store(merged.workspace)
      }
    } catch (cause) {
      if (this.active && epoch === this.epoch) {
        this.remoteReady = false
        this.publish({ workspaceRemoteError: `无法读取账号工作区：${message(cause)}。本机草稿仍保留。` })
      }
    } finally {
      if (this.active && epoch === this.epoch) this.publish({ restoring: false })
    }
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
  async flush() { await this.queue; await this.remoteQueue }
  async resolveAccountConflict(choice: "reload" | "keep-local") {
    if (!this.accountWorkspace || !this.ownerId || !this.active || !this.state.workspace) throw new Error("账号工作区尚未载入。")
    const epoch = this.epoch
    const latest = await getFieldWorkspace()
    if (!this.active || epoch !== this.epoch) return
    if (choice === "reload") {
      this.initializedFrom = latest.initialized_from
      this.remoteConflict = false
      this.remoteReady = true
      const workspace = accountWorkspaceForOwner(latest, this.ownerId)
      this.publish({ remoteVersion: latest.version, remoteConflict: false, workspaceRemoteError: null })
      await this.store(workspace, false)
      return
    }
    const current = this.state.workspace
    const saved = await saveFieldWorkspace(latest.version, current.farms, current.fields, latest.initialized_from)
    if (!this.active || epoch !== this.epoch) return
    this.initializedFrom = saved.initialized_from
    this.remoteConflict = false
    this.remoteReady = true
    this.publish({ remoteVersion: saved.version, remoteConflict: false, workspaceRemoteError: null })
  }
  async restoreAccountSample() {
    if (!this.accountWorkspace || !this.ownerId || !this.active) throw new Error("账号工作区尚未载入。")
    const epoch = this.epoch
    const sample = await restoreFieldWorkspaceSample()
    if (!this.active || epoch !== this.epoch) return
    this.initializedFrom = sample.initialized_from
    this.remoteReady = true
    this.remoteConflict = false
    const workspace = accountWorkspaceForOwner(sample, this.ownerId)
    this.publish({ remoteVersion: sample.version, remoteConflict: false, workspaceRemoteError: null })
    await this.store(workspace, false)
  }
  async reloadAccountWorkspace() {
    if (!this.accountWorkspace || !this.ownerId || !this.active) throw new Error("账号工作区尚未载入。")
    const epoch = this.epoch
    const remote = await getFieldWorkspace()
    if (!this.active || epoch !== this.epoch) return
    this.initializedFrom = remote.initialized_from
    this.remoteReady = true
    this.remoteConflict = false
    const workspace = accountWorkspaceForOwner(remote, this.ownerId)
    this.publish({ remoteVersion: remote.version, remoteConflict: false, workspaceRemoteError: null })
    await this.store(workspace, false)
  }
  async migrateLegacyAndClear() {
    if (!this.accountWorkspace || !this.ownerId || !this.active || !this.remoteReady || !this.state.workspace) {
      throw new Error("账号工作区尚未准备好，旧本地数据没有被清理。")
    }
    const epoch = this.epoch
    await this.flush()
    const imported = await importLocalWorkspace(this.ownerId, "legacy")
    if (!this.active || epoch !== this.epoch || !this.state.workspace) return
    const current = this.state.workspace
    const local = {
      farms: appendUnique(current.farms, imported.farms),
      fields: appendUnique(current.fields, imported.fields),
    }
    // Migration must not rely on the autosave queue: a prior conflict intentionally
    // blocks autosaves, and legacy data may only be deleted after an explicit save.
    const latest = await getFieldWorkspace()
    if (!this.active || epoch !== this.epoch) return
    const merged = mergeAccountWorkspace(local, latest, this.ownerId)
    const saved = await saveFieldWorkspace(latest.version, merged.workspace.farms, merged.workspace.fields, latest.initialized_from)
    if (!this.active || epoch !== this.epoch) return
    this.initializedFrom = saved.initialized_from
    this.remoteReady = true
    this.remoteConflict = false
    this.publish({
      workspace: merged.workspace,
      remoteVersion: saved.version,
      remoteConflict: false,
      workspaceRemoteError: null,
    })
    await replaceStoredWorkspace(merged.workspace.farms, merged.workspace.fields, this.ownerId)
    if (!this.active || epoch !== this.epoch) return
    await clearLegacyWorkspaceData()
  }
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
