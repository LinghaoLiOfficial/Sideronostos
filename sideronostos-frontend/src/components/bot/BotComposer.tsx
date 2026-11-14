"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ArrowUp, LoaderCircle, Mic, Square, X } from "lucide-react";
import {
  browserRecognition,
  createDictation,
  type DictationSnapshot,
} from "@/lib/dictation";
import styles from "./composer.module.css";

export type BotComposerProps = {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  active: boolean;
  label: string;
  placeholder?: string;
  language?: string;
  pending?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  maxLength?: number;
};
const idle: DictationSnapshot = { phase: "idle", preview: "", error: null };
type Hold = {
  id: number;
  x: number;
  y: number;
  started: boolean;
  cancel: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** Text remains caller-owned; dictation only edits the draft, never sends a message. */
export function BotComposer({
  value,
  onChange,
  onSend,
  active,
  label,
  placeholder = "想聊点什么？",
  language = "zh-CN",
  pending = false,
  inputRef,
  maxLength = 2000,
}: BotComposerProps) {
  const english = language.toLowerCase().startsWith("en");
  const ownInput = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? ownInput;
  const id = useId();
  const [speech, setSpeech] = useState<DictationSnapshot>(idle);
  const [cancelZone, setCancelZone] = useState(false);
  const [holding, setHolding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<ReturnType<typeof createDictation> | null>(null);
  const state = useRef<DictationSnapshot>(idle);
  const hold = useRef<Hold | null>(null);
  const insertion = useRef({ value: "", start: 0, end: 0 });
  const live = useRef({ value, onChange, active, maxLength });
  useEffect(() => {
    live.current = { value, onChange, active, maxLength };
  }, [value, onChange, active, maxLength]);
  useEffect(() => {
    let mounted = true;
    const session = createDictation({
      create: browserRecognition,
      language,
      onSnapshot: (next) => {
        state.current = next;
        if (mounted) setSpeech(next);
      },
      onText: (transcript) => {
        if (!mounted || !live.current.active) return;
        const base = insertion.current;
        if (live.current.value !== base.value) {
          setNotice(english ? "The draft changed. Please dictate again." : "输入已更新，请重新说一次。");
          return;
        }
        const before = base.value.slice(0, base.start),
          after = base.value.slice(base.end);
        const available = Math.max(
          0,
          live.current.maxLength - before.length - after.length,
        );
        // Preserve the existing draft and never split a UTF-16 surrogate pair.
        let inserted = transcript.slice(0, available);
        if (/[\uD800-\uDBFF]$/.test(inserted)) inserted = inserted.slice(0, -1);
        if (inserted.length < transcript.length)
          setNotice("输入框已满，部分语音未加入。请检查后再发送。");
        live.current.onChange(before + inserted + after);
        input.current?.focus({ preventScroll: true });
      },
    });
    controller.current = session;
    function clearHold() {
      clearTimeout(hold.current?.timer);
      hold.current = null;
      setCancelZone(false);
    }
    function cancel() {
      clearHold();
      if (state.current.phase !== "idle") session.cancel();
    }
    function release(event: PointerEvent) {
      const gesture = hold.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      clearHold();
      if (gesture.started) {
        if (gesture.cancel || event.type === "pointercancel") session.cancel();
        else session.finish();
      }
    }
    function move(event: PointerEvent) {
      const gesture = hold.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      if (
        !gesture.started &&
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10
      ) {
        clearHold();
        return;
      }
      if (gesture.started) {
        gesture.cancel = gesture.y - event.clientY >= 64;
        setCancelZone(gesture.cancel);
      }
    }
    function visibility() {
      if (document.visibilityState === "hidden") cancel();
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("pointermove", move);
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted = false;
      clearTimeout(hold.current?.timer);
      hold.current = null;
      session.cancel();
      controller.current = null;
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [language, input, english]);
  useEffect(() => {
    if (
      !active ||
      (state.current.phase !== "idle" && value !== insertion.current.value)
    ) {
      clearTimeout(hold.current?.timer);
      hold.current = null;
      if (state.current.phase !== "idle") controller.current?.cancel();
    }
  }, [active, value]);
  function start(viaHold = false) {
    if (!active || state.current.phase !== "idle") return;
    insertion.current = {
      value,
      start: input.current?.selectionStart ?? value.length,
      end: input.current?.selectionEnd ?? value.length,
    };
    setHolding(viaHold);
    setNotice(null);
    setCancelZone(false);
    controller.current?.start();
  }
  function cancel() {
    clearTimeout(hold.current?.timer);
    hold.current = null;
    setCancelZone(false);
    controller.current?.cancel();
  }
  const recording = speech.phase !== "idle";
  const status = cancelZone
    ? (english ? "Release to cancel" : "松开取消")
    : speech.phase === "starting"
      ? (english ? "Starting microphone…" : "正在开启麦克风…")
      : speech.phase === "finishing"
        ? (english ? "Turning speech into text…" : "正在转成文字…")
        : holding
          ? (english ? "Release to insert text · swipe up to cancel" : "松开转文字 · 上滑取消")
          : (english ? "Listening · tap to insert text" : "正在听 · 点击停止转文字");
  return (
    <div
      className={styles.root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && recording) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {recording && (
        <div className={styles.voiceStatus} data-cancel={cancelZone}>
          <span
            className={styles.wave}
            data-listening={speech.phase === "listening"}
            aria-hidden="true"
          >
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            <p role="status">{status}</p>
            <span className={styles.preview}>
              {speech.preview || (english ? "Speech fills the draft. You choose when to send." : "语音只会填入输入框，由你确认发送")}
            </span>
          </div>
          <button type="button" onClick={cancel} aria-label={english ? "Cancel voice input" : "取消语音输入"}>
            <X size={16} />
          </button>
        </div>
      )}
      <form
        className={styles.composer}
        data-recording={recording}
        onSubmit={(event) => {
          event.preventDefault();
          if (!recording && !pending && value.trim()) {
            onSend();
            input.current?.focus({ preventScroll: true });
          }
        }}
      >
        <textarea
          ref={input}
          aria-label={label}
          aria-describedby={`${id}-hint`}
          value={value}
          maxLength={maxLength}
          rows={2}
          placeholder={placeholder}
          readOnly={recording}
          onChange={(event) => onChange(event.target.value)}
          onPointerDown={(event) => {
            if (event.button !== 0 || recording || !active || hold.current)
              return;
            const gesture: Hold = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              started: false,
              cancel: false,
            };
            hold.current = gesture;
            gesture.timer = setTimeout(() => {
              if (hold.current !== gesture || !live.current.active) return;
              // Moving before the hold threshold remains ordinary text selection.
              gesture.started = true;
              start(true);
            }, 450);
          }}
          onContextMenu={(event) => {
            if (state.current.phase !== "idle") event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (!recording && !pending && value.trim()) {
                onSend();
                input.current?.focus({ preventScroll: true });
              }
            }
          }}
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.mic}
            aria-label={recording ? (english ? "Stop voice and insert text" : "停止语音并转成文字") : (english ? "Start voice input" : "开始语音输入")}
            aria-pressed={recording}
            disabled={speech.phase === "finishing"}
            onClick={() => (recording ? controller.current?.finish() : start())}
          >
            {recording ? <Square size={15} /> : <Mic size={18} />}
          </button>
          <button
            type="submit"
            className={styles.send}
            disabled={pending || recording || !value.trim()}
            aria-label={english ? "Send message" : "发送消息"}
          >
            {pending ? <LoaderCircle size={18} /> : <ArrowUp size={20} />}
          </button>
        </div>
      </form>
      <p id={`${id}-hint`} className={styles.hint}>
        {english ? "Hold the composer to dictate · your browser transcribes speech" : "按住输入框说话 · 语音由浏览器服务转写"}
      </p>
      {(speech.error || notice) && (
        <p role="alert" className={styles.error}>
          {speech.error || notice}
        </p>
      )}
    </div>
  );
}
