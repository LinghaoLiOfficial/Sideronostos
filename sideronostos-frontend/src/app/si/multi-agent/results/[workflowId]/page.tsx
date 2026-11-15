"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getToolResult, type AgentToolResult } from "@/features/si/agent-api";
import { publishedHref } from "@/features/si/published-href";

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

function factRows(result: Record<string, unknown> | null) {
  if (!Array.isArray(result?.facts)) return null;
  const labels: Record<string, string> = {
    rainfall_total: "Historical rainfall",
    reference_et0_total: "Reference evapotranspiration",
    surface_soil_moisture: "Surface soil moisture",
  };
  return result.facts.filter((fact): fact is Record<string, unknown> =>
    !!fact && typeof fact === "object" && !Array.isArray(fact)
  ).slice(0, 12).map((fact, index) => {
    const period = fact.period && typeof fact.period === "object" ? fact.period as Record<string, unknown> : {};
    const source = fact.source && typeof fact.source === "object" ? fact.source as Record<string, unknown> : {};
    const label = labels[String(fact.metric)] ?? String(fact.metric ?? "Observation");
    const value = typeof fact.value === "number" && Number.isFinite(fact.value)
      ? `${fact.value} ${String(fact.unit ?? "")}`.trim() : "Incomplete for this period";
    const dates = period.start === period.end ? String(period.start ?? "")
      : [period.start, period.end].filter(Boolean).join(" – ");
    return <li key={`${String(fact.id ?? index)}`} className="rounded-md border border-border/70 px-3 py-3">
      <strong>{label}: {value}</strong>
      {dates && <p className="mt-1 text-sm text-muted-foreground">{dates}</p>}
      {typeof source.product === "string" && <p className="mt-1 text-xs text-muted-foreground">Source: {source.product} · {String(source.release_id ?? "published release")}</p>}
      {fact.source_kind === "synthetic_test" && <p className="mt-1 text-xs font-medium text-amber-700">Synthetic test data; not a live NASA observation.</p>}
    </li>;
  });
}

export default function AgentResultPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [result, setResult] = useState<AgentToolResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const hasConversation = typeof window !== "undefined" && Boolean(new URLSearchParams(window.location.search).get("conversation"));
  useEffect(() => {
    const conversation = new URLSearchParams(window.location.search).get("conversation");
    let live = true;
    if (!conversation || !workflowId) {
      queueMicrotask(() => { if (live) { setFailed(true); setLoading(false); } });
      return () => { live = false; };
    }
    getToolResult(conversation, workflowId).then((data) => {
      if (live) { setResult(data); setLoading(false); }
    }).catch(() => { if (live) { setFailed(true); setLoading(false); } });
    return () => { live = false; };
  }, [workflowId, attempt]);
  const href = publishedHref(result?.href);
  const data = result?.result && typeof result.result === "object" ? result.result as Record<string, unknown> : null;
  const image = data && typeof data.image_base64 === "string" && result?.content_type?.startsWith("image/")
    ? `data:${result.content_type};base64,${data.image_base64}` : null;
  const facts = factRows(data);
  const factCount = Array.isArray(data?.facts) ? data.facts.filter((fact) => !!fact && typeof fact === "object" && !Array.isArray(fact)).length : 0;
  const title = facts ? "Published observations for your selected area" : result?.title;
  return <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
    <div className="mx-auto max-w-4xl">
      <Link href="/si/multi-agent" className="text-sm text-primary underline">← Back to farm assistant</Link>
      <p className="mt-8 text-xs font-semibold uppercase tracking-widest text-primary">Farm task result</p>
      {loading && <p role="status" className="mt-6 text-sm text-muted-foreground">Loading result…</p>}
      {failed && <div className="mt-6 space-y-3"><p role="alert">This result is unavailable for your account.</p>{hasConversation && workflowId && <button type="button" className="min-h-10 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { setFailed(false); setLoading(true); setAttempt((value) => value + 1); }}>Retry</button>}</div>}
      {result && <div data-testid="result-ready" className="mt-2">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">{result.status === "completed" ? "Task complete" : `Status: ${result.status}`}</p>
        {href && <Link href={href} className="mt-3 inline-block font-semibold text-primary underline">Open original module page ↗</Link>}
        {Array.isArray(data?.items) && <p className="mt-4 font-medium">{data.items.length} records returned{data.items.length > 8 && " · showing first 8"}</p>}
        {facts && <>
          <p className="mt-4 font-medium">{factCount} published observations{factCount > facts.length && ` · showing first ${facts.length}`}</p>
          {facts.length > 0 ? <ul className="mt-3 space-y-2">{facts}</ul>
            : <p className="mt-3 text-sm text-muted-foreground">No published observations cover this selection and period.</p>}
        </>}
        {!facts && summary(result.result).length > 0 && <ul className="mt-4 space-y-2">{summary(result.result).map((item, index) => <li key={`${index}-${item}`} className="rounded-md border border-border/70 px-3 py-2">{item}</li>)}</ul>}
        {/* The owned business API returns an in-memory image, with no stable URL or dimensions for next/image. */}
        {image && <img src={image} alt="Result image from the business service" className="mt-5 max-w-full rounded border border-border" />}
        {typeof result.result === "string" && <pre className="mt-5 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{result.result.slice(0, 12000)}</pre>}
      </section></div>}
    </div>
  </main>;
}
