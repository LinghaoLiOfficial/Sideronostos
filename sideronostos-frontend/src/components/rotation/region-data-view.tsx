"use client";
import { MapPin, CalendarDays, Droplets } from "lucide-react";
import type {
  RegionSelection,
  RegionFacts,
  ScienceFact,
} from "@/lib/api/rotation-types";
import {
  labels,
  dataStatus,
  missingReason,
  readableUnit,
} from "./science-presentation";
import styles from "./region-data-view.module.css";
type Props = {
  selection: RegionSelection;
  data?: RegionFacts;
  dates?: { start: string; end: string } | null;
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
  sourceName?: (releaseId: string | undefined) => string;
};
const number = (value: number, precision = 4) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: precision }).format(
    value,
  );
export function RegionDataView({
  selection,
  data,
  dates,
  loading,
  error,
  onRetry,
  sourceName = () => "区域资料",
}: Props) {
  const matches =
    data?.selection.id === selection.id &&
    data.selection.revision === selection.revision;
  const ready = matches && !loading && !error;
  const areaMissing = Boolean(
    ready &&
      data.unavailable.some(
        (item) => item.reason === "no_prepared_area_statistics",
      ),
  );
  const facts = ready && !areaMissing ? data.facts : [];
  return (
    <section
      className={styles.page}
      aria-label="选区数据概览"
      aria-busy={loading}
    >
      <div className={styles.intro}>
        <span className={styles.eyebrow}>这片土地</span>
        <h1>看看这里的观测数据</h1>
        <p>先看已有资料，再一起讨论下一轮种植。</p>
      </div>
      <dl className={styles.context}>
        <div>
          <dt>
            <MapPin size={16} />
            当前选区
          </dt>
          <dd>
            {
              {
                point: "地图选点",
                polygon: "手绘区域",
                viewport: "已采用的视野",
              }[selection.kind]
            }
          </dd>
          <small>
            中心经纬度 {selection.center.map((v) => number(v)).join(", ")}
          </small>
        </div>
        {selection.area_ha != null && (
          <div>
            <dt>几何面积</dt>
            <dd>{number(selection.area_ha, 2)} ha</dd>
            <small>根据选区边界计算</small>
          </div>
        )}
        <div>
          <dt>
            <CalendarDays size={16} />
            查看时段
          </dt>
          <dd>{dates ? `${dates.start} — ${dates.end}` : "全部已发布观测"}</dd>
          <small>历史观测，不是天气预报</small>
        </div>
      </dl>
      {loading ? (
        <p role="status" className={styles.notice}>
          正在读取这片选区的资料…
        </p>
      ) : error || !matches ? (
        <div className={styles.notice} role={error ? "alert" : "status"}>
          <p>这片选区的资料暂不可用，请重新读取。</p>
          <button type="button" onClick={onRetry}>
            重新读取
          </button>
        </div>
      ) : (
        <>
          {facts.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>已经知道的</h2>
              <div className={styles.cards}>
                {facts.map((fact, index) => (
                  <Reading key={`${fact.id}:${index}`} fact={fact} />
                ))}
              </div>
            </>
          )}
          {data.unavailable.length > 0 && (
            <div className={styles.notice}>
              <h2>
                {areaMissing
                  ? "区域已选好，面积统计还没准备好"
                  : "还有这些资料暂时缺少"}
              </h2>
              {data.unavailable.map((item, index) => (
                <p key={index}>
                  <strong>{sourceName(item.release_id)}：</strong>{" "}
                  {missingReason[item.reason] ?? "这项资料暂时不可用。"}
                </p>
              ))}
              {areaMissing && (
                <p>
                  返回地图后可点选一个位置，查看该处已有的卫星观测；它只能代表观测网格，不能代表整片农田。
                </p>
              )}
            </div>
          )}
          {!facts.length && !data.unavailable.length && (
            <p className={styles.notice}>这片选区目前没有可显示的观测记录。</p>
          )}
          {selection.kind === "point" && facts.length > 0 && (
            <p className={styles.footnote}>
              这些是选点对应的观测资料。卫星网格可能比农田大，不能直接用来判断整块田应灌多少水。
            </p>
          )}
        </>
      )}
    </section>
  );
}
function Reading({ fact }: { fact: ScienceFact }) {
  return (
    <article className={styles.card}>
      <h3>
        <Droplets size={17} />
        {labels[fact.metric] ?? fact.metric}
        {fact.pass ? ` · ${fact.pass}` : ""}
      </h3>
      <p className={styles.value}>
        {fact.value == null
          ? "暂无有效值"
          : `${number(fact.value)} ${readableUnit(fact.unit)}`}
      </p>
      <p className={styles.status}>
        {dataStatus[fact.status] ?? "资料状态待核对"}
      </p>
      <p className={styles.period}>
        {fact.period.start.slice(0, 10)} — {fact.period.end.slice(0, 10)}
      </p>
      <details>
        <summary>从哪里来，怎么看</summary>
        <p>
          {String(
            fact.source.product ?? fact.source.release_id ?? fact.data_kind,
          )}
        </p>
        {fact.limitations.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
        {typeof fact.source.url === "string" &&
          /^https?:\/\//.test(fact.source.url) && (
            <a href={fact.source.url} target="_blank" rel="noreferrer">
              查看原始来源
            </a>
          )}
      </details>
    </article>
  );
}
