import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TaskResultCard } from "./task-result-card";

const api = vi.hoisted(() => ({ apiBlob: vi.fn() }));
vi.mock("@/lib/api/client", () => api);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
