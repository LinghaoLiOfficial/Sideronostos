"use client";
import Link from "next/link";
import type { Field } from "@/lib/api/field-shift-types";
import type {
  DailyDraft,
  DailyFieldConditions,
  DailyProfile,
} from "@/lib/api/daily-types";
import { FIELD_PARAMETERS } from "@/lib/api/daily-types";
import { blankCapacity, fieldParameters } from "./daily-model";
import { CapacityEditor, EvidenceValue } from "./daily-evidence";
import { HistoryEditor } from "./history-editor";
import { formatValue } from "./planning-model";
import styles from "./workspace.module.css";

export function DailyFieldEditor({
  field,
  conditions,
  draft,
  profile,
  defaultSource,
  onChange,
  onSaved,
  onHistoryDirty,
}: {
  field: Field;
  conditions: DailyFieldConditions;
  draft: DailyDraft;
  profile: DailyProfile;
  defaultSource: string;
  onChange: (conditions: DailyFieldConditions) => void;
  onSaved: (field: Field) => void;
  onHistoryDirty: (id: string, dirty: boolean) => void;
}) {
  const catalogue = {
    id: profile.id,
    history_catalogue: profile.history_catalogue,
    crops: Object.entries(profile.crops).map(([id, crop]) => ({
      id,
      name: crop.name,
    })),
  };
  const groups = [
    [
      "土壤与地形",
      FIELD_PARAMETERS.filter((k) =>
        [
          "field_capacity",
          "wilting_point",
          "depth_m",
          "ph",
          "salinity_ds_m",
          "drainage",
          "slope_deg",
          "aspect",
          "terrain_position",
          "effective_rain_fraction",
        ].includes(k),
      ),
    ],
    [
      "前茬、经营条件与水分假设",
      FIELD_PARAMETERS.filter(
        (k) =>
          ![
            "field_capacity",
            "wilting_point",
            "depth_m",
            "ph",
            "salinity_ds_m",
            "drainage",
            "slope_deg",
            "aspect",
            "terrain_position",
            "effective_rain_fraction",
          ].includes(k),
      ),
    ],
  ] as const;
  return (
    <details className={styles.dailyPanel} open>
      <summary>
        {field.name} · {formatValue(field.area_ha, 3)} ha · 地块版本{" "}
        {field.version}
      </summary>
      <p>
        土壤类型：{field.soil_texture} · 灌溉设施：
        {field.irrigation_available ? "已记录为有" : "已记录为无"} ·{" "}
        <Link href={`/fields?field=${encodeURIComponent(field.id)}`}>
          返回地图修改基本资料
        </Link>
      </p>
      <HistoryEditor
        key={`${field.id}:${field.version}`}
        field={field}
        profile={catalogue}
        onSaved={onSaved}
        onDirtyChange={onHistoryDirty}
      />
      {groups.map(([title, keys]) => (
        <details className={styles.details} key={title}>
          <summary>{title}</summary>
          <div className={styles.dailyGrid}>
            {keys.map((key) => (
              <EvidenceValue
                key={key}
                {...fieldParameters[key]}
                value={conditions.values[key]}
                sources={draft.sources}
                defaultSource={defaultSource}
                onChange={(value) =>
                  onChange({
                    ...conditions,
                    values: { ...conditions.values, [key]: value },
                  })
                }
              />
            ))}
          </div>
        </details>
      ))}
      <p className={styles.help}>
        初始水分采用每个候选独立从萎蔫点开始的保守假设；当前没有跨季连续土壤水量模拟。此前未种植必须有依据，未知历史不能当作空地。
      </p>
      <label>
        本地块所属水源
        <select
          disabled={!field.irrigation_available}
          value={conditions.water_system_id ?? ""}
          onChange={(e) =>
            onChange({ ...conditions, water_system_id: e.target.value || null })
          }
        >
          <option value="">无 / 尚未选择</option>
          {Object.entries(draft.farm_resources[field.farm_id!]?.daily ?? {})
            .filter(([, r]) => r.kind === "water")
            .map(([id], index) => (
              <option key={id} value={id}>
                水源 {index + 1} · {id.slice(-8)}
              </option>
            ))}
        </select>
      </label>
      <fieldset className={styles.unstyledFieldset}>
        <legend>禁止种植的作物</legend>
        <div className={styles.cropChoices}>
          {Object.entries(profile.crops).map(([id, crop]) => (
            <label className={styles.checkLabel} key={id}>
              <input
                type="checkbox"
                checked={conditions.forbidden_crop_ids.includes(id)}
                onChange={(e) =>
                  onChange({
                    ...conditions,
                    forbidden_crop_ids: e.target.checked
                      ? [...conditions.forbidden_crop_ids, id]
                      : conditions.forbidden_crop_ids.filter((c) => c !== id),
                  })
                }
              />
              {crop.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        裸地天数上限
        <select
          value={
            conditions.bare_limit
              ? "limit"
              : conditions.bare_limit_disabled !== null
                ? "none"
                : ""
          }
          onChange={(e) =>
            onChange({
              ...conditions,
              bare_limit:
                e.target.value === "limit" ? blankCapacity("day") : null,
              bare_limit_disabled: e.target.value === "none" ? "" : null,
            })
          }
        >
          <option value="">尚未核对</option>
          <option value="limit">有明确上限</option>
          <option value="none">本次不设上限，说明原因</option>
        </select>
      </label>
      {conditions.bare_limit && (
        <CapacityEditor
          label="本地块裸地天数"
          unit="day"
          value={conditions.bare_limit}
          sources={draft.sources}
          defaultSource={defaultSource}
          onChange={(bare_limit) => onChange({ ...conditions, bare_limit })}
        />
      )}
      {conditions.bare_limit_disabled !== null && (
        <label>
          不设上限的原因
          <input
            value={conditions.bare_limit_disabled}
            onChange={(e) =>
              onChange({ ...conditions, bare_limit_disabled: e.target.value })
            }
          />
        </label>
      )}
    </details>
  );
}
