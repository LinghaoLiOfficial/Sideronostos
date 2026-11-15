"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useState } from "react";
import { Check, RefreshCw, Save, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Analysis, PlanningInputs, RotationOption } from "@/lib/api/field-shift-types";
import { ClimateProvenance, Evidence } from "./evidence";
import { formatNumber } from "./model";
import styles from "./field-shift.module.css";

const metrics = [{ key: "irrigation_gap_mm", title: "估计补灌缺口", unit: "mm", description: "按参考气候估计，越低需要的额外水越少" }, { key: "water_demand_mm", title: "估计作物需水", unit: "mm", description: "作物生长期间的蒸散需求估计" }, { key: "cover_days", title: "主作物生长覆盖", unit: "天", description: "不等于实测土壤保护效果" }, { key: "diversity", title: "作物科多样性", unit: "科", description: "三年中不同植物科的数量" }, { key: "cost_usd_ha", title: "估计投入", unit: "USD/ha", description: "成本假设，不包含收入与利润" }, { key: "labor_days_ha", title: "估计劳动", unit: "天/ha", description: "按示范参数计算的劳动需求" }] as const;

export function PlantingTimeline({ option }: { option: RotationOption }) {
  const { t } = useI18n();

  return <div role="group" className={styles.timeline} aria-label={t("{0}种植时间线", { "0": option.label })}>{option.seasons.map((season) => {
    const start = new Date(`${season.year}-01-01T00:00:00Z`).getTime(); const end = new Date(`${season.year + 1}-01-01T00:00:00Z`).getTime();
    const left = Math.max(0, (new Date(season.sow_date).getTime() - start) / (end - start) * 100); const width = Math.min(100 - left, (new Date(season.harvest_date).getTime() - new Date(season.sow_date).getTime()) / (end - start) * 100);
    return <div className={styles.season} key={season.year}><div><span>{season.year}</span><strong>{season.crop_name}</strong></div><div className={styles.seasonTrack}><span style={{ left: `${left}%`, width: `${Math.max(1, width)}%` }} /></div><small>{season.sow_date.slice(5).replace("-", "/")} {t(" 播种 → ")}{season.harvest_date.slice(5).replace("-", "/")} {t(" 收获")}</small></div>;
  })}</div>;
}

export function OptionCard({ option, options, disabled = false, onSave }: { option: RotationOption; options: RotationOption[]; disabled?: boolean; onSave?: (option: RotationOption, trigger: HTMLButtonElement) => void }) {
  const { t } = useI18n();

  const conflictPreview = [...new Map(option.violations.map((item) => [item.rule_id, item])).values()].slice(0, 2);
  return <article aria-label={t(option.label)} className={`${styles.optionCard} ${option.is_baseline ? styles.baselineCard : ""}`}>
    <div className={styles.optionHeader}><span className={styles.eyebrow}>{option.is_baseline ? "YOUR BASELINE" : "ROTATION OPTION"}</span><h3>{t(option.label)}</h3><span className={option.feasible ? styles.feasible : styles.infeasible}>{option.feasible ? <Check size={14} /> : <TriangleAlert size={14} />}{option.feasible ? t("符合当前约束") : t("存在约束冲突")}</span></div>
    <PlantingTimeline option={option} />
    <dl className={styles.metricList}>{metrics.map((metric) => {
      const value = option.metrics[metric.key]; const max = Math.max(1, ...options.map((item) => item.metrics[metric.key]));
      return <div key={metric.key} className={styles.metricHeading}><dt title={t(metric.description)}>{t(metric.title)}</dt><dd><span className={styles.metricValue}>{formatNumber(value, 1)} <small>{metric.unit}</small></span><div className={styles.metricTrack} aria-hidden="true"><i style={{ width: `${Math.max(0, value) / max * 100}%` }} /></div></dd></div>;
    })}</dl>
    {option.violations.length > 0 && <div className={styles.violationList}><strong>{option.violations.length} {t(" 项约束冲突，需要先解决")}</strong><ul aria-label={t("冲突摘要")}>{conflictPreview.map((v) => <li key={v.rule_id}>{t(v.message)}</li>)}</ul>{option.violations.length > conflictPreview.length && <details className={styles.details}><summary>{t("查看全部 ")}{option.violations.length} {t(" 项冲突")}</summary><ul>{option.violations.map((v, i) => <li key={`${v.rule_id}-${i}`}>{t(v.message)}</li>)}</ul></details>}</div>}
    {option.reasons.length > 0 && <p className={styles.reasonSummary}>{t(option.reasons[0])}</p>}
    {option.reasons.length > 1 && <details className={styles.details}><summary>{t("指标解读与排序依据")}</summary><ul>{option.reasons.slice(1).map((reason, index) => <li key={index}>{t(reason)}</li>)}</ul></details>}
    <Evidence items={option.evidence} title={t("为什么得到这个结果")} />
    {onSave && option.feasible && <Button variant={option.is_baseline ? "outline" : "default"} className={styles.saveOption} disabled={disabled} onClick={(event) => onSave(option, event.currentTarget)} aria-label={t("保存{0}", { "0": option.label })}><Save size={16} />{t("保存这个方案")}</Button>}
  </article>;
}

