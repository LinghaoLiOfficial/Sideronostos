import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgentResultPage from "./page";

const api = vi.hoisted(() => ({ getToolResult: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workflowId: "workflow-1" }) }));
vi.mock("@/features/si/agent-api", () => api);

afterEach(() => { cleanup(); api.getToolResult.mockReset(); window.history.replaceState({}, "", "/"); });

it("shows request progress and lets the user retry an unavailable result", async () => {
  window.history.replaceState({}, "", "/si/multi-agent/results/workflow-1?conversation=chat-1");
  api.getToolResult.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
    id: "workflow-1", operation_id: "list_profiles", title: "Crop profiles", status: "completed",
    href: null, content_type: null, result: { items: [{ id: "profile-1", name: "Temperate crops" }] },
  });
  render(<AgentResultPage />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading result");
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: "Crop profiles" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
