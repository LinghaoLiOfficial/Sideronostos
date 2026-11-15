"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Field, FieldInput, Profile } from "@/lib/api/field-shift-types";
import { ApiError } from "@/lib/api/client";
import { errorMessage, initialFieldDraft, parseFieldDraft } from "./model";
import { useDraft } from "./use-draft";
import styles from "./field-shift.module.css";

export function FieldForm({ field, profiles, userId, onSave, onReload, geometryLocked = false, onDirtyChange, draftKey }: { field?: Field; profiles: Profile[]; userId: string; onSave: (value: FieldInput, expectedVersion?: number) => Promise<void>; onReload?: () => Promise<Field>; draftKey?: string; geometryLocked?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const draft = useDraft(draftKey ?? `field-shift:${userId}:field:${field?.id ?? "new"}:v1`, initialFieldDraft(profiles[0]?.id ?? "", field));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reloadSequence = useRef(0);
  useEffect(() => () => { reloadSequence.current += 1; }, []);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Field | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const profile = profiles.find((item) => item.id === draft.value.profile_id);
  useEffect(() => { onDirtyChange?.(draft.dirty); }, [draft.dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const set = (change: Partial<typeof draft.value>) => { draft.update({ ...draft.value, ...change }); onDirtyChange?.(true); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const submitted = draft.value;
    const result = parseFieldDraft(draft.value, profile?.crops.map((c) => c.id) ?? []);
    if (result.error || !result.value) { setError(result.error ?? t("请检查输入。")); return; }
    setBusy(true); setError(null);
    try { await onSave(result.value, version ?? submitted.expected_version ?? field?.version); draft.clearIfUnchanged(submitted); }
    catch (caught) { setError(errorMessage(caught)); setConflict(caught instanceof ApiError && caught.status === 409); }
    finally { setBusy(false); }
  }
  async function reloadLatest() {
    if (!onReload || reloading) return;
    const request = ++reloadSequence.current;
    setReloading(true);
    try { const value = await onReload(); if (request === reloadSequence.current) setLatest(value); }
    catch (caught) { if (request === reloadSequence.current) setError(errorMessage(caught)); }
    finally { if (request === reloadSequence.current) setReloading(false); }
  }
  return <form onSubmit={submit} className={styles.stack} noValidate><fieldset disabled={busy} className={styles.formFields}>
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>{t("01 / YOUR FIELD")}</span><h2>{field ? t("核对这块地的情况") : t("从你的一块地开始")}</h2><p>{t("记录位置与过去种植的作物，为下一步轮作比较提供依据。")}</p></div>
    {draft.restored && <p className={styles.notice} role="status">{t("已恢复此页面未提交的输入。保存后才会更新地块资料。")}</p>}
    {!draft.storageAvailable && <p className={styles.warning}>{t("浏览器无法保留草稿，请在离开页面前保存。")}</p>}
    <div className={styles.formGrid}>
      <label className={styles.field}>{t("地块名称")}<Input aria-label={t("地块名称")} value={draft.value.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder={t("例如：河边的西田")} autoComplete="off" /></label>
      <label className={styles.field}>{t("面积（公顷）")}<Input aria-label={t("面积（公顷）")} readOnly={geometryLocked} type="number" min="0" step="any" value={draft.value.area_ha} onChange={(e) => set({ area_ha: e.target.value })} placeholder={t("如 2.5")} /></label>
      <label className={styles.field}>{t("纬度")}<Input aria-label={t("纬度")} readOnly={geometryLocked} type="number" min="-90" max="90" step="any" value={draft.value.latitude} onChange={(e) => set({ latitude: e.target.value })} placeholder={t("−90 至 90")} /></label>
      <label className={styles.field}>{t("经度")}<Input aria-label={t("经度")} readOnly={geometryLocked} type="number" min="-180" max="180" step="any" value={draft.value.longitude} onChange={(e) => set({ longitude: e.target.value })} placeholder={t("−180 至 180")} /></label>
    </div>
    <p className={styles.help}>{geometryLocked ? t("面积与地块内部参考点来自已确认的地图边界，保存时由服务器复核。") : t("使用地块中心点查询区域气象；这不是地块测绘边界。可从地图服务复制经纬度。")}</p>
    <div className={styles.formGrid}>
      <label className={styles.field}>{t("土壤质地")}<select aria-label={t("土壤质地")} className={styles.select} value={draft.value.soil_texture} onChange={(e) => set({ soil_texture: e.target.value as FieldInput["soil_texture"] })}><option value="unknown">{t("尚不清楚")}</option><option value="sand">{t("砂土")}</option><option value="loam">{t("壤土")}</option><option value="clay">{t("黏土")}</option></select></label>
      <label className={styles.field}>{t("地区与作物配置")}<select aria-label={t("地区与作物配置")} className={styles.select} value={draft.value.profile_id} onChange={(e) => set({ profile_id: e.target.value })}>{profiles.map((p) => <option key={p.id} value={p.id}>{t(p.name)}{p.is_demo ? t("（示范）") : ""}</option>)}</select></label>
    </div>
    <label className={styles.checkbox}><input type="checkbox" checked={draft.value.irrigation_available} onChange={(e) => set({ irrigation_available: e.target.checked })} /><span>{t("这块地能够灌溉")}<small>{t("未勾选时，方案按不提供补灌水评估。")}</small></span></label>
    {profile?.is_demo && <p className={styles.notice}>{t("当前使用可配置的温带作物示范规则，尚未针对你的地区验证。具体假设将在生成方案前展示。")}</p>}
    <div className={styles.subsection}><div className={styles.rowBetween}><div><h3>{t("过去种过什么？")}</h3><p className={styles.help}>{t("每年一季主作物；未知时可留空，并保留为资料缺口。")}</p></div><Button type="button" variant="outline" size="sm" onClick={() => set({ history: [...draft.value.history, { year: "", crop_id: profile?.crops[0]?.id ?? "" }] })}><Plus size={16} />{t("添加年份")}</Button></div>
      {draft.value.history.length === 0 ? <p className={styles.emptyInline}>{t("尚未记录种植历史。")}</p> : <div className={styles.history}>{draft.value.history.map((item, index) => <div key={index} className={styles.historyRow}><label className={styles.field}>{t("年份")}<Input aria-label={t("历史年份 {0}", { "0": index + 1 })} type="number" value={item.year} min="1900" max="2200" placeholder={t("例如 2025")} onChange={(e) => set({ history: draft.value.history.map((h, i) => i === index ? { ...h, year: e.target.value } : h) })} /></label><label className={styles.field}>{t("作物")}<select className={styles.select} aria-label={t("历史作物 {0}", { "0": index + 1 })} value={item.crop_id} onChange={(e) => set({ history: draft.value.history.map((h, i) => i === index ? { ...h, crop_id: e.target.value } : h) })}>{profile?.crops.map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}</select></label><Button type="button" variant="ghost" size="icon" aria-label={t("删除历史 {0}", { "0": index + 1 })} onClick={() => set({ history: draft.value.history.filter((_, i) => i !== index) })}><Trash2 size={17} /></Button></div>)}</div>}
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    {conflict && onReload && <div className={styles.notice}><Button type="button" variant="outline" onClick={reloadLatest} disabled={reloading}>{reloading ? t("正在获取最新资料…") : t("查看服务器上的最新资料")}</Button>{latest && <div className={styles.stack}><p>{t("最新记录：")}{latest.name} · {latest.area_ha} {t(" 公顷 · (")}{latest.latitude}, {latest.longitude}{t(") · 土壤 ")}{t("soil." + latest.soil_texture)} · {latest.irrigation_available ? t("可灌溉") : t("无补灌")}</p><p>{t("历史：")}{latest.history.map((h) => `${h.year} ${profile?.crops.find((c) => c.id === h.crop_id)?.name ?? h.crop_id}`).join("、") || t("未填写")}</p><Button type="button" variant="outline" onClick={() => { setVersion(latest.version); setConflict(false); setError(null); setLatest(null); }}>{t("已核对，保留我的输入并重新保存")}</Button></div>}</div>}
    <div className={styles.formFooter}><span>{t("保存至你的账户")}</span><Button type="submit" disabled={busy || conflict}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <ArrowRight size={17} />}{busy ? t("正在保存…") : t("保存地块并继续")}</Button></div>
  </fieldset></form>;
}
