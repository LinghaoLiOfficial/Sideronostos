import type { Field } from "@/lib/api/field-shift-types";
import type { DailyReadiness, FieldParameter } from "@/lib/api/daily-types";
import { fieldParameters } from "./daily-model";
import { sourceKindLabels } from "./daily-evidence";
import styles from "./workspace.module.css";
const issues: Record<string, string> = {
  value_missing: "尚未提供值",
  source_missing: "缺少来源",
  confirmation_required: "来源尚未确认",
  invalid_value: "数值或选项不适用",
  unit_mismatch: "单位需核对",
  quality_rejected: "资料质量不满足要求",
  outside_region: "超出资料适用地区",
  outside_time_scope: "来源适用时间未覆盖规划期",
  engineering_assumption_unaccepted: "工程假设尚未接受",
  weather_release_unavailable: "尚无适用的已发布天气数据",
  utc_daily_proxy_unaccepted: "尚未接受 UTC 日聚合近似",
  history_unknown: "需要真实前茬或此前未种植的依据",
  field_version_changed: "地块版本已改变",
  baseline_missing: "缺少原定种法",
  remediability_unknown: "尚未确认能否补救",
  water_system_missing: "尚未关联水源",
  source_not_confirmed: "来源尚未确认",
};
function label(path: string, fields: Field[]) {
  const [kind, id, parameter] = path.split(".");
  if (kind === "fields")
    return `${fields.find((f) => f.id === id)?.name ?? "经营地块"} · ${fieldParameters[parameter as FieldParameter]?.label ?? "资料与条件"}`;
  if (kind === "farms") return "农场共享资源与供需";
  if (kind === "weather") return "历史气象资料";
  if (kind === "profile") return "地区与作物参数";
  return "规划资料";
}
export function DailyReadinessPanel({
  report,
  fields,
}: {
  report: DailyReadiness;
  fields: Field[];
}) {
  const blocked = report.items.filter((item) => item.status === "blocked");
  return (
    <section
      className={styles.dailyPanel}
      aria-label="资料检查结果"
      aria-live="polite"
    >
      <h3>
        {report.ready
          ? "资料已满足计算前置检查"
          : `还需补齐或核对 ${blocked.length} 项资料`}
      </h3>
      <p>
        {report.ready
          ? "可以提交计算。候选适宜性和资源可行性将在计算时进一步核验；本检查不代表方案已可实施。"
          : "下列项目会阻止对应计算，未知值没有被替换为零。"}
      </p>
      <ul className={styles.readinessList}>
        {blocked.map((item, index) => (
          <li key={`${item.path}:${index}`}>
            <strong>{label(item.path, fields)}</strong>
            <p>
              {item.issues
                .map(
                  (code) =>
                    issues[code] ?? "此项未满足模型要求，请核对资料及适用范围",
                )
                .join("；")}
            </p>
            {item.missing_reason && <p>{item.missing_reason}</p>}
            <details>
              <summary>核查依据与资料位置</summary>
              <p>
                {item.path} · 预期单位 {item.expected_unit}
              </p>
              <p>{item.issues.join(" / ")}</p>
              {item.sources.map((source) => (
                <p key={source.id}>
                  {sourceKindLabels[source.kind]} · {source.title} ·{" "}
                  {source.locator}
                </p>
              ))}
            </details>
          </li>
        ))}
      </ul>
      <details>
        <summary>所有输入状态与天气限制</summary>
        <p>历史天气回放不表示未来预报。{report.weather.warnings.join("；")}</p>
        <ul className={styles.readinessList}>
          {report.items
            .filter((item) => item.status !== "blocked")
            .map((item, index) => (
              <li key={`${item.path}:${index}`}>
                {label(item.path, fields)} ·{" "}
                {item.value == null ? "未启用" : String(item.value)} {item.unit}{" "}
                · {item.engineering_assumption ? "工程假设" : "有来源记录"}
                {item.sources.length > 0 && (
                  <small>
                    {" "}
                    · {item.sources.map((s) => s.title).join("、")}
                  </small>
                )}
              </li>
            ))}
        </ul>
      </details>
    </section>
  );
}
