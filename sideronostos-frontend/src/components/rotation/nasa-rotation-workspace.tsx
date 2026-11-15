"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, FlaskConical, Leaf, Settings2, Sprout } from "lucide-react";
import { getCurrentUser } from "@/lib/api/client";
import * as fieldsApi from "@/lib/api/field-shift";
import * as api from "@/lib/api/rotation";
import { isDailyRun } from "@/lib/api/daily-types";
import type { Field } from "@/lib/api/field-shift-types";
import type { NasaDataRelease, RotationInput, RotationPreflightInput, RotationWeights, RunV2 } from "@/lib/api/rotation-types";
import { errorMessage } from "../field-shift/model";
import { allOptions, RunResults } from "./results";
import { NasaReleaseMap } from "./nasa-release-map";
import styles from "./nasa-rotation.module.css";

type Horizon = "1y" | "2y" | "3y";
type ResourcePreset = "dryland" | "irrigated";
const WEIGHT_LABELS: Record<keyof RotationWeights, string> = {
  cover: "土地覆盖",
  diversity: "科属多样性",
  water: "节水",
  cost: "降低成本",
};
const within = (field: Field, release: NasaDataRelease) => {
  const [west, south, east, north] = release.bounds;
  const points: [number, number][] = [[field.longitude, field.latitude]];
  if (field.geometry?.type === "Polygon") points.push(...field.geometry.coordinates[0]);
  return points.every(([longitude, latitude]) => west <= longitude && longitude <= east && south <= latitude && latitude <= north);
};
const yearsFor = (release: NasaDataRelease, horizon: Horizon) => {
  const first = Number(release.start.slice(0, 4));
  return Array.from({ length: Number(horizon[0]) }, (_, index) => first + index);
};
const SYNTHETIC_FIELDS = [
  [[-93.5096306562, 41.9963549948], [-93.4999717999, 41.9963974692], [-93.5, 42], [-93.509659401, 41.9999575203], [-93.5096306562, 41.9963549948]],
  [[-93.4998510641, 41.996397995], [-93.4901921869, 41.9964396466], [-93.4902198355, 42.0000421826], [-93.4998792574, 42.0000005259], [-93.4998510641, 41.996397995]],
  [[-93.5096601197, 42.0000475834], [-93.5000007051, 42.0000900632], [-93.5000289104, 42.0036925917], [-93.5096888699, 42.0036501065], [-93.5096601197, 42.0000475834]],
  [[-93.4998799623, 42.0000905891], [-93.4902205267, 42.000132246], [-93.4902481804, 42.0037347798], [-93.4999081608, 42.0036931176], [-93.4998799623, 42.0000905891]],
] as const;

