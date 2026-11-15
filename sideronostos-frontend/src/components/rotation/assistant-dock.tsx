"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Reconcile external conversation pages and explicit open requests into the persistent chat view. */

import { useI18n } from "@/lib/i18n/provider";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "@/components/bot/Bot";
import type { BotMode } from "@/lib/bot";
import {
  ArrowUp,
  BookOpen,
  History,
  LoaderCircle,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import * as api from "@/lib/api/rotation";
import type {
  AssistantAction,
  AssistantContext,
  AssistantMessage,
  AssistantPreferences,
  Citation,
  Conversation,
  Fact,
} from "@/lib/api/rotation-types";
import { errorMessage } from "../field-shift/model";
import styles from "./rotation.module.css";
import { BotAnswer } from "@/components/bot/BotAnswer";
import { BotComposer } from "@/components/bot/BotComposer";

export type AssistantDockProps = {
  ownerId: string;
  context: AssistantContext;
  contextLabel: string;
  contextPending?: boolean;
  onAction: (action: AssistantAction) => void;
  openRequest?: { id: number; text: string };
};
type Submission = {
  conversation: string;
  body: { client_message_id: string; text: string; context: AssistantContext };
};
const actionLabels: Record<AssistantAction, string> = {
  open_planner: "打开轮作规划",
  edit_conditions: "调整规划条件",
  choose_field: "选择地块",
  view_sources: "查看依据",
};

function contextKey(ctx: AssistantContext) {
  return JSON.stringify({
    page: ctx.page,
    selection: ctx.selection
      ? { id: ctx.selection.id, revision: ctx.selection.revision }
      : null,
    dates: ctx.dates ? { start: ctx.dates.start, end: ctx.dates.end } : null,
    fields: [...(ctx.fields ?? [])]
      .map((field) => ({
        id: field.id,
        expected_version: field.expected_version,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    run: ctx.run_id ?? null,
    option: ctx.option_id ?? null,
    otherRun: ctx.compare_run_id ?? null,
    otherOption: ctx.compare_option_id ?? null,
    analysis: ctx.analysis_id ?? null,
    dirty: ctx.draft?.dirty ?? false,
    changes: [...(ctx.draft?.changed_fields ?? [])].sort(),
  });
}
function mergeMessages(
  existing: AssistantMessage[],
  incoming: AssistantMessage[],
) {
  const rows = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    const old = rows.get(item.id);
    if (!old || old.status === "pending" || item.status !== "pending")
      rows.set(item.id, item);
  }
  return [...rows.values()].sort((a, b) => a.sequence - b.sequence);
}
function storageRead(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageWrite(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}
function sourceUrl(url: unknown) {
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : undefined;
}

export function AssistantDock(props: AssistantDockProps) {
  // Account changes remount all private local state, including any in-flight callbacks.
  return <AssistantSession key={props.ownerId} {...props} />;
}
function AssistantSession({
  ownerId,
  context,
  contextLabel,
  contextPending = false,
  onAction,
  openRequest,
}: AssistantDockProps) {
  const { t, locale, setLocale } = useI18n();

  const storageKey = `field-shift:assistant:${ownerId}`;
  const [mode, setMode] = useState<BotMode>("collapsed");
  const open = mode !== "collapsed";
  const setOpen = (value: boolean) => setMode(value ? "chat" : "collapsed");
  const [text, setText] = useState("");
  const [conversation, setConversation] = useState<string | null>(() =>
    storageRead(storageKey),
  );
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [preferences, setPreferences] = useState<AssistantPreferences>({
    language: "zh",
    detail: "brief",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [source, setSource] = useState<Fact | Citation | null>(null),
    [sourceBusy, setSourceBusy] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [retry, setRetry] = useState<Submission | null>(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [outgoing, setOutgoing] = useState<Submission["body"] | null>(null);
  const [freshRequests, setFreshRequests] = useState<Set<string>>(
    () => new Set(),
  );
  const followBottom = useRef(true);
  const [announcement, setAnnouncement] = useState("");
  const followReply = useCallback(() => {
    if (followBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, []);
  const finishReveal = useCallback((clientId: string, answer: string) => {
    setAnnouncement(answer);
    setFreshRequests((old) => {
      if (!old.has(clientId)) return old;
      const next = new Set(old);
      next.delete(clientId);
      return next;
    });
  }, []);
  const preferenceSequence = useRef(0);
  const sequence = useRef(0),
    mounted = useRef(true),
    controller = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const sourceSequence = useRef(0),
    sourceOrigin = useRef<HTMLElement | null>(null),
    sourceClose = useRef<HTMLButtonElement | null>(null);
  const active = useRef({ conversation, ownerId });
  useEffect(() => {
    active.current = { conversation, ownerId };
  }, [conversation, ownerId]);
  const initialPrefs = useQuery({
    queryKey: ["rotation", ownerId, "assistant-preferences"],
    queryFn: api.getPreferences,
    enabled: open,
    retry: false,
  });
  const page = useQuery({
    queryKey: ["rotation", ownerId, "conversation", conversation],
    queryFn: ({ signal }) =>
      api.getConversation(conversation!, undefined, signal),
    enabled: open && Boolean(conversation),
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.messages.some((m) => m.status === "pending") ? 1800 : false,
  });
  const history = useQuery({
    queryKey: ["rotation", ownerId, "conversations", historyOpen],
    queryFn: api.listConversations,
    enabled: open && historyOpen,
    retry: false,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (initialPrefs.data && !conversation) setPreferences(initialPrefs.data);
  }, [initialPrefs.data, conversation]);
  useEffect(() => {
    if (page.data && page.data.id === active.current.conversation) {
      setMessages((old) => mergeMessages(old, page.data.messages));
      setNextBefore(page.data.next_before_sequence);
      setPreferences({
        language: page.data.language,
        detail: page.data.detail,
      });
    }
  }, [page.data]);
  useEffect(() => {
    if (openRequest) {
      setOpen(true);
      setText(openRequest.text);
    }
  }, [openRequest]);
  useEffect(() => {
    if (open) followReply();
  }, [messages.length, busy, open, followReply]);
  useEffect(() => {
    if (open && conversation) {
      const raw = storageRead(`${storageKey}:pending`);
      if (raw) {
        try {
          const request = JSON.parse(raw) as Submission;
          if (request.conversation === conversation) setRetry(request);
        } catch {}
      }
    }
  }, [open, conversation, storageKey]);
  useEffect(() => {
    if (
      retry?.conversation === conversation &&
      messages.some(
        (message) =>
          message.client_message_id === retry.body.client_message_id &&
          message.status !== "pending",
      )
    ) {
      setRetry(null);
      storageWrite(`${storageKey}:pending`, null);
    }
  }, [messages, retry, conversation, storageKey]);
  const pending = busy || messages.some((m) => m.status === "pending");

  function selectConversation(id: string | null) {
    if (busy) return;
    sequence.current++;
    sourceSequence.current++;
    preferenceSequence.current++;
    setSavingPreferences(false);
    setSourceBusy(false);
    controller.current?.abort();
    active.current.conversation = id;
    setConversation(id);
    setMessages([]);
    setOutgoing(null);
    setFreshRequests(new Set());
    setAnnouncement("");
    followBottom.current = true;
    setNextBefore(null);
    setSource(null);
    setError(null);
    setRetry(null);
    setHistoryOpen(false);
    storageWrite(storageKey, id);
  }
  async function send(event?: FormEvent, previous?: Submission) {
    event?.preventDefault();
    if (contextPending || pending || savingPreferences || (!text.trim() && !previous)) return;
    const requestSequence = ++sequence.current;
    // Freeze at the click, before conversation creation can race a map selection.
    const body = previous?.body ?? {
      client_message_id: crypto.randomUUID(),
      text: text.trim(),
      context: structuredClone(context),
    };
    const requestedPreferences = { ...preferences, language: locale };
    setOutgoing(body);
    setAnnouncement("");
    setFreshRequests((old) => new Set(old).add(body.client_message_id));
    if (!previous) setText("");
    followBottom.current = true;
    setBusy(true);
    setError(null);
    controller.current = new AbortController();
    let submission = previous;
    const isCurrent = () =>
      mounted.current && sequence.current === requestSequence;
    try {
      let chat = previous?.conversation ?? conversation;
      if (!chat) {
        const created = await api.createConversation(requestedPreferences);
        if (!isCurrent()) return;
        chat = created.id;
        active.current.conversation = chat;
        setConversation(chat);
        storageWrite(storageKey, chat);
      }
      else {
        // The backend freezes language with the message. Never send until it agrees
        // with the UI choice captured at the click, including restored conversations.
        await api.setPreferences(requestedPreferences, chat);
        if (!isCurrent()) return;
      }
      submission ??= {
        conversation: chat,
        body,
      };
      storageWrite(`${storageKey}:pending`, JSON.stringify(submission));
      const result = await api.sendMessage(
        submission.conversation,
        submission.body,
        controller.current.signal,
      );
      if (!isCurrent()) return;
      setMessages((old) => mergeMessages(old, [result]));
      setOutgoing(null);
      setRetry(null);
      storageWrite(`${storageKey}:pending`, null);
      if (result.status === "pending") void page.refetch();
    } catch (cause) {
      if (isCurrent()) {
        setError(errorMessage(cause));
        if (submission) setRetry(submission);
        else {
          setOutgoing(null);
          setText((draft) => draft || body.text);
        }
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  async function loadOlder() {
    if (!conversation || !nextBefore) return;
    const chat = conversation;
    try {
      const result = await api.getConversation(chat, nextBefore);
      if (mounted.current && active.current.conversation === chat) {
        setMessages((old) => mergeMessages(old, result.messages));
        setNextBefore(result.next_before_sequence);
      }
    } catch (cause) {
      if (mounted.current && active.current.conversation === chat)
        setError(errorMessage(cause));
    }
  }
  async function updatePreferences(next: AssistantPreferences) {
    if (savingPreferences) return;
    const chat = conversation,
      request = ++preferenceSequence.current;
    const isCurrent = () =>
      mounted.current &&
      active.current.conversation === chat &&
      preferenceSequence.current === request;
    setSavingPreferences(true);
    setError(null);
    try {
      const saved = await api.setPreferences({ ...next, language: locale }, chat ?? undefined);
      if (isCurrent()) setPreferences(saved);
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    } finally {
      if (isCurrent()) setSavingPreferences(false);
    }
  }
  function closeSource() {
    sourceSequence.current++;
    setSource(null);
    setSourceBusy(false);
    sourceOrigin.current?.focus();
  }
  useEffect(() => {
    if (sourceBusy) sourceClose.current?.focus();
  }, [sourceBusy]);
  async function showSource(message: AssistantMessage, evidence: string) {
    if (!conversation || !evidence) return;
    const chat = conversation,
      request = ++sourceSequence.current;
    sourceOrigin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const isCurrent = () =>
      mounted.current &&
      active.current.conversation === chat &&
      sourceSequence.current === request;
    setSourceBusy(true);
    setError(null);
    try {
      const item = await api.getMessageSource(chat, message.id, evidence);
      if (isCurrent()) setSource(item);
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    } finally {
      if (isCurrent()) setSourceBusy(false);
    }
  }
  function chooseHistory(item: Conversation) {
    selectConversation(item.id);
  }
  const currentKey = contextKey(context);
  return (
    <Bot
      identity={{
        id: "rotation",
        name: t("轮作助手"),
        description: t("解释数据，一起想清下一茬"),
      }}
      mode={mode}
      onModeChange={(next) => {
        setMode(next);
        if (next === "collapsed") {
          setFreshRequests(new Set());
          setAnnouncement("");
        }
      }}
      headerActions={
        <>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t("历史对话")}
            aria-expanded={historyOpen}
            onClick={() => {
              setHistoryOpen(!historyOpen);
              setSettingsOpen(false);
            }}
          >
            <History size={18} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t("回答偏好")}
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen(!settingsOpen);
              setHistoryOpen(false);
            }}
          >
            <Settings2 size={18} />
          </button>
        </>
      }
    >
      <div className={styles.chatContext}>
        <span className={styles.contextDot} />
        <span>{contextLabel}</span>
        {context.draft?.dirty && <strong>{t("条件已修改，尚未重算")}</strong>}
      </div>
      {settingsOpen && (
        <div className={styles.chatSettings}>
          <label>
            {t("语言")}<select
              disabled={savingPreferences}
              value={locale}
              onChange={(e) =>
                setLocale(e.target.value as "zh" | "en")
              }
            >
              <option value="zh">{t("中文")}</option>
              <option value="en">{t("English")}</option>
            </select>
          </label>
          <label>
            {t("解释程度")}<select
              disabled={savingPreferences}
              value={preferences.detail}
              onChange={(e) =>
                void updatePreferences({
                  ...preferences,
                  detail: e.target.value as "brief" | "detailed",
                })
              }
            >
              <option value="brief">{t("简明易懂")}</option>
              <option value="detailed">{t("展开说明")}</option>
            </select>
          </label>
        </div>
      )}
      {historyOpen && (
        <div className={styles.historyList}>
          <button
            type="button"
            disabled={busy}
            onClick={() => selectConversation(null)}
          >
            <Plus size={16} />
            {t("开始新对话")}</button>
          {history.isPending && <p role="status">{t("正在读取对话…")}</p>}
          {history.error && (
            <button onClick={() => void history.refetch()}>
              {t("读取失败，重试")}</button>
          )}
          {history.data?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={busy}
              aria-current={item.id === conversation ? "true" : undefined}
              onClick={() => chooseHistory(item)}
            >
              {t("轮作对话 ·")}{" "}
              {new Date(item.updated_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </button>
          ))}
        </div>
      )}
      <div
        className={styles.chatScroll}
        ref={scroll}
        role="log"
        aria-live="off"
        onScroll={(event) => {
          const el = event.currentTarget;
          followBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
      >
        {page.isPending && conversation && <p role="status">{t("正在恢复对话…")}</p>}
        {page.error && (
          <div role="alert" className={styles.error}>
            <p>{t(errorMessage(page.error))}</p>
            <button onClick={() => void page.refetch()}>{t("重试读取")}</button>
            <button onClick={() => selectConversation(null)}>{t("开始新对话")}</button>
          </div>
        )}
        {nextBefore && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => void loadOlder()}
          >
            {t("查看更早的消息")}</button>
        )}
        {!messages.length && !outgoing && !busy && !page.error && (
          <div className={styles.chatWelcome}>
            <h2>{t("下一茬，我们一起想。")}</h2>
            <p>{t("想知道下一茬种什么，还是想看看地里的水分？直接问我就好。")}</p>
            <div className={styles.promptChips}>
              {[
                t("轮作为什么要换不同科？"),
                t("帮我读懂当前方案"),
                t("这些数据能说明什么？"),
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setText(q);
                    textarea.current?.focus();
                  }}
                >
                  {q}
                  <ArrowUp size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => {
          const stale = contextKey(message.context) !== currentKey;
          const facts = message.response?.facts ?? message.facts;
          const revealing = freshRequests.has(message.client_message_id);
          return (
            <article key={message.id} className={styles.exchange}>
              <p className={styles.userMessage}>{message.text}</p>
              <div className={styles.reply}>
                {stale && (
                  <p className={styles.stale}>
                    {t("基于之前的选择 ·")}{" "}
                    {message.context_labels.fields.map((f) => f.name).join(", ") || t("地图选区")}
                  </p>
                )}
                {message.status === "pending" ? (
                  <p role="status" className={styles.thinking}>
                    <LoaderCircle size={16} />
                    {t("我看一下…")}</p>
                ) : (
                  message.response && (
                    <BotAnswer
                      answer={message.response}
                      facts={facts}
                      animate={revealing}
                      clientId={message.client_message_id}
                      onComplete={finishReveal}
                      onProgress={followReply}
                      onSource={(id) => void showSource(message, id)}
                    />
                  )
                )}
                {message.status === "failed" ||
                message.status === "interrupted" ? (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      setText(message.text);
                      textarea.current?.focus();
                    }}
                  >
                    {t("重新提问")}</button>
                ) : null}
                {message.response?.retrieval_mode === "lexical_degraded" && (
                  <p className={styles.muted}>
                    {t("语义检索暂不可用，本次使用关键词资料。")}</p>
                )}
                <div className={styles.answerActions} hidden={revealing}>
                  {message.response?.actions
                    .filter((action) => action !== "view_sources")
                    .map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={stale}
                        onClick={() => onAction(action)}
                      >
                        {t(actionLabels[action])}
                      </button>
                    ))}
                </div>
              </div>
            </article>
          );
        })}
        {outgoing &&
          !messages.some(
            (m) => m.client_message_id === outgoing.client_message_id,
          ) && (
            <article className={styles.exchange}>
              <p className={styles.userMessage}>{outgoing.text}</p>
              {busy && (
                <p role="status" className={styles.thinking}>
                  <span className={styles.thinkingDot} />
                  {t("我看一下…")}</p>
              )}
            </article>
          )}
      </div>
      <p role="status" className={styles.screenReaderOnly}>
        {announcement}
      </p>
      {(source || sourceBusy) && (
        <section
          className={styles.sourcePanel}
          aria-label={t("回答依据")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeSource();
            }
          }}
        >
          <button
            className={styles.iconButton}
            type="button"
            aria-label={t("关闭依据")}
            ref={sourceClose}
            onClick={closeSource}
          >
            <X size={16} />
          </button>
          {sourceBusy ? (
            <p>{t("正在读取依据…")}</p>
          ) : (
            source &&
            ("excerpt" in source ? (
              <>
                <h3>
                  <BookOpen size={16} />
                  {source.source.title}
                </h3>
                <p className={styles.muted}>
                  {source.source.locator_type === "pdf_page"
                    ? t("PDF 页")
                    : t("章节")}{" "}
                  {source.page} ·{" "}
                  {source.source.access_scope === "abstract_only"
                    ? t("仅摘要")
                    : t("已发布资料")}
                </p>
                <p>{source.excerpt}</p>
                {source.source.limitations.map((item) => (
                  <p className={styles.muted} key={item}>
                    {item}
                  </p>
                ))}
                {sourceUrl(source.source.url) && (
                  <a
                    href={sourceUrl(source.source.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("打开原始来源 ↗")}</a>
                )}
              </>
            ) : (
              <>
                <h3>{t(source.label)}</h3>
                <p>{source.display}</p>
                {source.limitations.map((item) => (
                  <p key={item}>{item}</p>
                ))}
                <p className={styles.muted}>
                  {String(source.source.kind ?? t("数据快照"))}
                </p>
                {sourceUrl(source.source.url) && (
                  <a
                    href={sourceUrl(source.source.url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("打开来源 ↗")}</a>
                )}
              </>
            ))
          )}
        </section>
      )}
      {error && (
        <div className={styles.chatError} role="alert">
          {t(error)}
          {retry && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void send(undefined, retry)}
            >
              {t("重试原消息")}</button>
          )}
        </div>
      )}
      {!error && retry && (
        <div className={styles.chatError}>
          {t("上次请求结果尚未确认。")}<button
            type="button"
            disabled={pending}
            onClick={() => void send(undefined, retry)}
          >
            {t("恢复原消息")}</button>
        </div>
      )}
      {contextPending && <p role="status" className={styles.chatFootnote}>{t("正在核对地块、选区或历史方案，完成后可继续提问。")}</p>}
      <BotComposer
        inputRef={textarea}
        label={t("给轮作助手留言")}
        active={open}
        value={text}
        onChange={setText}
        onSend={() => void send()}
        pending={pending || contextPending}
        language={locale === "zh" ? "zh-CN" : "en-US"}
        placeholder={
          locale === "zh"
            ? t("说说你想了解什么…")
            : "Ask about your next crop…"
        }
      />
      <p className={styles.chatFootnote}>
        {t("结合地里实际情况判断，依据可以展开查看。")}</p>
    </Bot>
  );
}
