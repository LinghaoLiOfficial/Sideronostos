"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listAllPlans, listAllRuns } from "@/lib/api/daily";
import { exportRunCsv } from "@/lib/api/rotation";
import type { AnyRotationRun } from "@/lib/api/daily-types";
import { Input, linkStyle, LoadingState, primary, secondary, Select, TaskFeedback, tr, useDraft, useLoad, useTaskExecution, type TaskProps } from "./shared";

const running = (status: string) => ["queued", "pending", "running", "cancel_requested"].includes(status);
const runHref = (run: string) => `/field-shift/rotation?run=${encodeURIComponent(run)}`;
function statusLabel(status: string, language: "en" | "zh") {
  const labels: Record<string, [string, string]> = { queued: ["Waiting to start", "等待开始"], pending: ["Waiting to start", "等待开始"], running: ["Calculating", "计算中"], succeeded: ["Results ready", "结果已就绪"], failed: ["Needs attention", "需要处理"], infeasible: ["No workable plan found", "未找到可行方案"], cancelled: ["Cancelled", "已取消"], cancel_requested: ["Stopping", "正在停止"] };
  return tr(language, ...(labels[status] ?? ["Check calculation", "查看计算"]));
}

export function RotationPlans({ userId, language }: TaskProps) {
  const plans = useLoad(() => listAllPlans(userId));
  const [query, setQuery] = useState("");
  return <div className="space-y-3"><LoadingState state={plans} language={language} />{plans.data && <>
    {plans.data.items.length > 5 && <Input label={tr(language, "Find a plan", "查找计划")} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}
    {!plans.data.items.length && <p>{tr(language, "You haven’t saved a rotation plan yet. Start with your fields and planting goals.", "还没有保存轮作计划，可以从地块和种植目标开始。")}</p>}
    <ul className="divide-y divide-border">{plans.data.items.filter((p) => p.title.toLowerCase().includes(query.toLowerCase())).map((plan) => <li key={plan.id} className="py-2"><Link href={`/field-shift/rotation?plan=${encodeURIComponent(plan.id)}`} className={linkStyle}>{plan.title}</Link><p className="text-xs text-muted-foreground">{new Date(plan.created_at).toLocaleDateString(language === "en" ? "en" : "zh-CN")}</p></li>)}</ul>
  </>}<Link href="/field-shift/rotation" className={linkStyle}>{tr(language, "Plan the next seasons", "规划接下来的种植季")}</Link></div>;
}

export function RotationRuns(props: TaskProps) {
  const { userId, language } = props;
  const runs = useLoad(() => listAllRuns(userId));
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Poll only while a job is active. The saved run remains the authority on status.
  useEffect(() => {
    if (!runs.data?.items.some((run) => running(run.status))) return;
    const timer = setTimeout(runs.reload, 10000);
    return () => clearTimeout(timer);
  }, [runs.data, runs.reload]);
  const current = runs.data?.items.find((run) => run.id === selected);
  return <div className="space-y-3"><LoadingState state={runs} language={language} />
    {!runs.loading && <button className={secondary} onClick={runs.reload}>{tr(language, "Refresh progress", "刷新进度")}</button>}
    {runs.data && !runs.data.items.length && <p>{tr(language, "No calculations yet. The planner will guide you through your fields, crops and resource limits.", "还没有计算记录。规划器会引导你选择地块、作物和资源限制。")}</p>}
    {current ? <><button className={secondary} onClick={() => setSelected(null)}>{tr(language, "All calculations", "所有计算")}</button><RunDetails key={current.id} {...props} run={current} refresh={runs.reload} /></> : <>
      {(runs.data?.items.length ?? 0) > 5 && <Input label={tr(language, "Find a field’s calculations", "查找地块计算")} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}
      <ul className="divide-y divide-border">{runs.data?.items.filter((run) => run.field_snapshots.some((field) => field.name.toLowerCase().includes(query.toLowerCase()))).map((run) => <li key={run.id} className="space-y-1 py-3"><h4 className="font-medium">{run.field_snapshots.map((field) => field.name).join(", ") || tr(language, "Farm calculation", "农场计算")}</h4><p className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString(language === "en" ? "en" : "zh-CN")} · <span>{statusLabel(run.status, language)}</span></p><div className="flex flex-wrap gap-4"><Link href={runHref(run.id)} className={linkStyle}>{tr(language, running(run.status) ? "View progress" : "Open results", running(run.status) ? "查看进度" : "打开结果")}</Link><button className={linkStyle} onClick={() => setSelected(run.id)}>{tr(language, "Manage this calculation", "管理此计算")}</button></div></li>)}</ul>
    </>}
    <Link href="/field-shift/rotation" className={linkStyle}>{tr(language, "Start a new plan", "开始新规划")}</Link>
  </div>;
}

