"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BotComposer } from "./BotComposer";
import { getCurrentUser } from "@/lib/api/client";
import type { AssistantMessage, Citation, Fact } from "@/lib/api/rotation-types";
import type { CatalogBot } from "@/lib/bot-catalog";
import type { Locale } from "@/lib/i18n/locale";
import * as api from "@/features/si/agent-api";
import type { AgentConversation, AgentDomain } from "@/features/si/agent-api";
import styles from "./MultiBotDock.module.css";

type BotConversation = AgentConversation & { bot_id: string };
type ErrorKind = "load" | "send" | "poll" | "delayed" | "source" | "preferences" | "unavailable" | null;

const labels = {
  en: {
    loading: "Loading your conversation…", empty: "Ask this specialist a question.",
    signIn: "Sign in to chat with this specialist.", signInLink: "Sign in", retry: "Try again",
    loadError: "Conversation could not be loaded.", sendError: "Message could not be sent. Your draft is safe.",
    failed: "This reply could not be completed.", delayed: "The reply is still processing. Reopen this specialist to refresh it.",
    pollError: "Reply status could not be refreshed. Reopen this specialist to check it.",
    sourceError: "Source could not be loaded.", preferencesError: "Conversation language could not be updated.", unavailable: "The published knowledge base is not ready. Ask an administrator to publish it, then try again.", pending: "Working on your request…",
    source: "View source", closeSource: "Close source", older: "Load earlier messages",
    facts: "View data used", localLimit: "Prices and crop varieties are examples, not live local data.",
    weatherLimit: "This chat does not provide a live forecast.",
  },
  "zh-CN": {
    loading: "正在加载对话…", empty: "向这位助手提问。",
    signIn: "登录后与这位助手对话。", signInLink: "登录", retry: "重试",
    loadError: "无法加载对话。", sendError: "消息未能发送，草稿已保留。",
    failed: "这条回复未能完成。", delayed: "回复仍在处理中。重新打开此助手可刷新状态。",
    pollError: "无法刷新回复状态。重新打开此助手可查看结果。",
    sourceError: "无法加载依据。", preferencesError: "无法更新对话语言。", unavailable: "知识库尚未发布，助手暂时无法开启。请先发布知识库后重试。", pending: "正在处理你的请求…",
    source: "查看依据", closeSource: "关闭依据", older: "加载更早的消息",
    facts: "查看当时的数据", localLimit: "价格与品种数据为示例，并非实时本地数据。",
    weatherLimit: "此对话不提供实时天气预报。",
  },
};

function belongsToBot(item: AgentConversation, bot: CatalogBot): item is BotConversation {
  return item.preset === bot.presetId && (item as BotConversation).bot_id === bot.id;
}

function sourceView(source: Fact | Citation) {
  return "excerpt" in source
    ? { title: source.source.title, text: source.excerpt, url: source.source.url ?? undefined }
    : { title: source.label, text: source.display, url: undefined };
}

function upsert(rows: AssistantMessage[], message: AssistantMessage) {
  return [...rows.filter((row) => row.id !== message.id), message].sort((a, b) => a.sequence - b.sequence);
}

