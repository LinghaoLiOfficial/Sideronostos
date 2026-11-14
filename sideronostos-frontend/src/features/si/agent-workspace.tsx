"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Globe2, Leaf, LoaderCircle, Menu, Plus, Radio, RotateCcw, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { BotComposer } from "@/components/bot/BotComposer";
import { getCurrentUser, type AuthUser } from "@/lib/api/client";
import { setLocale, useLocale } from "@/lib/i18n/locale";
import type { AssistantMessage, Citation, Fact } from "@/lib/api/rotation-types";
import * as api from "./agent-api";
import type { AgentConversation, AgentConversationPage, AgentDomain } from "./agent-api";
import { AgentActions } from "./agent-actions";

const domains: { id: AgentDomain; en: string; zh: string; enHint: string; zhHint: string; icon: typeof Leaf }[] = [
  { id: "field_management", en: "Field management", zh: "地块管理", enHint: "Understand your fields and keep their details together.", zhHint: "了解地块，整理地块资料。", icon: Leaf },
  { id: "remote_sensing", en: "Remote sensing", zh: "遥感分析", enHint: "Explore satellite layers and observed conditions.", zhHint: "查看卫星图层与观测条件。", icon: Radio },
  { id: "local_agriculture", en: "Local agriculture", zh: "本地农业知识", enHint: "Ask about local rules and expert knowledge.", zhHint: "查询本地农业规则与专家知识。", icon: BookOpen },
  { id: "rotation", en: "Crop rotation", zh: "作物轮作", enHint: "Think through next season and rotation choices.", zhHint: "规划下一季和轮作选择。", icon: RotateCcw },
];
const labels = {
  en: { title: "Your assistants", history: "Conversations", newChat: "New chat", empty: "No conversations yet", choose: "Choose an assistant to start a conversation.", start: "Start a conversation", loading: "Loading conversations…", pending: "Working on your request…", error: "Something went wrong. Your draft is safe.", failed: "This reply could not be completed.", mock: "Local prices and crop varieties are mock examples, not live local data.", source: "View source", older: "Load earlier messages", signIn: "Sign in to use your assistants", login: "Sign in", back: "Back to fields", retry: "Try again" },
  zh: { title: "你的助手", history: "对话记录", newChat: "新建对话", empty: "还没有对话", choose: "选择一位助手，开始对话。", start: "开始对话", loading: "正在加载对话…", pending: "正在处理你的请求…", error: "发生错误。草稿已保留。", failed: "这条回复未能完成。", mock: "价格与品种数据为模拟数据，并非实时本地数据。", source: "查看依据", older: "加载更早的消息", signIn: "登录后使用助手", login: "登录", back: "返回地块", retry: "重试" },
};
function name(domain: AgentDomain, zh: boolean) {
  const item = domains.find((entry) => entry.id === domain);
  return item ? (zh ? item.zh : item.en) : domain;
}
function sourceView(source: Fact | Citation) {
  return "excerpt" in source
    ? { title: source.source.title, text: source.excerpt }
    : { title: source.label, text: source.display };
}

