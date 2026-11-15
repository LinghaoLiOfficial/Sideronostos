import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "@/test/render-zh";
import { useState } from "react";
import type { RecognitionPort } from "@/lib/dictation";
import { BotComposer } from "./BotComposer";
class Recognition implements RecognitionPort {
  static latest: Recognition;
  lang = "";
  interimResults = false;
  continuous = false;
  onstart: RecognitionPort["onstart"] = null;
  onend: RecognitionPort["onend"] = null;
  onerror: RecognitionPort["onerror"] = null;
  onresult: RecognitionPort["onresult"] = null;
  constructor() {
    Recognition.latest = this;
  }
  start() {}
  stop() {}
  abort() {}
  result(text: string) {
    this.onresult?.({
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
    this.onend?.();
  }
}
const send = vi.fn();
function Example({ active = true }: { active?: boolean }) {
  const [value, setValue] = useState("北田");
  return (
    <BotComposer
      value={value}
      onChange={setValue}
      onSend={send}
      label="消息"
      active={active}
    />
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("SpeechRecognition", Recognition);
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId = 1;
      pointerType = "mouse";
    },
  );
  send.mockClear();
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
function hold() {
  fireEvent.pointerDown(screen.getByRole("textbox"), {
    button: 0,
    clientY: 200,
  });
  advance(500);
  act(() => Recognition.latest.onstart?.());
}
it("keeps short taps as text editing and sends nothing", () => {
  render(<Example />);
  fireEvent.pointerDown(screen.getByRole("textbox"), { button: 0 });
  advance(150);
  fireEvent.pointerUp(window);
  advance(500);
  expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
  expect(send).not.toHaveBeenCalled();
});
it("long press transcribes into the existing draft after release without auto-send", () => {
  render(<Example />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  input.setSelectionRange(2, 2);
  hold();
  expect(input).toHaveAttribute("readonly");
  fireEvent.pointerUp(window);
  act(() => Recognition.latest.result("下一茬种什么？"));
  expect(input).toHaveValue("北田下一茬种什么？");
  expect(send).not.toHaveBeenCalled();
  expect(input).not.toHaveAttribute("readonly");
});
it("slide up cancels and late speech cannot change the draft", () => {
  render(<Example />);
  hold();
  fireEvent.pointerMove(window, { clientY: 120 });
  fireEvent.pointerUp(window, { clientY: 120 });
  act(() => Recognition.latest.result("丢弃这句"));
  expect(screen.getByRole("textbox")).toHaveValue("北田");
  expect(send).not.toHaveBeenCalled();
});
it("provides keyboard-accessible dictation and Escape cancels before the enclosing chat closes", () => {
  const escaped = vi.fn();
  render(
    <div onKeyDown={escaped}>
      <Example />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
  act(() => Recognition.latest.onstart?.());
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  act(() => Recognition.latest.result("丢弃"));
  expect(escaped).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox")).toHaveValue("北田");
});
it("aborts dictation when the chat collapses and ignores later results", () => {
  const view = render(<Example />);
  hold();
  view.rerender(<Example active={false} />);
  act(() => Recognition.latest.result("不能保留"));
  expect(screen.getByRole("textbox")).toHaveValue("北田");
});
it("keeps the draft and explains unsupported speech input", () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/浏览器/);
  expect(screen.getByRole("textbox")).toHaveValue("北田");
});
it("never submits Enter during dictation or an IME composition", () => {
  render(<Example />);
  fireEvent.keyDown(screen.getByRole("textbox"), {
    key: "Enter",
    isComposing: true,
  });
  expect(send).not.toHaveBeenCalled();
  hold();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
});

it("does not overwrite a draft changed externally while speech was in flight", () => {
  const change = vi.fn();
  const view = render(
    <BotComposer
      value="旧草稿"
      onChange={change}
      onSend={send}
      active
      label="消息"
    />,
  );
  hold();
  view.rerender(
    <BotComposer
      value="新的问题"
      onChange={change}
      onSend={send}
      active
      label="消息"
    />,
  );
  act(() => Recognition.latest.result("迟到的话"));
  expect(screen.getByRole("textbox")).toHaveValue("新的问题");
  expect(change).not.toHaveBeenCalled();
});
it("preserves existing text when speech reaches the input limit", () => {
  const change = vi.fn();
  render(
    <BotComposer
      value="AB"
      onChange={change}
      onSend={send}
      active
      label="消息"
      maxLength={4}
    />,
  );
  (screen.getByRole("textbox") as HTMLTextAreaElement).setSelectionRange(1, 1);
  hold();
  fireEvent.pointerUp(window);
  act(() => Recognition.latest.result("🌱XY"));
  expect(change).toHaveBeenCalledWith("A🌱B");
  expect(screen.getByRole("alert")).toHaveTextContent(/部分语音/);
});