export function MultiBotChat({ bot, locale }: { bot: CatalogBot; locale: Locale }) {
  const l = labels[locale];
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [reload, setReload] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationLanguage, setConversationLanguage] = useState<"en" | "zh" | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKind>(null);
  const [source, setSource] = useState<{ title: string; text: string; url?: string } | null>(null);
  const alive = useRef(true);
  const sending = useRef(false);
  const retry = useRef<{ text: string; id: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    let current = true;
    (async () => {
      try {
        await getCurrentUser();
        if (!current) return;
        const history = await api.listConversations();
        if (!current) return;
        const latest = history.items.filter((item) => belongsToBot(item, bot))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (latest) {
          const page = await api.getConversation(latest.id);
          if (!current) return;
          if (!belongsToBot(page, bot)) throw new Error("Conversation identity mismatch");
          setConversationId(page.id);
          setConversationLanguage(page.language);
          setMessages(page.messages);
          setNextBefore(page.next_before_sequence);
        } else {
          setConversationId(null);
          setConversationLanguage(null);
          setMessages([]);
          setNextBefore(null);
        }
        setUnauthenticated(false);
      } catch (cause) {
        if (!current) return;
        if (cause instanceof Error && "status" in cause && cause.status === 401) setUnauthenticated(true);
        else if (typeof cause === "object" && cause !== null && "status" in cause && cause.status === 401) setUnauthenticated(true);
        else setError("load");
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; alive.current = false; };
  }, [bot, reload]);

  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages]);

  useEffect(() => {
    const language = locale === "en" ? "en" : "zh";
    if (!conversationId || !conversationLanguage || conversationLanguage === language) return;
    let current = true;
    api.setPreferences({ language, detail: "brief" }, conversationId)
      .then(() => { if (current) setConversationLanguage(language); })
      .catch(() => { if (current) setError("preferences"); });
    return () => { current = false; };
  }, [conversationId, conversationLanguage, locale]);

  async function send() {
    const text = draft.trim();
    if (!text || sending.current || loading || unauthenticated) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    let chatId = conversationId;
    let accepted = false;
    try {
      if (!chatId) {
        const body = { preset: bot.presetId as AgentDomain, bot_id: bot.id, language: locale === "en" ? "en" as const : "zh" as const, detail: "brief" as const };
        const created = await api.createConversation(body);
        if (!alive.current) return;
        if (!belongsToBot(created, bot)) throw new Error("Conversation identity mismatch");
        chatId = created.id;
        setConversationId(chatId);
        setConversationLanguage(created.language);
      }
      const clientId = retry.current?.text === text ? retry.current.id : crypto.randomUUID();
      retry.current = { text, id: clientId };
      let reply = await api.sendMessage(chatId, { client_message_id: clientId, text, context: { page: "map", revision: 1 } });
      if (!alive.current) return;
      accepted = true;
      retry.current = null;
      setDraft("");
      setMessages((previous) => upsert(previous, reply));
      for (let attempt = 0; reply.status === "pending" && attempt < 20 && alive.current; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (!alive.current) return;
        reply = await api.getMessage(chatId, reply.id);
        if (!alive.current) return;
        setMessages((previous) => upsert(previous, reply));
      }
      if (reply.status === "pending") setError("delayed");
    } catch (cause) {
      if (alive.current) {
        const unavailable = !accepted && typeof cause === "object" && cause !== null
          && "status" in cause && cause.status === 503;
        setError(accepted ? "poll" : unavailable ? "unavailable" : "send");
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function openSource(message: AssistantMessage, evidence: string) {
    if (!conversationId) return;
    try {
      setSource(sourceView(await api.getSource(conversationId, message.id, evidence)));
    } catch { if (alive.current) setError("source"); }
  }

  async function loadOlder() {
    if (!conversationId || !nextBefore || busy) return;
    setBusy(true);
    try {
      const page = await api.getConversation(conversationId, nextBefore);
      if (!alive.current) return;
      if (!belongsToBot(page, bot)) throw new Error("Conversation identity mismatch");
      setMessages((previous) => [...page.messages, ...previous]);
      setNextBefore(page.next_before_sequence);
    } catch { if (alive.current) setError("load"); }
    finally { if (alive.current) setBusy(false); }
  }

  if (loading) return <div className={styles.chatStatus} role="status">{l.loading}</div>;
  if (unauthenticated) return <div className={styles.chatStatus}><p>{l.signIn}</p><Link href={`/login?next=${encodeURIComponent(`/si/${bot.module}`)}&authRequired=1`}>{l.signInLink}</Link></div>;
  if (error === "load") return <div className={styles.chatStatus} role="alert"><p>{l.loadError}</p><button type="button" onClick={() => { setLoading(true); setError(null); setReload((value) => value + 1); }}>{l.retry}</button></div>;

  return <div className={styles.chatBody}>
    <div className={styles.messageList} aria-live="polite">
      {nextBefore !== null && <button type="button" className={styles.older} onClick={() => void loadOlder()} disabled={busy}>{l.older}</button>}
      {messages.length === 0 && <p className={styles.empty}>{l.empty}</p>}
      {messages.map((message) => <div key={message.id} className={styles.messagePair}>
        <p className={styles.question}>{message.text}</p>
        <div className={styles.answer}>
          {message.status === "pending" ? <span role="status">{l.pending}</span>
            : message.status === "failed" || message.status === "interrupted" ? <span role="alert">{l.failed}</span>
              : message.response ? <>
                {message.response.paragraphs.map((paragraph, index) => <p key={index}>{paragraph.text}</p>)}
                {[...new Set(message.response.paragraphs.flatMap((paragraph) => paragraph.evidence_ids))].map((evidence) => <button key={evidence} type="button" className={styles.sourceButton} onClick={() => void openSource(message, evidence)}>{l.source} {evidence}</button>)}
                {message.facts.length > 0 && <details className={styles.facts}><summary>{l.facts}</summary><dl>{message.facts.map((fact) => <div key={fact.id}><dt>{fact.label}: </dt><dd>{fact.display}</dd></div>)}</dl></details>}
              </> : null}
        </div>
      </div>)}
      <div ref={end} />
    </div>
    {source && <section className={styles.sourcePanel} aria-label={locale === "en" ? "Source details" : "依据详情"}><button type="button" aria-label={l.closeSource} onClick={() => setSource(null)}>×</button><h3>{source.title}</h3><p>{source.text}</p>{source.url && <a href={source.url} target="_blank" rel="noreferrer">{locale === "en" ? "Open source" : "打开来源"}</a>}</section>}
    {error && <p role="alert" className={styles.chatError}>{error === "send" ? l.sendError : error === "poll" ? l.pollError : error === "delayed" ? l.delayed : error === "preferences" ? l.preferencesError : error === "unavailable" ? l.unavailable : l.sourceError}</p>}
    <div className={styles.composerWrap}>
      <BotComposer value={draft} onChange={setDraft} onSend={() => void send()} active={!busy} pending={busy} label={locale === "en" ? `Message ${bot.name.en}` : `给${bot.name["zh-CN"]}留言`} placeholder={locale === "en" ? "Ask a question…" : "说说你想了解什么…"} language={locale === "en" ? "en-US" : "zh-CN"} />
      {bot.id === "local-knowledge-guide" && <p className={styles.limit}>{l.localLimit}</p>}
      {bot.id === "remote-weather" && <p className={styles.limit}>{l.weatherLimit}</p>}
    </div>
  </div>;
}
