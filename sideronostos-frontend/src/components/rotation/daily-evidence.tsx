"use client";
import type {
  DailyCapacity,
  EvidenceSource,
  RecordedValue,
} from "@/lib/api/daily-types";
import { numberRecord, suppliedRecord, unknownRecord } from "./daily-model";
import styles from "./workspace.module.css";

export const sourceKindLabels: Record<EvidenceSource["kind"], string> = {
  farmer_record: "农户记录",
  expert_reference: "专业资料",
  observation: "观测 / 检测",
  model_estimate: "模型估计",
  engineering_assumption: "工程假设",
};
export function EvidenceValue({
  label,
  unit,
  kind = "number",
  options,
  value,
  sources,
  defaultSource,
  onChange,
}: {
  label: string;
  unit: string;
  kind?: "number" | "boolean" | "text";
  options?: [string, string][];
  value?: RecordedValue;
  sources: Record<string, EvidenceSource>;
  defaultSource?: string;
  onChange: (value: RecordedValue) => void;
}) {
  const current = value ?? unknownRecord(unit);
  const origin = current.source_ids.length
    ? current.source_ids
    : defaultSource
      ? [defaultSource]
      : [];
  function change(text: string) {
    const next =
      text === ""
        ? { ...unknownRecord(unit), source_ids: origin }
        : kind === "number"
          ? numberRecord(text, unit, origin)
          : suppliedRecord(
              kind === "boolean" ? text === "true" : text,
              unit,
              origin,
            );
    onChange(next);
  }
  const shown = current.value == null ? "" : String(current.value);
  return (
    <div className={styles.evidenceValue}>
      <label>
        {label}
        {!["1", "category", "text"].includes(unit) && ` · ${unit}`}
        {options || kind === "boolean" ? (
          <select value={shown} onChange={(e) => change(e.target.value)}>
            <option value="">尚不清楚</option>
            {(
              options ?? [
                ["true", "是"],
                ["false", "否"],
              ]
            ).map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={kind === "number" ? "number" : "text"}
            step={kind === "number" ? "any" : undefined}
            value={shown}
            onChange={(e) => change(e.target.value)}
          />
        )}
      </label>
      <label className={styles.help}>
        该值的来源
        <select
          aria-label={`${label}来源`}
          value={current.source_ids[0] ?? ""}
          onChange={(e) =>
            onChange({
              ...current,
              source_ids: e.target.value ? [e.target.value] : [],
            })
          }
        >
          <option value="">尚未关联来源</option>
          {Object.values(sources).map((s) => (
            <option key={s.id} value={s.id}>
              {sourceKindLabels[s.kind]} · {s.title || "未命名资料"}
            </option>
          ))}
        </select>
      </label>
      {current.source_ids.some(
        (id) => sources[id]?.kind === "engineering_assumption",
      ) && <small>工程假设，未经田间校准</small>}
      {current.value === null && (
        <label className={styles.help}>
          缺少原因
          <input
            aria-label={`${label}缺少原因`}
            value={current.missing_reason ?? ""}
            onChange={(e) =>
              onChange({ ...current, missing_reason: e.target.value })
            }
          />
        </label>
      )}
    </div>
  );
}
export function CapacityEditor({
  label,
  unit,
  value,
  sources,
  defaultSource,
  onChange,
}: {
  label: string;
  unit: "m3/day" | "h/day" | "kg" | "day";
  value: DailyCapacity;
  sources: Record<string, EvidenceSource>;
  defaultSource?: string;
  onChange: (value: DailyCapacity) => void;
}) {
  const costUnit = {
    "m3/day": "USD/m3",
    "h/day": "USD/h",
    kg: "USD/kg",
    day: "USD/day",
  }[unit];
  return (
    <fieldset className={styles.resources}>
      <legend>{label}</legend>
      <EvidenceValue
        label="可用上限"
        unit={unit}
        value={value.amount}
        sources={sources}
        defaultSource={defaultSource}
        onChange={(amount) => onChange({ ...value, amount })}
      />
      <label>
        不足时能否补救？
        <select
          value={value.remediable === null ? "" : String(value.remediable)}
          onChange={(e) =>
            onChange({
              ...value,
              remediable:
                e.target.value === "" ? null : e.target.value === "true",
              ...(e.target.value !== "true"
                ? { gap_unit_cost: null, remedy: null }
                : {}),
            })
          }
        >
          <option value="">尚未确认</option>
          <option value="false">不能补救（硬上限）</option>
          <option value="true">可补救，需明确成本与条件</option>
        </select>
      </label>
      {value.remediable && (
        <>
          <EvidenceValue
            label={
              unit === "m3/day"
                ? "每单位净水缺口的补救成本"
                : "每单位缺口的补救成本"
            }
            unit={costUnit}
            value={value.gap_unit_cost ?? undefined}
            sources={sources}
            defaultSource={defaultSource}
            onChange={(gap_unit_cost) => onChange({ ...value, gap_unit_cost })}
          />
          <EvidenceValue
            label="补救条件"
            kind="text"
            unit="text"
            value={value.remedy ?? undefined}
            sources={sources}
            defaultSource={defaultSource}
            onChange={(remedy) => onChange({ ...value, remedy })}
          />
        </>
      )}
    </fieldset>
  );
}
export function SourcesEditor({
  sources,
  region,
  start,
  end,
  defaultSource,
  onDefaultSource,
  onChange,
}: {
  sources: Record<string, EvidenceSource>;
  region: string;
  start: string;
  end: string;
  defaultSource: string;
  onDefaultSource: (id: string) => void;
  onChange: (value: Record<string, EvidenceSource>) => void;
}) {
  const patch = (id: string, value: Partial<EvidenceSource>) =>
    onChange({
      ...sources,
      [id]: { ...sources[id], confirmed: false, ...value },
    });
  return (
    <section className={styles.formBlock}>
      <h2>资料来源与确认</h2>
      <p className={styles.help}>
        记录土壤检测、经营台账或参考资料。来源的适用时间需覆盖规划期；来源类型和确认状态会进入计算快照。
      </p>
      {Object.values(sources).map((s) => (
        <details className={styles.details} key={s.id}>
          <summary>
            {s.title || "待补充的资料来源"} · {sourceKindLabels[s.kind]} ·{" "}
            {s.confirmed ? "已确认" : "待确认"}
          </summary>
          {s.id === "engineering-fixture" ? (
            <p>
              {s.limitations.join(" ")}{" "}
              工程演示来源保留其原始标签；实际资料请另建来源。
            </p>
          ) : (
            <>
              <div className={styles.twoColumns}>
                <label>
                  资料名称
                  <input
                    value={s.title}
                    maxLength={300}
                    onChange={(e) => patch(s.id, { title: e.target.value })}
                  />
                </label>
                <label>
                  记录位置或参考链接
                  <input
                    value={s.locator}
                    maxLength={1000}
                    onChange={(e) => patch(s.id, { locator: e.target.value })}
                  />
                </label>
                <label>
                  来源类型
                  <select
                    value={s.kind}
                    onChange={(e) =>
                      patch(s.id, {
                        kind: e.target.value as EvidenceSource["kind"],
                        confirmed: false,
                      })
                    }
                  >
                    {Object.entries(sourceKindLabels).map(([id, label]) => (
                      <option value={id} key={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  资料质量
                  <select
                    value={s.quality}
                    onChange={(e) =>
                      patch(s.id, {
                        quality: e.target.value as EvidenceSource["quality"],
                        confirmed: false,
                      })
                    }
                  >
                    <option value="confirmed">已确认</option>
                    <option value="estimated">估计值</option>
                    <option value="missing">缺失</option>
                    <option value="rejected">不适用</option>
                  </select>
                </label>
                <label>
                  适用开始
                  <input
                    type="date"
                    value={s.applicable_start ?? ""}
                    onChange={(e) =>
                      patch(s.id, {
                        applicable_start: e.target.value || null,
                        confirmed: false,
                      })
                    }
                  />
                </label>
                <label>
                  适用结束
                  <input
                    type="date"
                    value={s.applicable_end ?? ""}
                    onChange={(e) =>
                      patch(s.id, {
                        applicable_end: e.target.value || null,
                        confirmed: false,
                      })
                    }
                  />
                </label>
                <label>
                  观测 / 记录开始（可选）
                  <input
                    type="date"
                    value={s.observed_start ?? ""}
                    onChange={(e) =>
                      patch(s.id, {
                        observed_start: e.target.value || null,
                        confirmed: false,
                      })
                    }
                  />
                </label>
                <label>
                  观测 / 记录结束（可选）
                  <input
                    type="date"
                    value={s.observed_end ?? ""}
                    onChange={(e) =>
                      patch(s.id, {
                        observed_end: e.target.value || null,
                        confirmed: false,
                      })
                    }
                  />
                </label>
              </div>
              <label>
                适用范围与限制
                <textarea
                  value={s.limitations.join("\n")}
                  onChange={(e) =>
                    patch(s.id, {
                      limitations: e.target.value.split("\n"),
                      confirmed: false,
                    })
                  }
                />
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={s.confirmed}
                  onChange={(e) => patch(s.id, { confirmed: e.target.checked })}
                />
                我已核对这份资料的来源、时间和限制
              </label>
            </>
          )}
        </details>
      ))}
      <button
        type="button"
        onClick={() => {
          const id = `source-${crypto.randomUUID()}`;
          onChange({
            ...sources,
            [id]: {
              id,
              kind: "farmer_record",
              title: "",
              locator: "",
              region_id: region,
              applicable_start: start,
              applicable_end: end,
              quality: "confirmed",
              confirmed: false,
              limitations: [""],
            },
          });
          onDefaultSource(id);
        }}
      >
        添加资料来源
      </button>
      <label>
        接下来填写的数据来自
        <select
          value={defaultSource}
          onChange={(e) => onDefaultSource(e.target.value)}
        >
          <option value="">逐项指定</option>
          {Object.values(sources)
            .filter((s) => s.id !== "engineering-fixture")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "待补充的资料来源"}
              </option>
            ))}
        </select>
      </label>
    </section>
  );
}
