"use client";

import { useI18n } from "@/lib/i18n/provider";
import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Minus } from "lucide-react";
import type { BotIdentity, BotMode } from "@/lib/bot";
import styles from "./bot.module.css";

export type BotProps = {
  identity: BotIdentity;
  mode: BotMode;
  onModeChange: (mode: BotMode) => void;
  children: ReactNode;
  headerActions?: ReactNode;
};

export function BotAvatar({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${small ? styles.smallAvatar : ""}`}
    >
      <span className={styles.eyes}>
        <i />
        <i />
      </span>
    </span>
  );
}

/** Persistent, non-modal companion. Domain state and transport belong to the caller. */
export function Bot({
  identity,
  mode,
  onModeChange,
  children,
  headerActions,
}: BotProps) {
  const { t } = useI18n();

  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const preview = useRef(false);
  const suppressed = useRef(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const change = useRef(onModeChange);
  const previous = useRef(mode);
  const open = mode === "chat";
  useEffect(() => {
    change.current = onModeChange;
  }, [onModeChange]);
  useEffect(() => {
    if (mode === "chat" && !preview.current) {
      // Hover previews must never steal keyboard focus from the map.
      panel.current
        ?.querySelector<HTMLTextAreaElement>("textarea")
        ?.focus({ preventScroll: true });
    } else if (
      mode === "collapsed" &&
      previous.current !== mode &&
      panel.current?.contains(document.activeElement)
    ) {
      launcher.current?.focus({ preventScroll: true });
    }
    previous.current = mode;
  }, [mode]);
  useEffect(
    () => () => {
      clearTimeout(enterTimer.current);
      clearTimeout(leaveTimer.current);
    },
    [],
  );
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      const keyboard = inset > 80;
      panel.current?.style.setProperty(
        "--bot-visible-height",
        `${viewport.height}px`,
      );
      panel.current?.style.setProperty(
        "--bot-mobile-bottom",
        keyboard
          ? `${inset + 12}px`
          : "calc(110px + env(safe-area-inset-bottom))",
      );
      panel.current?.setAttribute("data-keyboard", String(keyboard));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  function pin() {
    preview.current = false;
    clearTimeout(leaveTimer.current);
  }
  function collapse() {
    pin();
    suppressed.current = true;
    clearTimeout(enterTimer.current);
    onModeChange("collapsed");
    launcher.current?.focus({ preventScroll: true });
  }
  function enter() {
    clearTimeout(leaveTimer.current);
    if (
      open ||
      suppressed.current ||
      !window.matchMedia?.("(hover: hover) and (pointer: fine)").matches
    )
      return;
    clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => {
      preview.current = true;
      change.current("chat");
    }, 350);
  }
  function leave() {
    clearTimeout(enterTimer.current);
    suppressed.current = false;
    if (preview.current)
      leaveTimer.current = setTimeout(() => {
        if (preview.current) {
          preview.current = false;
          change.current("collapsed");
        }
      }, 400);
  }
  const color = {
    "--bot-accent": identity.color ?? "#7962ce",
  } as CSSProperties;
  return (
    <>
      <button
        ref={launcher}
        type="button"
        className={styles.launcher}
        style={color}
        aria-label={
          open ? t("{0}，对话已展开", { "0": identity.name }) : t("打开{0}", { "0": identity.name })
        }
        aria-expanded={open}
        aria-controls={id}
        data-open={open}
        onPointerEnter={enter}
        onPointerLeave={(e) => {
          leave();
          e.currentTarget.style.removeProperty("--gaze-x");
          e.currentTarget.style.removeProperty("--gaze-y");
        }}
        onPointerMove={(e) => {
          if (
            e.pointerType !== "mouse" ||
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          )
            return;
          const bounds = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty(
            "--gaze-x",
            `${Math.max(-3, Math.min(3, (e.clientX - bounds.left - bounds.width / 2) / 12))}px`,
          );
          e.currentTarget.style.setProperty(
            "--gaze-y",
            `${Math.max(-2, Math.min(2, (e.clientY - bounds.top - bounds.height / 2) / 12))}px`,
          );
        }}
        onClick={() => {
          clearTimeout(enterTimer.current);
          if (open && !preview.current) collapse();
          else {
            pin();
            onModeChange("chat");
            panel.current
              ?.querySelector("textarea")
              ?.focus({ preventScroll: true });
          }
        }}
      >
        <span className={styles.petShadow} aria-hidden="true" />
        <BotAvatar />
        <span className={styles.petLabel}>
          {identity.name}
          <span>{t("点我聊聊")}</span>
        </span>
      </button>
      <section
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="false"
        aria-hidden={!open}
        inert={!open}
        data-bot-panel
        data-mode={mode}
        className={styles.panel}
        style={color}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onPointerDownCapture={pin}
        onFocusCapture={pin}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            collapse();
          }
        }}
      >
        <header className={styles.header}>
          <BotAvatar small />
          <div className={styles.heading}>
            <h2 id={`${id}-title`}>{identity.name}</h2>
            <p id={`${id}-description`}>{t(identity.description)}</p>
          </div>
          <div className={styles.headerActions}>{headerActions}</div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t("收起{0}", { "0": identity.name })}
            onClick={collapse}
          >
            <Minus size={19} />
          </button>
        </header>
        <div className={styles.chat}>{children}</div>
      </section>
    </>
  );
}
