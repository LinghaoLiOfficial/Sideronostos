import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { RotationRecommendationWorkspace } from "./rotation-recommendation-workspace"
import { demoFarm } from "@/lib/demo/data"

vi.mock("@/components/rotation/use-workspace-session", () => ({
  useWorkspaceSession: () => ({ ready: true, session: { data: { id: "demo-farmer", email_verified: true } } }),
}))
vi.mock("@/features/fields/use-owned-workspace", () => ({
  useOwnedWorkspace: () => ({ workspace: { farms: [demoFarm, { ...demoFarm, properties: { ...demoFarm.properties, id: "new-farm", name: "New farm" } }], fields: [] } }),
}))
vi.mock("@/components/rotation/nasa-rotation-workspace", () => ({
  NasaRotationWorkspace: ({ farmId }: { farmId: string }) => <div data-testid="recommendations">{farmId}</div>,
}))

it("shows the selected farm recommendations and an empty state for new farms", () => {
  render(<RotationRecommendationWorkspace />)
  expect(screen.getByTestId("recommendations")).toHaveTextContent(demoFarm.properties.id)
  fireEvent.click(screen.getByRole("button", { name: /New farm/ }))
  expect(screen.getByText("This farm has no rotation recommendations yet.")).toBeVisible()
  expect(screen.queryByTestId("recommendations")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /^Iowa / }))
  expect(screen.getByTestId("recommendations")).toHaveTextContent(demoFarm.properties.id)
})
