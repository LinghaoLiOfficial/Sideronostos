"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { FieldForm, FieldList, FieldPlans } from "./tasks/field-tasks";
import { Observations, ObservationMaps } from "./tasks/observation-tasks";
import { ComparePlans, RotationPlans, RotationRuns } from "./tasks/rotation-tasks";
import { control, Input, primary, tr, useDraft, type TaskProps } from "./tasks/shared";

export type FarmerTasksProps = {
  conversationId: string | null;
  ensureConversation: () => Promise<string | null>;
  userId: string;
  botId: string;
  language: "en" | "zh";
  onAsk: (text: string) => void | Promise<void>;
  compact?: boolean;
};

type TaskId = "fields" | "add" | "field-plans" | "observations" | "maps" | "plans" | "runs" | "compare" | "local";
type Choice = { id: TaskId; en: string; zh: string };

function choices(bot: string): Choice[] {
  if (bot === "field-guide") return [{ id: "fields", en: "My fields", zh: "我的地块" }, { id: "add", en: "Add a field", zh: "添加地块" }, { id: "field-plans", en: "My planting plans", zh: "我的种植计划" }];
  if (bot === "rotation-guide") return [{ id: "plans", en: "My saved plans", zh: "已保存计划" }, { id: "runs", en: "My calculations", zh: "我的计算" }, { id: "compare", en: "Compare saved plans", zh: "比较已保存计划" }];
  if (bot === "local-knowledge-guide") return [{ id: "local", en: "Ask about my area", zh: "询问本地农业" }];
  const observation: Choice = { id: "observations", en: bot === "remote-soil" ? "Check soil moisture" : bot === "remote-weather" ? "Check past weather" : "Check water conditions", zh: bot === "remote-soil" ? "查看土壤湿度" : bot === "remote-weather" ? "查看历史天气" : "查看水分状况" };
  return bot === "remote-weather" ? [observation] : [observation, { id: "maps", en: "Explore observation maps", zh: "浏览观测地图" }];
}

export function FarmerTasks(props: FarmerTasksProps) {
  const { language, botId, userId, conversationId } = props;
  const scope = `agrisata-tasks:${userId}:${botId}:${conversationId ?? "new"}`;
  const [selected, setSelected] = useDraft<TaskId | null>(`${scope}:task`, null);
  const options = choices(botId);
  const active = options.find((item) => item.id === selected);
  const taskProps = { ...props, scope };
  return <section aria-label={tr(language, "Farm tasks", "农场任务")} className="mb-3 rounded-xl border border-border bg-card p-3 text-sm sm:p-4">
    {active ? <>
      <header className="mb-3 flex items-center gap-3"><button type="button" onClick={() => setSelected(null)} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><ArrowLeft size={16} aria-hidden="true" />{tr(language, "All tasks", "所有任务")}</button><h3 className="min-w-0 font-semibold">{tr(language, active.en, active.zh)}</h3></header>
      <div data-task-scroll className={props.compact ? "pr-1" : "max-h-[min(48dvh,30rem)] overflow-y-auto overscroll-contain pr-1"}>
        {selected === "fields" && <FieldList {...taskProps} />}
        {selected === "add" && <FieldForm {...taskProps} />}
        {selected === "field-plans" && <FieldPlans {...taskProps} />}
        {selected === "observations" && <Observations {...taskProps} />}
        {selected === "maps" && <ObservationMaps {...taskProps} />}
        {selected === "plans" && <RotationPlans {...taskProps} />}
        {selected === "runs" && <RotationRuns {...taskProps} />}
        {selected === "compare" && <ComparePlans {...taskProps} />}
        {selected === "local" && <LocalQuestion {...taskProps} />}
      </div>
    </> : <><h3 className="mb-3 font-medium">{tr(language, "What would you like to do?", "你想做什么？")}</h3><div className="flex flex-wrap gap-2">
      {options.map((task) => <button key={task.id} type="button" onClick={() => setSelected(task.id)} className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">{tr(language, task.en, task.zh)}</button>)}
      {botId === "rotation-guide" && <Link href="/field-shift/rotation" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 hover:border-primary hover:bg-muted">{tr(language, "Plan the next seasons", "规划接下来的种植季")}<ArrowUpRight size={14} aria-hidden="true" /></Link>}
    </div></>}
  </section>;
}

function LocalQuestion({ language, scope, onAsk }: TaskProps) {
  const [draft, setDraft] = useDraft(`${scope}:local`, { region: "", crop: "", question: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function ask() {
    setBusy(true); setError(false);
    try {
      await onAsk(tr(language,
        `For ${draft.crop.trim()} near ${draft.region.trim()}: ${draft.question.trim()} Please use available sources, include their dates and region, and distinguish examples from current local facts.`,
        `关于${draft.region.trim()}附近的${draft.crop.trim()}：${draft.question.trim()}。请使用可核实来源，注明日期和适用地区，并区分示例与当前本地事实。`));
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void ask(); }}><fieldset className="space-y-3" disabled={busy}>
    <div className="grid gap-3 sm:grid-cols-2"><Input label={tr(language, "Region or nearest town", "地区或最近城镇")} required value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} /><Input label={tr(language, "Crop", "作物")} required value={draft.crop} onChange={(e) => setDraft({ ...draft, crop: e.target.value })} /></div>
    <label className="block">{tr(language, "Your question", "你的问题")}<textarea className={control} required rows={3} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} placeholder={tr(language, "For example: What should I check before choosing a planting date?", "例如：确定播种日期前应该查看什么？")} /></label>
    <p className="text-xs text-muted-foreground">{tr(language, "I’ll look for relevant sources. Current prices and local rules need dated, local evidence; example data will be identified in the answer.", "我会查找相关来源。当前价格和本地规定需要有日期的本地依据，示例数据会明确标注。")}</p>
    <button className={primary}>{tr(language, busy ? "Looking for sources…" : "Ask local knowledge", busy ? "正在查找依据…" : "询问本地知识")}</button>
  </fieldset>{error && <p role="alert">{tr(language, "The question could not be sent. Your input is kept; try again.", "问题未能发送，输入已保留，请重试。")}</p>}</form>;
}
