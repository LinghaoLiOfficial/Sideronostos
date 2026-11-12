"use client";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2, Minus } from "lucide-react";
import type { BotIdentity, BotMode } from "@/lib/bot";
import styles from "./bot.module.css";

export type BotDataView = { label: string; content: ReactNode };
export type BotProps = {
  identity: BotIdentity;
  mode: BotMode;
  onModeChange: (mode: BotMode) => void;
  children: ReactNode;
  headerActions?: ReactNode;
  dataView?: BotDataView;
};

export function BotAvatar({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${small ? styles.smallAvatar : ""}`}
    >
      <i />
      <i />
    </span>
  );
}

/** A reusable, controlled bot surface. Transport, evidence and domain state belong to the caller. */
export function Bot({
  identity,
  mode,
  onModeChange,
  children,
  headerActions,
  dataView,
}: BotProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const previous = useRef<BotMode>("collapsed");
  const change = useRef(onModeChange);
  useEffect(() => {
    change.current = onModeChange;
  }, [onModeChange]);
  const effective = mode === "data" && !dataView ? "chat" : mode;
  useEffect(() => {
    if (mode === "data" && !dataView) change.current("chat");
  }, [mode, dataView]);
  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const was = previous.current;
    previous.current = effective;
    if (panel.open) panel.close();
    if (effective === "collapsed") {
      if (was !== "collapsed") launcher.current?.focus();
      return;
    }
    if (effective === "data") panel.showModal();
    else panel.show();
    if (effective === "data") expand.current?.focus();
    else panel.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const overflow = document.body.style.overflow;
    if (effective === "data") document.body.style.overflow = "hidden";
    return () => {
      if (effective === "data") document.body.style.overflow = overflow;
    };
  }, [effective]);
  useEffect(() => {
    if (effective !== "chat") return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const activePanel =
        event.target instanceof Element
          ? event.target.closest("[data-bot-panel]")
          : null;
      if (activePanel && activePanel !== dialog.current) return;
      event.preventDefault();
      change.current("collapsed");
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [effective]);
  function escape() {
    onModeChange(effective === "data" ? "chat" : "collapsed");
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
        aria-label={`打开${identity.name}`}
        aria-expanded={effective !== "collapsed"}
        aria-controls={id}
        hidden={effective !== "collapsed"}
        onClick={() => onModeChange("chat")}
      >
        <BotAvatar />
        <span>{identity.name}</span>
      </button>
      <dialog
        ref={dialog}
        id={id}
        hidden={effective === "collapsed"}
        data-bot-panel
        data-mode={effective}
        className={styles.panel}
        style={color}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        aria-modal={effective === "data"}
        onCancel={(event) => {
          event.preventDefault();
          escape();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            escape();
          }
        }}
      >
        <header className={styles.header}>
          <BotAvatar small />
          <div className={styles.heading}>
            <h2 id={`${id}-title`}>{identity.name}</h2>
            <p id={`${id}-description`}>
              {effective === "data" ? dataView?.label : identity.description}
            </p>
          </div>
          <div hidden={effective === "data"} className={styles.headerActions}>
            {headerActions}
          </div>
          <button
            ref={expand}
            type="button"
            className={styles.iconButton}
            disabled={!dataView}
            aria-label={effective === "data" ? "返回聊天" : "全屏查看选区数据"}
            title={!dataView ? "先在地图选择位置或范围" : undefined}
            onClick={() => onModeChange(effective === "data" ? "chat" : "data")}
          >
            {effective === "data" ? (
              <Minimize2 size={18} />
            ) : (
              <Maximize2 size={18} />
            )}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`收起${identity.name}`}
            onClick={() => onModeChange("collapsed")}
          >
            <Minus size={19} />
          </button>
        </header>
        <div className={styles.chat} hidden={effective !== "chat"}>
          {children}
        </div>
        <div className={styles.data} hidden={effective !== "data"}>
          {dataView?.content}
        </div>
      </dialog>
    </>
  );
}
