"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LoaderCircle } from "lucide-react";
import * as api from "./agent-api";
import type { ModuleOperation, ModuleOperationOutcome } from "./agent-api";
import { CompletionReceipt } from "./completion-receipt";

type Props = { conversationId: string; language: "en" | "zh" };
const labels = {
  en: { heading: "Farm tasks", choose: "Choose a task", loadError: "Could not load farm tasks.", noOps: "This assistant has no operational tasks. Ask it a question to search its knowledge base.", run: "Continue task", working: "Working…", body: "Advanced JSON input", advanced: "Advanced input for complex details", result: "Operation result", open: "Open result", progress: "View progress", invalid: "Enter a valid JSON object.", inputs: "Required information", method: "Method", status: "Status", details: "Technical response" },
  zh: { heading: "农场任务", choose: "选择要完成的任务", loadError: "农场任务加载失败。", noOps: "此助手没有可操作的任务。可以直接提问来检索知识库。", run: "继续任务", working: "正在处理…", body: "高级 JSON 输入", advanced: "复杂信息的高级输入", result: "操作结果", open: "打开结果", progress: "查看进度", invalid: "请输入有效的 JSON 对象。", inputs: "需要补充的信息", method: "方法", status: "状态", details: "技术返回数据" },
};

function resultSummary(result: unknown, language: "en" | "zh"): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  const name = record.name ?? record.title;
  if (typeof name === "string" && name.trim()) return name;
  if (Array.isArray(record.items)) return language === "zh" ? `${record.items.length} 条记录` : `${record.items.length} ${record.items.length === 1 ? "record" : "records"} found`;
  return null;
}

function localHref(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const parsed = new URL(value, "https://app.invalid");
    return parsed.origin === "https://app.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch { return null; }
}

function requiredValue(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return "";
  const shape = schema as { type?: string; enum?: unknown[]; default?: unknown };
  if (shape.default !== undefined) return shape.default;
  if (shape.enum?.length) return shape.enum[0];
  if (shape.type === "boolean") return false;
  if (shape.type === "array") return [];
  if (shape.type === "integer" || shape.type === "number") return "";
  return "";
}

function initialBody(operation?: ModuleOperation): string {
  const schema = operation?.body as { properties?: Record<string, unknown> } | null;
  const initial = Object.fromEntries((operation?.required_body_parameters ?? [])
    .map((key) => [key, requiredValue(schema?.properties?.[key])]));
  return JSON.stringify(initial, null, 2);
}

type PropertyShape = { type?: string; title?: string; description?: string; enum?: unknown[] };

function bodyObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function fieldTitle(name: string, language: "en" | "zh"): string {
  const names: Record<string, [string, string]> = {
    name: ["Field name", "地块名称"], area_ha: ["Area (hectares)", "面积（公顷）"],
    latitude: ["Latitude", "纬度"], longitude: ["Longitude", "经度"],
    soil_texture: ["Soil texture", "土壤质地"], irrigation_available: ["Irrigation available", "具备灌溉条件"],
    profile_id: ["Parameter profile", "参数配置"],
  };
  return names[name]?.[language === "zh" ? 1 : 0] ?? name.replaceAll("_", " ");
}

