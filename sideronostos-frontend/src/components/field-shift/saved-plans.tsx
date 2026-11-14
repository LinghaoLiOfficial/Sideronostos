"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowUpRight, Download, FileCheck2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SavedPlan } from "@/lib/api/field-shift-types";
import { OptionCard } from "./comparison";
import { ClimateProvenance, Evidence } from "./evidence";
import { formatDate, formatNumber } from "./model";
import styles from "./field-shift.module.css";

export function serializePlan(plan: SavedPlan) { return JSON.stringify(plan, null, 2); }
function downloadPlan(plan: SavedPlan) {
  const url = URL.createObjectURL(new Blob([serializePlan(plan)], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `Field-Shift-${plan.title.replace(/[^\p{L}\p{N}_-]/gu, "-")}.json`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SavedPlans({ plans, onOpen, onStart }: { plans: SavedPlan[]; onOpen: (plan: SavedPlan) => void; onStart: () => void }) {
  const { t, locale } = useI18n();

  return <section className={styles.stack}><div className={styles.sectionHeading}><span className={styles.eyebrow}>{t("YOUR SAVED PLANS")}</span><h2>{t("留下计划，也留下依据")}</h2><p>{t("每份计划保存当时的地块、气象、规则、限制和计算结果，可随时重开核对。")}</p></div>{plans.length === 0 ? <div className={styles.emptyState}><FileCheck2 size={34} /><h3>{t("这块地还没有保存的计划")}</h3><p>{t("完成一次方案比较，选择合适的安排后即可保存在这里。")}</p><Button onClick={onStart}>{t("开始规划")}</Button></div> : <div className={styles.planList}>{plans.map((plan) => <article key={plan.id} className={styles.planRow}><div><h3>{plan.title}</h3><p>{plan.field_name} · {plan.analysis.inputs.start_year}–{plan.analysis.inputs.start_year + 2} {t(" · 保存于 ")}{t(formatDate(plan.created_at, locale))}</p>{plan.analysis.profile.is_demo && <p>{t("含示范假设")}</p>}</div><Button variant="outline" onClick={() => onOpen(plan)}>{t("查看计划")}<ArrowUpRight size={16} /></Button></article>)}</div>}</section>;
}

export function SavedPlanDetail({ plan, onBack }: { plan: SavedPlan; onBack: () => void }) {
  const { t, locale } = useI18n();

  const { field_snapshot: field, analysis } = plan;
  const soilLabels = { unknown: t("尚不清楚"), sand: t("砂土"), loam: t("壤土"), clay: t("黏土") };
  const printRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    let temporarilyOpened: HTMLDetailsElement[] = [];
    const preparePrint = () => {
      if (temporarilyOpened.length > 0) return;
      temporarilyOpened = [...(printRoot.current?.querySelectorAll<HTMLDetailsElement>("details:not([open])") ?? [])];
      temporarilyOpened.forEach((item) => { item.open = true; });
    };
    const restore = () => { temporarilyOpened.forEach((item) => { item.open = false; }); temporarilyOpened = []; };
    window.addEventListener("beforeprint", preparePrint);
    window.addEventListener("afterprint", restore);
    return () => { window.removeEventListener("beforeprint", preparePrint); window.removeEventListener("afterprint", restore); restore(); };
  }, [plan.id]);
  return <section ref={printRoot} className={styles.stack}>
    <div className={`${styles.rowBetween} ${styles.noPrint}`}><Button variant="ghost" onClick={onBack}><ArrowLeft size={16} />{t("返回已存计划")}</Button><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => downloadPlan(plan)}><Download size={16} />{t("导出完整 JSON")}</Button><Button variant="outline" onClick={() => window.print()}><Printer size={16} />{t("打印计划")}</Button></div></div>
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>{t("AGRISATA / FIELD SHIFT")}</span><h2>{plan.title}</h2><p>{plan.field_name} · {analysis.inputs.start_year}–{analysis.inputs.start_year + 2} {t(" · 保存于 ")}{t(formatDate(plan.created_at, locale))}</p></div>
    <p className={styles.notice}>{t("这是一份固定快照。之后地块或数据发生变化，都不会改写这份计划的原始依据。")}{analysis.profile.is_demo ? t("当前结果包含示范假设。") : ""}</p>
    <ClimateProvenance environment={analysis.environment} />
    {plan.notes && <div className={styles.limitations}><h3>{t("我的备注")}</h3><p className="whitespace-pre-wrap">{plan.notes}</p></div>}
    <div className={styles.snapshotGrid}><OptionCard option={plan.option} options={[analysis.baseline, ...analysis.alternatives]} /><div className={styles.stack}><div><h3>{t("当时的地块和规划条件")}</h3><dl className={styles.facts}><div><dt>{t("面积")}</dt><dd>{formatNumber(field.area_ha, 2)} {t(" 公顷")}</dd></div><div><dt>{t("参考位置")}</dt><dd>{field.latitude}, {field.longitude}</dd></div><div><dt>{t("土壤质地")}</dt><dd>{t(soilLabels[field.soil_texture])}</dd></div><div><dt>{t("灌溉条件")}</dt><dd>{field.irrigation_available ? t("可灌溉") : t("不提供补灌")}</dd></div><div><dt>{t("每季补灌上限")}</dt><dd>{field.irrigation_available ? formatNumber(analysis.inputs.max_irrigation_mm) : "0"} {t(" mm")}</dd></div><div><dt>{t("每年投入预算")}</dt><dd>{formatNumber(analysis.inputs.max_cost_usd_ha)} {t(" USD/ha")}</dd></div><div><dt>{t("每年劳动上限")}</dt><dd>{formatNumber(analysis.inputs.max_labor_days_ha)} {t(" 天/ha")}</dd></div><div><dt>{t("气候情景")}</dt><dd>{t("降雨 ")}{analysis.inputs.scenario.rainfall_change_pct > 0 ? "+" : ""}{analysis.inputs.scenario.rainfall_change_pct}%<br />{t("温度 ")}{analysis.inputs.scenario.temperature_change_c > 0 ? "+" : ""}{analysis.inputs.scenario.temperature_change_c}{t("°C")}</dd></div><div><dt>{t("参考资料")}</dt><dd>{analysis.environment.source_name}<br />{analysis.environment.reference_year} {t(" 年 · ")}{t(analysis.environment.status === "demo" ? t("合成演示") : t("历史资料"))}</dd></div><div><dt>{t("作物配置")}</dt><dd>{t(analysis.profile.name)}<br />{t("版本 ")}{analysis.profile.version}</dd></div></dl></div>
      <details className={styles.details}><summary>{t("种植历史与优先级")}</summary><p>{t("历史：")}{field.history.map((h) => `${h.year} ${analysis.profile_snapshot.crops.find((c) => c.id === h.crop_id)?.name ?? h.crop_id}`).join("、") || t("未提供")}</p><p>{t("优先级（0–5）：节水 ")}{analysis.inputs.weights.water}{t("，覆盖 ")}{analysis.inputs.weights.cover}{t("，多样性 ")}{analysis.inputs.weights.diversity}{t("，成本 ")}{analysis.inputs.weights.cost}。</p><p>{t("允许作物：")}{analysis.inputs.allowed_crop_ids.map((id) => analysis.profile_snapshot.crops.find((c) => c.id === id)?.name ?? id).join("、")}</p></details>
      <Evidence items={analysis.environment.evidence} title={t("环境资料依据")} /><Evidence items={analysis.profile_snapshot.sources} title={t("当时使用的农艺规则来源")} />
      <div className={styles.limitations}><h3>{t("保留的限制与假设")}</h3><ul>{[...new Set([...analysis.limitations, ...analysis.profile_snapshot.assumptions, ...analysis.environment.limitations])].map((text, index) => <li key={index}>{t(text)}</li>)}</ul><p>{t("完整逐月数据、作物参数和分析信息包含在 JSON 导出中。")}</p></div>
    </div></div>
  </section>;
}
