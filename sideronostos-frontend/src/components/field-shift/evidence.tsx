import { ExternalLink } from "lucide-react";
import type { Environment, Evidence as EvidenceItem } from "@/lib/api/field-shift-types";
import { formatDate } from "./model";
import styles from "./field-shift.module.css";

const labels: Record<EvidenceItem["kind"], string> = { rule: "农艺规则", observation: "观测资料", estimate: "计算估计", farmer_input: "农户输入", demonstration: "示范假设" };
export function Evidence({ items, title = "依据与资料来源" }: { items: EvidenceItem[]; title?: string }) {
  return <details className={styles.details}><summary>{title} <span>{items.length} 项</span></summary><ul className={styles.evidence}>{items.map((item) => <li key={item.id}><span className={styles.eyebrow}>{labels[item.kind]}</span><strong>{item.title}</strong><p>{item.detail}</p>{item.url && /^https?:\/\//.test(item.url) && <a href={item.url} target="_blank" rel="noopener noreferrer">查看原始资料 <ExternalLink size={13} /></a>}</li>)}</ul></details>;
}

export function ClimateProvenance({ environment }: { environment: Environment }) {
  if (environment.status === "demo") return <p className={styles.warning}>本次使用合成教学气候，并非该地点的 NASA 历史观测。所有用水估计与情景比较仅用于演示；保存和导出会保留此标记。</p>;
  if (environment.status === "unavailable") return <p className={styles.warning}>环境资料不可用，不能将这些结果视为有气候资料支持的建议。</p>;
  return <p className={styles.help}>环境依据：{environment.source_name} · {environment.reference_year} 年历史资料 · {environment.status === "cached" ? "使用已缓存资料" : "本次获取资料"}，获取于 {formatDate(environment.fetched_at)} · {environment.spatial_resolution}。这是区域背景，不是田间实测或未来预报。</p>;
}
