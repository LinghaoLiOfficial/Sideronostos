"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, LoaderCircle, Menu, Plus, X } from "lucide-react";
import { BotComposer } from "@/components/bot/BotComposer";
import { BotAvatar } from "@/components/bot/Bot";
import { botCatalog, type CatalogBot, type SiBotModule } from "@/lib/bot-catalog";
import { getCurrentUser, type AuthUser } from "@/lib/api/client";
import { useLocale } from "@/lib/i18n/locale";
import type { AssistantMessage, Citation, Fact } from "@/lib/api/rotation-types";
import * as api from "./agent-api";
import type { AgentConversation, AgentConversationPage, AgentDomain } from "./agent-api";
import { FarmerTasks } from "./farmer-tasks";
import { TaskResultCard } from "./task-result-card";

const domains: { id: AgentDomain; en: string; zh: string }[] = [
  { id: "general", en: "All farm tasks", zh: "农场综合" },
  { id: "field_management", en: "Field management", zh: "地块管理" },
  { id: "remote_sensing", en: "Remote sensing", zh: "遥感分析" },
  { id: "local_agriculture", en: "Local agriculture", zh: "本地农业知识" },
  { id: "rotation", en: "Crop rotation", zh: "作物轮作" },
];
const moduleHomes = {
  general: { href: "/si", en: "SI home", zh: "SI 首页" },
  "field-management": { href: "/si/field-management", en: "Field management", zh: "田地管理" },
  "remote-sensing": { href: "/si/remote-sensing", en: "Remote sensing", zh: "遥感分析" },
  "local-knowledge": { href: "/si/local-knowledge", en: "Local knowledge", zh: "本地农业知识库" },
  "rotation-recommendation": { href: "/si/rotation-recommendation", en: "Crop rotation", zh: "轮作策略推荐" },
} as const satisfies Record<SiBotModule, { href: string; en: string; zh: string }>;
const labels = {
  en: { title: "Your SI assistants", history: "Conversations", newChat: "New chat", empty: "No conversations yet", loading: "Loading conversations…", pending: "Working on your request…", error: "Something went wrong. Your draft is safe.", failed: "This reply could not be completed.", mock: "Local prices and crop varieties are mock examples, not live local data.", source: "View source", older: "Load earlier messages", signIn: "Sign in to use your assistants", login: "Sign in", retry: "Try again" },
  zh: { title: "你的助手", history: "对话记录", newChat: "新建对话", empty: "还没有对话", loading: "正在加载对话…", pending: "正在处理你的请求…", error: "发生错误。草稿已保留。", failed: "这条回复未能完成。", mock: "价格与品种数据为模拟数据，并非实时本地数据。", source: "查看依据", older: "加载更早的消息", signIn: "登录后使用助手", login: "登录", retry: "重试" },
};
function defaultBot(domain: AgentDomain): CatalogBot {
  return botCatalog.find((bot) => bot.presetId === domain) ?? botCatalog[0];
}
function conversationBot(item: AgentConversation): CatalogBot {
  return botCatalog.find((bot) => bot.id === item.bot_id && bot.presetId === item.preset) ?? defaultBot(item.preset);
}
function conversationTitle(item: AgentConversation, locale: "en" | "zh-CN"): string {
  const date = new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { month: "short", day: "numeric" }).format(new Date(item.created_at));
  return `${conversationBot(item).name[locale]} · ${date} · ${item.id.slice(-6)}`;
}
function sourceView(source: Fact | Citation) {
  const url = "excerpt" in source ? source.source.url : source.source.url;
  return "excerpt" in source
    ? { title: source.source.title, text: source.excerpt, url: safeSourceUrl(url) }
    : { title: source.label, text: source.display, url: safeSourceUrl(url) };
}
function safeSourceUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch { return null; }
}
function showBotInUrl(bot: CatalogBot) {
  const url = new URL(window.location.href);
  url.searchParams.set("bot", bot.id);
  window.history.replaceState(window.history.state, "", url);
}

