"use client";

import { useI18n } from "@/lib/i18n/provider";
import { ArrowRight, Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Environment } from "@/lib/api/field-shift-types";
import { formatDate, formatNumber } from "./model";
import { Evidence } from "./evidence";
import styles from "./field-shift.module.css";

const statusText = { live: "刚刚获取的历史资料", cached: "已缓存的历史资料", demo: "合成演示数据", unavailable: "环境资料暂不可用" };

export function EnvironmentPanel({ environment, loading, error, onRefresh, onContinue }: { environment?: Environment; loading: boolean; error: string | null; onRefresh: () => void; onContinue: () => void }) {
  const { t, locale } = useI18n();

  const months = environment?.months ?? [];
  const rainMax = Math.max(50, ...months.map((m) => m.rainfall_mm ?? 0));
  const temps = months.flatMap((m) => m.tmin_c === null || m.tmax_c === null ? [] : [(m.tmin_c + m.tmax_c) / 2]);
  const minTemp = Math.min(0, ...temps); const maxTemp = Math.max(30, ...temps);
  const yTemp = (n: number) => 150 - ((n - minTemp) / (maxTemp - minTemp)) * 125;
  return <section className={styles.stack}>
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>{t("02 / ENVIRONMENT")}</span><h2>{t("了解这里的季节变化")}</h2><p>{t("先看看降雨和温度，再判断作物用水高峰与当地环境是否匹配。")}</p></div>
    {loading && !environment && <div className={styles.loading} role="status"><RefreshCw className="animate-spin" /><strong>{t("正在整理区域气象资料…")}</strong><p>{t("首次查询可能需要一些时间；已保存的地块不会丢失。")}</p></div>}
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}<Button variant="outline" onClick={onRefresh} disabled={loading}>{t("重试获取资料")}</Button></AlertDescription></Alert>}
    {environment && <><div className={styles.dataHeader}><div><span className={styles.dataStatus}><Database size={15} />{t(statusText[environment.status])}</span><h3>{environment.reference_year} {t(" 年 · ")}{environment.source_name}</h3></div><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? "animate-spin" : ""} />{loading ? t("正在更新…") : t("重新获取")}</Button></div>
      {environment.status === "demo" && <div className={styles.warning}>{t("NASA 数据暂时无法取得，当前图表使用合成示范值。方案与导出资料会保留这个标记。")}</div>}
      {environment.status === "unavailable" ? <div className={styles.warning}>{t("没有可用于分析的环境资料。请重试获取，或稍后返回；当前不能生成可靠的方案比较。")}</div> : <div className={styles.climateChart}><div className={styles.chartLegend}><span><i />{t("降雨（mm，左轴）")}</span><span><i className={styles.temperatureDot} />{t("月均温（°C，右轴）")}</span></div><svg viewBox="0 0 700 195" role="img" aria-label={t("{0} 年月度降雨和温度；精确数值可在下方表格读取", { "0": environment.reference_year })}><line x1="40" x2="660" y1="150" y2="150" className={styles.chartAxis} /><line x1="40" x2="660" y1="25" y2="25" className={styles.chartGrid} /><text x="4" y="30">{Math.round(rainMax)}</text><text x="18" y="154">0</text><text x="666" y="30">{Math.round(maxTemp)}°</text><text x="666" y="154">{Math.round(minTemp)}°</text>{Array.from({ length: 12 }, (_, i) => {
        const month = months.find((m) => m.month === i + 1); const x = 48 + i * 51; const temp = month?.tmin_c != null && month?.tmax_c != null ? (month.tmin_c + month.tmax_c) / 2 : null;
        return <g key={i}>{month?.rainfall_mm != null ? <rect x={x} y={150 - month.rainfall_mm / rainMax * 125} width="27" height={Math.max(1, month.rainfall_mm / rainMax * 125)} rx="3" className={styles.rainBar}><title>{i + 1} {t(" 月降雨 ")}{formatNumber(month.rainfall_mm, 1)} {t(" mm")}</title></rect> : <text x={x + 13} y="142" textAnchor="middle">—</text>}{temp !== null && <circle cx={x + 13} cy={yTemp(temp)} r="4" className={styles.tempPoint}><title>{i + 1} {t(" 月均温 ")}{formatNumber(temp, 1)} {t(" °C")}</title></circle>}<text x={x + 13} y="177" textAnchor="middle">{i + 1}{t("月")}</text></g>;
      })}</svg></div>}
      <div className={styles.dataFootnote}><span>{t("空间尺度：")}{environment.spatial_resolution}</span><span>{t("获取日期：")}{t(formatDate(environment.fetched_at, locale))}</span></div>
      <p className={styles.help}>{t("这是一个完整历史参考年的区域资料，不是未来天气预报。未来情景由你设定；地块实际情况可能不同。")}</p>
      <details className={styles.details}><summary>{t("查看逐月数据")}</summary><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>{t("月份")}</th><th>{t("降雨 mm")}</th><th>{t("最低温 °C")}</th><th>{t("最高温 °C")}</th><th>{t("参考蒸散估计 mm")}</th><th>{t("有效日数")}</th></tr></thead><tbody>{months.map((m) => <tr key={m.month}><th>{m.month} {t(" 月")}</th><td>{formatNumber(m.rainfall_mm, 1)}</td><td>{formatNumber(m.tmin_c, 1)}</td><td>{formatNumber(m.tmax_c, 1)}</td><td>{formatNumber(m.reference_et_mm, 1)}</td><td>{m.valid_days} / {m.expected_days}</td></tr>)}</tbody></table></div><p className={styles.help}>{t("参考蒸散由温度与纬度估计，不是 NASA 直接观测值。“暂无数据”不代表零。")}</p></details>
      <div className={styles.limitations}><h3>{t("这些资料能告诉我们什么？")}</h3><p>{t("它们提供区域气候背景。当前没有连接地块土壤检测、卫星植被监测或实测产量。")}</p><ul>{environment.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
      <Evidence items={environment.evidence} />
      <div className={styles.formFooter}><span>{t("下一步：设置基准安排和资源限制")}</span><Button onClick={onContinue} disabled={environment.status === "unavailable" || loading}>{t("设置我的目标")}<ArrowRight size={17} /></Button></div>
    </>}
  </section>;
}
