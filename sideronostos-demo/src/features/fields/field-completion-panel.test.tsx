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
