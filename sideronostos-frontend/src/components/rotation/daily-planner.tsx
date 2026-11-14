"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import type { Field } from "@/lib/api/field-shift-types";
import type { ServerFarmHeader } from "@/lib/api/farms";
import type { ChangedCondition } from "@/lib/api/rotation-types";
import {
  DAILY_METRICS,
  type DailyDraft,
  type DailyProfile,
  type DailyRun,
  type OptionalDailyMetric,
} from "@/lib/api/daily-types";
import {
  activePlanningFields,
  annualPeriods,
  applyEngineeringFixture,
  fieldParameters,
  metricLabels,
  selectDailyFields,
  unknownRecord,
} from "./daily-model";
import { draftFromDailyRun, useDailyPlanning } from "./use-daily-planning";
import { SourcesEditor } from "./daily-evidence";
import { DailyFieldEditor } from "./daily-fields";
import { DailyResourcesEditor } from "./daily-resources";
import { DailyReadinessPanel } from "./daily-readiness";
import { errorMessage } from "../field-shift/model";
import { formatValue } from "./planning-model";
import styles from "./workspace.module.css";

export type DailyPlannerProps = {
  owner: string;
  profile: DailyProfile;
  fields: Field[];
  farms: ServerFarmHeader[];
  run?: DailyRun;
  selectedFieldId?: string;
  onRun: (run: DailyRun) => void;
  onDraft: (changes: ChangedCondition[], fields: DailyDraft["fields"]) => void;
  onFieldSaved: (field: Field) => void;
};
export function DailyPlannerForm(props: DailyPlannerProps) {
  const { profile, fields, farms, run, onFieldSaved } = props;
  const [dirtyHistory, setDirtyHistory] = useState<Record<string, boolean>>({});
  const [defaultSource, setDefaultSource] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const onHistoryDirty = useCallback(
    (id: string, dirty: boolean) =>
      setDirtyHistory((old) =>
        Boolean(old[id]) === dirty ? old : { ...old, [id]: dirty },
      ),
    [],
  );
  const planning = useDailyPlanning({
    ...props,
    historyDirty: Object.values(dirtyHistory).some(Boolean),
  });
  const { draft, replaceDraft } = planning;
  const active = activePlanningFields(fields, farms);
  const mapField = active.find((f) => f.id === props.selectedFieldId);
  const chosen = fields.filter((f) => draft.fields.some((c) => c.id === f.id));
  const patch = (value: Partial<DailyDraft>) => {
    setLocalError(null);
    replaceDraft({ ...draft, ...value });
  };
  function reconcile(next: DailyDraft, selection = chosen) {
    try {
      setLocalError(null);
      replaceDraft(selectDailyFields(next, selection, profile));
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  }
  const weights = draft.weights ?? profile.default_weights;
  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <section
      className={styles.formSection}
      id="planning-conditions"
      tabIndex={-1}
      aria-label="逐日轮作规划"
    >
      <p className={styles.eyebrow}>FIELD SHIFT · DAILY PLANNING</p>
      <h1>把田间条件变成可比较的种植计划</h1>
      <p>
        先核对你的地块与经营资料，再检查数据、生成方案。计算会优先减少可补救的资源缺口，然后比较六项指标。
      </p>
      <nav className={styles.dailySectionNav} aria-label="规划步骤">
        <a href="#daily-fields">地块与日期</a>
        <a href="#daily-evidence">资料来源</a>
        <a href="#daily-conditions">田间条件</a>
        <a href="#daily-resources">共享资源</a>
        <a href="#daily-baseline">原定种法</a>
        <a href="#daily-check">检查并计算</a>
      </nav>
      {planning.pending && (
        <div className={styles.notice} role="status">
          <strong>上一次提交尚未确认</strong>
          <p>
            保留了原始输入和请求编号。按原请求重试会恢复已有计算，避免重复提交；可见草稿不会替换那次输入。
          </p>
          <button
            type="button"
            disabled={planning.submitting}
            onClick={() => void planning.retryPending()}
          >
            按原请求重试
          </button>
        </div>
      )}
      {planning.storageError && (
        <p className={styles.error} role="alert">
          浏览器暂时无法保存草稿或提交记录。请检查存储空间与浏览器设置；无法可靠保存重试记录时不会提交新计算。
        </p>
      )}
      {run && (
        <p className={styles.notice}>
          下方结果属于它创建时的输入快照。编辑当前草稿不会改变历史结果。
          {run.provenance.profile_sha256 === profile.sha256 &&
            run.request.profile_id === profile.id && (
              <button
                type="button"
                disabled={planning.submitting || Boolean(planning.pending)}
                onClick={() => replaceDraft(draftFromDailyRun(run))}
              >
                采用这次计算的输入条件
              </button>
            )}
        </p>
      )}
      <fieldset
        disabled={planning.submitting || Boolean(planning.pending)}
        className={styles.unstyledFieldset}
      >
        <section id="daily-fields" className={styles.formBlock}>
          <h2>地块、规划日期与作物</h2>
          <p className={styles.help}>
            一次最多 10
            个已同步且属于当前分割方案的地块。数量超限时请明确分批；共享资源的分配需要另行核对。
          </p>
          {mapField && !draft.fields.some((f) => f.id === mapField.id) && (
            <div className={styles.notice} role="status">
              地图所选的「{mapField.name}」尚未加入保留的规划草稿。
              <button
                type="button"
                onClick={() => reconcile(draft, [...chosen, mapField])}
              >
                将地图所选地块加入规划
              </button>
            </div>
          )}
          {!active.length && (
            <p>
              还没有可参与本次规划的地块。
              <Link href="/fields">返回地图确认分割并补齐资料</Link>。
            </p>
          )}
          {active.map((field) => (
            <div key={field.id} className={styles.fieldChoice}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={draft.fields.some((c) => c.id === field.id)}
                  onChange={(e) =>
                    reconcile(
                      draft,
                      e.target.checked
                        ? [...chosen, field]
                        : chosen.filter((f) => f.id !== field.id),
                    )
                  }
                />
                <span>
                  <strong>{field.name}</strong>
                  <small>
                    {formatValue(field.area_ha, 3)} ha ·{" "}
                    {farms.find((f) => f.id === field.farm_id)?.name ?? "农场"}{" "}
                    · 版本 {field.version}
                  </small>
                </span>
              </label>
            </div>
          ))}
          {draft.fields
            .filter((c) => !active.some((f) => f.id === c.id))
            .map((c) => (
              <p className={styles.error} key={c.id}>
                草稿中的一个地块已不属于当前分割方案。
                <button
                  type="button"
                  onClick={() =>
                    reconcile(
                      draft,
                      chosen.filter((f) => f.id !== c.id),
                    )
                  }
                >
                  从本次规划移除
                </button>
              </p>
            ))}
          <p>已选 {draft.fields.length} 个地块</p>
          <div className={styles.twoColumns}>
            {(["start", "end"] as const).map((key) => (
              <label key={key}>
                {key === "start" ? "规划开始" : "规划结束"}
                <input
                  type="date"
                  value={draft[key]}
                  onChange={(e) => {
                    const next = { ...draft, [key]: e.target.value };
                    reconcile({
                      ...next,
                      periods: annualPeriods(next.start, next.end),
                    });
                  }}
                />
              </label>
            ))}
          </div>
          <p className={styles.help}>
            最多三年，资源分期默认按日历年覆盖所选日期。改变日期会重新划分年度分期；来源适用时间不会自动延长。
          </p>
          <div className={styles.cropChoices}>
            {Object.entries(profile.crops).map(([id, crop]) => (
              <label className={styles.checkLabel} key={id}>
                <input
                  type="checkbox"
                  checked={draft.allowed_crop_ids.includes(id)}
                  onChange={(e) =>
                    reconcile({
                      ...draft,
                      allowed_crop_ids: e.target.checked
                        ? [...draft.allowed_crop_ids, id]
                        : draft.allowed_crop_ids.filter((c) => c !== id),
                    })
                  }
                />
                {crop.name}
              </label>
            ))}
          </div>
          <details className={styles.details}>
            <summary>自定义供需分期</summary>
            <p>分期必须连续覆盖全部规划日期。每期分别填写种子与市场容量。</p>
            {draft.periods.map((period, index) => (
              <div className={styles.twoColumns} key={period.id}>
                <label>
                  第 {index + 1} 期开始
                  <input
                    type="date"
                    value={period.start}
                    onChange={(e) =>
                      patch({
                        periods: draft.periods.map((p, i) =>
                          i === index ? { ...p, start: e.target.value } : p,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  第 {index + 1} 期结束
                  <input
                    type="date"
                    value={period.end}
                    onChange={(e) =>
                      patch({
                        periods: draft.periods.map((p, i) =>
                          i === index ? { ...p, end: e.target.value } : p,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={draft.periods.length === 1}
                  onClick={() =>
                    reconcile({
                      ...draft,
                      periods: draft.periods.filter((_, i) => i !== index),
                    })
                  }
                >
                  移除此分期
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={draft.periods.length >= 36}
              onClick={() =>
                reconcile({
                  ...draft,
                  periods: [
                    ...draft.periods,
                    { id: `period-${crypto.randomUUID()}`, start: "", end: "" },
                  ],
                })
              }
            >
              添加分期
            </button>
          </details>
        </section>
        <div id="daily-evidence">
          <SourcesEditor
            sources={draft.sources}
            region={profile.region_id}
            start={draft.start}
            end={draft.end}
            defaultSource={defaultSource}
            onDefaultSource={setDefaultSource}
            onChange={(sources) => patch({ sources })}
          />
        </div>
        <section id="daily-conditions" className={styles.formBlock}>
          <h2>田间资料与前茬</h2>
          <p className={styles.help}>
            NASA
            背景数据不能代替土壤检测、农户历史或经营台账。每一项都保留单位和来源；空白表示未知。
          </p>
          {chosen.map((field) => (
            <div key={field.id}>
              {draft.fields.find((c) => c.id === field.id)?.expected_version !==
                field.version && (
                <p role="status" className={styles.notice}>
                  「{field.name}
                  」有新版本。核对后采用新版本，并重新确认前茬与经营条件。
                  <button
                    type="button"
                    onClick={() =>
                      reconcile({
                        ...draft,
                        fields: draft.fields.map((c) =>
                          c.id === field.id
                            ? { ...c, expected_version: field.version }
                            : c,
                        ),
                        field_conditions: {
                          ...draft.field_conditions,
                          [field.id]: {
                            ...draft.field_conditions[field.id],
                            values: {
                              ...draft.field_conditions[field.id].values,
                              history_reviewed: unknownRecord(
                                fieldParameters.history_reviewed.unit,
                              ),
                              management_reviewed: unknownRecord(
                                fieldParameters.management_reviewed.unit,
                              ),
                            },
                          },
                        },
                      })
                    }
                  >
                    采用地块新版并重新核对
                  </button>
                </p>
              )}
              <DailyFieldEditor
                field={field}
                conditions={draft.field_conditions[field.id]}
                draft={draft}
                profile={profile}
                defaultSource={defaultSource}
                onChange={(value) =>
                  patch({
                    field_conditions: {
                      ...draft.field_conditions,
                      [field.id]: value,
                    },
                  })
                }
                onSaved={onFieldSaved}
                onHistoryDirty={onHistoryDirty}
              />
            </div>
          ))}
        </section>
        <DailyResourcesEditor
          draft={draft}
          profile={profile}
          farms={farms}
          fields={fields}
          defaultSource={defaultSource}
          onChange={(farm_resources) =>
            patch({
              farm_resources,
              field_conditions: Object.fromEntries(
                Object.entries(draft.field_conditions).map(([id, c]) => [
                  id,
                  {
                    ...c,
                    water_system_id:
                      c.water_system_id &&
                      Object.values(farm_resources).some(
                        (farm) => farm.daily[c.water_system_id!],
                      )
                        ? c.water_system_id
                        : null,
                  },
                ]),
              ),
            })
          }
        />
        <section id="daily-baseline" className={styles.formBlock}>
          <h2>你原本打算怎么种？</h2>
          <p className={styles.help}>
            每个地块至少填写一季确认的原定种法，用作基准。作物和日期仍需经过适宜性检查。
          </p>
          {draft.baseline.map((season, index) => (
            <div className={styles.baselineRow} key={index}>
              <label>
                地块
                <select
                  value={season.field_id}
                  onChange={(e) =>
                    patch({
                      baseline: draft.baseline.map((b, i) =>
                        i === index ? { ...b, field_id: e.target.value } : b,
                      ),
                    })
                  }
                >
                  {chosen.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                作物
                <select
                  value={season.crop_id}
                  onChange={(e) =>
                    patch({
                      baseline: draft.baseline.map((b, i) =>
                        i === index ? { ...b, crop_id: e.target.value } : b,
                      ),
                    })
                  }
                >
                  {draft.allowed_crop_ids.map((id) => (
                    <option key={id} value={id}>
                      {profile.crops[id]?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                播种日期
                <input
                  type="date"
                  min={draft.start}
                  max={draft.end}
                  value={season.sow_date}
                  onChange={(e) =>
                    patch({
                      baseline: draft.baseline.map((b, i) =>
                        i === index ? { ...b, sow_date: e.target.value } : b,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                aria-label={`移除原定第 ${index + 1} 季`}
                onClick={() =>
                  patch({
                    baseline: draft.baseline.filter((_, i) => i !== index),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={
              !draft.fields.length ||
              !draft.allowed_crop_ids.length ||
              draft.baseline.length >= 60
            }
            onClick={() =>
              patch({
                baseline: [
                  ...draft.baseline,
                  {
                    field_id: draft.fields[0].id,
                    crop_id: draft.allowed_crop_ids[0],
                    sow_date: "",
                  },
                ],
              })
            }
          >
            加入原定的一季
          </button>
        </section>
        <details className={styles.dailyPanel}>
          <summary>天气情景与六项偏好</summary>
          <p>
            对历史天气作情景调整，不能解释为未来天气预测。偏好权重合计应为
            100%；节水权重必须大于 0。
          </p>
          <div className={styles.twoColumns}>
            <label>
              气温变化 · °C
              <input
                type="number"
                min={-3}
                max={5}
                step="0.1"
                value={draft.scenario.temperature_change_c}
                onChange={(e) =>
                  patch({
                    scenario: {
                      ...draft.scenario,
                      temperature_change_c: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              降雨变化 · %
              <input
                type="number"
                min={-50}
                max={50}
                value={draft.scenario.rainfall_change_pct}
                onChange={(e) =>
                  patch({
                    scenario: {
                      ...draft.scenario,
                      rainfall_change_pct: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
          <div className={styles.dailyGrid}>
            {DAILY_METRICS.map((metric) => (
              <div key={metric}>
                <label>
                  {metricLabels[metric]}权重 · %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    disabled={metric in draft.disabled_metrics}
                    value={Number((weights[metric] * 100).toFixed(6))}
                    onChange={(e) =>
                      patch({
                        weights: {
                          ...weights,
                          [metric]: Number(e.target.value) / 100,
                        },
                      })
                    }
                  />
                </label>
                {metric !== "water" && metric !== "bare" && (
                  <>
                    <label className={styles.checkLabel}>
                      <input
                        type="checkbox"
                        checked={metric in draft.disabled_metrics}
                        onChange={(e) => {
                          const disabled_metrics = {
                            ...draft.disabled_metrics,
                          };
                          if (e.target.checked) disabled_metrics[metric] = "";
                          else delete disabled_metrics[metric];
                          patch({
                            disabled_metrics,
                            weights: { ...weights, [metric]: 0 },
                          });
                        }}
                      />
                      暂不计算此可选指标
                    </label>
                    {metric in draft.disabled_metrics && (
                      <label>
                        停用原因
                        <input
                          value={
                            draft.disabled_metrics[
                              metric as OptionalDailyMetric
                            ] ?? ""
                          }
                          onChange={(e) =>
                            patch({
                              disabled_metrics: {
                                ...draft.disabled_metrics,
                                [metric]: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <p>
            当前合计 {(weightTotal * 100).toFixed(1)}%{" "}
            <button
              type="button"
              disabled={weightTotal <= 0 || weights.water <= 0}
              onClick={() =>
                patch({
                  weights: Object.fromEntries(
                    DAILY_METRICS.map((k) => [k, weights[k] / weightTotal]),
                  ) as typeof weights,
                })
              }
            >
              按当前比例归一化为 100%
            </button>
          </p>
          <p className={styles.help}>
            关闭收益等可选指标不会免除作物产量、气候适宜性、供水、设备等必需资料。
          </p>
        </details>
        <div id="daily-profile" className={styles.benchmark}>
          <strong>
            {profile.scope === "benchmark_not_locally_calibrated"
              ? "当前是工程基准，试点地区尚未确定"
              : "地区参数包"}
          </strong>
          <p>
            {profile.name} · {profile.region} · {profile.timezone}
          </p>
          <details>
            <summary>参数、来源与计算限制</summary>
            <ul>
              {profile.limitations.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
            {Object.entries(profile.crops).map(([id, crop]) => (
              <p key={id}>
                {crop.name} · 播种窗口{" "}
                {crop.sow_windows.map((w) => w.join("—")).join("、")} · 产量估计{" "}
                {crop.yield_kg_ha} kg/ha ·{" "}
                {crop.economics
                  ? `价格 ${crop.economics.price_usd_kg} USD/kg，成本 ${crop.economics.cost_usd_ha} USD/ha`
                  : "收益资料未提供"}
              </p>
            ))}
            {Object.values(profile.sources).map((source) => (
              <p key={source.id}>
                {source.title} · {source.locator}
              </p>
            ))}
          </details>
          {profile.scope === "benchmark_not_locally_calibrated" && (
            <>
              <p>
                可明确填入演示所需的缺失经营值。该操作不会修改已保存地块，不会把假设标为实测，也不会覆盖已填写的值。
              </p>
              <button
                type="button"
                onClick={() => {
                  try {
                    replaceDraft(
                      applyEngineeringFixture(draft, fields, profile),
                    );
                  } catch (cause) {
                    setLocalError(errorMessage(cause));
                  }
                }}
              >
                仅为演示：填入缺少的工程假设
              </button>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={draft.accept_engineering_assumptions}
                  onChange={(e) =>
                    patch({ accept_engineering_assumptions: e.target.checked })
                  }
                />
                我理解并接受当前工程参数、独立初始水分和 UTC 日聚合近似的限制
              </label>
            </>
          )}
        </div>
      </fieldset>
      <section id="daily-check">
        <div className={styles.dailyActionBar}>
          <button
            type="button"
            disabled={
              planning.checking ||
              planning.submitting ||
              Boolean(planning.pending)
            }
            onClick={() => void planning.check()}
          >
            {planning.checking ? "正在检查资料…" : "检查资料是否足以计算"}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={
              !planning.readiness?.ready ||
              planning.submitting ||
              Boolean(planning.pending) ||
              planning.runActive
            }
            onClick={() => void planning.submit()}
          >
            {planning.submitting ? "正在提交…" : "生成轮作方案"}
          </button>
        </div>
        {(localError || planning.error) && (
          <p className={styles.error} role="alert">
            {localError ?? planning.error}
          </p>
        )}
        {Object.values(dirtyHistory).some(Boolean) && (
          <p className={styles.notice}>
            前茬修改尚未保存。请先保存或放弃，再检查资料。
          </p>
        )}
        {planning.runActive && (
          <p className={styles.notice}>
            计算仍在进行，可以在结果区查看进度或取消。
          </p>
        )}
        {planning.readiness && (
          <DailyReadinessPanel report={planning.readiness} fields={fields} />
        )}
        <p className={styles.help}>
          草稿按账号保存在此浏览器。检查通过后，提交时仍会重新核对版本和数据，防止使用过期资料。
        </p>
      </section>
    </section>
  );
}
