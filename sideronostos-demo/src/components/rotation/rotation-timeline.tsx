import { useI18n } from "@/lib/i18n/provider";
import { formatValue as n } from "./planning-model";
import type { Field } from "@/lib/api/field-shift-types";
import type { SeasonV2 } from "@/lib/api/rotation-types";
import styles from "./workspace.module.css";
const crops: Record<string, string> = {
  maize: "玉米",
  pea: "豌豆",
  oat: "燕麦",
};
const day = (s: string) => Date.parse(s + "T00:00:00Z") / 86400000;
export function RotationTimeline({
  option,
  fields,
  start,
  end,
}: {
  option: { seasons: SeasonV2[] };
  fields: Field[];
  start: string;
  end: string;
}) {
  const { t } = useI18n();

  const total = day(end) - day(start) + 1;
  return (
    <section className={styles.timeline} aria-label={t("按地块查看播种与收获")}>
      <div className={styles.timelineLegend}>
        <span>
          <i className={styles.growingKey} />
          {t("生长期")}</span>
        <span>
          <i className={styles.turnaroundKey} />
          {t("换茬占用")}</span>
        <span>
          <i className={styles.idleKey} />
          {t("空闲 / 休耕")}</span>
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
              {field.name} <small>{n(field.area_ha, 3)} {t(" ha")}</small>
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
                  title={t(`${t(crops[s.crop_id] ?? s.crop_id)} ${s.sow_date} — ${s.occupied_until}`)}
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
                    <strong>{t(crops[s.crop_id] ?? s.crop_id)}</strong>
                    <span>
                      {s.sow_date} {t(" 播种 → ")}{s.harvest_date} {t(" 预计成熟")}</span>
                    <small>
                      {t("生长 ")}{s.growing_days} {t(" 天 · 换茬占用至 ")}{s.occupied_until}（
                      {s.turnaround_days} {t(" 天）")}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.help}>{t("此地块在整个规划期休耕。")}</p>
            )}
          </div>
        );
      })}
      <p className={styles.help}>
        {t("收获日期由积温阈值与历史天气情景计算，需按当地品种、天气和田间成熟情况核对。")}</p>
    </section>
  );
}
