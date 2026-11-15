import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentWorkspace } from "./agent-workspace";
import { setLocale } from "@/lib/i18n/locale";

vi.mock("./agent-api", () => ({ listConversations: vi.fn().mockResolvedValue({ items: [] }) }));
vi.mock("@/lib/api/client", () => ({ getCurrentUser: vi.fn().mockResolvedValue({ id: "farmer-1", display_name: "Farmer", email: "farmer@example.test", email_verified: true }) }));

afterEach(() => { cleanup(); localStorage.clear(); setLocale("en"); });

it("resizes the assistants panel by dragging its visible right border", async () => {
  render(<AgentWorkspace />);
  const panel = await screen.findByRole("complementary", { name: "Your SI assistants" });
  const workspace = panel.closest("main") as HTMLElement;
  const before = Number.parseInt(workspace.style.getPropertyValue("--assistant-panel-width"), 10);
  Object.defineProperty(panel, "getBoundingClientRect", { configurable: true, value: () => ({ right: before, width: before }) });
  Object.defineProperty(panel, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(panel, "releasePointerCapture", { configurable: true, value: vi.fn() });

  function pointer(type: string, x: number) {
    fireEvent(panel, Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x }), { pointerId: 1 }));
  }
  pointer("pointerdown", before - 1);
  pointer("pointermove", before + 119);
  pointer("pointerup", before + 119);

  expect(Number.parseInt(workspace.style.getPropertyValue("--assistant-panel-width"), 10)).toBeGreaterThan(before);
});
