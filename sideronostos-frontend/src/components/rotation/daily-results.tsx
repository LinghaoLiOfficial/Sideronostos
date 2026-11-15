"use client";
import type { Translator } from "@/lib/i18n/translate";
import { useI18n } from "@/lib/i18n/provider";
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
import type { ChangedCondition } from "@/lib/api/rotation-types";
import {
  DAILY_METRICS,
  isDailyRun,
  type DailyComparison,
  type DailyInput,
  type DailyMetrics,
  type DailyOption,
  type DailyProvenance,
  type DailyPreparationIssue,
  type DailyRun,
  type DailySaved,
  type OptionalDailyMetric,
} from "@/lib/api/daily-types";
import * as api from "@/lib/api/daily";
import { metricLabels, metricUnits } from "./daily-model";
import { downloadJson, formatValue as n, runStatus } from "./planning-model";
import { RotationTimeline } from "./rotation-timeline";
import { sourceKindLabels } from "./daily-evidence";
import { errorMessage } from "../field-shift/model";
import styles from "./workspace.module.css";

const preparationReasons: Record<string, string> = {
  confirmed_baseline_unavailable: "原定种法没有通过候选检查",
  field_has_no_candidate: "地块没有符合硬约束的候选",
  sampled_start_limit_exceeded:
    "播种日期组合超过计算上限，请缩小范围或明确分批",
  candidate_limit_exceeded: "候选数量超过计算上限，请缩小范围或明确分批",
  candidate_graph_limit_exceeded:
    "轮作衔接组合超过计算上限，请缩小范围或明确分批",
  coefficient_verification_failed: "科学预计算未通过独立校验，不能采用本次结果",
  cancelled: "计算已取消",
  irrigation_unavailable: "缺少所需灌溉设施",
  crop_prohibited: "该作物已被禁止种植",
  outside_sowing_window: "播种日期不在适宜窗口内",
  soil_unsuitable: "土壤条件不符合参数要求",
  terrain_unsuitable: "地形条件不符合参数要求",
  mechanical_access_unavailable: "机械无法进入地块",
  historical_gap: "与前茬的间隔不足",
  climate_unsuitable: "气候条件不符合参数要求",
  operation_outside_occupancy: "农机作业日期超出候选占用期",
  hard_water_capacity: "供水硬限制不足",
  hard_machine_capacity: "设备硬限制不足",
  hard_seed_capacity: "种源硬限制不足",
  hard_market_capacity: "市场硬限制不足",
};
function preparationIssueText(issue: DailyPreparationIssue, fields: Field[], t: Translator) {
  const detail = typeof issue === "string" ? { code: issue } : issue;
  return [
    t(preparationReasons[detail.code] ?? detail.code),
    detail.field_id
      ? (fields.find((f) => f.id === detail.field_id)?.name ?? detail.field_id)
      : null,
    detail.crop_id,
    detail.sow_date,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const dailyOptions = (run: DailyRun) => [
  ...(run.result?.options ?? []),
  ...(run.result?.baseline ? [run.result.baseline] : []),
];
export function dailyOptionName(option: DailyOption) {
  if (option.id === "baseline") return "原定种法 / 基准";
  const names: Record<string, string> = {
    requested: "当前偏好方案",
    water_emphasis: "节水优先备选",
    profit_emphasis: "收益优先备选",
    rotation_emphasis: "轮作衔接优先备选",
    soil_emphasis: "土壤贡献优先备选",
    risk_emphasis: "降低暴露优先备选",
    bare_emphasis: "减少裸地优先备选",
    distinct_fallback: "其他可行排期",
  };
  return names[option.preference_id ?? ""] ?? option.label;
}
function optionState(option: DailyOption) {
  if (!option.complete || !option.scientific_verification?.valid)
    return "尚未通过完整校验";
  if (!option.feasible || !option.verification.valid) return "不满足硬约束";
  if (option.verification.diagnostic) return "需补救的诊断方案";
  return option.execution_label === "engineering_benchmark"
    ? "零资源缺口 · 工程基准"
    : "零资源缺口 · 情景方案";
}
export function compatibleDailyRuns(a: DailyRun, b: DailyRun) {
  const identity = (r: DailyRun) =>
    r.field_snapshots
      .map((f) => `${f.id}:${f.version}`)
      .sort()
      .join("|");
  return (
    a.id !== b.id &&
    identity(a) === identity(b) &&
    a.request.start === b.request.start &&
    a.request.end === b.request.end &&
    a.provenance.profile_sha256 === b.provenance.profile_sha256 &&
    a.request.profile_id === b.request.profile_id &&
    a.provenance.weather_sha256 === b.provenance.weather_sha256 &&
    ![
      "pending",
      "running",
      "failed",
      "cancelled",
      "timeout_no_solution",
    ].includes(b.status) &&
    dailyOptions(b).some((o) => o.complete)
  );
}
export function DailyOptionsComparison({
  options,
}: {
  options: DailyOption[];
}) {
  const { t } = useI18n();

  if (options.length < 2) return null;
  const checked = (option: DailyOption) =>
    option.complete && option.scientific_verification?.valid;
  return (
    <section aria-label={t("本次方案比较")}>
      <div
        className={styles.tableScroll}
        tabIndex={0}
        role="region"
        aria-label={t("原始指标比较表，可横向滚动")}
      >
        <table>
          <caption>{t("本次方案原始指标比较")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("指标")}</th>
              {options.map((o) => (
                <th scope="col" key={o.id}>
                  {t(dailyOptionName(o))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t("计算边界")}</th>
              {options.map((o) => (
                <td key={o.id}>{t(optionState(o))}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">{t("缺口补救成本 · USD · 优先降低")}</th>
              {options.map((o) => (
                <td key={o.id}>
                  {checked(o) ? n(o.verification.gap_cost) : t("未通过校验")}
                </td>
              ))}
            </tr>
            {DAILY_METRICS.map((metric) => (
              <tr key={metric}>
                <th scope="row">
                  {t(metricLabels[metric])} · {t(metricUnits[metric])} ·{" "}
                  {["profit", "rotation", "soil"].includes(metric)
                    ? t("越高越好")
                    : t("越低越好")}
                </th>
                {options.map((o) => (
                  <td key={o.id}>
                    {!checked(o)
                      ? t("未通过校验")
                      : o.verification.metrics[metric] == null
                        ? t("未计算")
                        : n(
                            o.verification.metrics[metric]!,
                            metric === "risk" ? 3 : 2,
                          )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.help}>
        {t("先比较硬约束和资源缺口，再看六项原始指标的取舍。各备选可能采用不同权重，综合分数不用于跨偏好排名；详细权重和限制可在各方案中查看。")}</p>
    </section>
  );
}

export function DailyOptionDetail({
  option,
  fields,
  request,
}: {
  option: DailyOption;
  fields: Field[];
  request: DailyInput;
}) {
  const { t } = useI18n();

  const proof = option.verification,
    verified = option.complete && option.scientific_verification?.valid;
  const gaps = proof.resources.filter((r) => r.gap > 0);
  const [showAllGaps, setShowAllGaps] = useState(false);
  if (!verified)
    return (
      <p role="alert" className={styles.error}>
        {t("此方案尚未通过完整科学校验，不能作为已验证结果使用。")}</p>
    );
  return (
    <article className={styles.optionDetail}>
      <h3>{t(dailyOptionName(option))}</h3>
      <p
        className={
          !option.feasible || proof.diagnostic ? styles.notice : styles.help
        }
        role={!option.feasible || proof.diagnostic ? "alert" : "status"}
      >
        {t(optionState(option))}
        {t("。求解器找到结果不表示已具备实施条件；仍需核对当地品种、资料与实际资源。")}</p>
      {!proof.valid && (
        <details open>
          <summary>{t("约束冲突")}</summary>
          <p>{t("这个基准仅保留用于检查，不能保存为可行种法。")}</p>
          <ul>
            {proof.violations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </details>
      )}
      <dl className={styles.metrics}>
        {DAILY_METRICS.map((metric) => (
          <div
            key={metric}
            aria-label={t(`${t(metricLabels[metric])} · ${t(metricUnits[metric])}`)}
          >
            <dt>
              {t(metricLabels[metric])} · {t(metricUnits[metric])}
            </dt>
            <dd>
              {proof.metrics[metric] === null
                ? t("未计算")
                : n(
                    proof.metrics[metric]!,
                    metric === "rotation" ||
                      metric === "soil" ||
                      metric === "risk"
                      ? 3
                      : 2,
                  )}
            </dd>
            {proof.metrics[metric] === null && (
              <small>
                {option.objective_definition.disabled_metrics[
                  metric as OptionalDailyMetric
                ] ?? t("资料不足")}
              </small>
            )}
          </div>
        ))}
      </dl>
      <p className={styles.help}>
        {t("收益是参数包产量、价格和成本的估算；土壤贡献是代理分数，风险指标描述历史气象暴露与灌溉依赖，均不是实测变化或损失概率。历史天气回放不是未来预报。")}</p>
      <section className={styles.dailyPanel} aria-label={t("经营资源缺口")}>
        <h4>{t("经营资源缺口")}</h4>
        <p>
          {t("缺口补救成本估计：")}{n(proof.gap_cost)} {t(" USD ·")}{" "}
          {gaps.length
            ? t("{0} 项资源或日期需要补救", { "0": gaps.length })
            : t("本次所列资源没有缺口")}
        </p>
        {gaps.length > 0 && (
          <>
            <ul className={styles.readinessList}>
              {(showAllGaps ? gaps : gaps.slice(0, 20)).map((gap) => (
                <li key={gap.id}>
                  <strong>
                    {{
                      water: t("供水"),
                      machine: t("设备"),
                      seed: t("种子"),
                      market: t("市场容量"),
                      bare: t("裸地天数"),
                    }[gap.kind] ?? gap.kind}{" "}
                    · {gap.id.match(/\d{4}-\d{2}-\d{2}$/)?.[0] ?? t("规划分期")}
                  </strong>
                  <p>
                    {t("需要 ")}{n(gap.used)}{t("，可用 ")}{n(gap.capacity)}{t("，缺口")}{" "}
                    {n(gap.gap)} {gap.unit}{t("；补救成本 ")}{n(gap.gap_cost)} {t(" USD")}</p>
                  <p>{gap.remedy ?? t("补救条件尚未说明")}</p>
                  <details>
                    <summary>{t("资源与依据")}</summary>
                    <p>{gap.id}</p>
                    {gap.evidence_ids.map((id) => {
                      const source = request.sources[id.replace(/^input:/, "")];
                      return (
                        <p key={id}>
                          {t(source
                            ? `${t(sourceKindLabels[source.kind])} · ${source.title} · ${source.locator}`
                            : id)}
                        </p>
                      );
                    })}
                  </details>
                </li>
              ))}
            </ul>
            {gaps.length > 20 && (
              <button type="button" onClick={() => setShowAllGaps((v) => !v)}>
                {showAllGaps
                  ? t("收起缺口明细")
                  : t("展开全部 {0} 项缺口", { "0": gaps.length })}
              </button>
            )}
          </>
        )}
      </section>
      <RotationTimeline
        option={option}
        fields={fields}
        start={request.start}
        end={request.end}
      />
      <details className={styles.details}>
        <summary>{t("本方案的偏好与求解边界")}</summary>
        <p>
          {t("首先最小化资源缺口成本，再按以下权重比较归一化指标。不同权重的方案不能只按综合分数排名。")}</p>
        <ul>
          {DAILY_METRICS.map((metric) => (
            <li key={metric}>
              {t(metricLabels[metric])} {t(" · 权重")}{" "}
              {n(option.objective_definition.weights[metric] * 100, 1)}{t("% · 参考尺度 ")}{option.objective_definition.scales[metric] ?? t("未启用")}
            </li>
          ))}
        </ul>
        {option.solver ? (
          <p>
            {option.solver.gap_optimality_proven
              ? t("已证明当前候选集中的最小资源缺口。")
              : t("得到限时可用结果，尚未证明最小资源缺口。")}
            {option.solver.score_optimality_proven
              ? t("已证明该偏好下的候选集最优。")
              : t("尚未证明综合目标最优。")}
          </p>
        ) : (
          <p>{t("这是独立核验的原定种法，未经最优化。")}</p>
        )}
        {option.non_dominated_among_generated !== undefined && (
          <p>
            {option.non_dominated_among_generated
              ? t("在已生成的方案中，没有另一方案在所有已启用指标上都不差且至少一项更好。")
              : t("已生成的其他方案中存在各项不差且至少一项更好的方案。")}
            {t("这不是完整的全局 Pareto 前沿。")}</p>
        )}
      </details>
    </article>
  );
}
export function DailyComparisonSummary({
  comparison,
  current,
  other,
}: {
  comparison: DailyComparison;
  current: DailyMetrics;
  other: DailyMetrics;
}) {
  const { t } = useI18n();

  return (
    <>
      <p>
        {t("差值为对照结果减当前结果，与创建时间先后无关。正值表示对照较高，负值表示对照较低。")}</p>
      {!comparison.score_comparable && (
        <p className={styles.notice}>
          {t("偏好或尺度不同，综合分数不能直接比较；请比较原始指标与资源缺口。")}</p>
      )}
      <dl className={styles.metrics}>
        {DAILY_METRICS.map((metric) => (
          <div key={metric} aria-label={t("{0}差值", { "0": metricLabels[metric] })}>
            <dt>
              {t(metricLabels[metric])}{t("差值 · ")}{t(metricUnits[metric])}
            </dt>
            <dd>
              {comparison.delta[metric] == null
                ? t("无法比较")
                : `${comparison.delta[metric]! > 0 ? "+" : ""}${n(comparison.delta[metric]!)}`}
            </dd>
            <small>
              {t("当前 ")}{current[metric] == null ? t("未计算") : n(current[metric]!)} {t(" → 对照 ")}{other[metric] == null ? t("未计算") : n(other[metric]!)}
            </small>
          </div>
        ))}
      </dl>
      <p className={styles.help}>
        {t("差值来自两份已保存的计算快照，不表示实测收益或已实现节水。")}</p>
    </>
  );
}
function DailyBasis({
  request,
  provenance,
  label,
}: {
  request: DailyInput;
  provenance: DailyProvenance;
  label: string;
}) {
  const { t } = useI18n();

  return (
    <section className={styles.dailyPanel} aria-label={t(label)}>
      <h3>{t("资料依据与适用限制")}</h3>
      <p>
        {t("参数包 ")}{provenance.profile_id} {t(" · 历史天气")}{" "}
        {provenance.weather_release_id}
      </p>
      <p>
        {t("历史天气回放，不是未来天气预测。气温情景调整")}{" "}
        {n(request.scenario.temperature_change_c)} {t(" °C；降雨调整")}{" "}
        {n(request.scenario.rainfall_change_pct)}%。
      </p>
      <p>{t("每个候选使用独立初始土壤水分假设，尚未实现跨季连续水量模拟。")}</p>
      {provenance.benchmark_scope === "benchmark_not_locally_calibrated" && (
        <p>
          {t("工程基准：尚未确定真实试点，参数和经营假设需要当地资料及农艺校准。")}</p>
      )}
      <details className={styles.details}>
        <summary>{t("来源、版本与限制")}</summary>
        <dl className={styles.evidenceGrid}>
          <dt>{t("参数校验值")}</dt>
          <dd>{provenance.profile_sha256}</dd>
          <dt>{t("天气校验值")}</dt>
          <dd>{provenance.weather_sha256}</dd>
        </dl>
        <ul>
          {provenance.limitations.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
        {Object.values({ ...provenance.sources, ...request.sources }).map(
          (s) => (
            <p key={s.id}>
              {t(sourceKindLabels[s.kind])} · {s.title} · {s.locator}
              {s.applicable_start
                ? t(" · 适用 {0}—{1}", { "0": s.applicable_start, "1": s.applicable_end })
                : ""}
            </p>
          ),
        )}
      </details>
    </section>
  );
}
export function DailySavedPlan({ plan }: { plan: DailySaved }) {
  const { t, locale } = useI18n();

  return (
    <section className={styles.resultsSection}>
      <p className={styles.eyebrow}>{t("SAVED DAILY PLAN")}</p>
      <h1>{plan.title}</h1>
      <p>
        {t("保存于 ")}{new Date(plan.created_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")} {t(" · 使用保存时的地块版本、经营条件、参数与天气")}</p>
      {plan.notes && <p className={styles.savedNotes}>{plan.notes}</p>}
      <div className={styles.actions}>
        <button
          onClick={() => downloadJson(plan, `rotation-v3-plan-${plan.id}.json`)}
        >
          <Download size={14} />
          {t("导出完整计划")}</button>
        <button onClick={() => window.print()}>
          <Printer size={14} />
          {t("打印摘要")}</button>
      </div>
      <DailyOptionDetail
        option={plan.option}
        fields={plan.input_snapshot.fields}
        request={plan.input_snapshot.request}
      />
      <DailyBasis
        request={plan.input_snapshot.request}
        provenance={plan.input_snapshot.provenance}
        label={t("保存时的资料依据")}
      />
    </section>
  );
}
type Props = {
  owner: string;
  run: DailyRun;
  changes: ChangedCondition[];
  selectedOptionId: string | null;
  onSelect: (id: string) => void;
  onExplain: (option: DailyOption) => void;
  onUpdate: (run: DailyRun) => void;
  onSaved: (plan: DailySaved) => void;
  compareRunId: string | null;
  compareOptionId: string | null;
  onCompare: (run: string | null, option: string | null) => void;
};
export function DailyRunResults({
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
  const { t, locale } = useI18n();

  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [saveTarget, setSaveTarget] = useState<DailyOption | null>(null),
    [title, setTitle] = useState(""),
    [notes, setNotes] = useState("");
  const active = useRef(run.id),
    inFlight = useRef(false);
  useEffect(() => {
    active.current = run.id;
    return () => {
      active.current = "";
    };
  }, [run.id]);
  const history = useQuery({
    queryKey: ["rotation", owner, "all-runs"],
    queryFn: () => api.listAllRuns(owner),
    refetchOnMount: "always",
  });
  const others = (history.data?.items ?? [])
    .filter(isDailyRun)
    .filter((r) => compatibleDailyRuns(run, r));
  const options = dailyOptions(run),
    selected = options.find((o) => o.id === selectedOptionId),
    other = others.find((r) => r.id === compareRunId),
    second = other && dailyOptions(other).find((o) => o.id === compareOptionId);
  const comparison = useQuery({
    queryKey: [
      "rotation",
      owner,
      "v3-comparison",
      run.id,
      selected?.id,
      other?.id,
      second?.id,
    ],
    queryFn: () =>
      api.compareDailyRuns(owner, {
        first_run_id: run.id,
        first_option_id: selected!.id,
        second_run_id: other!.id,
        second_option_id: second!.id,
      }),
    enabled: Boolean(selected?.complete && second?.complete && other),
    retry: false,
  });
  async function perform(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (active.current === run.id) setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      if (active.current === run.id) setBusy(false);
    }
  }
  const running = ["pending", "running"].includes(run.status);
  return (
    <section
      className={styles.resultsSection}
      id="rotation-results"
      aria-labelledby="daily-results-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>{t("VERIFIED DAILY OPTIONS")}</p>
          <h2 id="daily-results-title">{t("这次计算的结果")}</h2>
          <p>
            {run.request.start}—{run.request.end} ·{" "}
            {run.field_snapshots
              .map((f) => t("{0}（版本 {1}）", { "0": f.name, "1": f.version }))
              .join("、")}
          </p>
        </div>
        <span role="status" className={styles.status}>
          {t(runStatus[run.status] ?? run.status)}
        </span>
      </div>
      {changes.length > 0 && (
        <p className={styles.notice}>
          {t("草稿条件已经修改，尚未重新计算。以下数值、日期和来源仍属于上一次提交的快照。")}</p>
      )}
      <div className={styles.actions}>
        {running && (
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const value = await api.updateDailyRun(owner, run.id, "cancel");
                if (active.current === run.id) onUpdate(value);
              })
            }
          >
            {t("取消本次计算")}</button>
        )}
        {["failed", "cancelled", "timeout_no_solution"].includes(
          run.status,
        ) && (
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const value = await api.updateDailyRun(owner, run.id, "retry");
                if (active.current === run.id) onUpdate(value);
              })
            }
          >
            {t("重试原始条件")}</button>
        )}
        <button
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              const value = await api.exportAnyRun(owner, run.id);
              if (active.current === run.id)
                downloadJson(value, `rotation-v3-${run.id}.json`);
            })
          }
        >
          <Download size={14} />
          {t("导出完整依据")}</button>
        <button onClick={() => window.print()}>
          <Printer size={14} />
          {t("打印摘要")}</button>
      </div>
      {running && (
        <p className={styles.notice}>
          {t("任务已保存，可以离开页面或刷新，再从此链接查看进度。")}</p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {t(error)}
        </p>
      )}
      {run.status === "infeasible" && (
        <p className={styles.notice}>
          {t("当前候选、前茬和硬约束下没有可行轮作。请核对禁种、设备、作物适宜性和资源资料；有待补救的缺口不能替代这些硬约束。")}</p>
      )}
      {run.result?.error_code && (
        <div className={styles.error} role="alert">
          <p>
            {t(run.result.error_code === "preparation_blocked"
              ? t("数据检查之后，候选生成或科学校验未能通过。请核对原定种法、日期和适宜性。")
              : t("本次计算未完成，原始条件已保留。"))}
          </p>
          <details>
            <summary>{t("具体原因")}</summary>
            <p>{t(run.result.error_code)}</p>
            <ul>
              {run.result.preparation?.errors?.map((v, i) => (
                <li key={i}>{t(preparationIssueText(v, run.field_snapshots, t))}</li>
              ))}
            </ul>
            {Object.keys(run.result.preparation?.rejected_by_reason ?? {})
              .length > 0 && (
              <>
                <p>{t("候选未被采用的原因（同一候选可能有多个原因）：")}</p>
                <ul>
                  {Object.entries(
                    run.result.preparation?.rejected_by_reason ?? {},
                  ).map(([code, count]) => (
                    <li key={code}>
                      {t(preparationReasons[code] ?? code)} · {count} {t(" 个候选")}</li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </div>
      )}
      {options.length > 0 && (
        <>
          <div
            className={styles.optionPicker}
            role="group"
            aria-label={t("选择要查看的方案")}
          >
            {options.map((option) => (
              <button
                key={option.id}
                aria-pressed={selected?.id === option.id}
                onClick={() => onSelect(option.id)}
              >
                <strong>{t(dailyOptionName(option))}</strong>
                <span>{t(optionState(option))}</span>
              </button>
            ))}
          </div>
          <DailyOptionsComparison options={options} />
          {selected ? (
            <>
              <DailyOptionDetail
                key={selected.id}
                option={selected}
                fields={run.field_snapshots}
                request={run.request}
              />
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  onClick={() => onExplain(selected)}
                >
                  <MessageCircle size={15} />
                  {t("解释这个方案")}</button>
                <button
                  disabled={
                    busy ||
                    !selected.complete ||
                    !selected.feasible ||
                    !selected.verification.valid ||
                    !selected.scientific_verification?.valid
                  }
                  onClick={() => {
                    setTitle(
                      `${run.field_snapshots[0]?.name ?? t("轮作")} · ${run.request.start}`,
                    );
                    setNotes("");
                    setSaveTarget(selected);
                  }}
                >
                  <Save size={14} />
                  {selected.verification.diagnostic
                    ? t("保存诊断方案")
                    : t("保存此方案")}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.help}>
              {t("选择一个方案，查看原始指标、排期与资源缺口。")}</p>
          )}
        </>
      )}
      {run.result?.alternatives?.reason && (
        <p className={styles.notice}>
          {t("在当前候选集、同等资源缺口上限和计算时限内，没有找到足够不同的备选方案。")}</p>
      )}
      {selected && !running && (
        <details className={styles.details}>
          <summary>{t("与另一份计算比较")}</summary>
          <p>{t("只比较相同地块版本、日期、参数和天气资料的结果。")}</p>
          {history.error && (
            <p role="alert">
              {t("无法读取计算历史。")}<button onClick={() => void history.refetch()}>{t("重试")}</button>
            </p>
          )}
          <div className={styles.twoColumns}>
            <label>
              {t("另一份计算")}<select
                value={other?.id ?? ""}
                onChange={(e) => onCompare(e.target.value || null, null)}
              >
                <option value="">{t("选择已完成的计算")}</option>
                {others.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.created_at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")} ·{" "}
                    {t(runStatus[r.status] ?? r.status)}
                  </option>
                ))}
              </select>
            </label>
            {other && (
              <label>
                {t("比较的方案")}<select
                  value={second?.id ?? ""}
                  onChange={(e) => onCompare(other.id, e.target.value || null)}
                >
                  <option value="">{t("选择方案")}</option>
                  {dailyOptions(other)
                    .filter((o) => o.complete)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {t(dailyOptionName(o))} · {t(optionState(o))}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {!others.length && !history.isFetching && (
            <p>
              {t("目前没有相同资料版本下的另一份完成结果。调整条件并重新计算后，可在这里比较。")}</p>
          )}
          {comparison.isFetching && <p role="status">{t("正在比较两份快照…")}</p>}
          {comparison.error && (
            <p role="alert">{t(errorMessage(comparison.error))}</p>
          )}
          {comparison.data && second && (
            <>
              <DailyComparisonSummary
                comparison={comparison.data}
                current={selected.verification.metrics}
                other={second.verification.metrics}
              />
              <p>
                {t("资源缺口成本：当前 ")}{n(selected.verification.gap_cost)} {t(" USD → 对照 ")}{n(second.verification.gap_cost)} {t(" USD。")}</p>
            </>
          )}
        </details>
      )}
      <DailyBasis
        request={run.request}
        provenance={run.provenance}
        label={t("本次计算的资料依据")}
      />
      <Dialog
        open={Boolean(saveTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setSaveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {saveTarget?.verification.diagnostic
                ? t("保存需补救的诊断方案")
                : t("保存轮作方案")}
            </DialogTitle>
            <DialogDescription>
              {t("保存本次地块、经营条件、来源和计算结果的完整快照。")}</DialogDescription>
          </DialogHeader>
          <form
            className={styles.saveForm}
            onSubmit={(e) => {
              e.preventDefault();
              const target = saveTarget;
              if (!target || !title.trim()) return;
              void perform(async () => {
                const plan = await api.saveDailyPlan(owner, {
                  run_id: run.id,
                  option_id: target.id,
                  title: title.trim(),
                  notes,
                });
                if (active.current === run.id) {
                  setSaveTarget(null);
                  onSaved(plan);
                }
              });
            }}
          >
            <label>
              {t("计划名称")}<input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              {t("备注")}<textarea
                maxLength={5000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {saveTarget?.verification.diagnostic && (
              <p>{t("该方案仍有经营资源缺口；保存不会改变补救条件或实际设施。")}</p>
            )}
            {error && <p role="alert">{t(error)}</p>}
            <button className={styles.primary} disabled={busy || !title.trim()}>
              {busy ? t("正在保存…") : t("保存计划")}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
