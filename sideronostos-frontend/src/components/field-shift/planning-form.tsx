"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Field, PlanningInputs, Profile } from "@/lib/api/field-shift-types";
import { initialPlanningDraft, parsePlanningDraft } from "./model";
import { useDraft } from "./use-draft";
import { Evidence } from "./evidence";
import styles from "./field-shift.module.css";

const priorities = [{ key: "water", name: "减少补灌缺口", detail: "优先考虑需要较少额外供水的安排" }, { key: "cover", name: "增加生长覆盖", detail: "减少没有主作物生长覆盖的时间" }, { key: "diversity", name: "增加作物科多样性", detail: "考虑不同植物科的轮换" }, { key: "cost", name: "控制投入成本", detail: "比较种子、农资等投入估计" }] as const;

export function PlanningForm({ field, profile, userId, initial, onGenerate, busy, error }: { field: Field; profile: Profile; userId: string; initial?: PlanningInputs; onGenerate: (inputs: PlanningInputs) => Promise<void> | void; busy: boolean; error: string | null }) {
  const draft = useDraft(`field-shift:${userId}:planning:${field.id}:v1`, initialPlanningDraft(profile.crops.map((c) => c.id), initial));
  const [validation, setValidation] = useState<string | null>(null);
  const set = (change: Partial<typeof draft.value>) => draft.update({ ...draft.value, ...change });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const submitted = draft.value;
    const result = parsePlanningDraft(draft.value, profile.crops.map((c) => c.id), field.history, profile.is_demo);
    if (!result.value) { setValidation(result.error ?? "请检查设置。"); return; }
    setValidation(null);
    try { await onGenerate({ ...result.value, max_irrigation_mm: field.irrigation_available ? result.value.max_irrigation_mm : 0 }); draft.clearIfUnchanged(submitted); } catch { /* Parent retains and describes the API error. */ }
  }
  return <form className={styles.stack} onSubmit={submit} noValidate><fieldset disabled={busy} className={styles.formFields}>
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>03 / YOUR PRIORITIES</span><h2>什么样的安排适合你？</h2><p>先设定你原本会怎么种，再让系统寻找满足实际条件的轮作。</p></div>
    {draft.restored && <p className={styles.notice}>已恢复尚未提交的规划设置。</p>}
    {!draft.storageAvailable && <p className={styles.warning}>浏览器无法保留草稿，请在离开前完成计算。</p>}
    <div className={styles.subsection}><h3>如果不调整，你准备怎么种？</h3><p className={styles.help}>这会成为比较用的基准。当前配置每年一季主作物，共比较三年。</p><label className={`${styles.field} ${styles.narrowField}`}>规划起始年<Input aria-label="规划起始年" type="number" min="2000" max="2100" value={draft.value.start_year} onChange={(e) => set({ start_year: e.target.value })} /></label><div className={styles.baselineInputs}>{draft.value.baseline_crop_ids.map((id, index) => <label className={styles.field} key={index}><span>{Number(draft.value.start_year) + index || `第 ${index + 1}`} 年</span><select aria-label={`基准第 ${index + 1} 年作物`} className={styles.select} value={id} onChange={(e) => set({ baseline_crop_ids: draft.value.baseline_crop_ids.map((value, i) => i === index ? e.target.value : value) as [string, string, string] })}>{profile.crops.map((crop) => <option key={crop.id} value={crop.id}>{crop.name}</option>)}</select></label>)}</div></div>
    <div className={styles.subsection}><h3>哪些作物是你愿意考虑的？</h3><p className={styles.help}>排除没有设备、经验或销售渠道的作物。勾选表示愿意考虑，适宜性仍需当地核对。</p><div className={styles.cropChoices}>{profile.crops.map((crop) => <label key={crop.id} className={`${styles.checkbox} ${draft.value.allowed_crop_ids.includes(crop.id) ? styles.selectedCrop : ""}`}><input type="checkbox" checked={draft.value.allowed_crop_ids.includes(crop.id)} onChange={(e) => set({ allowed_crop_ids: e.target.checked ? [...draft.value.allowed_crop_ids, crop.id] : draft.value.allowed_crop_ids.filter((id) => id !== crop.id) })} /><span>{crop.name}<small>{crop.family} · 约 {crop.duration_days} 天</small></span></label>)}</div></div>
    <div className={styles.subsection}><h3>每一季的资源上限</h3><p className={styles.help}>以下是每公顷、每一年的上限。预填值仅帮助演示，请按自己的条件调整。</p><div className={styles.resourceGrid}>
      <label className={styles.field}>每季补灌上限（mm）<Input aria-label="每季补灌上限（mm）" type="number" min="0" step="any" value={field.irrigation_available ? draft.value.max_irrigation_mm : "0"} disabled={!field.irrigation_available} onChange={(e) => set({ max_irrigation_mm: e.target.value })} /><small>{field.irrigation_available ? "0 表示不提供补灌；1 mm = 10 m³/公顷。" : "地块未配置灌溉能力，实际按 0 mm 筛选。"}</small></label>
      <label className={styles.field}>每年投入预算（USD/公顷）<Input aria-label="每年投入预算（USD/公顷）" type="number" min="0" step="any" value={draft.value.max_cost_usd_ha} onChange={(e) => set({ max_cost_usd_ha: e.target.value })} /><small>投入估计不等于收入或利润。</small></label>
      <label className={styles.field}>每年劳动上限（天/公顷）<Input aria-label="每年劳动上限（天/公顷）" type="number" min="0" step="any" value={draft.value.max_labor_days_ha} onChange={(e) => set({ max_labor_days_ha: e.target.value })} /></label>
    </div></div>
    <div className={styles.subsection}><h3>在可行的方案中，你更看重什么？</h3><p className={styles.help}>0 = 不参与排序，5 = 很重要。提高优先级不会放宽上面的资源限制。</p><div className={styles.priorityGrid}>{priorities.map((priority) => <label className={styles.priority} key={priority.key}><span><strong>{priority.name}</strong><output>{draft.value.weights[priority.key]}</output></span><input aria-label={priority.name} type="range" min="0" max="5" step="1" value={draft.value.weights[priority.key]} onChange={(e) => set({ weights: { ...draft.value.weights, [priority.key]: Number(e.target.value) } })} /><small>{priority.detail}</small></label>)}</div></div>
    <div className={styles.assumptions}><span className={styles.eyebrow}>{profile.is_demo ? "DEMONSTRATION PROFILE" : "REGIONAL PROFILE"}</span><h3>{profile.name}</h3><p>{profile.description}</p><ul>{profile.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul><details className={styles.details}><summary>查看作物参数和轮作规则</summary><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>作物</th><th>播种日</th><th>生长期</th><th>作物系数</th><th>估计成本 USD/ha</th><th>劳动 天/ha</th></tr></thead><tbody>{profile.crops.map((c) => <tr key={c.id}><th>{c.name}</th><td>{c.sow_month}/{c.sow_day}</td><td>{c.duration_days} 天</td><td>{c.kc}</td><td>{c.estimated_cost_usd_ha}</td><td>{c.estimated_labor_days_ha}</td></tr>)}</tbody></table></div><ul>{profile.rules.map((rule) => <li key={rule.id}><strong>{rule.name}：</strong>{rule.description}</li>)}</ul></details><Evidence items={profile.sources} />{profile.is_demo && <label className={styles.checkbox}><input type="checkbox" checked={draft.value.accept_demo_assumptions} onChange={(e) => set({ accept_demo_assumptions: e.target.checked })} /><span>我理解这些是示范假设，实际种植前需要核对当地条件。</span></label>}</div>
    {(validation || error) && <Alert variant="destructive"><AlertDescription>{validation ?? error}</AlertDescription></Alert>}
    <div className={styles.formFooter}><span>先检查可行性，再按你的优先级排序</span><Button type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />}{busy ? "正在比较作物安排…" : "生成可行轮作"}</Button></div>
  </fieldset></form>;
}