function RunDetails(props: TaskProps & { run: AnyRotationRun; refresh: () => void }) {
  const { run, language, scope, refresh } = props;
  const execution = useTaskExecution(props, `run:${run.id}`);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [draft, setDraft] = useDraft(`${scope}:save-plan:${run.id}`, { option: "", title: "", notes: "" });
  const options = [run.result?.baseline, ...(run.result?.options ?? [])].filter((option) => option && option.feasible && option.complete !== false);
  async function update(action: "cancel" | "retry") {
    const outcome = await execution.run({ kind: "operation", method: "POST", path: `/rotation-optimizer/runs/{run_id}/${action}`, pathParams: { run_id: run.id } });
    if (outcome?.status === "succeeded" || outcome?.status === "pending") { setConfirmCancel(false); refresh(); }
  }
  async function download() {
    setDownloading(true); setDownloadError(false);
    try {
      const blob = await exportRunCsv(run.id);
      const href = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = href; anchor.download = `planting-plan-${run.created_at.slice(0, 10)}.csv`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { setDownloadError(true); } finally { setDownloading(false); }
  }
  return <div className="space-y-3"><h4 className="font-medium">{run.field_snapshots.map((field) => field.name).join(", ")}</h4><p role="status">{statusLabel(run.status, language)}</p><Link className={linkStyle} href={runHref(run.id)}>{tr(language, "Open calculation", "打开计算")}</Link>
    {running(run.status) && run.status !== "cancel_requested" && (confirmCancel ? <div className="rounded-lg border border-border p-3"><p>{tr(language, "Stop this calculation? Your saved fields and plans will remain available.", "停止此计算？已保存的地块和计划仍会保留。")}</p><div className="mt-2 flex flex-wrap gap-2"><button disabled={execution.busy} className={primary} onClick={() => void update("cancel")}>{tr(language, "Stop calculation", "停止计算")}</button><button className={secondary} onClick={() => setConfirmCancel(false)}>{tr(language, "Keep calculating", "继续计算")}</button></div></div> : <button className={secondary} onClick={() => setConfirmCancel(true)}>{tr(language, "Cancel calculation", "取消计算")}</button>)}
    {["failed", "cancelled"].includes(run.status) && <button className={primary} disabled={execution.busy || execution.uncertain} onClick={() => void update("retry")}>{tr(language, "Retry calculation", "重试计算")}</button>}
    {!running(run.status) && run.result && <button className={secondary} disabled={downloading} onClick={() => void download()}>{tr(language, downloading ? "Preparing download…" : "Download planting schedule", downloading ? "正在准备下载…" : "下载种植日程")}</button>}
    {downloadError && <p role="alert">{tr(language, "The download failed. Try again or open the calculation.", "下载失败，请重试或打开计算页面。")}</p>}
    {options.length > 0 && execution.outcome?.status !== "succeeded" && <form className="space-y-3 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); void execution.run({ kind: "operation", method: "POST", path: "/rotation-optimizer/plans", body: { run_id: run.id, option_id: draft.option, title: draft.title.trim(), notes: draft.notes } }); }}><fieldset className="space-y-3" disabled={execution.busy || execution.uncertain}>
      <Select required label={tr(language, "Which option would you like to keep?", "想保留哪个方案？")} value={draft.option} onChange={(e) => setDraft({ ...draft, option: e.target.value })}><option value="">{tr(language, "Choose an option", "选择方案")}</option>{options.map((option) => option && <option key={option.id} value={option.id}>{option.label}</option>)}</Select>
      <Input required maxLength={160} label={tr(language, "Plan name", "计划名称")} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      <Input label={tr(language, "Notes (optional)", "备注（可选）")} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /><button className={primary}>{tr(language, "Save this plan", "保存此计划")}</button>
    </fieldset></form>}
    <TaskFeedback execution={execution} language={language} success={tr(language, "Your request has been confirmed. Open the result for its current state.", "请求已确认，打开结果可查看当前状态。")} linkLabel={tr(language, "Open result", "打开结果")} />
  </div>;
}

export function ComparePlans({ userId, language, scope }: TaskProps) {
  const plans = useLoad(() => listAllPlans(userId));
  const [choice, setChoice] = useDraft(`${scope}:compare`, { first: "", second: "" });
  const first = plans.data?.items.find((plan) => plan.id === choice.first);
  const second = plans.data?.items.find((plan) => plan.id === choice.second);
  const href = first && second && first.id !== second.id ? `/field-shift/rotation?${new URLSearchParams({ run: first.run_id, option: first.option_id, compare: second.run_id, compareOption: second.option_id })}` : null;
  return <div className="space-y-3"><LoadingState state={plans} language={language} />{plans.data && (plans.data.items.length < 2 ? <p>{tr(language, "Save two plans first, then compare their water use, crop choices and trade-offs.", "先保存两个计划，即可比较用水、作物和取舍。")}</p> : <>
    <p className="text-xs text-muted-foreground">{tr(language, "Choose two saved plans. The comparison page will check whether their methods and scores can be compared.", "选择两个已保存计划，比较页面会检查计算方法和评分是否可比。")}</p>
    {(["first", "second"] as const).map((key) => <Select key={key} label={tr(language, key === "first" ? "First plan" : "Second plan", key === "first" ? "第一个计划" : "第二个计划")} value={choice[key]} onChange={(e) => setChoice({ ...choice, [key]: e.target.value })}><option value="">{tr(language, "Choose a saved plan", "选择已保存计划")}</option>{plans.data?.items.map((plan) => <option disabled={plan.id === choice[key === "first" ? "second" : "first"]} key={plan.id} value={plan.id}>{plan.title} · {plan.created_at.slice(0, 10)}</option>)}</Select>)}
    {href && <Link className={primary} href={href}>{tr(language, "Compare these plans", "比较这两个计划")}</Link>}
  </>)}</div>;
}
