"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes } from "react";
import Link from "next/link";
import { publishedHref } from "../published-href";
import * as agent from "../agent-api";
import type { FarmerTasksProps } from "../farmer-tasks";
import { CompletionReceipt } from "../completion-receipt";

export type TaskProps = FarmerTasksProps & { scope: string };
export const control = "mt-1 block w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary";
export const primary = "inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50";
export const secondary = "inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50";
export const linkStyle = "inline-flex min-h-10 items-center text-sm font-medium text-foreground underline underline-offset-4";
export const tr = (language: "en" | "zh", en: string, zh: string) => language === "zh" ? zh : en;

export function readSaved<T>(key: string, initial: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? initial; } catch { return initial; }
}
export function writeSaved(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* The form still works when browser storage is disabled. */ }
}
export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readSaved(key, initial));
  useEffect(() => { writeSaved(key, value); }, [key, value]);
  return [value, setValue] as const;
}

export function Input({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return <div className="min-w-0 text-sm"><label htmlFor={props.id ?? id}>{label}</label><input id={id} className={control} {...props} /></div>;
}
export function Select({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return <div className="min-w-0 text-sm"><label htmlFor={props.id ?? id}>{label}</label><select id={id} className={control} {...props}>{children}</select></div>;
}

export function useLoad<T>(load: () => Promise<T>) {
  const loader = useRef(load);
  useEffect(() => { loader.current = load; }, [load]);
  const [state, setState] = useState<{ data?: T; loading: boolean; error: boolean }>({ loading: true, error: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    loader.current().then((data) => { if (live) setState({ data, loading: false, error: false }); })
      .catch(() => { if (live) setState({ loading: false, error: true }); });
    return () => { live = false; };
  }, [revision]);
  const reload = useCallback(() => { setState((old) => ({ ...old, loading: true, error: false })); setRevision((n) => n + 1); }, []);
  return { ...state, reload };
}
export function LoadingState({ state, language }: { state: { loading: boolean; error: boolean; reload: () => void }; language: "en" | "zh" }) {
  if (state.loading) return <p role="status" className="py-3 text-sm text-muted-foreground">{tr(language, "Loading your records…", "正在加载你的记录…")}</p>;
  if (state.error) return <div role="alert" className="space-y-2"><p>{tr(language, "Your records could not be loaded. Check your connection and try again.", "无法加载记录，请检查网络后重试。")}</p><button className={secondary} onClick={state.reload}>{tr(language, "Try again", "重试")}</button></div>;
  return null;
}
export function NoFields({ language }: { language: "en" | "zh" }) {
  return <div className="space-y-2"><p>{tr(language, "Save a field first so I can use its location.", "先保存一个地块，我就能使用它的位置。")}</p><Link className={linkStyle} href="/si/fields?field=new&step=field">{tr(language, "Add your first field", "添加第一个地块")}</Link></div>;
}

type Command = { kind: "action"; action: agent.AgentActionName; arguments: Record<string, unknown> } |
  { kind: "operation"; method: string; path: string; pathParams?: Record<string, string>; body?: Record<string, unknown> };
type Outcome = agent.AgentActionOutcome | agent.ModuleOperationOutcome;
type Attempt = { key: string; command: Command; outcome?: Outcome };

// Keep the exact request across a lost response, close/reopen and refresh. A retry
// must query the same journal entry, rather than risk duplicating a business write.
export function useTaskExecution(props: TaskProps, name: string) {
  const storage = `${props.scope}:request:${name}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() => readSaved(storage, null));
  const attemptRef = useRef(attempt);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(Boolean(attempt?.outcome));
  const locked = useRef(false);
  const [error, setError] = useState("");
  const uncertain = Boolean(attempt && !attempt.outcome);
  useEffect(() => {
    const saved = attemptRef.current;
    const chat = props.conversationId;
    if (!saved?.outcome || !chat) return;
    let live = true;
    const lookup = saved.command.kind === "action" ? agent.getAction(chat, saved.key) :
      agent.listModuleOperationHistory(chat).then(({ items }) => items.find((item) => item.idempotency_key === saved.key)?.outcome);
    lookup.then((outcome) => {
      if (!outcome) throw new Error("Saved result unavailable");
      if (live) { const next = { ...saved, outcome }; attemptRef.current = next; setAttempt(next); writeSaved(storage, next); }
    }).catch(() => {
      if (live) { const next = { ...saved, outcome: undefined }; attemptRef.current = next; setAttempt(next); writeSaved(storage, next); }
    }).finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
  }, [props.conversationId, storage]);
  function remember(next: Attempt | null) { attemptRef.current = next; setAttempt(next); writeSaved(storage, next); }
  async function run(command: Command): Promise<Outcome | undefined> {
    if (locked.current || restoring) return;
    locked.current = true; setBusy(true); setError("");
    let current = attemptRef.current;
    try {
      const chat = props.conversationId ?? await props.ensureConversation();
      if (!chat) throw new Error("Conversation unavailable");
      if (!current || current.outcome) current = { key: crypto.randomUUID(), command };
      remember(current);
      const pending = current.command;
      let outcome: Outcome;
      if (pending.kind === "action") {
        outcome = await agent.postAction(chat, { action: pending.action, arguments: pending.arguments, idempotency_key: current.key });
      } else {
        const catalog = await agent.listModuleOperations(chat);
        const operation = catalog.items.find((item) => item.method === pending.method && item.path === pending.path);
        if (!operation) throw new Error("Task unavailable");
        outcome = await agent.postModuleOperation(chat, { operation_id: operation.operation_id, path_params: pending.pathParams ?? {}, query_params: {}, body: pending.body ?? null, idempotency_key: current.key });
      }
      remember({ ...current, outcome });
      return outcome;
    } catch {
      setError(tr(props.language, "We could not confirm the result. Check your connection, then choose Check again to recover this same request.", "暂时无法确认结果。请检查网络，然后点击再次确认以恢复同一次请求。"));
    } finally { locked.current = false; setBusy(false); }
  }
  return { run, busy: busy || restoring, error, uncertain, outcome: restoring ? null : attempt?.outcome ?? null, clear: () => remember(null), retry: () => attemptRef.current && run(attemptRef.current.command) };
}

export function TaskFeedback({ execution, language, success, linkLabel, children }: {
  execution: ReturnType<typeof useTaskExecution>; language: "en" | "zh"; success: string; linkLabel: string; children?: ReactNode;
}) {
  const outcome = execution.outcome;
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!outcome) return;
    // Bring the confirmed result into view even when a long form was scrolled.
    let parent = result.current?.parentElement;
    while (parent) {
      if (parent.hasAttribute("data-task-scroll")) parent.scrollTop = 0;
      parent = parent.parentElement;
    }
  }, [outcome]);
  const stopping = outcome?.result && typeof outcome.result === "object" && "status" in outcome.result
    && outcome.result.status === "cancel_requested";
  const pendingText = stopping
    ? tr(language, "Stopping this calculation. Open its progress to confirm when it has stopped.", "正在停止此计算，打开进度可确认是否已停止。")
    : tr(language, "Your calculation is underway. Open its progress to see when it is ready.", "计算已开始，打开进度可查看结果。");
  const href = publishedHref(outcome?.href);
  return <div ref={result} className="space-y-3">
    {execution.busy && <p role="status">{tr(language, "Working on it…", "正在处理…")}</p>}
    {(execution.error || execution.uncertain) && !execution.busy && <div role="alert" className="space-y-2"><p>{execution.error || tr(language, "This request still needs confirmation. Check again before starting another one.", "上次请求仍需确认，请先确认结果。")}</p><button className={secondary} onClick={() => void execution.retry()}>{tr(language, "Check again", "再次确认")}</button></div>}
    {outcome?.status === "succeeded" && href ? <CompletionReceipt href={href} message={success} language={language} linkLabel={linkLabel} fileName="agrisata-task-result.png" captureKey={JSON.stringify(outcome.result)}>{children}</CompletionReceipt> : outcome && <div role="status" className="space-y-2 rounded-lg bg-muted p-3"><p>{outcome.status === "succeeded" ? success : outcome.status === "pending" ? pendingText : outcome.status === "needs_input" ? tr(language, "Some details still need attention. Check the form and try again.", "还有资料需要补充，请检查表单后重试。") : outcome.status === "unavailable" ? tr(language, "No published observation is available for this place and period. Try another period.", "该地点和时段暂无已发布观测，请更换时段。") : tr(language, "This task could not be completed. Your input is kept.", "任务未能完成，输入已保留。")}</p>{outcome.status === "failed" && outcome.text?.trim() && <p>{outcome.text}</p>}{outcome.status === "succeeded" && children}{href && outcome.status === "pending" && <Link href={href} className={linkStyle}>{tr(language, "View progress", "查看进度")}</Link>}</div>}
  </div>;
}
