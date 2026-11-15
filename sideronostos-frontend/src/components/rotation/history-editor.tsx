"use client";
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useRef, useState } from "react";
import type { Field, HistoryEvent } from "@/lib/api/field-shift-types";
export type HistoryCatalogue = {
  id: string;
  crops: { id: string; name: string }[];
  history_catalogue: Record<string, unknown>;
};
import { updateField } from "@/lib/api/field-shift";
import { errorMessage } from "../field-shift/model";
import { fieldInput } from "./planning-model";
import styles from "./workspace.module.css";
export function HistoryEditor({
  field,
  profile,
  onSaved,
  onDirtyChange,
}: {
  field: Field;
  profile: HistoryCatalogue;
  onSaved: (field: Field) => void;
  onDirtyChange: (fieldId: string, dirty: boolean) => void;
}) {
  const { t } = useI18n();

  const [entries, setEntries] = useState<HistoryEvent[]>(
      () => field.history_events ?? [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty =
    JSON.stringify(entries) !== JSON.stringify(field.history_events ?? []);
  useEffect(() => {
    onDirtyChange(field.id, dirty);
    return () => onDirtyChange(field.id, false);
  }, [field.id, dirty, onDirtyChange]);
  function change(index: number, patch: Partial<HistoryEvent>) {
    setEntries((old) =>
      old.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    );
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await updateField(
        field.id,
        { ...fieldInput(field), history_events: entries },
        field.version,
      );
      if (mounted.current) onSaved(result);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const name = (id: string) =>
    profile.crops.find((c) => c.id === id)?.name ?? id;
  return (
    <details className={styles.historyEditor}>
      <summary>{t("查看 / 补充前茬记录")}</summary>
      <p className={styles.help}>
        {t("只填写你知道的精度。仅知年份时，模型保守地按年末结束核对间隔；补充月或日后会保存为新的地块版本。")}</p>
      {field.history.length > 0 && (
        <ul>
          {field.history.map((item) => (
            <li key={item.year}>
              {item.year} {t(" 年 · ")}{name(item.crop_id)} {t(" · 仅年份")}{!entries.some((e) => e.linked_legacy_year === item.year) && (
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={busy}
                  onClick={() =>
                    setEntries((old) => [
                      ...old,
                      {
                        id: crypto.randomUUID(),
                        crop_id: item.crop_id,
                        profile_id: profile.id,
                        precision: "year",
                        end_year: item.year,
                        linked_legacy_year: item.year,
                      },
                    ])
                  }
                >
                  {t("补充此条")}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!entries.length && !field.history.length && (
        <p>{t("没有历史记录；请确认是新开垦地，或先补充已知前茬。")}</p>
      )}
      {entries.map((entry, index) => (
        <fieldset key={entry.id} disabled={busy} className={styles.historyRow}>
          <legend>
            {entry.linked_legacy_year
              ? t("补充 {0} 年记录", { "0": entry.linked_legacy_year })
              : t("前茬记录 {0}", { "0": index + 1 })}
          </legend>
          <label>
            {t("作物")}<select
              value={entry.crop_id}
              onChange={(e) => change(index, { crop_id: e.target.value })}
            >
              {Object.keys(profile.history_catalogue).map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("结束时间精度")}<select
              value={entry.precision}
              onChange={(e) =>
                change(index, {
                  precision: e.target.value as HistoryEvent["precision"],
                  end_month:
                    e.target.value === "year"
                      ? null
                      : (entry.end_month ?? null),
                  end_day:
                    e.target.value === "day" ? (entry.end_day ?? null) : null,
                })
              }
            >
              <option value="year">{t("只知道年份")}</option>
              <option value="month">{t("知道月份")}</option>
              <option value="day">{t("知道日期")}</option>
            </select>
          </label>
          <label>
            {t("结束年份")}<input
              type="number"
              min="1900"
              max="2200"
              disabled={Boolean(entry.linked_legacy_year)}
              value={entry.end_year}
              onChange={(e) =>
                change(index, { end_year: Number(e.target.value) })
              }
            />
          </label>
          {entry.precision !== "year" && (
            <label>
              {t("月份")}<input
                type="number"
                min="1"
                max="12"
                value={entry.end_month ?? ""}
                onChange={(e) =>
                  change(index, { end_month: Number(e.target.value) })
                }
              />
            </label>
          )}
          {entry.precision === "day" && (
            <label>
              {t("日")}<input
                type="number"
                min="1"
                max="31"
                value={entry.end_day ?? ""}
                onChange={(e) =>
                  change(index, { end_day: Number(e.target.value) })
                }
              />
            </label>
          )}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() =>
              setEntries((old) => old.filter((_, i) => i !== index))
            }
          >
            {t("移除此补充")}</button>
        </fieldset>
      ))}
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || entries.length >= 60}
          onClick={() =>
            setEntries((old) => [
              ...old,
              {
                id: crypto.randomUUID(),
                crop_id: profile.crops[0].id,
                profile_id: profile.id,
                precision: "year",
                end_year: new Date().getFullYear() - 1,
              },
            ])
          }
        >
          {t("新增前茬")}</button>
        {dirty && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEntries(field.history_events ?? []);
              setError(null);
            }}
          >
            {t("放弃前茬修改")}</button>
        )}
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? t("正在保存…") : t("保存前茬记录")}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      )}
    </details>
  );
}
