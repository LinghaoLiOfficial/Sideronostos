import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LocalKnowledgeWorkspace } from "./local-knowledge-workspace"
import { demoFarm } from "@/lib/demo/data"
import { createFarmFeature } from "@/features/fields/geometry"

const mocks = vi.hoisted(() => ({ getLocalKnowledge: vi.fn() }))
vi.mock("@/lib/api/rotation", () => ({ getLocalKnowledge: mocks.getLocalKnowledge }))
vi.mock("@/components/rotation/use-workspace-session", () => ({
  useWorkspaceSession: () => ({ ready: true, session: { data: { id: "demo-farmer", email_verified: true } } }),
}))
vi.mock("@/features/fields/use-owned-workspace", () => ({
  useOwnedWorkspace: () => {
    const farm = createFarmFeature(demoFarm.geometry, "drawn", 2)
    farm.properties.id = "new-farm"
    return { workspace: { farms: [demoFarm, farm], fields: [] } }
  },
}))

describe("local knowledge farm scope", () => {
  it("does not load or show the sample knowledge for a new farm", async () => {
    mocks.getLocalKnowledge.mockResolvedValue({
      active: { revision: 1 },
      draft: { sha256: "sample-hash", profile: { crops: [], sources: {}, name: "Sample knowledge", region: "Iowa", limitations: [], weather_center: [42, -93] } },
    })
    render(<QueryClientProvider client={new QueryClient()}><LocalKnowledgeWorkspace /></QueryClientProvider>)
    expect(await screen.findByDisplayValue("Sample knowledge")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /Farm 2/ }))
    expect(screen.getByText("This farm has no local agricultural knowledge yet.")).toBeVisible()
    expect(screen.queryByDisplayValue("Sample knowledge")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Publish and activate" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Iowa / }))
    expect(await screen.findByDisplayValue("Sample knowledge")).toBeVisible()
  })
})
