"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { Bot, BotAvatar } from "./Bot";
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
              onClick={() => { setExpanded(false); setSelected(bot); }}
            >
              <BotAvatar variant={bot.avatar} small />
              <span className={styles.avatarLabel} aria-hidden={!expanded}>{bot.shortName[locale]}</span>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <div className={styles.botHost}>
          <Bot
            identity={{ id: selected.id, name: selected.name[locale], description: selected.capability[locale], color: selected.color, avatar: selected.avatar }}
            locale={locale}
            purpose="details"
            mode="chat"
            onModeChange={(mode) => { if (mode === "collapsed") collapseChat(); }}
          >
            <div className={styles.notice}>
              <h3>{locale === "en" ? "Chat not available here yet" : "此处暂不能对话"}</h3>
              <p>{selected.fallback[locale]}</p>
            </div>
          </Bot>
        </div>
      )}
    </div>
  );
}
