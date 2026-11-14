"use client";
import { useState } from "react";
import type { Field } from "@/lib/api/field-shift-types";
import type { ServerFarmHeader } from "@/lib/api/farms";
import type {
  DailyDraft,
  DailyFarmResources,
  DailyProfile,
  DailyResource,
} from "@/lib/api/daily-types";
import { blankCapacity, unknownRecord } from "./daily-model";
import { CapacityEditor, EvidenceValue } from "./daily-evidence";
import styles from "./workspace.module.css";

function CalendarEditor({
  label,
  value,
  sources,
  defaultSource,
  fields,
  onChange,
  onRemove,
}: {
  label: string;
  value: DailyResource;
  sources: DailyDraft["sources"];
  defaultSource: string;
  fields: Field[];
  onChange: (resource: DailyResource) => void;
  onRemove: () => void;
}) {
  const [date, setDate] = useState("");
  const unit = value.kind === "water" ? "m3/day" : "h/day";
  return (
    <details className={styles.dailyPanel}>
      <summary>
        {label} · {value.field_ids.length} 个地块共享
      </summary>
      <button type="button" onClick={onRemove}>
        移除此资源
      </button>
      <fieldset className={styles.unstyledFieldset}>
        <legend>资源覆盖的地块（该上限由这些地块共享）</legend>
        {fields.map((f) => (
          <label className={styles.checkLabel} key={f.id}>
            <input
              type="checkbox"
              checked={value.field_ids.includes(f.id)}
              onChange={(e) =>
                onChange({
                  ...value,
                  field_ids: e.target.checked
                    ? [...value.field_ids, f.id]
                    : value.field_ids.filter((id) => id !== f.id),
                })
              }
            />
            {f.name}
          </label>
        ))}
      </fieldset>
      {value.kind === "water" && (
        <>
          <label>
            水量口径
            <select
              value={value.water_basis ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  water_basis: (e.target.value ||
                    null) as DailyResource["water_basis"],
                  irrigation_efficiency:
                    e.target.value === "gross"
                      ? value.irrigation_efficiency
                      : null,
                })
              }
            >
              <option value="">尚未确认</option>
              <option value="net">净水量：到达根区的水</option>
              <option value="gross">毛水量：从水源取用的水</option>
            </select>
          </label>
          {value.water_basis === "gross" && (
            <EvidenceValue
              label="灌溉效率（0–1）"
              unit="1"
              value={value.irrigation_efficiency ?? undefined}
              sources={sources}
              defaultSource={defaultSource}
              onChange={(irrigation_efficiency) =>
                onChange({ ...value, irrigation_efficiency })
              }
            />
          )}
        </>
      )}
      <CapacityEditor
        label="通常每天的可用量"
        unit={unit}
        value={value.default}
        sources={sources}
        defaultSource={defaultSource}
        onChange={(next) => onChange({ ...value, default: next })}
      />
      <details className={styles.details}>
        <summary>特定日期的例外</summary>
        <p className={styles.help}>
          例外值会替换当天的通常可用量，例如设备检修日填写
          0。不能补救的硬上限仍然生效。
        </p>
        {Object.entries(value.overrides).map(([day, amount]) => (
          <div key={day}>
            <EvidenceValue
              label={day}
              unit={unit}
              value={amount}
              sources={sources}
              defaultSource={defaultSource}
              onChange={(next) =>
                onChange({
                  ...value,
                  overrides: { ...value.overrides, [day]: next },
                })
              }
            />
            <button
              type="button"
              onClick={() => {
                const overrides = { ...value.overrides };
                delete overrides[day];
                onChange({ ...value, overrides });
              }}
            >
              移除 {day} 例外
            </button>
          </div>
        ))}
        <label>
          例外日期
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!date || Boolean(value.overrides[date])}
          onClick={() => {
            onChange({
              ...value,
              overrides: { ...value.overrides, [date]: unknownRecord(unit) },
            });
            setDate("");
          }}
        >
          加入日期例外
        </button>
      </details>
    </details>
  );
}
export function DailyResourcesEditor({
  draft,
  profile,
  farms,
  fields,
  defaultSource,
  onChange,
}: {
  draft: DailyDraft;
  profile: DailyProfile;
  farms: ServerFarmHeader[];
  fields: Field[];
  defaultSource: string;
  onChange: (resources: DailyDraft["farm_resources"]) => void;
}) {
  const machineTypes = [
    ...new Set(
      draft.allowed_crop_ids.flatMap(
        (c) => profile.crops[c]?.operations.map((o) => o.machine) ?? [],
      ),
    ),
  ];
  const patch = (id: string, farm: DailyFarmResources) =>
    onChange({ ...draft.farm_resources, [id]: farm });
  return (
    <section className={styles.formBlock} id="daily-resources">
      <h2>共享资源与分期供需</h2>
      <p className={styles.help}>
        供水与农机按实际作业日检查；种子按播种期、市场按收获期检查。各农场分别核算，同一资源的额度由勾选地块共同使用。
      </p>
      {Object.entries(draft.farm_resources).map(([farmId, farm]) => (
        <section
          key={farmId}
          aria-label={farms.find((f) => f.id === farmId)?.name ?? "农场资源"}
        >
          <h3>{farms.find((f) => f.id === farmId)?.name ?? farmId}</h3>
          {Object.entries(farm.daily).map(([id, resource]) => (
            <CalendarEditor
              key={id}
              label={`${resource.kind === "water" ? "水源" : resource.machine_type === "tractor" ? "拖拉机" : resource.machine_type === "harvester" ? "收获机" : resource.machine_type} ${
                Object.entries(farm.daily)
                  .filter(
                    ([, r]) =>
                      r.kind === resource.kind &&
                      r.machine_type === resource.machine_type,
                  )
                  .findIndex(([key]) => key === id) + 1
              } · ${id.slice(-8)}`}
              value={resource}
              onRemove={() => {
                const daily = { ...farm.daily };
                delete daily[id];
                patch(farmId, { ...farm, daily });
              }}
              fields={fields.filter(
                (f) =>
                  f.farm_id === farmId &&
                  draft.fields.some((c) => c.id === f.id),
              )}
              sources={draft.sources}
              defaultSource={defaultSource}
              onChange={(next) =>
                patch(farmId, { ...farm, daily: { ...farm.daily, [id]: next } })
              }
            />
          ))}
          <label>
            增加独立资源
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const kind = e.target.value === "water" ? "water" : "machine";
                const id = `resource-${crypto.randomUUID()}`;
                patch(farmId, {
                  ...farm,
                  daily: {
                    ...farm.daily,
                    [id]: {
                      kind,
                      ...(kind === "machine"
                        ? { machine_type: e.target.value }
                        : { water_basis: null }),
                      field_ids: [],
                      default: blankCapacity(
                        kind === "water" ? "m3/day" : "h/day",
                      ),
                      overrides: {},
                    },
                  },
                });
              }}
            >
              <option value="">选择资源种类…</option>
              <option value="water">另一个水源</option>
              {machineTypes.map((m) => (
                <option key={m} value={m}>
                  另一组 {m}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.help}>
            若添加独立资源，请核对各组地块归属。每块地只能归属一个水源，每类必需设备只能归属一组。
          </p>
          {draft.periods.map((period) => (
            <details key={period.id} className={styles.dailyPanel}>
              <summary>
                {period.start}—{period.end} · 种子与市场容量
              </summary>
              {farm.period_limits.map(
                (limit, index) =>
                  limit.period_id === period.id && (
                    <CapacityEditor
                      key={`${limit.kind}:${limit.crop_id}`}
                      label={`${profile.crops[limit.crop_id]?.name ?? limit.crop_id} · ${limit.kind === "seed" ? "可获得种子" : "可销售产量"}`}
                      unit="kg"
                      value={limit.limit}
                      sources={draft.sources}
                      defaultSource={defaultSource}
                      onChange={(value) =>
                        patch(farmId, {
                          ...farm,
                          period_limits: farm.period_limits.map((item, i) =>
                            i === index ? { ...item, limit: value } : item,
                          ),
                        })
                      }
                    />
                  ),
              )}
            </details>
          ))}
        </section>
      ))}
    </section>
  );
}
