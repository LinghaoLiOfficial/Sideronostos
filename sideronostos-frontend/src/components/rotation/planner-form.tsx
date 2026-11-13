"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { LoaderCircle, Plus, RotateCcw, Sprout, X } from "lucide-react";
import type { Field } from "@/lib/api/field-shift-types";
import type {
  ChangedCondition,
  ProfileV2,
  ResourceLimit,
  RotationInput,
  RunV2,
} from "@/lib/api/rotation-types";
import * as api from "@/lib/api/rotation";
import { ApiError } from "@/lib/api/client";
import { errorMessage } from "../field-shift/model";
import {
  blankLimit,
  buildRequest,
  draftChanges,
  draftFromRun,
  emptyDraft,
  limitLabels,
  planningYears,
  readDraft,
  saveDraft,
  type PlannerDraft,
  type TextLimit,
} from "./planning-model";
import { HistoryEditor } from "./history-editor";
import styles from "./workspace.module.css";
import { DailyPlannerForm, type DailyPlannerProps } from "./daily-planner";

type Props = {
  owner: string;
  profile: ProfileV2;
  fields: Field[];
  run?: RunV2;
  selectedFieldId?: string;
  onRun: (run: RunV2) => void;
  onDraft: (
    changes: ChangedCondition[],
    fields: RotationInput["fields"],
  ) => void;
  onFieldSaved: (field: Field) => void;
};
export function ResourceInputs({
  label,
  value,
  onChange,
  required = true,
}: {
  label: string;
  value: TextLimit;
  onChange: (value: TextLimit) => void;
  required?: boolean;
}) {
  return (
    <fieldset className={styles.resources}>
      <legend>{label}</legend>
      {(Object.keys(limitLabels) as (keyof ResourceLimit)[]).map((key) => (
        <label key={key}>
          {limitLabels[key]}
          <input
            type="number"
            required={required}
            min="0"
            step="any"
            inputMode="decimal"
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
    </fieldset>
  );
}
function LegacyPlannerForm({
  owner,
  profile,
  fields,
  run,
  selectedFieldId,
  onRun,
  onDraft,
  onFieldSaved,
}: Props) {
  const [draft, setDraft] = useState<PlannerDraft>(() => {
    const stored = readDraft(owner, profile);
    if (stored) return stored;
    if (run) return draftFromRun(run.request);
    const initial = emptyDraft(profile),
      field = fields.find((f) => f.id === selectedFieldId);
    if (field)
      initial.fields = [
        {
          id: field.id,
          expected_version: field.version,
          require_crop: true,
          history_reviewed: false,
        },
      ];
    return initial;
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [storageError, setStorageError] = useState(false);
  const [uncertain, setUncertain] = useState<RotationInput | null>(() => {
    try {
      const pending = JSON.parse(
        localStorage.getItem(`rotation-pending:${owner}`) ?? "null",
      );
      return pending?.profile_id === profile.id ? pending : null;
    } catch {
      return null;
    }
  });
  const [dirtyHistory, setDirtyHistory] = useState<Record<string, boolean>>({});
  const onHistoryDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyHistory((old) =>
      Boolean(old[id]) === dirty ? old : { ...old, [id]: dirty },
    );
  }, []);
  const hasUnsavedHistory = draft.fields.some((f) => dirtyHistory[f.id]);
  const runActive = run?.status === "pending" || run?.status === "running";
  const mounted = useRef(true),
    inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onDraft(run ? draftChanges(run.request, draft) : [], draft.fields);
  }, [draft, run, onDraft]);
  function replaceDraft(next: PlannerDraft) {
    setDraft(next);
    try {
      saveDraft(owner, profile, next);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  const years = planningYears(draft.start, draft.end);
  const patch = (value: Partial<PlannerDraft>) =>
    replaceDraft({ ...draft, ...value });
  function fieldChange(
    id: string,
    value: Partial<RotationInput["fields"][number]>,
  ) {
    patch({
      fields: draft.fields.map((f) => (f.id === id ? { ...f, ...value } : f)),
    });
  }
  async function submit(event?: FormEvent, previous?: RotationInput) {
    event?.preventDefault();
    if (inFlight.current) return;
    setError(null);
    if (!previous && hasUnsavedHistory) {
      setError("请先保存或放弃前茬修改，再生成轮作方案。");
      return;
    }
    if (!previous && runActive) {
      setError("当前计算仍在进行，请等待结果或在结果区取消后再提交。");
      return;
    }
    let request: RotationInput;
    try {
      request =
        previous ?? buildRequest(draft, profile, fields, crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请检查规划条件。");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      try {
        localStorage.setItem(
          `rotation-pending:${owner}`,
          JSON.stringify(request),
        );
      } catch {
        setStorageError(true);
      }
      const created = await api.createRun(request);
      if (!mounted.current) return;
      setUncertain(null);
      try {
        localStorage.removeItem(`rotation-pending:${owner}`);
      } catch {}
      onRun(created);
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause));
        if (!(cause instanceof ApiError) || cause.status >= 500)
          setUncertain(request);
        else {
          setUncertain(null);
          try {
            localStorage.removeItem(`rotation-pending:${owner}`);
          } catch {}
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      className={styles.formSection}
      id="planning-conditions"
      tabIndex={-1}
      aria-labelledby="planning-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>PLAN YOUR NEXT CROP</p>
          <h1 id="planning-title">安排下一轮种植</h1>
          <p>先核对地块，再按你的日期和资源比较可行种法。</p>
        </div>
        <Sprout size={28} />
      </div>
      {storageError && (
        <p className={styles.notice}>
          浏览器暂时无法保存草稿。请保持页面打开，已提交的计算仍保存在服务器。
        </p>
      )}
      {run && (
        <button
          className={styles.linkButton}
          type="button"
          disabled={busy}
          onClick={() => {
            replaceDraft(draftFromRun(run.request));
            setError(null);
          }}
        >
          <RotateCcw size={14} />
          载入当前计算的原始条件
        </button>
      )}
      {uncertain && (
        <div className={styles.notice} role="status">
          上次提交结果尚未确认。恢复会使用同一个请求编号，不会重复创建计算。
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(undefined, uncertain)}
          >
            恢复上次提交
          </button>
        </div>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <fieldset
          disabled={busy || Boolean(uncertain)}
          className={styles.unstyledFieldset}
        >
          <section className={styles.formBlock}>
            <h2>1. 地块与前茬</h2>
            <p className={styles.help}>
              选择的是你已保存的经营地块。地图上画出的区域不会自动加入计算。
            </p>
            {!fields.length ? (
              <p>
                还没有地块。
                <Link href="/field-shift?field=new">先创建地块</Link>
              </p>
            ) : (
              fields.map((field) => {
                const choice = draft.fields.find((f) => f.id === field.id),
                  changed = Boolean(
                    choice && choice.expected_version !== field.version,
                  );
                return (
                  <div className={styles.fieldChoice} key={field.id}>
                    <label className={styles.checkLabel}>
                      <input
                        type="checkbox"
                        checked={Boolean(choice)}
                        onChange={(e) =>
                          patch({
                            fields: e.target.checked
                              ? [
                                  ...draft.fields,
                                  {
                                    id: field.id,
                                    expected_version: field.version,
                                    require_crop: true,
                                    history_reviewed: false,
                                  },
                                ]
                              : draft.fields.filter((f) => f.id !== field.id),
                          })
                        }
                      />
                      <span>
                        <strong>{field.name}</strong>
                        <small>
                          {field.area_ha} ha ·{" "}
                          {field.irrigation_available ? "可灌溉" : "无灌溉条件"}
                        </small>
                      </span>
                      <Link
                        href={`/field-shift?field=${encodeURIComponent(field.id)}`}
                      >
                        编辑地块
                      </Link>
                    </label>
                    {choice && (
                      <div className={styles.fieldDetails}>
                        <HistoryEditor
                          key={`${field.id}:${field.version}`}
                          field={field}
                          profile={profile}
                          onSaved={onFieldSaved}
                          onDirtyChange={onHistoryDirty}
                        />
                        {changed && (
                          <p className={styles.notice}>
                            地块已更新，请重新核对历史与面积。
                          </p>
                        )}
                        <label className={styles.checkLabel}>
                          <input
                            type="checkbox"
                            checked={choice.history_reviewed && !changed}
                            onChange={(e) =>
                              fieldChange(field.id, {
                                history_reviewed: e.target.checked,
                                expected_version: field.version,
                              })
                            }
                          />
                          已核对面积与前茬记录，缺少历史时已确认其原因
                        </label>
                        <label className={styles.checkLabel}>
                          <input
                            type="checkbox"
                            checked={!choice.require_crop}
                            onChange={(e) =>
                              fieldChange(field.id, {
                                require_crop: !e.target.checked,
                              })
                            }
                          />
                          允许这块地在整个规划期休耕
                        </label>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>
          <section className={styles.formBlock}>
            <h2>2. 日期与候选作物</h2>
            <div className={styles.twoColumns}>
              <label>
                规划开始
                <input
                  type="date"
                  required
                  min="2000-01-01"
                  max="2197-12-31"
                  value={draft.start}
                  onChange={(e) => patch({ start: e.target.value })}
                />
              </label>
              <label>
                规划结束
                <input
                  type="date"
                  required
                  min={draft.start}
                  value={draft.end}
                  onChange={(e) => patch({ end: e.target.value })}
                />
              </label>
            </div>
            <p className={styles.help}>
              最多三年。播种、成熟和换茬占用都必须落在规划期内。
            </p>
            <div className={styles.cropChoices}>
              {profile.crops.map((crop) => (
                <label key={crop.id} className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={draft.allowed_crop_ids.includes(crop.id)}
                    onChange={(e) => {
                      const windows = { ...draft.sow_windows };
                      if (!e.target.checked) delete windows[crop.id];
                      patch({
                        allowed_crop_ids: e.target.checked
                          ? [...draft.allowed_crop_ids, crop.id]
                          : draft.allowed_crop_ids.filter(
                              (id) => id !== crop.id,
                            ),
                        sow_windows: windows,
                      });
                    }}
                  />
                  {crop.name}
                </label>
              ))}
            </div>
            <details className={styles.details}>
              <summary>缩小可播种时间窗口</summary>
              <p className={styles.help}>
                月-日格式；只可在参数包的范围内缩小窗口。
              </p>
              {profile.crops
                .filter((c) => draft.allowed_crop_ids.includes(c.id))
                .map((crop) => (
                  <div key={crop.id} className={styles.sowingRow}>
                    <strong>{crop.name}</strong>
                    <label>
                      最早
                      <input
                        aria-label={`${crop.name}最早播种`}
                        pattern="\d{2}-\d{2}"
                        value={
                          draft.sow_windows[crop.id]?.[0] ?? crop.sow_start_mmdd
                        }
                        onChange={(e) =>
                          patch({
                            sow_windows: {
                              ...draft.sow_windows,
                              [crop.id]: [
                                e.target.value,
                                draft.sow_windows[crop.id]?.[1] ??
                                  crop.sow_end_mmdd,
                              ],
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      最晚
                      <input
                        aria-label={`${crop.name}最晚播种`}
                        pattern="\d{2}-\d{2}"
                        value={
                          draft.sow_windows[crop.id]?.[1] ?? crop.sow_end_mmdd
                        }
                        onChange={(e) =>
                          patch({
                            sow_windows: {
                              ...draft.sow_windows,
                              [crop.id]: [
                                draft.sow_windows[crop.id]?.[0] ??
                                  crop.sow_start_mmdd,
                                e.target.value,
                              ],
                            },
                          })
                        }
                      />
                    </label>
                    <small>
                      参数范围 {crop.sow_start_mmdd}—{crop.sow_end_mmdd}
                    </small>
                  </div>
                ))}
            </details>
          </section>
          <section className={styles.formBlock}>
            <h2>3. 每年可用多少资源？</h2>
            <p className={styles.help}>
              以下是所选地块合计的年度上限。水量用立方米，投入用美元，劳力用人日；不是每公顷的额度。
            </p>
            {years.map((year) => (
              <ResourceInputs
                key={year}
                label={`${year} 年 · 全部已选地块`}
                value={draft.farm_limits[year] ?? blankLimit()}
                onChange={(v) =>
                  patch({ farm_limits: { ...draft.farm_limits, [year]: v } })
                }
              />
            ))}
            {!years.length && (
              <p className={styles.notice}>请先填写有效的规划日期。</p>
            )}
            <details className={styles.details}>
              <summary>为个别地块增加资源上限（可选）</summary>
              {draft.fields.map((choice) => (
                <div key={choice.id}>
                  <h3>
                    {fields.find((f) => f.id === choice.id)?.name ??
                      "已不可用的地块"}
                  </h3>
                  {years.map((year) => {
                    const value = draft.field_limits[choice.id]?.[year];
                    return (
                      <div key={year}>
                        <label className={styles.checkLabel}>
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(e) => {
                              const caps = {
                                ...(draft.field_limits[choice.id] ?? {}),
                              };
                              if (e.target.checked) caps[year] = blankLimit();
                              else delete caps[year];
                              const limits = { ...draft.field_limits };
                              if (Object.keys(caps).length)
                                limits[choice.id] = caps;
                              else delete limits[choice.id];
                              patch({ field_limits: limits });
                            }}
                          />
                          对 {year} 年单独设限
                        </label>
                        {value && (
                          <ResourceInputs
                            label={`${year} 年 · 此地块`}
                            value={value}
                            onChange={(v) =>
                              patch({
                                field_limits: {
                                  ...draft.field_limits,
                                  [choice.id]: {
                                    ...draft.field_limits[choice.id],
                                    [year]: v,
                                  },
                                },
                              })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </details>
          </section>
          <section className={styles.formBlock}>
            <h2>4. 和你原本的种法比较</h2>
            <p className={styles.help}>
              可逐季填写原计划。留空则不进行基准比较；不满足约束的基准会保留并说明原因。
            </p>
            {draft.baseline.map((item, index) => (
              <div key={index} className={styles.baselineRow}>
                <label>
                  地块
                  <select
                    required
                    value={item.field_id}
                    onChange={(e) =>
                      patch({
                        baseline: draft.baseline.map((b, i) =>
                          i === index ? { ...b, field_id: e.target.value } : b,
                        ),
                      })
                    }
                  >
                    <option value="">选择地块</option>
                    {draft.fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {fields.find((v) => v.id === f.id)?.name ?? f.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  作物
                  <select
                    value={item.crop_id}
                    onChange={(e) =>
                      patch({
                        baseline: draft.baseline.map((b, i) =>
                          i === index ? { ...b, crop_id: e.target.value } : b,
                        ),
                      })
                    }
                  >
                    {profile.crops.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  播种日期
                  <input
                    type="date"
                    required
                    min={draft.start}
                    max={draft.end}
                    value={item.sow_date}
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
                  aria-label={`删除基准第 ${index + 1} 季`}
                  onClick={() =>
                    patch({
                      baseline: draft.baseline.filter((_, i) => i !== index),
                    })
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={!draft.fields.length || draft.baseline.length >= 60}
              onClick={() =>
                patch({
                  baseline: [
                    ...draft.baseline,
                    {
                      field_id: draft.fields[0].id,
                      crop_id: profile.crops[0].id,
                      sow_date: "",
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              加入一季
            </button>
          </section>
          <details className={styles.details}>
            <summary>天气情景与偏好</summary>
            <p className={styles.help}>
              在已发布的历史天气上做情景调整，不是未来天气预测。偏好只影响可行方案之间的排序。
            </p>
            <div className={styles.twoColumns}>
              <label>
                气温变化（°C）
                <input
                  type="number"
                  step="0.1"
                  min="-3"
                  max="5"
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
                降雨变化（%）
                <input
                  type="number"
                  step="1"
                  min="-50"
                  max="50"
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
            <div className={styles.twoColumns}>
              {(["cover", "diversity", "water", "cost"] as const).map(
                (key, i) => (
                  <label key={key}>
                    {
                      [
                        "增加土地覆盖",
                        "增加作物科属多样性",
                        "降低用水估计",
                        "降低投入估计",
                      ][i]
                    }
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      value={(draft.weights ?? profile.default_weights)[key]}
                      onChange={(e) =>
                        patch({
                          weights: {
                            ...(draft.weights ?? profile.default_weights),
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ),
              )}
            </div>
          </details>
          <div className={styles.benchmark}>
            <strong>当前使用研发参数包</strong>
            <p>
              {profile.name} · 历史天气 {profile.weather_release_id}
            </p>
            <p>
              试点地区尚未确定。该包仅支持已声明范围内的比较，成本、劳力及部分农艺参数仍是明确标注的假设。
            </p>
            <details>
              <summary>适用范围与来源</summary>
              <p>{profile.scope}</p>
              <ul>
                {profile.limitations.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              {Object.entries(profile.sources).map(([id, source]) => (
                <p key={id}>
                  {id} · {source.title}
                  {source.url && /^https?:\/\//.test(source.url) && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={source.url} target="_blank" rel="noreferrer">
                        原文
                      </a>
                    </>
                  )}
                </p>
              ))}
            </details>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={draft.accept_benchmark_assumptions}
                onChange={(e) =>
                  patch({ accept_benchmark_assumptions: e.target.checked })
                }
              />
              我理解这些估计的范围，并将根据当地实际情况核对
            </label>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {hasUnsavedHistory && (
          <p className={styles.notice} role="status">
            前茬记录尚未保存，请先保存或放弃修改。计算只使用服务器上已保存的记录。
          </p>
        )}
        {runActive && (
          <p className={styles.notice} role="status">
            当前计算仍在进行。你可以继续编辑草稿，等待结果或在结果区取消后再提交。
          </p>
        )}
        <div className={styles.submitRow}>
          <button
            className={styles.primary}
            type="submit"
            disabled={
              busy || Boolean(uncertain) || hasUnsavedHistory || runActive
            }
          >
            {runActive ? (
              "计算进行中"
            ) : busy ? (
              <>
                <LoaderCircle size={17} />
                正在提交…
              </>
            ) : run ? (
              "按当前条件重新计算"
            ) : (
              "生成轮作方案"
            )}
          </button>
          <span>仅点击后计算 · 草稿自动保存在此浏览器</span>
        </div>
      </form>
    </section>
  );
}

export function PlannerForm(
  props: Props | (DailyPlannerProps & { version: "v3" }),
) {
  if ("version" in props) return <DailyPlannerForm {...props} />;
  return <LegacyPlannerForm {...props} />;
}
