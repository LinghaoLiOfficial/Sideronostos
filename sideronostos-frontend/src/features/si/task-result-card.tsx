"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { apiBlob, apiRequest } from "@/lib/api/client";
import type { AssistantTask } from "@/lib/api/rotation-types";

function displayValue(value: unknown, zh: boolean): string {
  if (typeof value === "boolean") return value ? (zh ? "是" : "Yes") : (zh ? "否" : "No");
  if (value === null || value === undefined) return zh ? "未提供" : "Not provided";
  if (Array.isArray(value)) return value.length ? value.map((item) => displayValue(item, zh)).join(", ") : (zh ? "无" : "None");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function summaryEntries(summary: Record<string, unknown>): [string, unknown][] {
  return Object.entries(summary).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? summaryEntries(value as Record<string, unknown>)
      : [[key, value] as [string, unknown]],
  ).filter(([key]) => key !== "idempotency_key");
}

export function TaskResultCard({ task, language }: { task: AssistantTask; language: "en" | "zh" }) {
  const [currentTask, setCurrentTask] = useState(task);
  useEffect(() => { setCurrentTask(task); }, [task]);
  useEffect(() => {
    if (currentTask.status !== "pending" || !currentTask.refresh_url) return;
    let live = true;
    const timer = window.setTimeout(() => {
      apiRequest<AssistantTask>(currentTask.refresh_url!).then((updated) => {
        if (live) setCurrentTask(updated);
      }).catch(() => { if (live) setCurrentTask((previous) => ({ ...previous })); });
    }, 3000);
    return () => { live = false; window.clearTimeout(timer); };
  }, [currentTask]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    if (currentTask.status !== "completed" || !currentTask.preview_url) return;
    let live = true;
    let objectUrl: string | null = null;
    apiBlob(currentTask.preview_url).then((image) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(image);
      setPreview(objectUrl);
    }).catch(() => { if (live) setPreviewError(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [currentTask.preview_url, currentTask.status]);
  const shown = currentTask;
  const zh = language === "zh";
  if (shown.status === "awaiting_confirmation" && shown.summary) return <section className="mt-3 rounded-lg border border-primary/50 bg-card p-3" aria-label={zh ? "待确认的操作" : "Operation awaiting confirmation"}>
    <p className="text-xs font-semibold uppercase text-primary">{zh ? "等待你的确认" : "Waiting for your confirmation"}</p>
    <dl className="mt-2 grid gap-1 text-sm">{summaryEntries(shown.summary).map(([key, value]) => <div key={key} className="flex justify-between gap-3 border-b border-border/60 py-1"><dt className="text-muted-foreground">{key.replaceAll("_", " ")}</dt><dd className="text-right font-medium">{displayValue(value, zh)}</dd></div>)}</dl>
  </section>;
  if (shown.status === "needs_input" && shown.missing_inputs.length) return <section className="mt-3 rounded-lg border border-border bg-card p-3" aria-label={zh ? "还需补充" : "More details needed"}>
    <p className="text-xs font-semibold uppercase text-muted-foreground">{zh ? "还需补充" : "More details needed"}</p>
    <p className="mt-1 text-sm">{shown.missing_inputs.map((item) => item.replaceAll("_", " ")).join(", ")}</p>
  </section>;
  if (shown.status === "pending") return <section className="mt-3 rounded-lg border border-border bg-card p-3" role="status">{zh ? "任务正在处理，可通过结果链接查看进度。" : "Task in progress. Open the result link to check progress."}{shown.href && <Link className="ml-2 font-semibold text-primary underline" href={shown.href}>{zh ? "查看进度" : "View progress"}</Link>}</section>;
  if (shown.status !== "completed" || !shown.href) return null;
  const fieldResult = shown.href.startsWith("/field-shift?field=");
  return <section className="mt-3 rounded-lg border border-border bg-card p-3" aria-label={zh ? "任务结果" : "Task result"}>
    <p className="text-xs font-semibold uppercase text-muted-foreground">{fieldResult ? (zh ? "已保存的结果" : "Saved result") : (zh ? "任务结果" : "Task result")}</p>
    <Link className="mt-2 inline-block font-semibold text-primary underline" href={shown.href}>{fieldResult ? (zh ? "打开已保存地块" : "Open saved field") : (zh ? "打开结果页面" : "Open result page")}</Link>
    {shown.result_page_url && <Link className="ml-3 inline-block text-sm text-primary underline" href={shown.result_page_url}>{zh ? "查看任务记录" : "View task details"}</Link>}
    {preview && <figure className="mt-3"><Image unoptimized src={preview} alt={fieldResult ? (zh ? "已保存地块的结果页面" : "Saved field result page") : (zh ? "任务结果页面" : "Task result page")} width={720} height={450} className="max-h-64 w-auto max-w-full rounded border border-border object-contain" /><figcaption className="mt-1 text-xs text-muted-foreground">{zh ? "真实结果页面截图" : "Screenshot of the real result page"}</figcaption></figure>}
    {previewError && <p role="status" className="mt-2 text-xs text-muted-foreground">{zh ? "预览暂时不可用；地块已保存，可用上方链接打开。" : "Preview unavailable. Your field is saved; use the link above."}</p>}
  </section>;
}
