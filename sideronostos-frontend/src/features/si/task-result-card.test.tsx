import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TaskResultCard } from "./task-result-card";

const api = vi.hoisted(() => ({ apiBlob: vi.fn(), apiRequest: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("shows the confirmed result link and the private screenshot from the real result page", async () => {
  api.apiBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:field-preview" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  render(<TaskResultCard language="en" task={{
    id: "workflow-1", status: "completed", href: "/field-shift?field=field-1&step=field",
    preview_url: "/farm-assistant/conversations/chat-1/previews/workflow-1",
    missing_inputs: [], summary: null,
  }} />);
  expect(screen.getByRole("link", { name: "Open saved field" })).toHaveAttribute("href", "/field-shift?field=field-1&step=field");
  expect(await screen.findByRole("img", { name: "Saved field result page" })).toHaveAttribute("src", "blob:field-preview");
  expect(api.apiBlob).toHaveBeenCalledWith("/farm-assistant/conversations/chat-1/previews/workflow-1");
});

it("shows the exact values awaiting confirmation before a tool write", () => {
  render(<TaskResultCard language="en" task={{
    id: "workflow-2", status: "awaiting_confirmation", operation_id: "create_field",
    title: "Create Field", href: null, preview_url: null, missing_inputs: [],
    summary: { body: { name: "South field", area_ha: 4, irrigation_available: false } },
  }} />);
  expect(screen.getByText("South field")).toBeVisible();
  expect(screen.getByText("4")).toBeVisible();
  expect(screen.getByText("No")).toBeVisible();
  expect(screen.getByText(/Waiting for your confirmation/)).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("opens a generic business result and its protected viewer", async () => {
  api.apiBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:tool-preview" });
  render(<TaskResultCard language="en" task={{
    id: "workflow-3", status: "completed", operation_id: "list_profiles", title: "List Profiles",
    href: "/field-shift", result_page_url: "/si/multi-agent/results/workflow-3?conversation=chat-1",
    preview_url: "/farm-assistant/conversations/chat-1/previews/workflow-3", missing_inputs: [], summary: null,
  }} />);
  expect(screen.getByRole("link", { name: "Open result page" })).toHaveAttribute("href", "/field-shift");
  expect(screen.getByRole("link", { name: "View task details" })).toHaveAttribute("href", "/si/multi-agent/results/workflow-3?conversation=chat-1");
  expect(await screen.findByRole("img", { name: "Task result page" })).toHaveAttribute("src", "blob:tool-preview");
});

it("refreshes a pending business job before showing its verified result", async () => {
  vi.useFakeTimers();
  api.apiBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  api.apiRequest.mockResolvedValue({
    id: "workflow-4", status: "completed", href: "/field-shift/rotation?run=job-1",
    result_page_url: "/si/multi-agent/results/workflow-4?conversation=chat-1",
    preview_url: "/farm-assistant/conversations/chat-1/previews/workflow-4",
    refresh_url: null, missing_inputs: [], summary: null,
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:job-preview" });
  render(<TaskResultCard language="en" task={{
    id: "workflow-4", status: "pending", href: "/field-shift/rotation?run=job-1",
    refresh_url: "/farm-assistant/conversations/chat-1/workflows/workflow-4/refresh",
    preview_url: null, missing_inputs: [], summary: null,
  }} />);
  expect(screen.queryByRole("img", { name: "Task result page" })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(api.apiRequest).toHaveBeenCalledWith("/farm-assistant/conversations/chat-1/workflows/workflow-4/refresh");
  expect(screen.getByRole("link", { name: "Open result page" })).toHaveAttribute("href", "/field-shift/rotation?run=job-1");
  expect(screen.getByRole("img", { name: "Task result page" })).toHaveAttribute("src", "blob:job-preview");
});
