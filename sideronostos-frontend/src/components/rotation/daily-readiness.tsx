import type { Field } from "@/lib/api/field-shift-types";
import type { DailyReadiness, FieldParameter } from "@/lib/api/daily-types";
import { fieldParameters } from "./daily-model";
import { sourceKindLabels } from "./daily-evidence";
import styles from "./workspace.module.css";
const issues: Record<string, string> = {
  value_missing: "尚未提供值",
  remedy_policy_missing: "尚未确认资源不足时能否补救",
  weather_day_proxy_unaccepted: "尚未接受工程模式使用 UTC 历史日序列的近似",
  invalid_soil_water: "需核对持水量、萎蔫点和有效土层深度的关系",
  water_basis_missing: "请区分净根区供水量与毛供水量",
  net_capacity_cannot_be_converted_again: "净供水量不能再次乘灌溉效率",
  rainfed_field_has_water_system: "无灌溉设施的地块不能关联灌溉水源",
  recorded_history_not_acknowledged: "已有前茬记录尚未核对确认",
  baseline_crop_prohibited: "原定种法包含已禁止的作物",
  baseline_outside_sow_window: "原定种法超出适用播期",
  unsupported_initial_water_policy: "初始水分假设尚未得到当前模型支持",
  ambiguous_water_system: "请明确每个地块使用的水源",
  invalid_resource_membership: "共享资源覆盖的地块与当前农场不一致",
  duplicate_resource_id: "共享资源标识重复，请重新建立该资源",
  machine_type_missing: "请指定设备类型",
  disabled_metric_needs_zero_weight_and_reason:
    "关闭可选目标需说明原因并将权重设为零",
  metric_parameters_missing: "该目标缺少适用参数，需补齐或按规则明确关闭",
  hard_limit_cannot_have_soft_remedy: "不可补救的硬上限不能同时设置缺口补救",
  farm_association_missing: "地块尚未关联已保存农场",
  field_missing: "所选地块已不可用",
  profile_identity_mismatch: "参数包版本不一致，请恢复当前版本后重新核对",
  outside_weather_coverage: "地块位置超出天气资料适用范围",
  reserved_profile_source_identity: "用户资料来源与已发布参数来源标识冲突",
  soil_texture_missing: "需补齐地块的土壤质地",
  unknown_aspect_class: "坡向选项不在当前参数包范围内",
  unknown_drainage_class: "排水选项不在当前参数包范围内",
  unknown_terrain_position: "地形选项不在当前参数包范围内",
  unknown_crop: "作物不在当前参数包范围内",
  unknown_farm: "当前农场关联不可用",
  weather_calendar_incomplete: "历史气象日历不完整，需要准备完整资料",
  weather_daily_invalid: "历史逐日气象数据未通过质量检查",
  weather_day_mismatch: "天气日期与已发布日历不一致",
  weather_et0_unavailable: "参考蒸散所需气象资料不完整",
  weather_not_historical: "天气资料未标记为已支持的历史回放资料",
  weather_provenance_missing: "天气资料缺少可追溯来源",
  weather_recipe_unsupported: "天气预处理配方未得到当前模型支持",
  weather_release_identity_mismatch: "天气发布版本不匹配",
  weather_release_location_mismatch: "天气发布位置与参数包不匹配",
  weather_replay_invalid: "历史天气回放的日期映射不适用",
  weather_unit_mismatch: "已发布天气资料的单位需核对",
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
  history_catalogue_incompatible:
    "前茬记录的作物目录与当前参数包不一致，请在前茬记录中核对并补充；无需编造更精确的日期",
  machine_membership_missing:
    "尚未为地块指定必需设备，请在共享资源中勾选该设备覆盖的地块",
  ambiguous_machine_assignment:
    "同一地块被分配到多组同类设备，请在共享资源中核对并保留一组",
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
    return `${fields.find((f) => f.id === id)?.name ?? "经营地块"} · ${fieldParameters[parameter as FieldParameter]?.label ?? (parameter === "history" ? "前茬记录" : parameter === "machine" ? "设备归属" : "资料与条件")}`;
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
  const groups = new Map<string, typeof blocked>();
  const targetFor = (path: string) => {
    const [kind, , parameter] = path.split(".");
    if (kind === "farms" || (kind === "fields" && parameter === "machine"))
      return "daily-resources";
    if (kind === "fields") return "daily-conditions";
    if (["profile", "weather"].includes(kind)) return "daily-profile";
    return "daily-fields";
  };
  for (const item of blocked) {
    const [kind, id] = item.path.split(".");
    const scope = ["fields", "farms"].includes(kind) ? `${kind}.${id}` : kind;
    const key = `${scope}:${targetFor(item.path)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <section
      className={styles.dailyPanel}
      aria-label="资料检查结果"
      aria-live="polite"
    >
      <h3>
        {report.ready
          ? "资料已满足计算前置检查"
          : `还有 ${groups.size} 组资料需要核对`}
      </h3>
      <p>
        {report.ready
          ? "可以提交计算。候选适宜性和资源可行性将在计算时进一步核验；本检查不代表方案已可实施。"
          : `共有 ${blocked.length} 条检查未通过；同一份资料可能影响多条检查。先按下列分组处理，未知值没有被替换为零。`}
      </p>
      <ul className={styles.readinessList}>
        {[...groups].map(([key, items]) => (
          <li key={key}>
            <strong>
              {label(key.split(":")[0], fields)} · {items.length} 条检查
            </strong>
            <p>
              {[...new Set(items.flatMap((item) => item.issues))]
                .map(
                  (code) =>
                    issues[code] ?? "此项未满足模型要求，请核对资料及适用范围",
                )
                .join("；")}
            </p>
            <a href={`#${targetFor(items[0].path)}`}>去核对资料</a>
            <details>
              <summary>展开逐项依据（{items.length} 条）</summary>
              <ul className={styles.readinessList}>
                {items.map((item, index) => (
                  <li key={`${item.path}:${index}`}>
                    <strong>{label(item.path, fields)}</strong>
                    {item.missing_reason && <p>{item.missing_reason}</p>}
                    <p>
                      {item.path} · 预期单位 {item.expected_unit}
                    </p>
                    <p>
                      {item.issues
                        .map((code) => issues[code] ?? code)
                        .join("；")}
                    </p>
                    {item.sources.map((source) => (
                      <p key={source.id}>
                        {sourceKindLabels[source.kind]} · {source.title} ·{" "}
                        {source.locator}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
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