export function AgentWorkspace() {
  const locale = useLocale();
  const zh = locale === "zh-CN";
  const l = zh ? labels.zh : labels.en;
  const [user, setUser] = useState<AuthUser | null | undefined>();
  const [items, setItems] = useState<AgentConversation[]>([]);
  const [domain, setDomain] = useState<AgentDomain>("field_management");
  const [selectedBotId, setSelectedBotId] = useState(defaultBot("field_management").id);
  const selectedBot = botCatalog.find((bot) => bot.id === selectedBotId) ?? defaultBot(domain);
  const moduleHome = moduleHomes[selectedBot.module];
  const visibleItems = items.filter((item) => conversationBot(item).id === selectedBot.id);
  const [id, setId] = useState<string | null>(null);
  const [page, setPage] = useState<AgentConversationPage | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<"request" | "failed" | null>(null);
  const [menu, setMenu] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [source, setSource] = useState<{ title: string; text: string; url: string | null } | null>(null);
  const active = useRef<string | null>(null);
  const justCreated = useRef<string | null>(null);
  const retryId = useRef<string | null>(null);
  const retryText = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const botNavigation = useRef<HTMLElement>(null);
  const previousLocale = useRef(locale);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const account = await getCurrentUser();
        const history = await api.listConversations();
        if (!live) return;
        const sorted = [...history.items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        setUser(account);
        setItems(sorted);
        const requestedBot = botCatalog.find((bot) => bot.id === new URLSearchParams(window.location.search).get("bot"));
        if (requestedBot) {
          setDomain(requestedBot.presetId as AgentDomain);
          setSelectedBotId(requestedBot.id);
        }
        if (sorted.length) {
          const saved = localStorage.getItem("agrisata-agent-chat:" + account.id);
          const first = requestedBot
            ? sorted.find((item) => conversationBot(item).id === requestedBot.id)
            : sorted.find((item) => item.id === saved) ?? sorted[0];
          if (first) {
            active.current = first.id;
            setId(first.id);
            setDomain(first.preset);
            setSelectedBotId(conversationBot(first).id);
          }
        }
      } catch (cause) {
        if (!live) return;
        if (cause instanceof Error && "status" in cause && cause.status === 401) setUser(null);
        else setError("request");
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  // The initial account/history request must not rerun on a language change.
  }, [reload]);
  useEffect(() => {
    if (!id) return;
    if (justCreated.current === id) { justCreated.current = null; return; }
    let live = true;
    api.getConversation(id).then((next) => { if (live) setPage(next); }).catch(() => { if (live) setError("request"); });
    return () => { live = false; };
  }, [id]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [page?.messages.length, outgoing]);
  useEffect(() => {
    if (!menu && window.matchMedia?.("(max-width: 1023px)").matches) return;
    botNavigation.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [selectedBotId, loading, menu]);
  useEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    const body = { language: locale === "en" ? "en" as const : "zh" as const, detail: "brief" as const };
    api.setPreferences(body, id ?? undefined).catch(() => setError("request"));
  }, [locale, id]);

  function chooseDomain(next: AgentDomain) {
    active.current = null;
    retryId.current = null;
    retryText.current = null;
    setDomain(next);
    setSelectedBotId(defaultBot(next).id);
    setId(null);
    setPage(null);
    setDraft("");
    setError(null);
    setMenu(false);
    setActionsOpen(false);
  }
  function chooseBot(bot: CatalogBot) {
    chooseDomain(bot.presetId as AgentDomain);
    setSelectedBotId(bot.id);
    showBotInUrl(bot);
  }
  function chooseChat(item: AgentConversation) {
    const bot = conversationBot(item);
    active.current = item.id;
    retryId.current = null;
    retryText.current = null;
    setDomain(item.preset);
    setSelectedBotId(bot.id);
    setId(item.id);
    setPage(null);
    setDraft("");
    setError(null);
    setMenu(false);
    setActionsOpen(false);
    showBotInUrl(bot);
    if (user) localStorage.setItem("agrisata-agent-chat:" + user.id, item.id);
  }
  async function create() {
    if (busy) return null;
    setBusy(true);
    setError(null);
    try {
      const chat = await api.createConversation({ preset: domain, bot_id: selectedBot.id, language: zh ? "zh" : "en", detail: "brief" });
      setItems((previous) => [chat, ...previous]);
      active.current = chat.id;
      justCreated.current = chat.id;
      setId(chat.id);
      setPage({ ...chat, messages: [], next_before_sequence: null });
      if (user) localStorage.setItem("agrisata-agent-chat:" + user.id, chat.id);
      setMenu(false);
      setActionsOpen(false);
      return chat.id;
    } catch { setError("request"); return null; }
    finally { setBusy(false); }
  }
  async function send(question?: string) {
    const text = (question ?? draft).trim();
    if (!text || busy) return false;
    if (question) setDraft(question);
    let chatId = id;
    if (!chatId) chatId = await create();
    if (!chatId) return;
    setBusy(true);
    setError(null);
    setOutgoing(text);
    const clientId = retryText.current === text ? retryId.current ?? crypto.randomUUID() : crypto.randomUUID();
    retryId.current = clientId;
    retryText.current = text;
    try {
      let message = await api.sendMessage(chatId, { client_message_id: clientId, text, context: { page: "map", revision: 1 } });
      retryId.current = null;
      retryText.current = null;
      if (active.current === chatId) {
        setDraft("");
        setPage((previous) => previous ? { ...previous, messages: [...previous.messages.filter((row) => row.id !== message.id), message] } : previous);
      }
      for (let n = 0; message.status === "pending" && n < 20; n += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        message = await api.getMessage(chatId, message.id);
        if (active.current === chatId) setPage((previous) => previous ? { ...previous, messages: [...previous.messages.filter((row) => row.id !== message.id), message].sort((a, b) => a.sequence - b.sequence) } : previous);
      }
      if (message.status === "pending") setError("failed");
      return true;
    } catch { setError("request"); return false; }
    finally { setOutgoing(null); setBusy(false); }
  }
  async function openActions() {
    if (busy) return;
    if (!id && !await create()) return;
    setActionsOpen(true);
  }
  async function openSource(message: AssistantMessage, evidence: string) {
    if (!id) return;
    try { setSource(sourceView(await api.getSource(id, message.id, evidence))); }
    catch { setError("request"); }
  }
  async function older() {
    if (!id || !page?.next_before_sequence) return;
    setBusy(true);
    try {
      const previous = await api.getConversation(id, page.next_before_sequence);
      if (active.current === id) setPage((current) => current ? { ...current, messages: [...previous.messages, ...current.messages], next_before_sequence: previous.next_before_sequence } : current);
    } catch { setError("request"); }
    finally { setBusy(false); }
  }

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
    {loading ? <div role="status" className="flex flex-1 items-center justify-center gap-2 text-muted-foreground"><LoaderCircle size={18} className="animate-spin" />{l.loading}</div> : user === null ? <main className="flex flex-1 flex-col items-center justify-center gap-4"><h1 className="text-xl font-semibold">{l.signIn}</h1><Link className="rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/login?next=%2Fsi%2Fmulti-agent&authRequired=1">{l.login}</Link></main> : user === undefined ? <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4"><p role="alert" className="text-center text-sm text-destructive">{l.error}</p><button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1); }}>{l.retry}</button></main> : <main className="relative grid min-h-0 flex-1 lg:grid-cols-[clamp(20rem,28vw,34rem)_minmax(0,1fr)]">
      {menu && <button type="button" className="absolute inset-0 z-20 bg-black/50 lg:hidden" aria-label={zh ? "关闭菜单" : "Close menu"} onClick={() => setMenu(false)} />}
      <aside className={(menu ? "translate-x-0" : "-translate-x-full") + " absolute inset-y-0 left-0 z-30 flex w-[min(26rem,90vw)] flex-col border-r border-border bg-sidebar transition-transform lg:static lg:w-auto lg:translate-x-0"} aria-label={l.title}>
        <div className="flex h-16 shrink-0 items-center justify-end border-b border-border px-5 lg:hidden"><button type="button" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" aria-label={zh ? "关闭菜单" : "Close menu"} onClick={() => setMenu(false)}><X size={19} /></button></div>
        <div className="flex items-center justify-between px-5 pb-2 pt-5"><h1 className="text-lg font-semibold tracking-tight">{l.title}</h1><button type="button" aria-label={l.newChat} title={l.newChat} onClick={() => void create()} disabled={busy} className="inline-flex size-10 items-center justify-center rounded-full border border-border text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"><Plus size={20} aria-hidden="true" /></button></div>
        <nav ref={botNavigation} aria-label={zh ? "助手身份" : "Bot identities"} className="max-h-[60%] shrink-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
          {domains.map((entry) => (
            <section key={entry.id} role="group" aria-labelledby={`bot-module-${entry.id}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 py-1.5 last:border-b-0">
              <h2 id={`bot-module-${entry.id}`} className="text-xs font-semibold leading-snug text-muted-foreground">{zh ? entry.zh : entry.en}</h2>
              <div className="flex min-w-0 items-stretch gap-1 overflow-x-auto overscroll-x-contain">
                {botCatalog.filter((bot) => bot.presetId === entry.id).map((bot) => (
                  <button key={bot.id} type="button" aria-label={bot.name[locale]} aria-pressed={selectedBot.id === bot.id} onClick={() => chooseBot(bot)} style={{ "--bot-accent": bot.color } as CSSProperties} className={(selectedBot.id === bot.id ? "border-primary/70 bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground") + " flex min-h-[4.75rem] w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5 text-center text-[10px] leading-tight focus-visible:outline-2 focus-visible:outline-primary"}>
                    <BotAvatar small variant={bot.avatar} />
                    <span className="line-clamp-2 min-h-6">{bot.name[locale]}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="border-t border-border px-5 py-3"><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l.history}</h2></div>
        <nav aria-label={l.history} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{visibleItems.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">{l.empty}</p> : visibleItems.map((item) => <button key={item.id} type="button" onClick={() => chooseChat(item)} aria-current={id === item.id ? "page" : undefined} className={(id === item.id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/70") + " mb-1 flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"}><span className="truncate">{conversationTitle(item, locale)}</span><time className="text-xs text-muted-foreground" dateTime={item.updated_at}>{new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.updated_at))}</time></button>)}</nav>
      </aside>
      <section className="si-cream-surface flex min-h-0 min-w-0 flex-col" aria-label={selectedBot.name[locale]} style={{ "--bot-accent": selectedBot.color } as CSSProperties}>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-6"><button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-primary lg:hidden" aria-label={menu ? (zh ? "关闭菜单" : "Close menu") : (zh ? "打开菜单" : "Open menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button><div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5" style={{ "--bot-accent": selectedBot.color } as CSSProperties}><BotAvatar small variant={selectedBot.avatar} /><h2 className="truncate text-sm font-semibold sm:text-base">{selectedBot.name[locale]}</h2></div><Link href={moduleHome.href} aria-label={zh ? `前往${moduleHome.zh}` : `Open ${moduleHome.en}`} className="ml-auto inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary sm:px-3 sm:text-sm"><span className="sm:hidden">{zh ? "主页" : "Home"}</span><span className="hidden sm:inline">{zh ? moduleHome.zh : moduleHome.en}</span><ArrowUpRight size={15} aria-hidden="true" /></Link></header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8" aria-live="polite"><div className="mx-auto flex min-h-full max-w-3xl flex-col">
          {page?.next_before_sequence && <button type="button" className="mx-auto mb-6 text-sm text-primary" onClick={() => void older()} disabled={busy}>{l.older}</button>}
          {!page?.messages.length && !outgoing && <div className="my-auto py-12 text-center"><div className="mx-auto flex size-14 items-center justify-center" style={{ "--bot-accent": selectedBot.color } as CSSProperties}><BotAvatar variant={selectedBot.avatar} /></div></div>}
          <div className="space-y-6">{page?.messages.map((message) => <div key={message.id} className="space-y-3"><div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">{message.text}</div><div className="max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm leading-7 sm:max-w-[85%]">{message.status === "pending" ? <span className="flex items-center gap-2 text-muted-foreground"><LoaderCircle size={15} className="animate-spin" />{l.pending}</span> : message.status === "failed" || message.status === "interrupted" ? <span role="alert">{l.failed}</span> : message.response ? <>{message.response.paragraphs.map((paragraph, index) => <p key={index} className="mb-2 last:mb-0">{paragraph.text}</p>)}{message.response.task && <TaskResultCard task={message.response.task} language={zh ? "zh" : "en"} />}{message.response.tasks?.map((task) => <TaskResultCard key={task.id} task={task} language={zh ? "zh" : "en"} />)}{[...new Set(message.response.paragraphs.flatMap((paragraph) => paragraph.evidence_ids))].map((evidence) => <button key={evidence} type="button" onClick={() => void openSource(message, evidence)} className="mr-2 mt-2 rounded-md border border-border px-2 py-1 text-xs text-primary">{l.source} {evidence}</button>)}{message.facts.length > 0 && <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">{zh ? "查看当时的数据" : "View data used"}</summary><dl>{message.facts.map((fact) => <div key={fact.id}><dt className="inline font-medium">{fact.label}: </dt><dd className="inline">{fact.display}</dd></div>)}</dl></details>}{message.response.actions.includes("open_planner") && <Link href="/si/fields?step=planning" className="mt-3 block text-xs text-primary underline">{zh ? "打开轮作规划" : "Open rotation planner"}</Link>}</> : null}</div></div>)}{outgoing && <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary/70 px-4 py-3 text-sm text-primary-foreground">{outgoing}</div>}</div><div ref={end} />
        </div></div>
        {error && <div role="alert" className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2 text-sm text-destructive"><span>{error === "failed" ? l.failed : l.error}</span></div>}
        {source && <section aria-label={zh ? "依据详情" : "Source details"} className="mx-auto mb-2 w-[calc(100%-2rem)] max-w-3xl rounded-lg border border-border bg-card p-4 text-sm"><div className="flex justify-between gap-2"><h3 className="font-semibold">{source.title}</h3><button type="button" aria-label={zh ? "关闭依据" : "Close source"} onClick={() => setSource(null)}><X size={16} /></button></div><p className="mt-2 text-muted-foreground">{source.text}</p>{source.url && <a className="mt-2 inline-block text-primary underline" href={source.url} target="_blank" rel="noreferrer">{zh ? "打开来源" : "Open source"}</a>}</section>}
        <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-8"><div className="mx-auto max-w-3xl">
          <div className="px-4 max-[700px]:px-3">
            {actionsOpen && id && user ? <FarmerTasks key={`${selectedBot.id}:${id}`} conversationId={id} ensureConversation={create} botId={selectedBot.id} language={zh ? "zh" : "en"} userId={user.id} onBack={() => setActionsOpen(false)} onAsk={async (question) => { if (!await send(question)) throw new Error("Question not sent"); }} /> : <button type="button" className="mb-3 min-h-10 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50" disabled={busy} onClick={() => void openActions()}>{zh ? "操作" : "Actions"}</button>}
          </div>
          <BotComposer value={draft} onChange={setDraft} onSend={() => void send()} active={!busy} pending={busy} label={zh ? "给" + selectedBot.name[locale] + "留言" : "Message " + selectedBot.name[locale]} placeholder={zh ? "输入问题…" : "Ask a question…"} language={zh ? "zh-CN" : "en-US"} />
          {domain === "local_agriculture" && <p className="mt-2 text-center text-xs text-muted-foreground">{l.mock}</p>}
        </div></div>
      </section>
    </main>}
  </div>;
}
