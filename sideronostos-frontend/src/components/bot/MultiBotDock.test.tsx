import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { botsForModule } from "@/lib/bot-catalog";
import { MultiBotDock } from "./MultiBotDock";

beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("exposes distinct water, soil and weather specialists under remote sensing", () => {
  expect(botsForModule("remote-sensing").map((bot) => bot.id)).toEqual([
    "remote-water",
    "remote-soil",
    "remote-weather",
  ]);
  expect(botsForModule("remote-sensing").every((bot) => bot.presetId === "remote_sensing")).toBe(true);
  expect(botsForModule("field-management")).toHaveLength(1);
  expect(botsForModule("local-knowledge")).toHaveLength(1);
  expect(botsForModule("rotation-recommendation")).toHaveLength(1);
});

it("shows the specialist count and opens only the chosen bot with an honest availability message", () => {
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  expect(screen.getByRole("button", { name: "3 specialists. Expand" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open Soil specialist" }));
  expect(screen.getByRole("dialog", { name: "Soil specialist" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Soil specialist, details open" })).toBeVisible();
  expect(screen.getByText(/not connected yet/i)).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open Water specialist" })).not.toBeInTheDocument();
});

it("expands on pointer hover and offers an explicit touch toggle", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const { container } = render(<MultiBotDock module="remote-sensing" locale="en" />);
  const dock = container.querySelector("[data-multi-bot-dock]")!;
  const cluster = container.querySelector("[data-bot-cluster]")!;
  fireEvent.pointerEnter(cluster, { pointerType: "mouse" });
  expect(dock).toHaveAttribute("data-expanded", "true");
  fireEvent.pointerLeave(cluster, { pointerType: "mouse" });
  expect(dock).toHaveAttribute("data-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "3 specialists. Expand" }));
  expect(dock).toHaveAttribute("data-expanded", "true");
  expect(screen.getByRole("button", { name: "3 specialists. Collapse" })).toHaveAttribute("aria-expanded", "true");
});

it("keeps the touch toggle open when tap focuses it before clicking", () => {
  const { container } = render(<MultiBotDock module="remote-sensing" locale="en" />);
  const toggle = screen.getByRole("button", { name: "3 specialists. Expand" });
  fireEvent.focus(toggle);
  fireEvent.click(toggle);
  expect(container.querySelector("[data-multi-bot-dock]")).toHaveAttribute("data-expanded", "true");
});

it("reveals readable specialist names when the remote cluster expands", () => {
  const { rerender } = render(<MultiBotDock module="remote-sensing" locale="en" />);
  expect(screen.getByText("Water")).toHaveAttribute("aria-hidden", "true");
  fireEvent.click(screen.getByRole("button", { name: "3 specialists. Expand" }));
  expect(screen.getByText("Water")).toHaveAttribute("aria-hidden", "false");
  expect(screen.getByText("Soil")).toHaveAttribute("aria-hidden", "false");
  expect(screen.getByText("Weather")).toHaveAttribute("aria-hidden", "false");
  rerender(<MultiBotDock module="remote-sensing" locale="zh-CN" />);
  expect(screen.getByText("水分")).toHaveAttribute("aria-hidden", "false");
});

it("restores focus to the selected bot after Escape collapses chat", () => {
  render(<MultiBotDock module="remote-sensing" locale="en" />);
  fireEvent.click(screen.getByRole("button", { name: "Open Water specialist" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Water specialist" })).toHaveFocus();
});

it("focuses its own panel when another bot panel is present on the page", () => {
  render(<><section data-bot-panel><button>Other bot</button></section><MultiBotDock module="remote-sensing" locale="en" /></>);
  fireEvent.click(screen.getByRole("button", { name: "Open Water specialist" }));
  expect(screen.getByRole("button", { name: "Collapse Water specialist" })).toHaveFocus();
});

it("changes labels and limitation copy with locale", () => {
  const { rerender } = render(<MultiBotDock module="remote-sensing" locale="en" />);
  expect(screen.getByRole("button", { name: "Open Weather specialist" })).toBeVisible();
  rerender(<MultiBotDock module="remote-sensing" locale="zh-CN" />);
  fireEvent.click(screen.getByRole("button", { name: "打开天气助手" }));
  expect(screen.getByRole("dialog", { name: "天气助手" })).toBeVisible();
  expect(screen.getByText(/尚未接入/)).toBeVisible();
});
