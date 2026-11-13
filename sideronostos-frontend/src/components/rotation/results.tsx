"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, MessageCircle, Printer, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Field } from "@/lib/api/field-shift-types";
import type {
  ChangedCondition,
  ComparisonV2,
  Metrics,
  OptionV2,
  RunV2,
  SavedV2,
} from "@/lib/api/rotation-types";
import * as api from "@/lib/api/rotation";
import { errorMessage } from "../field-shift/model";
import {
  changeLabels,
  downloadJson,
  formatValue as n,
  planningYears,
  runStatus,
} from "./planning-model";
import styles from "./workspace.module.css";

const metricLabels: Record<keyof Metrics, string> = {
  water_m3: "用水估计 · m³",
  cost_usd: "投入估计 · USD",
  labor_days: "劳力估计 · 人日",
  cover_ha_days: "土地覆盖 · ha·天",
  diversity_ha_families: "科属多样性 · ha·科",
};
function violationText(code: string, fields: Field[]) {
  const [kind, first, second, third] = code.split(":");
  const resources: Record<string, string> = {
    water_m3: "补水量",
    cost_usd: "投入",
    labor_days: "劳力",
  };
  if (kind === "farm_resource")
    return `${first} 年的农场${resources[second] ?? "资源用量"}超过年度上限。`;
  if (kind === "field_resource")
    return `${fields.find((f) => f.id === first)?.name ?? "该地块"}在 ${second} 年的${resources[third] ?? "资源用量"}超过地块上限。`;
  const labels: Record<string, string> = {
    required_crop: "该地块要求种植作物，但此种法没有安排。",
    horizon: "种植或换茬占用超出规划日期。",
    irrigation_unavailable: "该地块没有灌溉条件，此种法却需要补水。",
    sequence: "种植或换茬占用时间发生冲突。",
    family_gap: "同科作物再次种植的间隔不足。",
    history: "此种法与已记录的前茬条件冲突。",
    historical_adjacency: "与前茬之间的间隔或换茬占用不符合要求。",
    unknown_crop: "作物不在当前参数包中。",
    growth_duration: "生长期长度未通过复核。",
    sowing_window: "播种日不在允许窗口内。",
    outside_sowing_window: "播种日不在允许窗口内。",
    crop_identity_or_turnaround: "作物身份或换茬天数与参数包不一致。",
    cost_or_labor: "投入或劳力估算未通过复核。",
    weather_missing: "生长期缺少必要天气资料。",
    missing_weather: "生长期缺少必要天气资料。",
    weather_invalid: "天气资料未通过质量检查。",
    water_coefficient: "逐日用水系数未通过复核。",
    first_maturity_day: "成熟日期未通过逐日复核。",
  };
  return labels[kind] ?? "此项未通过核验，请查看导出的完整依据。";
}
const inputLabels: Record<string, string> = {
  fields: "地块与历史",
  start: "规划日期",
  end: "规划日期",
  profile_id: "参数包",
  allowed_crop_ids: "候选作物",
  sow_windows: "播种窗口",
  farm_limits: "农场年度资源",
  field_limits: "地块年度资源",
  weights: "偏好",
  scenario: "天气情景",
  baseline: "基准种法",
  accept_benchmark_assumptions: "参数假设确认",
};
export function ComparisonSummary({
  comparison,
  current,
  other,
}: {
  comparison: ComparisonV2;
  current: Metrics;
  other: Metrics;
}) {
  return (
    <>
      <p>
        差值为对照结果减当前结果，与创建时间先后无关。正值表示对照较高，负值表示对照较低。
      </p>
      <p>
        变化的输入：
        {[
          ...new Set(
            Object.keys(comparison.input_changes).map(
              (k) => inputLabels[k] ?? "其他条件",
            ),
          ),
        ].join("、") || "输入相同"}
        。
        {!comparison.score_comparable &&
          "偏好已改变，两个目标分数不能直接比较。"}
      </p>
      <dl className={styles.metrics}>
        {(Object.keys(metricLabels) as (keyof Metrics)[]).map((k) => (
          <div key={k}>
            <dt>{metricLabels[k]}差值</dt>
            <dd>
              {comparison.delta[k] > 0 ? "+" : ""}
              {n(comparison.delta[k])}
              <small className={styles.comparisonValues}>
                当前 {n(current[k])} → 对照 {n(other[k])}
              </small>
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.help}>
        两次结果各自使用其情景假设；降低估计投入不等于增加利润。
      </p>
    </>
  );
}
const crops: Record<string, string> = {
  maize: "玉米",
  pea: "豌豆",
  oat: "燕麦",
};
export const allOptions = (run: RunV2) => [
  ...(run.result?.options ?? []),
  ...(run.result?.baseline ? [run.result.baseline] : []),
];
const optionName = (option: OptionV2, index?: number) =>
  option.id === "baseline"
    ? "原本种法 / 基准"
    : index !== undefined
      ? `轮作方案 ${index + 1}`
      : option.id.replace("option-", "轮作方案 ");
const day = (s: string) => Date.parse(s + "T00:00:00Z") / 86400000;
function Timeline({
  option,
  fields,
  start,
  end,
}: {
  option: OptionV2;
  fields: Field[];
  start: string;
  end: string;
}) {
  const total = day(end) - day(start) + 1;
  return (
    <section className={styles.timeline} aria-label="按地块查看播种与收获">
      <div className={styles.timelineLegend}>
        <span>
          <i className={styles.growingKey} />
          生长期
        </span>
        <span>
          <i className={styles.turnaroundKey} />
          换茬占用
        </span>
        <span>
          <i className={styles.idleKey} />
          空闲 / 休耕
        </span>
      </div>
      <div className={styles.timelineDates}>
        <span>{start}</span>
        <span>{end}</span>
      </div>
      {fields.map((field) => {
        const seasons = option.seasons
          .filter((s) => s.field_id === field.id)
          .sort((a, b) => a.sow_date.localeCompare(b.sow_date));
        return (
          <div className={styles.timelineField} key={field.id}>
            <h3>
              {field.name} <small>{field.area_ha} ha</small>
            </h3>
            <div className={styles.timelineTrack} aria-hidden="true">
              {seasons.map((s) => (
                <div
                  key={s.id}
                  className={styles.seasonSpan}
                  style={{
                    left: `${((day(s.sow_date) - day(start)) / total) * 100}%`,
                    width: `${((day(s.occupied_until) - day(s.sow_date) + 1) / total) * 100}%`,
                  }}
                  title={`${crops[s.crop_id] ?? s.crop_id} ${s.sow_date} — ${s.occupied_until}`}
                >
                  <span
                    className={styles.growing}
                    style={{
                      width: `${(s.growing_days / (s.growing_days + s.turnaround_days)) * 100}%`,
                    }}
                  />
                  <span className={styles.turnaround} />
                </div>
              ))}
            </div>
            {seasons.length ? (
              <ul className={styles.seasonList}>
                {seasons.map((s) => (
                  <li key={s.id}>
                    <strong>{crops[s.crop_id] ?? s.crop_id}</strong>
                    <span>
                      {s.sow_date} 播种 → {s.harvest_date} 预计成熟
                    </span>
                    <small>
                      生长 {s.growing_days} 天 · 换茬占用至 {s.occupied_until}（
                      {s.turnaround_days} 天）
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.help}>此地块在整个规划期休耕。</p>
            )}
          </div>
        );
      })}
      <p className={styles.help}>
        收获日期由积温阈值与历史天气情景计算，需按当地品种、天气和田间成熟情况核对。
      </p>
    </section>
  );
}
export function OptionDetail({
  option,
  fields,
  start,
  end,
}: {
  option: OptionV2;
  fields: Field[];
  start: string;
  end: string;
}) {
  const evidenceDisclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let originalOpen: boolean | null = null;
    const beforePrint = () => {
      const node = evidenceDisclosure.current;
      if (!node || originalOpen !== null) return;
      originalOpen = node.open;
      node.open = true;
    };
    const afterPrint = () => {
      if (evidenceDisclosure.current && originalOpen !== null)
        evidenceDisclosure.current.open = originalOpen;
      originalOpen = null;
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      afterPrint();
    };
  }, []);
  if (option.complete === false)
    return (
      <div className={styles.notice}>
        <strong>基准资料未完整计算</strong>
        <p>
          部分播种记录缺少有效输入，暂不能显示全期资源总量或把空白解释为休耕。
        </p>
        <ul>
          {option.input_errors?.map((item, index) => (
            <li key={index}>{item.reason}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <>
      <dl className={styles.metrics}>
        {(Object.keys(metricLabels) as (keyof Metrics)[]).map((k) => (
          <div key={k}>
            <dt>{metricLabels[k]}</dt>
            <dd>
              {option.complete === false
                ? "不完整"
                : n(option.verification.totals[k])}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.help}>
        以上为所选地块、整个规划期合计。覆盖与多样性是面积加权指标；用水为估计补水缺口，不是实测灌水量。
      </p>
      {!option.feasible && (
        <div className={styles.notice}>
          <strong>此种法不满足当前约束</strong>
          <ul>
            {option.verification.violations.map((v, i) => (
              <li key={i}>{violationText(v, fields)}</li>
            ))}
            {option.input_errors?.map((v, i) => (
              <li key={"input" + i}>{violationText(v.reason, fields)}</li>
            ))}
          </ul>
        </div>
      )}
      <Timeline option={option} fields={fields} start={start} end={end} />
      <details
        ref={evidenceDisclosure}
        className={`${styles.details} ${styles.printEvidence}`}
      >
        <summary>各年度资源与计算依据</summary>
        <div className={styles.tableScroll}>
          <table>
            <caption>年度合计（未安排种植的年度为零）</caption>
            <thead>
              <tr>
                <th>年度</th>
                <th>水量 m³</th>
                <th>投入 USD</th>
                <th>劳力 人日</th>
              </tr>
            </thead>
            <tbody>
              {planningYears(start, end).map((year) => (
                <tr key={year}>
                  <th>{year}</th>
                  <td>
                    {n(option.verification.farm_years[year]?.water_m3 ?? 0)}
                  </td>
                  <td>
                    {n(option.verification.farm_years[year]?.cost_usd ?? 0)}
                  </td>
                  <td>
                    {n(option.verification.farm_years[year]?.labor_days ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {option.solver && (
          <dl className={styles.evidenceGrid}>
            <dt>求解状态</dt>
            <dd>{runStatus[option.solver.status] ?? option.solver.status}</dd>
            <dt>目标值 / 界</dt>
            <dd>
              {n(option.solver.objective, 6)} / {n(option.solver.bound, 6)}
            </dd>
            <dt>真实最优差距</dt>
            <dd>
              {option.solver.gap == null
                ? "未提供"
                : n(option.solver.gap * 100, 6) + "%"}
            </dd>
            <dt>数学复核</dt>
            <dd>{option.verification.valid ? "通过" : "未通过"}</dd>
            <dt>逐日科学复核</dt>
            <dd>
              {option.scientific_verification?.valid
                ? "通过"
                : "未提供 / 未通过"}
            </dd>
          </dl>
        )}
        <p className={styles.help}>
          “最优”仅针对本次生成的候选日期及声明的目标；不等于真实经营利润最大或未来产量保证。
        </p>
      </details>
    </>
  );
}
function compatible(a: RunV2, b: RunV2) {
  const fields = (r: RunV2) =>
    r.field_snapshots
      .map((f) => `${f.id}:${f.version}`)
      .sort()
      .join("|");
  return (
    a.id !== b.id &&
    a.request.start === b.request.start &&
    a.request.end === b.request.end &&
    a.request.profile_id === b.request.profile_id &&
    a.provenance.weather_sha256 === b.provenance.weather_sha256 &&
    fields(a) === fields(b) &&
    allOptions(b).some((o) => o.complete !== false) &&
    ![
      "pending",
      "running",
      "failed",
      "cancelled",
      "timeout_no_solution",
    ].includes(b.status)
  );
}
type Props = {
  owner: string;
  run: RunV2;
  changes: ChangedCondition[];
  selectedOptionId: string | null;
  onSelect: (id: string) => void;
  onExplain: (option: OptionV2) => void;
  onUpdate: (run: RunV2) => void;
  onSaved: (plan: SavedV2) => void;
  compareRunId: string | null;
  compareOptionId: string | null;
  onCompare: (run: string | null, option: string | null) => void;
};
export function RunResults({
  owner,
  run,
  changes,
  selectedOptionId,
  onSelect,
  onExplain,
  onUpdate,
  onSaved,
  compareRunId,
  compareOptionId,
  onCompare,
}: Props) {
  const [error, setError] = useState<string | null>(null),
    [actionBusy, setActionBusy] = useState(false),
    [saveTarget, setSaveTarget] = useState<OptionV2 | null>(null),
    [title, setTitle] = useState(""),
    [notes, setNotes] = useState("");
  const sequence = useRef(0),
    active = useRef(run.id);
  useEffect(() => {
    active.current = run.id;
    return () => {
      active.current = "";
    };
  }, [run.id]);
  const history = useQuery({
    queryKey: ["rotation", owner, "runs"],
    queryFn: api.listRuns,
    refetchOnMount: "always",
  });
  const others = (history.data?.items ?? []).filter((r) => compatible(run, r));
  const other = others.find((r) => r.id === compareRunId);
  const options = allOptions(run),
    selected = options.find((o) => o.id === selectedOptionId),
    second = other && allOptions(other).find((o) => o.id === compareOptionId);
  const comparison = useQuery({
    queryKey: [
      "rotation",
      owner,
      "comparison",
      run.id,
      selected?.id,
      other?.id,
      second?.id,
    ],
    queryFn: () =>
      api.compareRuns({
        first_run_id: run.id,
        first_option_id: selected!.id,
        second_run_id: other!.id,
        second_option_id: second!.id,
      }),
    enabled: Boolean(
      selected &&
        selected.complete !== false &&
        other &&
        second &&
        second.complete !== false,
    ),
    retry: false,
  });
  async function perform(fn: () => Promise<void>) {
    const id = run.id,
      seq = ++sequence.current;
    setActionBusy(true);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      if (active.current === id && sequence.current === seq)
        setError(errorMessage(cause));
    } finally {
      if (active.current === id && sequence.current === seq)
        setActionBusy(false);
    }
  }
  const isActive = ["pending", "running"].includes(run.status);
  return (
    <section
      className={styles.resultsSection}
      id="rotation-results"
      aria-labelledby="results-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>YOUR CALCULATED OPTIONS</p>
          <h2 id="results-title">这次计算的结果</h2>
          <p>
            {run.request.start}—{run.request.end} ·{" "}
            {run.field_snapshots.map((f) => f.name).join("、")}
          </p>
        </div>
        <span className={styles.status} role="status">
          {runStatus[run.status] ?? run.status}
        </span>
      </div>
      {changes.length > 0 && (
        <p className={styles.notice}>
          条件已修改，尚未重算：{changes.map((k) => changeLabels[k]).join("、")}
          。下面仍是上次提交时的结果。
        </p>
      )}
      <div className={styles.actions}>
        {isActive && (
          <button
            disabled={actionBusy}
            onClick={() =>
              void perform(async () => {
                const value = await api.cancelRun(run.id);
                if (active.current === run.id) onUpdate(value);
              })
            }
          >
            取消本次计算
          </button>
        )}
        {["failed", "cancelled", "timeout_no_solution"].includes(
          run.status,
        ) && (
          <button
            disabled={actionBusy}
            onClick={() =>
              void perform(async () => {
                const value = await api.retryRun(run.id);
                if (active.current === run.id) onUpdate(value);
              })
            }
          >
            重试原始条件
          </button>
        )}
        <button
          disabled={actionBusy}
          onClick={() =>
            void perform(async () =>
              downloadJson(
                await api.exportRun(run.id),
                `rotation-${run.id}.json`,
              ),
            )
          }
        >
          <Download size={14} />
          导出完整依据
        </button>
        <button onClick={() => window.print()}>
          <Printer size={14} />
          打印摘要
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {isActive && (
        <p className={styles.notice}>
          计算已保存到服务器。可离开页面或刷新，返回此链接后继续查看进度。
        </p>
      )}
      {run.status === "infeasible" && (
        <p className={styles.notice}>
          在当前地块历史、候选日期和资源上限下，没有满足全部限制的轮作。可检查水量与预算、允许休耕，或调整日期后重新计算。基准种法会独立显示其约束结果。
        </p>
      )}
      {run.result?.error_code && (
        <p className={styles.error}>
          本次未能完成计算：{run.result.error_code}。原始条件已保留。
        </p>
      )}
      {options.length > 0 && (
        <>
          <div
            className={styles.optionPicker}
            role="group"
            aria-label="选择要查看的方案"
          >
            {options.map((option, index) => (
              <button
                key={option.id}
                aria-pressed={selected?.id === option.id}
                onClick={() => onSelect(option.id)}
              >
                <strong>{optionName(option, index)}</strong>
                <span>{option.feasible ? "满足当前约束" : "不满足约束"}</span>
              </button>
            ))}
          </div>
          {selected ? (
            <>
              <OptionDetail
                option={selected}
                fields={run.field_snapshots}
                start={run.request.start}
                end={run.request.end}
              />
              <PrintBasis request={run.request} provenance={run.provenance} />
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  onClick={() => onExplain(selected)}
                >
                  <MessageCircle size={15} />
                  解释这个方案
                </button>
                <button
                  disabled={!selected.feasible || actionBusy}
                  onClick={() => {
                    setTitle(
                      `${run.field_snapshots[0]?.name ?? "轮作"} · ${run.request.start}`,
                    );
                    setNotes("");
                    setSaveTarget(selected);
                  }}
                >
                  <Save size={14} />
                  保存此方案
                </button>
              </div>
            </>
          ) : (
            <p className={styles.help}>
              选择一个方案，查看日期、估计值和依据。
            </p>
          )}
        </>
      )}
      {!isActive && selected && (
        <details className={styles.details}>
          <summary>与另一份计算比较</summary>
          <p className={styles.help}>
            只能比较同一地块版本、规划日期与天气资料的两次计算。差值为对照结果减当前结果，不是实测收益。
          </p>
          {history.isError && (
            <p className={styles.error}>
              无法读取计算历史。
              <button onClick={() => void history.refetch()}>重试</button>
            </p>
          )}
          <div className={styles.twoColumns}>
            <label>
              另一份计算
              <select
                value={other?.id ?? ""}
                onChange={(e) => onCompare(e.target.value || null, null)}
              >
                <option value="">选择已完成的计算</option>
                {others.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.created_at).toLocaleString()} ·{" "}
                    {runStatus[r.status] ?? r.status}
                  </option>
                ))}
              </select>
            </label>
            {other && (
              <label>
                比较的方案
                <select
                  value={second?.id ?? ""}
                  onChange={(e) => onCompare(other.id, e.target.value || null)}
                >
                  <option value="">选择方案</option>
                  {allOptions(other)
                    .filter((o) => o.complete !== false)
                    .map((o, i) => (
                      <option key={o.id} value={o.id}>
                        {optionName(o, i)}
                        {o.feasible ? "" : "（不可行基准）"}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {!others.length && !history.isFetching && (
            <p className={styles.help}>
              还没有可比的第二次计算。调整条件并重新计算后可在这里选择。
            </p>
          )}
          {comparison.isFetching && <p role="status">正在核对两份快照…</p>}
          {comparison.error && (
            <p role="alert" className={styles.error}>
              {errorMessage(comparison.error)}
            </p>
          )}
          {comparison.data && selected && second && (
            <ComparisonSummary
              comparison={comparison.data}
              current={selected.verification.totals}
              other={second.verification.totals}
            />
          )}
        </details>
      )}
      <details className={styles.details}>
        <summary>本次资料版本与限制</summary>
        <dl className={styles.evidenceGrid}>
          <dt>参数包</dt>
          <dd>{run.provenance.profile_id}</dd>
          <dt>参数校验值</dt>
          <dd>{run.provenance.profile_sha256}</dd>
          <dt>历史天气</dt>
          <dd>{run.provenance.weather_release_id}</dd>
          <dt>天气校验值</dt>
          <dd>{run.provenance.weather_sha256}</dd>
          <dt>候选日期</dt>
          <dd>
            {run.result?.candidate_count ?? "尚未生成"} 个 · 采样间隔{" "}
            {run.result?.sampling_step_days ?? "—"} 天
          </dd>
        </dl>
        <ul>
          {[
            ...run.provenance.limitations,
            ...(run.result?.limitations ?? []),
          ].map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      </details>
      <Dialog
        open={Boolean(saveTarget)}
        onOpenChange={(open) => {
          if (!open && !actionBusy) setSaveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存轮作方案</DialogTitle>
            <DialogDescription>
              同时保存本次输入、地块、参数、来源和结果快照。
            </DialogDescription>
          </DialogHeader>
          <form
            className={styles.saveForm}
            onSubmit={(e) => {
              e.preventDefault();
              const target = saveTarget;
              if (!target) return;
              void perform(async () => {
                const saved = await api.saveRotationPlan({
                  run_id: run.id,
                  option_id: target.id,
                  title: title.trim(),
                  notes,
                });
                if (active.current === run.id) {
                  setSaveTarget(null);
                  onSaved(saved);
                }
              });
            }}
          >
            <label>
              计划名称
              <input
                value={title}
                required
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              备注
              <textarea
                value={notes}
                maxLength={5000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <button
              className={styles.primary}
              disabled={actionBusy || !title.trim()}
            >
              {actionBusy ? "正在保存…" : "保存计划"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function PrintBasis({ request, provenance }: {
  request: RunV2["request"];
  provenance: RunV2["provenance"];
}) {
  return (
    <section className={styles.printBasis} aria-label="打印方案的数据依据与适用限制">
      <h2>数据依据与适用限制</h2>
      <p>
        参数版本：{provenance.profile_id}<br />
        天气资料版本：{provenance.weather_release_id}
      </p>
      <p>
        使用历史天气重放，不是未来天气预报。温度调整 {n(request.scenario.temperature_change_c)} °C；
        降雨调整 {n(request.scenario.rainfall_change_pct)}%。
      </p>
      {provenance.benchmark_scope === "benchmark_not_locally_calibrated" && (
        <p>这是研发验收参数，尚未经当地农艺校准。成本、劳力、播期与同科间隔包含示范假设；不构成实际种植或灌溉处方。</p>
      )}
      <p>模型不预测产量、利润或实际节水。完整条件、参数假设和来源哈希保留在已保存的计划与 JSON 导出中。</p>
      <h3>参考资料</h3>
      <ul>
        {Object.entries(provenance.sources)
          .filter(([, source]) => source.kind === "reference")
          .map(([id, source]) => (
            <li key={id}>
              {source.title}
              {source.url && <span className={styles.printSourceUrl}>{source.url}</span>}
            </li>
          ))}
      </ul>
    </section>
  );
}
export function SavedPlan({ plan }: { plan: SavedV2 }) {
  return (
    <section className={styles.resultsSection}>
      <p className={styles.eyebrow}>SAVED PLAN</p>
      <h1>{plan.title}</h1>
      <p>
        保存于 {new Date(plan.created_at).toLocaleString()} ·
        保留保存时的输入与依据
      </p>
      {plan.notes && <p className={styles.savedNotes}>{plan.notes}</p>}
      <div className={styles.actions}>
        <button
          onClick={() => downloadJson(plan, `rotation-plan-${plan.id}.json`)}
        >
          <Download size={14} />
          导出计划
        </button>
        <button onClick={() => window.print()}>
          <Printer size={14} />
          打印
        </button>
      </div>
      <OptionDetail
        option={plan.option}
        fields={plan.input_snapshot.fields}
        start={plan.input_snapshot.request.start}
        end={plan.input_snapshot.request.end}
      />
      <PrintBasis
        request={plan.input_snapshot.request}
        provenance={plan.input_snapshot.provenance}
      />
      <details className={styles.details}>
        <summary>保存时的全部条件与来源</summary>
        <pre>
          {JSON.stringify(
            {
              request: plan.input_snapshot.request,
              provenance: plan.input_snapshot.provenance,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
