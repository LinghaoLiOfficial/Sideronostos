import { afterEach, expect, it, vi } from "vitest";
import {
  createDictation,
  type RecognitionPort,
  type DictationSnapshot,
} from "./dictation";
function setup() {
  const recognition: RecognitionPort = {
    lang: "",
    interimResults: false,
    continuous: false,
    onstart: null,
    onend: null,
    onerror: null,
    onresult: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  let snapshot: DictationSnapshot = { phase: "idle", preview: "", error: null };
  const onText = vi.fn();
  const session = createDictation({
    create: () => recognition,
    language: "zh-CN",
    onSnapshot: (s) => {
      snapshot = s;
    },
    onText,
  });
  const result = (text: string, final = true) =>
    recognition.onresult?.({
      results: [Object.assign([{ transcript: text }], { isFinal: final })],
    });
  return { session, recognition, onText, result, state: () => snapshot };
}
afterEach(() => {
  vi.useRealTimers();
});
it("inserts final dictated text only when stopped, never interim text or a message submission", () => {
  const t = setup();
  t.session.start();
  t.recognition.onstart?.();
  t.result("下一茬", false);
  expect(t.state().preview).toBe("下一茬");
  expect(t.onText).not.toHaveBeenCalled();
  t.session.finish();
  t.result("下一茬种什么？");
  t.recognition.onend?.();
  expect(t.onText).toHaveBeenCalledTimes(1);
  expect(t.onText).toHaveBeenCalledWith("下一茬种什么？");
  expect(t.state().phase).toBe("idle");
});
it("discards late results after cancel or after releasing before permission finishes", () => {
  const t = setup();
  t.session.start();
  t.session.finish();
  t.recognition.onstart?.();
  t.result("不能加入草稿");
  t.recognition.onend?.();
  expect(t.onText).not.toHaveBeenCalled();
  expect(t.state().phase).toBe("idle");
  t.session.start();
  t.recognition.onstart?.();
  t.session.cancel();
  t.result("仍不能加入");
  t.recognition.onend?.();
  expect(t.onText).not.toHaveBeenCalled();
});
it("reports actionable permission failure and does not keep partial words", () => {
  const t = setup();
  t.session.start();
  t.recognition.onerror?.({ error: "not-allowed" });
  expect(t.state().error).toMatch(/麦克风/);
  expect(t.state().phase).toBe("idle");
  expect(t.onText).not.toHaveBeenCalled();
});
it("stops listening at the duration cap and abandons a service that never finishes", () => {
  vi.useFakeTimers();
  const t = setup();
  t.session.start();
  t.recognition.onstart?.();
  vi.advanceTimersByTime(60000);
  expect(t.state().phase).toBe("finishing");
  vi.advanceTimersByTime(8000);
  expect(t.state().phase).toBe("idle");
  expect(t.state().error).toMatch(/重试/);
  expect(t.onText).not.toHaveBeenCalled();
});
it("reports unsupported recognition without attempting to send audio", () => {
  let error: string | null = null;
  const s = createDictation({
    create: () => null,
    language: "zh-CN",
    onSnapshot: (v) => {
      error = v.error;
    },
    onText: vi.fn(),
  });
  s.start();
  expect(error).toMatch(/浏览器/);
});