export function Comparison({ analysis, busy, error, onRecalculate, onSave, onEdit, stale = false }: { analysis: Analysis; busy: boolean; error: string | null; onRecalculate: (inputs: PlanningInputs) => void; onSave: (option: RotationOption, trigger: HTMLButtonElement) => void; onEdit: () => void; stale?: boolean }) {
  const { t } = useI18n();

  const [rain, setRain] = useState(analysis.inputs.scenario.rainfall_change_pct);
  const [temperature, setTemperature] = useState(analysis.inputs.scenario.temperature_change_c);
  const dirty = rain !== analysis.inputs.scenario.rainfall_change_pct || temperature !== analysis.inputs.scenario.temperature_change_c;
  const options = [analysis.baseline, ...analysis.alternatives];
  return <section className={styles.stack}>
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>{t("04 / COMPARE & DECIDE")}</span><h2>{t("看清取舍，再选择")}</h2><p>{analysis.inputs.start_year}–{analysis.inputs.start_year + 2}{t("，同一块地、同一周期。资源限制按每季检查，以下指标按三年汇总。")}</p></div>
    <div className={styles.resultSummary}><strong>{analysis.feasible_count > 0 ? t("找到 {0} 个满足约束的轮作序列", { "0": analysis.feasible_count }) : t("当前条件下没有可行替代方案")}</strong><span>{analysis.alternatives.length > 0 ? t("展示 {0} 个可行替代方案", { "0": analysis.alternatives.length }) : t("可调整允许作物或资源限制后重试")}</span><Button variant="outline" size="sm" onClick={onEdit}><SlidersHorizontal size={15} />{t("调整目标与限制")}</Button></div>
    <ClimateProvenance environment={analysis.environment} />
    {analysis.profile.is_demo && <p className={styles.notice}>{t("示范计算：投入、日历和农艺规则尚未经过当地验证。结果不代表实测节水、增产或利润改善。")}</p>}
    {stale && <div className={styles.warning}>{t("地块资料已更新。此处保留原分析供参考，请重新生成后再保存。")}</div>}
    <div className={styles.scenario}><div><span className={styles.eyebrow}>{t("WHAT IF?")}</span><h3>{t("如果更少雨，或者更热呢？")}</h3><p>{t(analysis.environment.status === "demo" ? t("在合成教学气候上调整假设") : t("在 {0} 年历史参考上调整假设", { "0": analysis.environment.reference_year }))}{t("；这是情景分析，不是预报。")}</p></div><div className={styles.scenarioControls}><label className={styles.priority}><span>{t("降雨变化")}<output>{rain > 0 ? "+" : ""}{rain}%</output></span><input aria-label={t("降雨变化")} disabled={busy} type="range" min="-50" max="50" step="5" value={rain} onChange={(e) => setRain(Number(e.target.value))} /></label><label className={styles.priority}><span>{t("温度变化")}<output>{temperature > 0 ? "+" : ""}{temperature}{t("°C")}</output></span><input aria-label={t("温度变化")} disabled={busy} type="range" min="-3" max="5" step="0.5" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /></label><Button variant="outline" disabled={busy || (!dirty && !stale)} onClick={() => onRecalculate({ ...analysis.inputs, scenario: { rainfall_change_pct: rain, temperature_change_c: temperature } })}><RefreshCw className={busy ? "animate-spin" : ""} size={16} />{busy ? t("正在重新计算…") : t("按此情景重新计算")}</Button></div>{dirty && <p className={styles.warning} role="status">{t("下方仍是上一次计算的结果。请重新计算后再保存。")}</p>}</div>
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    <div className={styles.comparisonGrid} style={{ "--option-count": Math.min(options.length, 3) } as React.CSSProperties}>{options.map((option) => <OptionCard key={option.id} option={option} options={options} disabled={busy || dirty || stale} onSave={onSave} />)}</div>
    {analysis.rejection_summary.length > 0 && <details className={styles.details}><summary>{t("为什么有些轮作没有入选？")}<span>{analysis.rejected_count} {t(" 个序列被排除")}</span></summary><ul>{analysis.rejection_summary.map((item) => <li key={item.rule_id}>{t(item.message)}{t("（涉及 ")}{item.count} {t(" 个序列）")}</li>)}</ul><p className={styles.help}>{t("同一个序列可能同时触发多条规则。先排除不可行安排，再根据你的优先级排序。")}</p></details>}
    <div className={styles.limitations}><h3>{t("决策前还要确认")}</h3><ul>{analysis.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul><p>{t("补灌缺口基于简化水量估计；生长覆盖天数不等于土壤健康评分。请结合土样、当地农技建议和销售条件。")}</p></div>
    <Evidence items={analysis.environment.evidence} title={t("本次分析使用的环境资料")} />
  </section>;
}
