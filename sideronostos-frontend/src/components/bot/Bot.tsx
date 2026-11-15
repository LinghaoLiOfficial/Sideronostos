"use client";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CloudSun, Droplet, Layers3, Map, MapPin, Minus, RefreshCw, Sprout, Wheat } from "lucide-react";
import type { BotAvatarVariant, BotIdentity, BotMode } from "@/lib/bot";
import type { Locale } from "@/lib/i18n/locale";
import { useI18n } from "@/lib/i18n/provider";
import styles from "./bot.module.css";

export type BotProps = {
  identity: BotIdentity;
  mode: BotMode;
  onModeChange: (mode: BotMode) => void;
  children: ReactNode;
  headerActions?: ReactNode;
  locale?: Locale;
  purpose?: "chat" | "details";
};

const avatarOutlines: Record<BotAvatarVariant, string> = {
  farm: "M9 39C8 22 23 8 55 7C54 37 43 56 25 58C14 59 8 50 9 39Z",
  field: "M14 7C23 8 28 11 32 13C36 11 41 8 50 7C54 7 56 10 56 14V49C56 54 53 57 48 57C42 57 37 55 32 52C27 55 22 57 16 57C11 57 8 54 8 49V14C8 10 10 7 14 7Z",
  water: "M32 3C28 14 12 26 12 40C12 52 21 60 32 60C43 60 52 52 52 40C52 26 36 14 32 3Z",
  soil: "M6 45C7 29 15 17 24 16C29 6 40 7 46 17C55 20 60 31 58 44C56 55 47 59 32 60C17 60 8 56 6 45Z",
  weather: "M8 41C6 33 10 25 18 23C19 13 28 8 37 12C43 14 47 19 48 25C56 25 61 33 58 42C55 51 48 55 38 55H21C13 55 9 50 8 41Z",
  knowledge: "M11 9C20 7 27 8 32 12C37 8 44 7 53 9V50C44 48 37 49 32 54C27 49 20 48 11 50V9Z",
  rotation: "M29 4C34 2 38 4 42 7L57 21C60 24 61 28 59 32L50 52C48 57 45 59 40 59L18 55C13 54 10 51 8 46L5 27C4 22 6 19 10 16L29 4Z",
};

export function BotAvatar({ small = false, variant }: { small?: boolean; variant?: BotAvatarVariant }) {
  const Icon = variant === "farm" ? Wheat : variant === "field" ? Map : variant === "water" ? Droplet : variant === "soil" ? Layers3 : variant === "weather" ? CloudSun : variant === "knowledge" ? MapPin : variant === "rotation" ? RefreshCw : Sprout;
  const gradientId = useId().replace(/:/g, "");
  const avatarRef = useRef<HTMLSpanElement>(null);
  const bounceRef = useRef<Animation | null>(null);
  useEffect(() => () => bounceRef.current?.cancel(), []);

  function bounce() {
    const avatar = avatarRef.current;
    if (!avatar?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    bounceRef.current?.cancel();
    bounceRef.current = avatar.animate(
      [
        { transform: "translateY(1px) scale(1.09, 0.78)", offset: 0 },
        { transform: "translateY(-7px) scale(0.88, 1.16)", offset: 0.24 },
        { transform: "translateY(0) scale(1.09, 0.88)", offset: 0.46 },
        { transform: "translateY(-3px) scale(0.96, 1.06)", offset: 0.67 },
        { transform: "translateY(0) scale(1.02, 0.98)", offset: 0.84 },
        { transform: "translateY(-2px) scale(1)", offset: 1 },
      ],
      { duration: 720, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }

  return (
    <span
      ref={avatarRef}
      aria-hidden="true"
      className={`${styles.avatar} ${small ? styles.smallAvatar : ""}`}
      data-avatar={variant}
      onPointerUp={bounce}
    >
      <svg className={styles.avatarShape} viewBox="0 0 64 64" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className={styles.avatarLight} />
            <stop offset="58%" className={styles.avatarMid} />
            <stop offset="100%" className={styles.avatarDark} />
          </linearGradient>
        </defs>
        <path className={styles.avatarBody} d={avatarOutlines[variant ?? "farm"]} fill={`url(#${gradientId})`} />
      </svg>
      <span className={styles.avatarAccessory}>
        <Icon className={styles.avatarSymbol} strokeWidth={1.85} />
      </span>
      <span className={styles.avatarEyes}>
        <i className={styles.avatarEye} /><i className={styles.avatarEye} />
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
  locale: localeProp,
  purpose = "chat",
}: BotProps) {
  const { locale: interfaceLocale, t } = useI18n();
  const locale = localeProp ?? (interfaceLocale === "zh" ? "zh-CN" : "en");
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
    "--bot-accent": identity.color ?? "#4d9b75",
  } as CSSProperties;
  const launcherLabel = open
    ? locale === "en"
      ? `${identity.name}, ${purpose === "chat" ? "chat" : "details"} open`
      : `${identity.name}，${purpose === "chat" ? "对话" : "详情"}已展开`
    : locale === "en"
      ? `Open ${identity.name}`
      : `打开${identity.name}`;
  const launcherHint = locale === "en"
    ? purpose === "chat" ? "Tap to chat" : "View details"
    : purpose === "chat" ? "点我聊聊" : "查看详情";
  return (
    <>
      <button
        ref={launcher}
        type="button"
        className={styles.launcher}
        style={color}
        aria-label={launcherLabel}
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
        <BotAvatar variant={identity.avatar} />
        <span className={styles.petLabel} aria-hidden={open}>
          {identity.name}
          <span>{launcherHint}</span>
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
          <BotAvatar small variant={identity.avatar} />
          <div className={styles.heading}>
            <h2 id={`${id}-title`}>{identity.name}</h2>
            <p id={`${id}-description`}>{t(identity.description)}</p>
          </div>
          <div className={styles.headerActions}>{headerActions}</div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={locale === "en" ? `Collapse ${identity.name}` : `收起${identity.name}`}
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