export function NasaRotationWorkspace() {
  const client = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: getCurrentUser, retry: false });
  const releases = useQuery({ queryKey: ["nasa-rotation", "releases"], queryFn: api.listNasaDataReleases, enabled: Boolean(session.data) });
  const profiles = useQuery({ queryKey: ["nasa-rotation", "profiles"], queryFn: api.listRotationProfiles, enabled: Boolean(session.data) });
  const fieldProfiles = useQuery({ queryKey: ["nasa-rotation", "field-profiles"], queryFn: fieldsApi.listProfiles, enabled: Boolean(session.data) });
  const fields = useQuery({ queryKey: ["nasa-rotation", "fields"], queryFn: fieldsApi.listFields, enabled: Boolean(session.data) });
  const [releaseId, setReleaseId] = useState("");
  const [horizon, setHorizon] = useState<Horizon>("3y");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [historyReviewed, setHistoryReviewed] = useState<Record<string, boolean>>({});
  const [geometryConfirmed, setGeometryConfirmed] = useState<Record<string, boolean>>({});
  const [cropSelection, setCropSelection] = useState<string[] | null>(null);
  const [windows, setWindows] = useState<Record<string, [string, string]>>({});
  const [weights, setWeights] = useState<RotationWeights>({ cover: 2, diversity: 1, water: 1, cost: .5 });
  const [scenario, setScenario] = useState({ temperature_change_c: 0, rainfall_change_pct: 0 });
  const [preset, setPreset] = useState<ResourcePreset>("irrigated");
  const [requireCrop, setRequireCrop] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [maxOptions, setMaxOptions] = useState(3);
  const [solverSeconds, setSolverSeconds] = useState(30);
  const [limitOverrides, setLimitOverrides] = useState<Record<string, { water_m3: number; cost_usd: number; labor_days: number }>>({});
  const [fieldLimitOverrides, setFieldLimitOverrides] = useState<Record<string, Record<string, { water_m3: number; cost_usd: number; labor_days: number }>>>({});
  const [run, setRun] = useState<RunV2 | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creatingSynthetic, setCreatingSynthetic] = useState(false);
  const [debouncedPreflight, setDebouncedPreflight] = useState<RotationPreflightInput | null>(null);
  const initializedRelease = useRef<string | null>(null);
  const release = releases.data?.items.find((item) => item.id === releaseId) ?? releases.data?.items[0];
  const profile = profiles.data?.items.find((item) => item.id === profiles.data?.default_profile_id) ?? profiles.data?.items[0];
  const fieldProfile = fieldProfiles.data?.items[0];
  const selectedCrops = useMemo(
    () => cropSelection ?? profile?.crops.map((crop) => crop.id) ?? [],
    [cropSelection, profile],
  );
  const eligibleFields = useMemo(() => release ? (fields.data?.items ?? []).filter((field) => within(field, release)) : [], [fields.data, release]);
  const chosen = useMemo(
    () => eligibleFields.filter((field) => selectedFields.includes(field.id)),
    [eligibleFields, selectedFields],
  );
  const years = release ? yearsFor(release, horizon) : [];
  const totalArea = chosen.reduce((sum, field) => sum + field.area_ha, 0);
  const defaultLimits = Object.fromEntries(years.map((year) => [String(year), {
      water_m3: preset === "dryland" ? 0 : Math.round(totalArea * 300 * 10),
      cost_usd: Math.round(totalArea * 1200),
      labor_days: Math.round(totalArea * 8),
    }]));
  const limits = Object.fromEntries(years.map((year) => [String(year), limitOverrides[year] ?? defaultLimits[year]]));
  const fieldLimits = Object.fromEntries(chosen.map((field) => [field.id, Object.fromEntries(years.map((year) => {
    const fallback = {
      water_m3: preset === "dryland" || !field.irrigation_available ? 0 : Math.round(field.area_ha * 300 * 10),
      cost_usd: Math.round(field.area_ha * 1200), labor_days: Math.round(field.area_ha * 8),
    };
    return [String(year), fieldLimitOverrides[field.id]?.[year] ?? fallback];
  }))]));
  const preflightInput = useMemo<RotationPreflightInput | null>(() => {
    if (!release || !profile || !chosen.length || !selectedCrops.length) return null;
    const start = release.start.slice(0, 4) + "-01-01";
    return {
      profile_id: profile.id,
      fields: chosen.map((field) => ({
        id: field.id,
        expected_version: field.version,
        require_crop: requireCrop,
      })),
      start,
      end: `${Number(start.slice(0, 4)) + Number(horizon[0]) - 1}-12-31`,
      allowed_crop_ids: selectedCrops,
      sow_windows: Object.fromEntries(
        Object.entries(windows).filter(([id]) => selectedCrops.includes(id)),
      ),
      scenario,
      data_release_id: release.id,
      horizon_mode: horizon,
    };
  }, [chosen, horizon, profile, release, requireCrop, scenario, selectedCrops, windows]);
  const preflightKey = preflightInput ? JSON.stringify(preflightInput) : "";
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedPreflight(
        preflightKey ? JSON.parse(preflightKey) as RotationPreflightInput : null,
      ),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [preflightKey]);
  const preflight = useQuery({
    queryKey: ["nasa-rotation", "preflight", debouncedPreflight],
    queryFn: () => api.preflightRotation(debouncedPreflight!),
    enabled: Boolean(debouncedPreflight),
    retry: false,
  });
  const preflightCurrent = Boolean(
    debouncedPreflight && JSON.stringify(debouncedPreflight) === preflightKey,
  );
  const capacityReady = preflightCurrent && preflight.isSuccess;
  const createSyntheticFields = useCallback(async () => {
    if (!fieldProfile || creatingSynthetic) return [];
    setError(null); setCreatingSynthetic(true);
    try {
      const existing = new Map((fields.data?.items ?? []).map((field) => [field.name, field]));
      const created: Field[] = [];
      for (const [index, ring] of SYNTHETIC_FIELDS.entries()) {
        const name = `Iowa synthetic benchmark ${index + 1}`;
        const found = existing.get(name);
        if (found) { created.push(found); continue; }
        const longitude = ring.slice(0, -1).reduce((sum, point) => sum + point[0], 0) / (ring.length - 1);
        const latitude = ring.slice(0, -1).reduce((sum, point) => sum + point[1], 0) / (ring.length - 1);
        created.push(await fieldsApi.createField({
          name, area_ha: 32, latitude, longitude, soil_texture: "loam",
          irrigation_available: true, profile_id: fieldProfile.id, history: [], history_events: [],
          geometry: { type: "Polygon", coordinates: [ring.map(([x, y]) => [x, y] as [number, number])] },
        }));
      }
      const identifiers = created.map((field) => field.id);
      const confirmations = Object.fromEntries(identifiers.map((id) => [id, true]));
      setSelectedFields(identifiers);
      setGeometryConfirmed(confirmations);
      setHistoryReviewed(confirmations);
      setAccepted(true);
      await client.invalidateQueries({ queryKey: ["nasa-rotation", "fields"] });
      return created;
    } catch (cause) { setError(errorMessage(cause)); return []; }
    finally { setCreatingSynthetic(false); }
  }, [client, creatingSynthetic, fieldProfile, fields.data]);

  useEffect(() => {
    if (!release || !profile || !fieldProfile || !fields.isSuccess || initializedRelease.current === release.id) return;
    initializedRelease.current = release.id;
    const timer = window.setTimeout(() => void createSyntheticFields(), 0);
    return () => window.clearTimeout(timer);
  }, [createSyntheticFields, fieldProfile, fields.isSuccess, profile, release]);

  useEffect(() => {
    if (!run || !["pending", "running"].includes(run.status)) return;
    const timer = window.setInterval(() => void api.getRun(run.id).then((value) => {
      setRun(value);
      if (value.result?.options?.[0] && !selectedOption) setSelectedOption(value.result.options[0].id);
    }).catch(() => undefined), 1800);
    return () => window.clearInterval(timer);
  }, [run, selectedOption]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (!release || !profile) return setError("NASA 数据 release 或参数包不可用。");
    if (!chosen.length) return setError("请至少选择一个位于 NASA 快照覆盖区内的地块。");
    if (chosen.some((field) => !historyReviewed[field.id] || !geometryConfirmed[field.id])) return setError("请逐块确认边界和前茬历史。");
    if (!selectedCrops.length) return setError("请至少选择一种候选作物。");
    if (!Object.values(weights).some((value) => value > 0)) return setError("至少一个目标权重必须大于 0。");
    if (!accepted) return setError("请确认历史回测和 benchmark 假设后再运行。");
    if (!capacityReady) return setError("请等待候选容量评估完成。");
    if (!preflight.data.within_capacity) return setError("当前候选规模超过服务器容量，请按容量诊断收窄配置。");
    const start = release.start.slice(0, 4) + "-01-01";
    const end = `${Number(start.slice(0, 4)) + Number(horizon[0]) - 1}-12-31`;
    const request: RotationInput = {
      idempotency_key: crypto.randomUUID(), profile_id: profile.id,
      fields: chosen.map((field) => ({ id: field.id, expected_version: field.version, require_crop: requireCrop, history_reviewed: true })),
      start, end, allowed_crop_ids: selectedCrops,
      sow_windows: Object.fromEntries(Object.entries(windows).filter(([id]) => selectedCrops.includes(id))),
      farm_limits: limits, field_limits: fieldLimits, weights, scenario, baseline: [],
      accept_benchmark_assumptions: true, data_release_id: release.id, horizon_mode: horizon,
      max_options: maxOptions, solver_time_limit_seconds: solverSeconds,
    };
    setSubmitting(true);
    try { const created = await api.createRun(request); setRun(created); setSelectedOption(null); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSubmitting(false); }
  }

  if (session.isPending) return <main className={styles.page} role="status">正在确认登录状态…</main>;
  if (!session.data) return <main className={styles.page}><div className={styles.main}><p className={styles.error}>请先登录并验证邮箱。</p><Link href="/login?next=/field-shift/nasa-rotation">登录</Link></div></main>;
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/field-shift/map"><Sprout /> Agrisata · NASA Rotation Lab</Link><nav><Link href="/field-shift/map">地图</Link><Link href="/field-shift/rotation">轮作规划</Link><Link href="/field-shift/nasa-rotation" aria-current="page">NASA 回测</Link></nav></header>
    <div className={styles.main}>
      {release ? <section className={styles.releaseBar}>
        <div><h1>NASA 历史轮作回测</h1><p>工程 benchmark，不是未来天气预报或种植处方。</p></div>
        <dl><dt>数据 release</dt><dd>{release.id}</dd></dl><dl><dt>时间覆盖</dt><dd>{release.start} — {release.end}</dd></dl><dl><dt>完整日数</dt><dd>{release.complete_days} / {release.expected_days}</dd></dl><dl><dt>校验值</dt><dd>{release.manifest_sha256.slice(0, 12)}…</dd></dl>
      </section> : <p className={styles.error}>尚未发布可用于轮作的 NASA release。请先运行离线发布命令。</p>}
      <div className={styles.layout}>
        <form className={styles.config} onSubmit={submit}>
          <section className={styles.section}><h2><Database size={16}/> 数据与规划期</h2>
            <label>NASA release<select value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>{releases.data?.items.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
            <div className={styles.grid3}><label>规划期<select value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)}><option value="1y">1 年</option><option value="2y">2 年</option><option value="3y">3 年</option></select></label><label>方案数量<input type="number" min={1} max={5} value={maxOptions} onChange={(e) => setMaxOptions(Number(e.target.value))}/></label><label>求解上限（秒）<input type="number" min={5} max={60} value={solverSeconds} onChange={(e) => setSolverSeconds(Number(e.target.value))}/></label></div>
            <p className={styles.notice}>温度、辐射、风和气压来自 POWER；降水来自 GPM；SRTM 高程进入 FAO-56 ET0。SMAP、HLS、ECOSTRESS、GRACE 仅作证据。</p>
          </section>
          <section className={styles.section}><h2><Leaf size={16}/> 地块与前茬</h2>
            {!eligibleFields.length && <p>{creatingSynthetic ? "正在准备默认 Iowa benchmark 测试地块…" : "当前没有可用的 benchmark 测试地块。"}</p>}
            {eligibleFields.map((field) => <div className={styles.field} key={field.id}><label className={styles.check}><input type="checkbox" checked={selectedFields.includes(field.id)} onChange={(e) => setSelectedFields((old) => e.target.checked ? [...old, field.id] : old.filter((id) => id !== field.id))}/><span><strong>{field.name}</strong><span className={styles.meta}>{field.area_ha} ha · {field.soil_texture} · {field.irrigation_available ? "可灌溉" : "旱作"} · v{field.version}</span></span></label>{selectedFields.includes(field.id) && <><label className={styles.check}><input type="checkbox" checked={Boolean(geometryConfirmed[field.id])} onChange={(e) => setGeometryConfirmed({...geometryConfirmed, [field.id]: e.target.checked})}/>边界与经营面积已核对</label><label className={styles.check}><input type="checkbox" checked={Boolean(historyReviewed[field.id])} onChange={(e) => setHistoryReviewed({...historyReviewed, [field.id]: e.target.checked})}/>前茬历史已核对</label></>}</div>)}
            <div className={styles.actions}><button type="button" onClick={() => void createSyntheticFields()} disabled={!fieldProfile || creatingSynthetic}>{creatingSynthetic ? "正在准备…" : "恢复默认测试地块"}</button><Link className={styles.primary} href="/field-shift">创建或编辑地块</Link></div>
            <p className={styles.notice}>页面默认选中 4 个约 32 ha 的合成 Iowa benchmark 地块，并完成测试数据确认；它们仅用于工程测试，不是真实地籍、权属或经营边界。用户仍可取消选择或改用自己的覆盖区内地块。</p>
          </section>
          <section className={styles.section}><h2><Sprout size={16}/> 候选作物与农艺参数</h2>
            {profile?.crops.map((crop) => <div className={styles.crop} key={crop.id}><label className={styles.check}><input type="checkbox" checked={selectedCrops.includes(crop.id)} onChange={(e) => setCropSelection(e.target.checked ? [...selectedCrops, crop.id] : selectedCrops.filter((id) => id !== crop.id))}/><span><strong>{crop.name}</strong><span className={styles.meta}>{crop.family} · GDD {crop.gdd_required} · {crop.sow_start_mmdd}—{crop.sow_end_mmdd}</span></span></label>{selectedCrops.includes(crop.id) && <div className={styles.grid2}><label>最早播种<input type="text" value={windows[crop.id]?.[0] ?? crop.sow_start_mmdd} onChange={(e) => setWindows({...windows, [crop.id]: [e.target.value, windows[crop.id]?.[1] ?? crop.sow_end_mmdd]})}/></label><label>最晚播种<input type="text" value={windows[crop.id]?.[1] ?? crop.sow_end_mmdd} onChange={(e) => setWindows({...windows, [crop.id]: [windows[crop.id]?.[0] ?? crop.sow_start_mmdd, e.target.value]})}/></label></div>}<div className={styles.chips}><span className={styles.chip}>基温 {crop.base_c}°C</span><span className={styles.chip}>上限 {crop.upper_c}°C</span><span className={styles.chip}>最长 {crop.max_growing_days} 天</span><span className={styles.chip}>Kc {crop.kc.join("/")}</span><span className={styles.chip}>${crop.cost_usd_ha}/ha</span><span className={styles.chip}>{crop.labor_days_ha} 人日/ha</span></div></div>)}
          </section>
          <section className={styles.section}><h2><Settings2 size={16}/> 资源、约束与目标</h2>
            <div className={styles.grid2}><label>资源预设<select value={preset} onChange={(e) => setPreset(e.target.value as ResourcePreset)}><option value="irrigated">灌溉 benchmark（300 mm）</option><option value="dryland">旱作 benchmark（补水上限 0）</option></select></label><label>种植要求<select value={String(requireCrop)} onChange={(e) => setRequireCrop(e.target.value === "true")}><option value="true">每块地至少一季</option><option value="false">允许全期休耕</option></select></label></div>
            {years.map((year) => <div className={styles.grid3} key={year}><label>{year} 水量 m³<input type="number" min={0} value={limits[year]?.water_m3 ?? 0} onChange={(e) => setLimitOverrides({...limitOverrides, [year]: {...limits[year], water_m3: Number(e.target.value)}})}/></label><label>{year} 成本 USD<input type="number" min={0} value={limits[year]?.cost_usd ?? 0} onChange={(e) => setLimitOverrides({...limitOverrides, [year]: {...limits[year], cost_usd: Number(e.target.value)}})}/></label><label>{year} 劳力 人日<input type="number" min={0} value={limits[year]?.labor_days ?? 0} onChange={(e) => setLimitOverrides({...limitOverrides, [year]: {...limits[year], labor_days: Number(e.target.value)}})}/></label></div>)}
            {chosen.length > 0 && <details><summary>地块年度资源上限</summary>{chosen.map((field) => <div className={styles.field} key={field.id}><strong>{field.name}</strong><span className={styles.meta}>{field.area_ha} ha · {field.irrigation_available ? "可灌溉" : "无灌溉设施，默认补水为 0"}</span>{years.map((year) => { const value = fieldLimits[field.id][year]; return <div className={styles.grid3} key={year}><label>{year} 水量 m³<input type="number" min={0} value={value.water_m3} onChange={(e) => setFieldLimitOverrides({...fieldLimitOverrides, [field.id]: {...fieldLimitOverrides[field.id], [year]: {...value, water_m3: Number(e.target.value)}}})}/></label><label>{year} 成本 USD<input type="number" min={0} value={value.cost_usd} onChange={(e) => setFieldLimitOverrides({...fieldLimitOverrides, [field.id]: {...fieldLimitOverrides[field.id], [year]: {...value, cost_usd: Number(e.target.value)}}})}/></label><label>{year} 劳力 人日<input type="number" min={0} value={value.labor_days} onChange={(e) => setFieldLimitOverrides({...fieldLimitOverrides, [field.id]: {...fieldLimitOverrides[field.id], [year]: {...value, labor_days: Number(e.target.value)}}})}/></label></div>})}</div>)}</details>}
            <label className={styles.check}><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)}/>展开高级目标与天气情景</label>
            {advanced && <><h3>目标权重（0–5）</h3><div className={styles.grid2}>{(Object.keys(WEIGHT_LABELS) as (keyof RotationWeights)[]).map((key) => <label key={key}>{WEIGHT_LABELS[key]}<input type="number" min={0} max={5} step=".5" value={weights[key]} onChange={(e) => setWeights({...weights, [key]: Number(e.target.value)})}/></label>)}</div><h3>历史天气敏感性情景</h3><div className={styles.grid2}><label>温度变化 °C<input type="number" min={-3} max={5} step=".1" value={scenario.temperature_change_c} onChange={(e) => setScenario({...scenario, temperature_change_c: Number(e.target.value)})}/></label><label>降雨变化 %<input type="number" min={-50} max={50} step="1" value={scenario.rainfall_change_pct} onChange={(e) => setScenario({...scenario, rainfall_change_pct: Number(e.target.value)})}/></label></div><p>硬约束：时间不重叠、换茬占用、同科间隔、前茬历史、灌溉可用性和年度资源容量。土壤养分、市场价格与设备能力当前未建模。</p></>}
          </section>
          <section className={styles.section}><h2><FlaskConical size={16}/> 提交确认</h2><div className={styles.capacity} aria-live="polite"><h3>候选容量预检</h3>{!preflightCurrent || preflight.isFetching ? <p>正在评估容量…</p> : preflight.error ? <p className={styles.error}>容量评估失败：{errorMessage(preflight.error)}</p> : preflight.data ? <><dl className={styles.summary}><div><dt>播种采样</dt><dd>{preflight.data.sampling_step_days} 天</dd></div><div><dt>预计候选</dt><dd>{preflight.data.candidate_count_truncated ? ">" : ""}{preflight.data.candidate_count.toLocaleString()} / {preflight.data.limits.max_candidates.toLocaleString()}</dd></div><div><dt>预计连接边</dt><dd>{preflight.data.transition_edge_count === null ? "未评估" : `${preflight.data.transition_edge_count_truncated ? ">" : ""}${preflight.data.transition_edge_count.toLocaleString()} / ${preflight.data.limits.max_transition_edges.toLocaleString()}`}</dd></div></dl><p className={preflight.data.within_capacity ? styles.capacityOk : styles.capacityBad}>{preflight.data.within_capacity ? "容量状态：可运行" : "容量状态：超出限制"}</p>{preflight.data.violations.map((violation) => <p className={styles.capacityReason} key={violation.dimension}>{violation.dimension === "candidates" ? `候选维度膨胀：${violation.factors.field_count} 个地块 × ${violation.factors.crop_count} 种作物 × ${violation.factors.year_count} 年，采样步长 ${violation.factors.sampling_step_days} 天。请减少地块、作物或年份，或收窄播种窗口。` : "连接边维度膨胀：同一地块内可衔接季次组合过多。请收窄播种窗口，或减少作物、地块或规划年份。"}</p>)}</> : <p>请选择地块和作物以评估容量。</p>}</div><label className={styles.check}><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}/>我理解这是使用历史 NASA 数据和行业 benchmark 的工程回测，不是未来天气预测、收益承诺或种植处方。</label>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button className={styles.primary} disabled={submitting || creatingSynthetic || !release || !capacityReady || !preflight.data?.within_capacity}>{creatingSynthetic ? "正在准备测试地块…" : submitting ? "正在提交…" : "运行 Gurobi 回测"}</button></div></section>
        </form>
        <div className={styles.results}>
          {release && <NasaReleaseMap key={release.id} release={release} fields={chosen.length ? chosen : eligibleFields} />}
          <section className={styles.section}><h2><BarChart3 size={16}/> 运行摘要</h2><dl className={styles.summary}><div><dt>地块</dt><dd>{chosen.length}</dd></div><div><dt>总面积</dt><dd>{totalArea.toFixed(1)} ha</dd></div><div><dt>候选作物</dt><dd>{selectedCrops.length}</dd></div></dl>{release && <><h3>数据产品边界</h3><div className={styles.chips}>{Object.entries(release.products).map(([name, product]) => <span key={name} className={styles.chip}>{name.toUpperCase()} · {product.model_usable ? "入模" : "证据"}</span>)}</div><p>{release.limitations.join(" ")}</p></>}</section>
          {run ? <RunResults owner={session.data.id} run={run} changes={[]} selectedOptionId={selectedOption} onSelect={setSelectedOption} onExplain={() => undefined} onUpdate={(value) => { if (isDailyRun(value)) return; setRun(value); client.setQueryData(["nasa-rotation", "run", value.id], value); }} onSaved={() => undefined} compareRunId={null} compareOptionId={null} onCompare={() => undefined}/> : <section className={styles.section}><h2>尚未运行</h2><p>完成左侧配置后，结果区将显示 Gurobi 状态、方案时间轴、资源消耗、约束核验、候选拒绝原因和可审计导出。</p></section>}
          {run?.result && <section className={styles.section}><h2>模型诊断</h2><dl className={styles.summary}><div><dt>候选数</dt><dd>{run.result.candidate_count ?? "—"}</dd></div><div><dt>返回方案</dt><dd>{allOptions(run).length}</dd></div><div><dt>求解上限</dt><dd>{run.result.solver_time_limit_seconds ?? solverSeconds}s</dd></div></dl><h3>候选拒绝原因</h3>{Object.entries(run.result.rejected_by_reason ?? {}).length ? <ul>{Object.entries(run.result.rejected_by_reason ?? {}).map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}</ul> : <p>暂无拒绝候选诊断。</p>}</section>}
        </div>
      </div>
    </div>
  </main>;
}
