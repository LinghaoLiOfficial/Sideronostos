"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import { Bot, BotAvatar } from "./Bot";
import { MultiBotChat } from "./MultiBotChat";
import { botsForModule, type CatalogBot, type SiBotModule } from "@/lib/bot-catalog";
import { useLocale, type Locale } from "@/lib/i18n/locale";
import styles from "./MultiBotDock.module.css";

export function MultiBotDock({ module, locale: localeOverride }: { module: SiBotModule; locale?: Locale }) {
  const persistedLocale = useLocale();
  const locale = localeOverride ?? persistedLocale;
  const bots = botsForModule(module);
  const [selected, setSelected] = useState<CatalogBot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const restoreId = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [position, setPosition] = useState({ right: 26, bottom: 33 });
  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);

  const clampPosition = useCallback((right: number, bottom: number) => {
    const width = root.current?.querySelector<HTMLElement>("[data-bot-cluster]")?.offsetWidth ?? 180;
    const height = root.current?.querySelector<HTMLElement>("[data-bot-cluster]")?.offsetHeight ?? 72;
    return {
      right: Math.max(12, Math.min(right, window.innerWidth - width - 12)),
      bottom: Math.max(12, Math.min(bottom, window.innerHeight - height - 12)),
    };
  }, []);

  useLayoutEffect(() => {
    let frame = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(`agrisata-bot-dock:${module}`) || "null");
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) {
        frame = requestAnimationFrame(() => setPosition(clampPosition(saved.right, saved.bottom)));
      }
    } catch { /* An invalid saved position is ignored. */ }
    return () => cancelAnimationFrame(frame);
  }, [module, clampPosition]);

  useLayoutEffect(() => {
    const onResize = () => setPosition((current) => clampPosition(current.right, current.bottom));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPosition]);

  function place(right: number, bottom: number) {
    const next = clampPosition(right, bottom);
    setPosition(next);
    localStorage.setItem(`agrisata-bot-dock:${module}`, JSON.stringify(next));
  }

  useLayoutEffect(() => {
    if (selected) {
      root.current?.querySelector<HTMLElement>("[data-bot-panel] button")?.focus({ preventScroll: true });
    } else if (restoreId.current) {
      buttons.current.get(restoreId.current)?.focus({ preventScroll: true });
      restoreId.current = null;
    }
  }, [selected]);

  function collapseChat() {
    if (!selected) return;
    restoreId.current = selected.id;
    setSelected(null);
  }

  const countLabel = locale === "en"
    ? `${bots.length} ${bots.length === 1 ? "specialist" : "specialists"}. ${expanded ? "Collapse" : "Expand"}`
    : `${bots.length} 位助手，${expanded ? "收起" : "展开"}`;

  return (
    <div ref={root} className={styles.root} data-multi-bot-dock data-expanded={expanded}>
      <div
        className={styles.cluster}
        data-bot-cluster
        style={{ "--dock-right": `${position.right}px`, "--dock-bottom": `${position.bottom}px` } as CSSProperties}
        hidden={selected !== null}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) setExpanded(true);
        }}
        onPointerLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement)) setExpanded(false);
        }}
        onFocusCapture={(event) => {
          if (event.target !== event.currentTarget.firstElementChild) setExpanded(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && expanded) {
            event.stopPropagation();
            setExpanded(false);
            event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
          }
        }}
      >
        <button
          type="button"
          className={styles.dragHandle}
          aria-label={locale === "en" ? "Move assistants" : "移动助手"}
          title={locale === "en" ? "Drag to move. Arrow keys also work." : "拖动位置，也可使用方向键。"}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            drag.current = { x: event.clientX, y: event.clientY, ...position };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
              place(drag.current.right + drag.current.x - event.clientX, drag.current.bottom + drag.current.y - event.clientY);
            }
          }}
          onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(event) => {
            const delta = event.shiftKey ? 40 : 12;
            if (event.key === "ArrowLeft") place(position.right + delta, position.bottom);
            else if (event.key === "ArrowRight") place(position.right - delta, position.bottom);
            else if (event.key === "ArrowUp") place(position.right, position.bottom + delta);
            else if (event.key === "ArrowDown") place(position.right, position.bottom - delta);
            else return;
            event.preventDefault();
          }}
        ><GripVertical size={17} aria-hidden="true" /></button>
        <button
          type="button"
          className={styles.toggle}
          aria-label={countLabel}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={styles.count}>{bots.length}</span>
          <span className={styles.label}>{locale === "en" ? "Specialists" : "专属助手"}</span>
          <ChevronDown className={styles.chevron} size={15} aria-hidden="true" />
        </button>
        <div className={styles.avatars} aria-label={locale === "en" ? "Choose a specialist" : "选择助手"}>
          {bots.map((bot) => (
            <button
              key={bot.id}
              ref={(node) => { if (node) buttons.current.set(bot.id, node); else buttons.current.delete(bot.id); }}
              type="button"
              className={styles.botButton}
              style={{ "--bot-accent": bot.color } as CSSProperties}
              aria-label={locale === "en" ? `Open ${bot.name.en}` : `打开${bot.name["zh-CN"]}`}
              title={bot.name[locale]}
              onPointerMove={(event) => {
                if (event.pointerType !== "mouse" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                event.currentTarget.style.setProperty("--gaze-x", `${Math.max(-2, Math.min(2, (event.clientX - bounds.left - bounds.width / 2) / 12))}px`);
                event.currentTarget.style.setProperty("--gaze-y", `${Math.max(-2, Math.min(2, (event.clientY - bounds.top - bounds.height / 2) / 12))}px`);
              }}
              onPointerLeave={(event) => {
                event.currentTarget.style.removeProperty("--gaze-x");
                event.currentTarget.style.removeProperty("--gaze-y");
              }}
              onClick={() => { setExpanded(false); setSelected(bot); }}
            >
              <BotAvatar variant={bot.avatar} small />
              <span className={styles.avatarLabel} aria-hidden={!expanded}>{bot.shortName[locale]}</span>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <div className={styles.botHost} style={{ "--dock-right": `${position.right}px`, "--dock-bottom": `${position.bottom}px` } as CSSProperties}>
          <Bot
            identity={{ id: selected.id, name: selected.name[locale], description: selected.capability[locale], color: selected.color, avatar: selected.avatar }}
            locale={locale}
            purpose="chat"
            mode="chat"
            onModeChange={(mode) => { if (mode === "collapsed") collapseChat(); }}
          >
            <MultiBotChat bot={selected} locale={locale} />
          </Bot>
        </div>
      )}
    </div>
  );
}
