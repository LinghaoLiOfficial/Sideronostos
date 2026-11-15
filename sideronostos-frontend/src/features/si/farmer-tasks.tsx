"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { FieldList } from "./tasks/field-tasks";
import { Observations } from "./tasks/observation-tasks";
import { RotationPlans, RotationRuns } from "./tasks/rotation-tasks";
import { tr, useDraft } from "./tasks/shared";

export type FarmerTasksProps = {
  conversationId: string | null;
  ensureConversation: () => Promise<string | null>;
  userId: string;
  botId: string;
  language: "en" | "zh";
  onAsk: (text: string) => void | Promise<void>;
  onBack?: () => void;
  compact?: boolean;
};

type TaskId = "fields" | "observations" | "plans" | "runs";
type Choice = { id: TaskId; en: string; zh: string } | { href: string; en: string; zh: string };

function choices(bot: string): Choice[] {
  if (bot === "field-guide") return [{ id: "fields", en: "My fields", zh: "我的地块" }, { href: "/si/fields?field=new&step=field", en: "Add a field", zh: "添加地块" }, { href: "/si/fields?step=saved", en: "My planting plans", zh: "我的种植计划" }];
  if (bot === "rotation-guide") return [{ id: "plans", en: "My saved plans", zh: "已保存计划" }, { id: "runs", en: "My calculations", zh: "我的计算" }];
  if (bot === "local-knowledge-guide") return [{ href: "/si/local-knowledge", en: "Ask about my area", zh: "询问本地农业" }];
  const observation: Choice = { id: "observations", en: bot === "remote-soil" ? "Check soil moisture" : bot === "remote-weather" ? "Check past weather" : "Check water conditions", zh: bot === "remote-soil" ? "查看土壤湿度" : bot === "remote-weather" ? "查看历史天气" : "查看水分状况" };
  return [observation];
}

export function FarmerTasks(props: FarmerTasksProps) {
  const { language, botId, userId, conversationId } = props;
  const scope = `agrisata-tasks:${userId}:${botId}:${conversationId ?? "new"}`;
  const [selected, setSelected] = useDraft<TaskId | null>(`${scope}:task`, null);
  const options = choices(botId);
  const active = options.find((item) => "id" in item && item.id === selected);
  const taskProps = { ...props, scope };
  return <section aria-label={tr(language, "Actions", "操作")} className="mb-3 rounded-xl border border-border bg-card p-3 text-sm sm:p-4">
    {active ? <>
      <header className="mb-3 flex items-center gap-3"><button type="button" onClick={() => setSelected(null)} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><ArrowLeft size={16} aria-hidden="true" />{tr(language, "Actions", "操作")}</button><h3 className="min-w-0 font-semibold">{tr(language, active.en, active.zh)}</h3></header>
      <div data-task-scroll className={props.compact ? "pr-1" : "max-h-[min(48dvh,30rem)] overflow-y-auto overscroll-contain pr-1"}>
        {selected === "fields" && <FieldList {...taskProps} />}
        {selected === "observations" && <Observations {...taskProps} />}
        {selected === "plans" && <RotationPlans {...taskProps} />}
        {selected === "runs" && <RotationRuns {...taskProps} />}
      </div>
    </> : <><header className="mb-3 flex items-center gap-3">{props.onBack && <button type="button" onClick={props.onBack} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><ArrowLeft size={16} aria-hidden="true" />{tr(language, "Back", "返回")}</button>}<h3 className="font-semibold">{tr(language, "Actions", "操作")}</h3></header><div className="flex flex-wrap gap-2">
      {options.map((task) => "href" in task ? <Link key={task.href} href={task.href} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">{tr(language, task.en, task.zh)}<ArrowUpRight size={14} aria-hidden="true" /></Link> : <button key={task.id} type="button" onClick={() => setSelected(task.id)} className="min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">{tr(language, task.en, task.zh)}</button>)}
      {botId === "rotation-guide" && <Link href="/si/fields?step=planning" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 hover:border-primary hover:bg-muted">{tr(language, "Plan the next seasons", "规划接下来的种植季")}<ArrowUpRight size={14} aria-hidden="true" /></Link>}
    </div></>}
  </section>;
}
