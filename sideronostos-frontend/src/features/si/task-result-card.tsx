"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { apiBlob } from "@/lib/api/client";
import type { AssistantTask } from "@/lib/api/rotation-types";

export function TaskResultCard({ task, language }: { task: AssistantTask; language: "en" | "zh" }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    if (task.status !== "completed" || !task.preview_url) return;
    let live = true;
    let objectUrl: string | null = null;
    apiBlob(task.preview_url).then((image) => {
      if (!live) return;
      objectUrl = URL.createObjectURL(image);
      setPreview(objectUrl);
    }).catch(() => { if (live) setPreviewError(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [task.preview_url, task.status]);
  if (task.status !== "completed" || !task.href) return null;
  const zh = language === "zh";
  return <section className="mt-3 rounded-lg border border-border bg-card p-3" aria-label={zh ? "任务结果" : "Task result"}>
    <p className="text-xs font-semibold uppercase text-muted-foreground">{zh ? "已保存的结果" : "Saved result"}</p>
    <Link className="mt-2 inline-block font-semibold text-primary underline" href={task.href}>{zh ? "打开已保存地块" : "Open saved field"}</Link>
    {preview && <figure className="mt-3"><Image unoptimized src={preview} alt={zh ? "已保存地块的结果页面" : "Saved field result page"} width={720} height={450} className="max-h-64 w-auto max-w-full rounded border border-border object-contain" /><figcaption className="mt-1 text-xs text-muted-foreground">{zh ? "真实结果页面截图" : "Screenshot of the real result page"}</figcaption></figure>}
    {previewError && <p role="status" className="mt-2 text-xs text-muted-foreground">{zh ? "预览暂时不可用；地块已保存，可用上方链接打开。" : "Preview unavailable. Your field is saved; use the link above."}</p>}
  </section>;
}