export function ModuleOperations({ conversationId, language }: Props) {
  const zh = language === "zh";
  const text = zh ? labels.zh : labels.en;
  const [operations, setOperations] = useState<ModuleOperation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [queryValues, setQueryValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("{}");
  const [outcome, setOutcome] = useState<ModuleOperationOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const touched = useRef(false);
  const outcomeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (outcome && touched.current) outcomeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [outcome]);
  useEffect(() => {
    let live = true;
    api.listModuleOperations(conversationId).then(({ items }) => {
      if (live) {
        setOperations(items);
        setSelectedId(items[0]?.operation_id ?? "");
        setBodyText(initialBody(items[0]));
      }
    }).catch(() => { if (live) setError(text.loadError); });
    return () => { live = false; };
  }, [conversationId, text.loadError]);
  useEffect(() => {
    let live = true;
    api.listModuleOperationHistory(conversationId).then(({ items }) => {
      if (live && !touched.current && items[0]) setOutcome(items[0].outcome);
    }).catch(() => { /* A previous result is optional; current operations remain available. */ });
    return () => { live = false; };
  }, [conversationId]);
  const selected = useMemo(() => operations.find((item) => item.operation_id === selectedId) ?? null, [operations, selectedId]);
  const bodyValues = useMemo(() => bodyObject(bodyText), [bodyText]);
  const bodyProperties = (selected?.body?.properties ?? {}) as Record<string, PropertyShape>;
  function setBodyProperty(name: string, value: unknown, required: boolean) {
    const updated = { ...bodyObject(bodyText) };
    if (value === "" && !required) delete updated[name];
    else updated[name] = value;
    setBodyText(JSON.stringify(updated, null, 2));
  }
  function select(id: string) {
    touched.current = true;
    setSelectedId(id); setPathValues({}); setQueryValues({}); setOutcome(null); setError("");
    const operation = operations.find((item) => item.operation_id === id);
    setBodyText(initialBody(operation));
  }
  async function run() {
    if (!selected || busy) return;
    touched.current = true;
    let body: unknown = null;
    if (selected.body) {
      try {
        body = JSON.parse(bodyText);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body must be an object");
      } catch { setError(text.invalid); return; }
    }
    setBusy(true); setError("");
    try {
      const result = await api.postModuleOperation(conversationId, {
        operation_id: selected.operation_id,
        path_params: pathValues,
        query_params: queryValues,
        body,
        idempotency_key: `module-${crypto.randomUUID()}`,
      });
      setOutcome(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : text.loadError); }
    finally { setBusy(false); }
  }
  const href = localHref(outcome?.href);
  return <details className="mb-3 rounded-xl border border-border bg-card text-sm">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-medium"><span>{text.heading}{operations.length > 0 ? ` · ${operations.length}` : ""}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="space-y-3 border-t border-border p-3">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!error && operations.length === 0 && <p className="text-muted-foreground">{text.noOps}</p>}
      {operations.length > 0 && <>
        <label className="block text-xs text-muted-foreground">{text.choose}<select aria-label={text.choose} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-foreground" value={selectedId} onChange={(event) => select(event.target.value)}>{operations.map((item) => <option key={item.operation_id} value={item.operation_id}>{item.title || item.operation_id.replaceAll("_", " ")}</option>)}</select></label>
        {selected && <>
          {(selected.path_parameters.length > 0 || selected.query_parameters.length > 0) && <div className="grid gap-2 sm:grid-cols-2">
            {[...selected.path_parameters.map((name) => ({ name, group: "path" as const, required: true })), ...selected.query_parameters.map((name) => ({ name, group: "query" as const, required: selected.required_query_parameters.includes(name) }))].map(({ name, group, required }) => <label key={`${group}.${name}`} className="text-xs text-muted-foreground">{name}{required ? " *" : ""}<input aria-label={`${name}${required ? " *" : ""}`} required={required} value={(group === "path" ? pathValues : queryValues)[name] ?? ""} onChange={(event) => (group === "path" ? setPathValues : setQueryValues)((values) => ({ ...values, [name]: event.target.value }))} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-foreground" /></label>)}
          </div>}
          {selected.body && <>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(bodyProperties).filter(([, shape]) => shape.type === "string" || shape.type === "number" || shape.type === "integer" || shape.type === "boolean").map(([name, shape]) => {
                const required = selected.required_body_parameters.includes(name);
                const label = `${fieldTitle(name, language)}${required ? " *" : ""}`;
                const current = bodyValues[name];
                return <label key={name} className="text-xs text-muted-foreground">{label}
                  {shape.enum?.length ? <select aria-label={label} value={String(current ?? "")} onChange={(event) => setBodyProperty(name, event.target.value, required)} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-foreground">{!required && <option value="">—</option>}{shape.enum.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>
                    : shape.type === "boolean" ? <input aria-label={label} type="checkbox" checked={current === true} onChange={(event) => setBodyProperty(name, event.target.checked, required)} className="ml-2 align-middle" />
                      : <input aria-label={label} type={shape.type === "number" || shape.type === "integer" ? "number" : "text"} step={shape.type === "integer" ? "1" : shape.type === "number" ? "any" : undefined} value={typeof current === "string" || typeof current === "number" ? current : ""} onChange={(event) => setBodyProperty(name, shape.type === "number" || shape.type === "integer" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value, required)} className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-foreground" />}
                </label>;
              })}
            </div>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{text.advanced}</summary><label className="mt-2 block">{text.body}<textarea aria-label={text.body} value={bodyText} onChange={(event) => setBodyText(event.target.value)} rows={5} spellCheck={false} className="mt-1 block w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" /></label></details>
          </>}
          <button type="button" onClick={() => void run()} disabled={busy} className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-60">{busy && <LoaderCircle size={14} className="mr-1 inline animate-spin" />}{busy ? text.working : text.run}</button>
        </>}
      </>}
      {outcome && <section ref={outcomeRef} aria-label={text.result} className="rounded-md bg-muted p-3">
        {href && outcome.status === "succeeded" ?
          <CompletionReceipt href={href} message={outcome.text} language={language} linkLabel={text.open} fileName={`agrisata-${outcome.operation_id}.png`} captureKey={JSON.stringify(outcome.result)}>
            {resultSummary(outcome.result, language) && <p className="mt-2 font-medium">{resultSummary(outcome.result, language)}</p>}
            <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{text.details}</summary>
              <p className="mt-1">{text.status}: {outcome.status}{outcome.status_code ? ` · HTTP ${outcome.status_code}` : ""}</p>
              {outcome.result !== null && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(outcome.result, null, 2)}</pre>}
            </details>
          </CompletionReceipt>
          : <>
            {href && outcome.status === "pending" && <Link href={href} className="inline-block rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">{text.progress}</Link>}
            <p className="mt-2 font-medium">{outcome.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">{text.status}: {outcome.status}{outcome.status_code ? ` · HTTP ${outcome.status_code}` : ""}</p>
            {outcome.missing_inputs.length > 0 && <p className="mt-2">{text.inputs}: {outcome.missing_inputs.join(", ")}</p>}
            {outcome.result !== null && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(outcome.result, null, 2)}</pre>}
          </>}
      </section>}
    </div>
  </details>;
}
