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

it("shows the total and visible count when a result list is shortened", async () => {
  window.history.replaceState({}, "", "/si/multi-agent/results/workflow-1?conversation=chat-1");
  api.getToolResult.mockResolvedValue({
    id: "workflow-1", operation_id: "list_profiles", title: "Crop profiles", status: "completed",
    href: null, content_type: null,
    result: { items: Array.from({ length: 9 }, (_, index) => ({ id: `profile-${index + 1}`, name: `Profile ${index + 1}` })) },
  });
  render(<AgentResultPage />);
  expect(await screen.findByText("9 records returned · showing first 8")).toBeInTheDocument();
  expect(screen.getByText("Profile 8")).toBeInTheDocument();
  expect(screen.queryByText("Profile 9")).not.toBeInTheDocument();
});

it("shows the total observation count when only twelve facts are visible", async () => {
  window.history.replaceState({}, "", "/si/multi-agent/results/workflow-1?conversation=chat-1");
  api.getToolResult.mockResolvedValue({
    id: "workflow-1", operation_id: "remote_sensing.fact", title: "Observations", status: "completed",
    href: null, content_type: null,
    result: { facts: Array.from({ length: 13 }, (_, index) => ({ id: `fact-${index + 1}`, metric: "rainfall_total", value: index + 1, unit: "mm" })) },
  });
  render(<AgentResultPage />);
  expect(await screen.findByText("13 published observations · showing first 12")).toBeInTheDocument();
  expect(screen.queryByText("Historical rainfall: 13 mm")).not.toBeInTheDocument();
});