export function AgentWorkspace() {
  const locale = useLocale();
  const zh = locale === "zh-CN";
  const l = zh ? labels.zh : labels.en;
  const [user, setUser] = useState<AuthUser | null | undefined>();
  const [items, setItems] = useState<AgentConversation[]>([]);
  const [domain, setDomain] = useState<AgentDomain>("field_management");
  const [id, setId] = useState<string | null>(null);
  const [page, setPage] = useState<AgentConversationPage | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<"request" | "failed" | null>(null);
  const [menu, setMenu] = useState(false);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [source, setSource] = useState<{ title: string; text: string } | null>(null);
  const active = useRef<string | null>(null);
  const justCreated = useRef<string | null>(null);
  const retryId = useRef<string | null>(null);
  const retryText = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

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
        if (sorted.length) {
          const saved = localStorage.getItem("agrisata-agent-chat:" + account.id);
          const first = sorted.find((item) => item.id === saved) ?? sorted[0];
          active.current = first.id;
          setId(first.id);
          setDomain(first.preset);
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

  function chooseDomain(next: AgentDomain) {
    active.current = null;
    retryId.current = null;
    retryText.current = null;
    setDomain(next);
    setId(null);
    setPage(null);
    setDraft("");
    setError(null);
    setMenu(false);
  }
  function chooseChat(item: AgentConversation) {
    active.current = item.id;
    retryId.current = null;
    retryText.current = null;
    setDomain(item.preset);
    setId(item.id);
    setPage(null);
    setDraft("");
    setError(null);
    setMenu(false);
    if (user) localStorage.setItem("agrisata-agent-chat:" + user.id, item.id);
  }
  async function create() {
    if (busy) return null;
    setBusy(true);
    setError(null);
    try {
      const chat = await api.createConversation({ preset: domain, language: zh ? "zh" : "en", detail: "brief" });
      setItems((previous) => [chat, ...previous]);
      active.current = chat.id;
      justCreated.current = chat.id;
      setId(chat.id);
      setPage({ ...chat, messages: [], next_before_sequence: null });
      if (user) localStorage.setItem("agrisata-agent-chat:" + user.id, chat.id);
      setMenu(false);
      return chat.id;
    } catch { setError("request"); return null; }
    finally { setBusy(false); }
  }
  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
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
    } catch { setError("request"); }
    finally { setOutgoing(null); setBusy(false); }
  }
  async function language(next: string) {
    if (next !== "en" && next !== "zh-CN") return;
    setLocale(next);
    const body = { language: next === "en" ? "en" as const : "zh" as const, detail: "brief" as const };
    try {
      await api.setPreferences(body);
      if (id) await api.setPreferences(body, id);
    } catch { setError("request"); }
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

  return <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-4 sm:px-6">
      <button type="button" className="inline-flex size-10 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-primary lg:hidden" aria-label={menu ? (zh ? "关闭菜单" : "Close menu") : (zh ? "打开菜单" : "Open menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
      <Link href="/si" aria-label={zh ? "Agrisata 首页" : "Agrisata home"} className="shrink-0"><BrandLogo priority className="w-28 sm:w-36" /></Link>
      <span className="hidden text-sm text-muted-foreground sm:block">/ {zh ? "农户助手" : "Farmer assistants"}</span>
      <label className="ml-auto flex items-center gap-1 text-sm"><Globe2 size={16} aria-hidden="true" /><span className="sr-only">{zh ? "语言" : "Language"}</span><select aria-label={zh ? "语言" : "Language"} value={locale} onChange={(event) => void language(event.target.value)} className="rounded-md bg-transparent p-2 focus-visible:outline-2 focus-visible:outline-primary"><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
      {user && <span className="hidden max-w-32 truncate text-sm text-muted-foreground sm:block">{user.display_name}</span>}
    </header>
    {loading ? <div role="status" className="flex flex-1 items-center justify-center gap-2 text-muted-foreground"><LoaderCircle size={18} className="animate-spin" />{l.loading}</div> : user === null ? <main className="flex flex-1 flex-col items-center justify-center gap-4"><h1 className="text-xl font-semibold">{l.signIn}</h1><Link className="rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/login?next=%2Fsi%2Fmulti-agent&authRequired=1">{l.login}</Link></main> : <main className="relative grid min-h-0 flex-1 lg:grid-cols-[19rem_minmax(0,1fr)]">
      {menu && <button type="button" className="absolute inset-0 z-20 bg-black/50 lg:hidden" aria-label={zh ? "关闭菜单" : "Close menu"} onClick={() => setMenu(false)} />}
      <aside className={(menu ? "translate-x-0" : "-translate-x-full") + " absolute inset-y-0 left-0 z-30 flex w-[min(21rem,88vw)] flex-col border-r border-border bg-sidebar transition-transform lg:static lg:w-auto lg:translate-x-0"} aria-label={l.title}>
        <div className="border-b border-border px-5 py-5"><h1 className="text-xl font-semibold tracking-tight">{l.title}</h1></div>
        <div className="px-3 py-3" role="group" aria-label={l.title}>{domains.map((entry) => {
          const Icon = entry.icon;
          return <button key={entry.id} type="button" aria-pressed={domain === entry.id} onClick={() => chooseDomain(entry.id)} className={(domain === entry.id ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground") + " flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-primary"}><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Icon size={18} aria-hidden="true" /></span><span><span className="block font-medium">{zh ? entry.zh : entry.en}</span>{entry.id === "local_agriculture" && <span className="block text-xs leading-5 text-muted-foreground">{l.mock}</span>}</span></button>;
        })}</div>
        <div className="flex items-center justify-between border-t border-border px-5 py-3"><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l.history}</h2><button type="button" onClick={() => void create()} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"><Plus size={16} aria-hidden="true" />{l.newChat}</button></div>
        <nav aria-label={l.history} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{items.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">{l.empty}</p> : items.map((item) => <button key={item.id} type="button" onClick={() => chooseChat(item)} aria-current={id === item.id ? "page" : undefined} className={(id === item.id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/70") + " mb-1 flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"}><span>{name(item.preset, zh)}</span><time className="text-xs text-muted-foreground" dateTime={item.updated_at}>{new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.updated_at))}</time></button>)}</nav>
        <Link href="/fields" className="flex items-center gap-2 border-t border-border px-5 py-4 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} />{l.back}</Link>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col" aria-label={name(domain, zh)}>
        <div className="flex h-16 shrink-0 items-center border-b border-border px-5 sm:px-8"><h2 className="text-lg font-semibold">{name(domain, zh)}</h2></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8" aria-live="polite"><div className="mx-auto flex min-h-full max-w-3xl flex-col">
          {page?.next_before_sequence && <button type="button" className="mx-auto mb-6 text-sm text-primary" onClick={() => void older()} disabled={busy}>{l.older}</button>}
          {!page?.messages.length && !outgoing && <div className="my-auto py-12 text-center"><div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary"><Leaf size={28} /></div><h3 className="text-2xl font-semibold">{l.start}</h3><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">{zh ? domains.find((item) => item.id === domain)?.zhHint : domains.find((item) => item.id === domain)?.enHint}</p></div>}
          <div className="space-y-6">{page?.messages.map((message) => <div key={message.id} className="space-y-3"><div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">{message.text}</div><div className="max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm leading-7 sm:max-w-[85%]">{message.status === "pending" ? <span className="flex items-center gap-2 text-muted-foreground"><LoaderCircle size={15} className="animate-spin" />{l.pending}</span> : message.status === "failed" || message.status === "interrupted" ? <span role="alert">{l.failed}</span> : message.response ? <>{message.response.paragraphs.map((paragraph, index) => <p key={index} className="mb-2 last:mb-0">{paragraph.text}</p>)}{[...new Set(message.response.paragraphs.flatMap((paragraph) => paragraph.evidence_ids))].map((evidence) => <button key={evidence} type="button" onClick={() => void openSource(message, evidence)} className="mr-2 mt-2 rounded-md border border-border px-2 py-1 text-xs text-primary">{l.source} {evidence}</button>)}{message.facts.length > 0 && <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">{zh ? "查看当时的数据" : "View data used"}</summary><dl>{message.facts.map((fact) => <div key={fact.id}><dt className="inline font-medium">{fact.label}: </dt><dd className="inline">{fact.display}</dd></div>)}</dl></details>}{message.response.actions.includes("open_planner") && <Link href="/field-shift/rotation" className="mt-3 block text-xs text-primary underline">{zh ? "打开轮作规划" : "Open rotation planner"}</Link>}</> : null}</div></div>)}{outgoing && <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary/70 px-4 py-3 text-sm text-primary-foreground">{outgoing}</div>}</div><div ref={end} />
        </div></div>
        {error && <div role="alert" className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2 text-sm text-destructive"><span>{error === "failed" ? l.failed : l.error}</span>{!user && <button type="button" className="shrink-0 underline" onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1); }}>{l.retry}</button>}</div>}
        {source && <section aria-label={zh ? "依据详情" : "Source details"} className="mx-auto mb-2 w-[calc(100%-2rem)] max-w-3xl rounded-lg border border-border bg-card p-4 text-sm"><div className="flex justify-between gap-2"><h3 className="font-semibold">{source.title}</h3><button type="button" aria-label={zh ? "关闭依据" : "Close source"} onClick={() => setSource(null)}><X size={16} /></button></div><p className="mt-2 text-muted-foreground">{source.text}</p></section>}
        <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-8"><div className="mx-auto max-w-3xl">{id && user && <AgentActions key={id} conversationId={id} ensureConversation={create} domain={domain} language={zh ? "zh" : "en"} userId={user.id} />}<BotComposer value={draft} onChange={setDraft} onSend={() => void send()} active={!busy} pending={busy} label={zh ? "给" + name(domain, zh) + "留言" : "Message " + name(domain, zh)} placeholder={zh ? "说说你想了解或完成什么…" : "Ask a question or describe a task…"} language={zh ? "zh-CN" : "en-US"} />{domain === "local_agriculture" && <p className="mt-2 text-center text-xs text-muted-foreground">{l.mock}</p>}</div></div>
      </section>
    </main>}
  </div>;
}
