import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { useState } from "react";
import type { BotMode } from "@/lib/bot";
import { Bot } from "./Bot";
function Example() {
  const [mode, setMode] = useState<BotMode>("collapsed");
  return (
    <>
      <button>地图工具</button>
      <Bot
        identity={{ id: "soil", name: "土壤助手", description: "聊聊土壤" }}
        mode={mode}
        onModeChange={setMode}
      >
        <textarea aria-label="消息" />
      </Bot>
    </>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
it("keeps the draft and returns focus when deliberately collapsed, without a full-screen action", () => {
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "打开土壤助手" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "明年种什么？" },
  });
  expect(
    screen.queryByRole("button", { name: /全屏/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
  fireEvent.click(screen.getByRole("button", { name: "收起土壤助手" }));
  expect(screen.getByRole("button", { name: "打开土壤助手" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "打开土壤助手" }));
  expect(screen.getByRole("textbox")).toHaveValue("明年种什么？");
});
it("opens on intentional hover without stealing map focus and closes after a leave grace period", () => {
  render(<Example />);
  screen.getByRole("button", { name: "地图工具" }).focus();
  const pet = screen.getByRole("button", { name: "打开土壤助手" });
  fireEvent.pointerEnter(pet);
  advance(200);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  advance(200);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("button", { name: "地图工具" })).toHaveFocus();
  fireEvent.pointerLeave(pet);
  advance(150);
  fireEvent.pointerEnter(screen.getByRole("dialog"));
  advance(500);
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.pointerLeave(screen.getByRole("dialog"));
  advance(500);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "地图工具" })).toHaveFocus();
});
it("pins a hover-open chat on interaction so moving back to the map does not dismiss it", () => {
  render(<Example />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: "打开土壤助手" }));
  advance(400);
  const panel = screen.getByRole("dialog");
  fireEvent.pointerDown(screen.getByRole("textbox"));
  fireEvent.pointerLeave(panel);
  advance(1000);
  expect(panel).toBeVisible();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  advance(1000);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("does not hover-open on a coarse pointer but still opens by tap", () => {
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: false,
  } as MediaQueryList);
  render(<Example />);
  const pet = screen.getByRole("button", { name: "打开土壤助手" });
  fireEvent.pointerEnter(pet);
  advance(1000);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(pet);
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("does not consume Escape from unrelated map controls", () => {
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "打开土壤助手" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "地图工具" }), {
    key: "Escape",
  });
  expect(screen.getByRole("dialog")).toBeVisible();
});
