"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getToolResult, type AgentToolResult } from "@/features/si/agent-api";

function summary(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const value = result as Record<string, unknown>;
  if (Array.isArray(value.items)) {
    const seen = new Set<string>();
    return value.items.slice(0, 8).map((item) => {
      if (!item || typeof item !== "object") return String(item);
      const row = item as Record<string, unknown>;
      const label = String(row.name ?? row.title ?? row.product ?? row.id ?? "Record");
      const display = seen.has(label) && row.id ? `${label} (${String(row.id)})` : label;
      seen.add(label);
      return display;
    });
  }
  return Object.entries(value).filter(([key, item]) =>
    key !== "image_base64" && (typeof item === "string" || typeof item === "number" || typeof item === "boolean")
  ).slice(0, 8).map(([key, item]) => `${key.replaceAll("_", " ")}: ${String(item)}`);
}

export default function AgentResultPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [result, setResult] = useState<AgentToolResult | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const conversation = new URLSearchParams(window.location.search).get("conversation");
    if (!conversation || !workflowId) { setFailed(true); return; }
    let live = true;
    getToolResult(conversation, workflowId).then((data) => {
      if (live) setResult(data);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [workflowId]);
  const href = result?.href?.startsWith("/") && !result.href.startsWith("//") ? result.href : null;
  const data = result?.result && typeof result.result === "object" ? result.result as Record<string, unknown> : null;
  const image = data && typeof data.image_base64 === "string" && result?.content_type?.startsWith("image/")
    ? `data:${result.content_type};base64,${data.image_base64}` : null;
  return <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
    <div className="mx-auto max-w-4xl">
      <Link href="/si/multi-agent" className="text-sm text-primary underline">← Back to farm assistant</Link>
      <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-primary">Farm task result</p>
      {failed && <p role="alert" className="mt-6">This result is unavailable for your account.</p>}
      {result && <div data-testid="result-ready" className="mt-2">
      <h1 className="text-3xl font-semibold">{result.title}</h1>
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">{result.status === "completed" ? "Task complete" : `Status: ${result.status}`}</p>
        {href && <Link href={href} className="mt-3 inline-block font-semibold text-primary underline">Open original module page ↗</Link>}
        {Array.isArray(data?.items) && <p className="mt-4 font-medium">{data.items.length} records returned</p>}
        {summary(result.result).length > 0 && <ul className="mt-4 space-y-2">{summary(result.result).map((item, index) => <li key={`${index}-${item}`} className="rounded-md border border-border/70 px-3 py-2">{item}</li>)}</ul>}
        {image && <img src={image} alt="Result image from the business service" className="mt-5 max-w-full rounded border border-border" />}
        {typeof result.result === "string" && <pre className="mt-5 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{result.result.slice(0, 12000)}</pre>}
      </section></div>}
    </div>
  </main>;
}
