import { fireEvent, screen, waitFor, cleanup, act } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { FieldCompletionPanel } from "./field-completion-panel"
import { createDemoFarm } from "./demo-data"
import type { OwnedWorkspace } from "./owned-workspace"
import { profile, field as savedField } from "@/components/field-shift/fixtures.test-helper"
import type { FarmSyncResult } from "@/lib/api/farms"
const api = vi.hoisted(() => ({ listProfiles: vi.fn(), listRotationProfiles: vi.fn(), getField: vi.fn() }))
vi.mock("@/lib/api/field-shift", () => ({ listProfiles: api.listProfiles, getField: api.getField }))
vi.mock("@/lib/api/rotation", () => ({ listRotationProfiles: api.listRotationProfiles }))
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks() })
it("does not navigate back to a field after its save finishes in an unmounted panel", async () => {
  api.listProfiles.mockResolvedValue({ items: [profile] }); api.listRotationProfiles.mockResolvedValue({ items: [] })
  const { farm, fields } = createDemoFarm(); const field = fields[0]
  field.properties.status = "confirmed"; field.properties.farmerConfirmed = true; field.properties.details = savedField
  let finish!: (result: FarmSyncResult) => void
  const store = { editDetails: vi.fn(), synchronize: vi.fn(() => new Promise<FarmSyncResult>(resolve => { finish = resolve })) } as unknown as OwnedWorkspace
  field.properties.backendFieldId = savedField.id
  const onSaved = vi.fn(), dirty = vi.fn()
  const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FieldCompletionPanel farm={farm} field={field} ownerId="owner" store={store} syncing={false} plannerHref="/field-shift/rotation?field=saved&selection=aoi&from=2025-01-01" onDirtyChange={dirty} onSaved={onSaved} /></QueryClientProvider>)
  const save = await screen.findByRole("button", { name: "保存地块并继续" })
  expect(screen.getByRole("link", { name: "查看经营条件与轮作规划 →" })).toHaveAttribute("href", "/field-shift/rotation?field=saved&selection=aoi&from=2025-01-01")
  expect(screen.getByRole("spinbutton", { name: "面积（公顷）" })).toHaveAttribute("readonly")
  fireEvent.click(save); await waitFor(() => expect(store.synchronize).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => finish({ farm: { id: "farm", version: 1 } as FarmSyncResult["farm"], complete: true, items: [{ local_id: field.properties.id, status: "synced", field: savedField, error: null }] }))
  expect(onSaved).not.toHaveBeenCalled()
})
it("offers review immediately after a batch conflict and preserves the draft until the latest version is acknowledged", async () => {
  api.listProfiles.mockResolvedValue({ items: [profile] }); api.listRotationProfiles.mockResolvedValue({ items: [] })
  const { farm, fields } = createDemoFarm(); const field = fields[0]
  Object.assign(field.properties, { status: "confirmed", farmerConfirmed: true, details: savedField, backendFieldId: savedField.id, backendVersion: 1, syncStatus: "conflict", syncError: "服务器上有更新版本，本地输入已保留。" })
  api.getField.mockResolvedValue({ ...savedField, version: 2, name: "另一设备更新" })
  const store = { editDetails: vi.fn(), synchronize: vi.fn(async () => ({ complete: true, items: [{ local_id: field.properties.id, status: "synced", field: { ...savedField, version: 3 } }] })) } as unknown as OwnedWorkspace
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FieldCompletionPanel farm={farm} field={field} ownerId="owner" store={store} syncing={false} plannerHref="/field-shift/rotation" onDirtyChange={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>)
  const save = await screen.findByRole("button", { name: "保存地块并继续" })
  fireEvent.change(screen.getByRole("textbox", { name: "地块名称" }), { target: { value: "保留我的草稿" } })
  expect(save).toBeDisabled()
  fireEvent.submit(save.closest("form")!)
  expect(store.synchronize).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "查看服务器上的最新资料" }))
  await screen.findByText(/最新记录：另一设备更新/)
  fireEvent.click(screen.getByRole("button", { name: "已核对，保留我的输入并重新保存" }))
  expect(screen.getByRole("textbox", { name: "地块名称" })).toHaveValue("保留我的草稿")
  fireEvent.click(save)
  await waitFor(() => expect(store.editDetails).toHaveBeenCalledWith(field.properties.id, expect.objectContaining({ name: "保留我的草稿" }), 2))
})

it.each([false, true])("reconciles an acknowledged batch draft without deleting newer input (newer=%s)", async (newer) => {
  api.listProfiles.mockResolvedValue({ items: [profile] }); api.listRotationProfiles.mockResolvedValue({ items: [] })
  const { farm, fields } = createDemoFarm(); const field = fields[0]
  Object.assign(field.properties, { status: "confirmed", farmerConfirmed: true, details: savedField, backendFieldId: savedField.id, backendVersion: 1, syncStatus: "error" })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onDirtyChange = vi.fn()
  const panel = (value: typeof field) => <QueryClientProvider client={client}><FieldCompletionPanel farm={farm} field={value} ownerId="owner" store={{} as OwnedWorkspace} syncing={false} plannerHref="/field-shift/rotation" onDirtyChange={onDirtyChange} onSaved={vi.fn()} /></QueryClientProvider>
  const view = render(panel(field))
  fireEvent.change(await screen.findByRole("textbox", { name: "地块名称" }), { target: { value: "批量保存名称" } })
  const key = `field-shift:owner:managed:${field.properties.id}:v1`
  expect(sessionStorage.getItem(key)).not.toBeNull()
  if (newer) fireEvent.change(screen.getByRole("textbox", { name: "地块名称" }), { target: { value: "保存途中新的输入" } })
  view.rerender(panel({ ...field, properties: { ...field.properties, backendVersion: 2, syncStatus: "synced", details: { ...savedField, name: "批量保存名称" } } }))
  if (newer) {
    expect(screen.getByRole("textbox", { name: "地块名称" })).toHaveValue("保存途中新的输入")
    expect(sessionStorage.getItem(key)).toContain("保存途中新的输入")
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  } else {
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull())
    expect(screen.getByRole("textbox", { name: "地块名称" })).toHaveValue("批量保存名称")
    expect(screen.queryByText(/已恢复此页面未提交/)).not.toBeInTheDocument()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  }
})
