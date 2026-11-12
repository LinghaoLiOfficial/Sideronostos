"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, FileCheck2, LoaderCircle, MapPin, Plus, RefreshCw, Sprout } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, getCurrentUser } from "@/lib/api/client";
import * as api from "@/lib/api/field-shift";
import type { Analysis, Field, FieldInput, PlanningInputs, RotationOption } from "@/lib/api/field-shift-types";
import { FieldForm } from "./field-form";
import { EnvironmentPanel } from "./environment-panel";
import { PlanningForm } from "./planning-form";
import { Comparison } from "./comparison";
import { SavedPlanDetail, SavedPlans } from "./saved-plans";
import { errorMessage, formatNumber } from "./model";
import styles from "./field-shift.module.css";

const steps = [{ id: "field", label: "地块与历史" }, { id: "environment", label: "环境与资料" }, { id: "planning", label: "目标与限制" }, { id: "comparison", label: "比较与选择" }] as const;
type Step = typeof steps[number]["id"] | "saved";
type RequestContext = { ownerId: string; fieldId: string | null; fieldVersion: number | null; locationKey: string; navigation: number };

function Loading({ text = "正在读取你的资料…" }: { text?: string }) { return <div className={styles.loading} role="status"><LoaderCircle className="animate-spin" size={25} /><strong>{text}</strong></div>; }
function QueryError({ error, retry }: { error: unknown; retry: () => void }) { return <Alert variant="destructive"><AlertDescription className="grid gap-3">{errorMessage(error)}<Button variant="outline" onClick={retry}><RefreshCw size={15} />重试</Button></AlertDescription></Alert>; }

export function FieldShiftWorkspace() {
  const router = useRouter(); const search = useSearchParams(); const client = useQueryClient();
  const user = useQuery({ queryKey: ["field-shift", "session"], queryFn: getCurrentUser, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: "always" });
  const identityReady = user.isFetchedAfterMount && !user.isFetching;
  const authenticated = Boolean(identityReady && user.isSuccess && user.data?.email_verified);
  const navigationSequence = useRef(0);
  const generationSequence = useRef(0);
  const saveSequence = useRef(0);
  const userId = user.data?.id ?? "anonymous";
  const locationKey = search.toString();
  useEffect(() => { navigationSequence.current += 1; }, [locationKey, userId]);
  useEffect(() => () => { navigationSequence.current += 1; }, []);
  const profiles = useQuery({ queryKey: ["field-shift", "profiles"], queryFn: api.listProfiles, enabled: authenticated, staleTime: 300_000, retry: false });
  const fields = useQuery({ queryKey: ["field-shift", userId, "fields"], queryFn: api.listFields, enabled: authenticated, retry: false });
  const requestedField = search.get("field");
  const selectedField = requestedField === "new" ? undefined : fields.data?.items.find((f) => f.id === requestedField) ?? (!requestedField ? fields.data?.items[0] : undefined);
  const selectedId = selectedField?.id;
  const requestedStep = search.get("step");
  const step: Step = requestedStep === "saved" || steps.some((s) => s.id === requestedStep) ? requestedStep as Step : "field";
  const analysisId = search.get("analysis"); const planId = search.get("plan");
  const analysis = useQuery({ queryKey: ["field-shift", userId, "analysis", analysisId], queryFn: () => api.getAnalysis(analysisId!), enabled: authenticated && Boolean(analysisId), staleTime: Infinity, retry: false });
  const environmentKey = ["field-shift", userId, "environment", selectedId, selectedField?.version];
  const environment = useQuery({ queryKey: environmentKey, queryFn: () => api.getEnvironment(selectedId!), enabled: authenticated && Boolean(selectedId) && step === "environment", staleTime: 300_000, retry: false });
  const refresh = useMutation({ mutationFn: async (request: RequestContext & { fieldId: string; cacheKey: readonly unknown[] }) => {
    const result = await api.getEnvironment(request.fieldId, true);
    client.setQueryData(request.cacheKey, result);
    return result;
  } });
  const plans = useQuery({ queryKey: ["field-shift", userId, "plans", selectedId], queryFn: () => api.listPlans(selectedId), enabled: authenticated && step === "saved" && !planId, retry: false });
  const plan = useQuery({ queryKey: ["field-shift", userId, "plan", planId], queryFn: () => api.getPlan(planId!), enabled: authenticated && step === "saved" && Boolean(planId), staleTime: Infinity, retry: false });
  const [saveTarget, setSaveTarget] = useState<{ option: RotationOption; analysisId: string; ownerId: string; locationKey: string; fieldVersion: number; sequence: number } | null>(null);
  const [title, setTitle] = useState(""); const [notes, setNotes] = useState(""); const [saveError, setSaveError] = useState<string | null>(null);
  const saveOrigin = useRef<{ element: HTMLButtonElement; context: RequestContext } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const previousView = useRef<string | null>(null);
  const viewKey = `${userId}:${selectedId ?? requestedField ?? "new"}:${step}:${planId ?? ""}`;
  const activeSaveTarget = authenticated && saveTarget?.ownerId === userId && saveTarget.locationKey === locationKey && saveTarget.fieldVersion === selectedField?.version ? saveTarget : null;
  const viewReady = authenticated && !profiles.isPending && !fields.isPending && !profiles.error && !fields.error && Boolean(profiles.data?.items.length);
  useEffect(() => {
    const target = mainRef.current;
    if (!viewReady || !target || previousView.current === viewKey) return;
    previousView.current = viewKey;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [viewKey, viewReady]);

  function navigate(nextStep: Step, options: { field?: string; analysis?: string; plan?: string; resetAnalysis?: boolean } = {}) {
    navigationSequence.current += 1;
    const params = new URLSearchParams();
    const fieldId = options.field ?? selectedId ?? "new";
    params.set("field", fieldId); params.set("step", nextStep);
    if (options.analysis || analysisId && !options.resetAnalysis && options.field === undefined) params.set("analysis", options.analysis ?? analysisId!);
    if (options.plan) params.set("plan", options.plan);
    router.replace(`/field-shift?${params}`, { scroll: false });
  }
  function requestContext(): RequestContext {
    return { ownerId: userId, fieldId: selectedId ?? null, fieldVersion: selectedField?.version ?? null, locationKey, navigation: navigationSequence.current };
  }
  function isVisibleContext(request?: RequestContext) {
    return Boolean(request && request.ownerId === userId && request.fieldId === (selectedId ?? null) && request.fieldVersion === (selectedField?.version ?? null) && request.locationKey === locationKey);
  }
  function isCurrentRequest(request: Pick<RequestContext, "ownerId" | "navigation">) {
    const session = client.getQueryState<Awaited<ReturnType<typeof getCurrentUser>>>(["field-shift", "session"]);
    return session?.status === "success" && session.fetchStatus === "idle" && session.data?.id === request.ownerId && session.data.email_verified && request.navigation === navigationSequence.current;
  }
  function restoreSaveFocus(event: Event) {
    event.preventDefault();
    const origin = saveOrigin.current;
    saveOrigin.current = null;
    if (origin?.element.isConnected && isVisibleContext(origin.context) && isCurrentRequest(origin.context)) origin.element.focus({ preventScroll: true });
  }
  function cacheField(value: Field, ownerId: string) {
    const updated = client.setQueryData<{ items: Field[] }>(["field-shift", ownerId, "fields"], (current) => ({ items: current?.items.some((item) => item.id === value.id) ? current.items.map((item) => item.id === value.id && value.version >= item.version ? value : item) : [...(current?.items ?? []), value] }));
    return updated?.items.find((item) => item.id === value.id) ?? value;
  }
  async function persistField(value: FieldInput, expectedVersion?: number) {
    const request = requestContext();
    const saved = request.fieldId ? await api.updateField(request.fieldId, value, expectedVersion ?? request.fieldVersion!) : await api.createField(value);
    cacheField(saved, request.ownerId);
    if (isCurrentRequest(request)) navigate("environment", { field: saved.id, resetAnalysis: true });
  }
  async function reloadField() {
    const request = requestContext();
    if (!request.fieldId) throw new Error("No field selected");
    return cacheField(await api.getField(request.fieldId), request.ownerId);
  }
  function generationRequest(inputs: PlanningInputs) {
    if (!selectedField) throw new Error("No field selected");
    return { ...requestContext(), fieldId: selectedField.id, fieldVersion: selectedField.version, inputs, sequence: ++generationSequence.current };
  }
  const generation = useMutation({ mutationFn: async (request: RequestContext & { fieldId: string; fieldVersion: number; inputs: PlanningInputs; sequence: number }) => {
    const result = await api.createAnalysis(request.fieldId, request.inputs, request.fieldVersion);
    client.setQueryData(["field-shift", request.ownerId, "analysis", result.id], result);
    if (request.sequence === generationSequence.current && isCurrentRequest(request)) navigate("comparison", { field: result.field_id, analysis: result.id });
    return result;
  } });
  function isCurrentSave(request: { ownerId: string; navigation: number; sequence: number }) {
    return isCurrentRequest(request) && request.sequence === saveSequence.current;
  }
  const save = useMutation({ mutationFn: async (request: RequestContext & { input: Parameters<typeof api.savePlan>[0]; sequence: number }) => {
    const saved = await api.savePlan(request.input);
    client.setQueryData(["field-shift", request.ownerId, "plan", saved.id], saved);
    void client.invalidateQueries({ queryKey: ["field-shift", request.ownerId, "plans"] });
    setSaveTarget((current) => current?.ownerId === request.ownerId && current.sequence === request.sequence ? null : current);
    if (isCurrentSave(request)) navigate("saved", { field: saved.field_id, plan: saved.id });
    return saved;
  } });
  const refreshPending = isVisibleContext(refresh.variables) && refresh.isPending;
  const refreshError = isVisibleContext(refresh.variables) ? refresh.error : null;
  const generationPending = isVisibleContext(generation.variables) && generation.isPending;
  const generationError = isVisibleContext(generation.variables) ? generation.error : null;
  const savePending = isVisibleContext(save.variables) && save.variables?.sequence === activeSaveTarget?.sequence && save.isPending;
  async function submitSave(event: FormEvent) {
    event.preventDefault(); if (!activeSaveTarget || savePending) return;
    if (!title.trim()) { setSaveError("请为计划填写名称。"); return; }
    setSaveError(null);
    const request = { ...requestContext(), input: { analysis_id: activeSaveTarget.analysisId, option_id: activeSaveTarget.option.id, title: title.trim(), notes: notes.trim() }, sequence: activeSaveTarget.sequence };
    try { await save.mutateAsync(request); }
    catch (error) { if (isCurrentSave(request)) setSaveError(errorMessage(error)); }
  }
  const selectedProfile = profiles.data?.items.find((p) => p.id === selectedField?.profile_id) ?? profiles.data?.items[0];
  const activeAnalysis: Analysis | undefined = analysis.data?.field_id === selectedId ? analysis.data : undefined;
  const navDisabled = (id: string) => id !== "field" && !selectedField || id === "comparison" && !activeAnalysis;
  const authRequired = user.error instanceof ApiError && user.error.status === 401 || user.isSuccess && !authenticated;
  const loginHref = `/login?next=${encodeURIComponent(`/field-shift${search.size ? `?${search}` : ""}`)}`;
  const shell = (content: React.ReactNode) => <Surface tone="dark" className={styles.app}><header className={styles.topbar}><div className={styles.brandGroup}><Link href="/agriculture" aria-label="Agrisata 农业首页"><BrandLogo priority className="w-28 sm:w-36" /></Link><span className={styles.productName}>Field Shift</span><Link href="/field-shift/map" className={styles.userLink}>地图与轮作助手</Link></div>{authenticated && user.data ? <Link href="/personal/account" className={styles.userLink}>{user.data.display_name}</Link> : <Link href="/agriculture" className={styles.userLink}>了解 Agrisata</Link>}</header>{content}</Surface>;

  if (user.isPending || !identityReady) return shell(<Loading text="正在确认登录状态…" />);
  if (authRequired) return shell(<div className={styles.emptyState}><Sprout size={40} /><span className={styles.eyebrow}>YOUR NEXT THREE SEASONS</span><h2>为下一轮种植，做一个有依据的选择</h2><p>记录地块、了解历史气候，比较满足你资源条件的三年轮作。登录后可保存资料和计划。</p>{user.data && <p>请先完成邮箱验证后再登录。</p>}<Button asChild><Link href={loginHref}>登录并开始<ArrowRight size={17} /></Link></Button><p className={styles.help}>当前地区和作物配置为明确标识的示范，不代表已验证的当地种植建议。</p></div>);
  if (user.error) return shell(<main className={styles.main}><QueryError error={user.error} retry={() => void user.refetch()} /></main>);
  if (profiles.isPending || fields.isPending) return shell(<Loading />);
  if (profiles.error || fields.error) return shell(<main className={styles.main}><QueryError error={profiles.error ?? fields.error} retry={() => { void profiles.refetch(); void fields.refetch(); }} /></main>);
  if (!profiles.data?.items.length) return shell(<div className={styles.emptyState}><h2>地区配置暂不可用</h2><p>目前没有可用的作物与农艺规则，请稍后重试。</p><Button onClick={() => void profiles.refetch()}>重新加载</Button></div>);

  let content: React.ReactNode;
  if (step === "saved") {
    if (planId) content = plan.isPending ? <Loading text="正在读取保存时的完整资料…" /> : plan.error ? <QueryError error={plan.error} retry={() => void plan.refetch()} /> : plan.data ? <SavedPlanDetail plan={plan.data} onBack={() => navigate("saved")} /> : null;
    else content = plans.isPending ? <Loading /> : plans.error ? <QueryError error={plans.error} retry={() => void plans.refetch()} /> : <SavedPlans plans={plans.data?.items ?? []} onOpen={(item) => { client.setQueryData(["field-shift", userId, "plan", item.id], item); navigate("saved", { field: item.field_id, plan: item.id, resetAnalysis: true }); }} onStart={() => navigate(selectedField ? "environment" : "field")} />;
  } else if (requestedField && requestedField !== "new" && !selectedField) {
    content = <div className={styles.emptyState}><h2>找不到这块地</h2><p>它可能不属于当前账户。请在左侧选择已有地块或创建一块。</p><Button onClick={() => navigate("field", { field: "new", resetAnalysis: true })}>创建地块</Button></div>;
  } else if (step === "field" || !selectedField) {
    content = <FieldForm key={`${userId}:${selectedId ?? "new"}`} field={selectedField} profiles={profiles.data.items} userId={userId} onSave={persistField} onReload={selectedField ? reloadField : undefined} />;
  } else if (step === "environment") {
    content = <EnvironmentPanel environment={environment.data} loading={environment.isFetching || refreshPending} error={refreshError || environment.error ? errorMessage(refreshError ?? environment.error) : null} onRefresh={() => refresh.mutate({ ...requestContext(), fieldId: selectedField.id, cacheKey: environmentKey })} onContinue={() => navigate("planning")} />;
  } else if (step === "planning") {
    content = selectedProfile ? <PlanningForm key={`${userId}:${selectedId}:${selectedProfile.version}`} field={selectedField} profile={selectedProfile} userId={userId} initial={activeAnalysis?.inputs} onGenerate={async (inputs) => { await generation.mutateAsync(generationRequest(inputs)); }} busy={generationPending} error={generationError ? errorMessage(generationError) : null} /> : null;
  } else {
    content = analysis.isFetching && !analysis.data ? <Loading text="正在恢复方案比较…" /> : analysis.error ? <QueryError error={analysis.error} retry={() => void analysis.refetch()} /> : activeAnalysis ? <Comparison key={activeAnalysis.id} analysis={activeAnalysis} stale={activeAnalysis.field_version !== selectedField.version} busy={generationPending} error={generationError ? errorMessage(generationError) : null} onRecalculate={(inputs) => generation.mutate(generationRequest(inputs))} onEdit={() => navigate("planning")} onSave={(option, trigger) => { saveOrigin.current = { element: trigger, context: requestContext() }; setSaveError(null); setNotes(""); setTitle(`${selectedField.name} · ${activeAnalysis.inputs.start_year}–${activeAnalysis.inputs.start_year + 2}`); setSaveTarget({ option, analysisId: activeAnalysis.id, ownerId: userId, locationKey, fieldVersion: selectedField.version, sequence: ++saveSequence.current }); }} /> : <div className={styles.emptyState}><h2>先设定你的种植目标</h2><p>生成方案后，这里会并排比较基准与可行轮作。</p><Button onClick={() => navigate("planning")}>设置目标与限制</Button></div>;
  }

  return shell(<><div className={styles.layout}><aside className={`${styles.sidebar} ${styles.noPrint}`}><div className={styles.sidebarInner}><div><span className={styles.sideTitle}>MY FIELDS / 我的地块</span><div className={styles.fieldPicker}><select className={styles.select} aria-label="选择地块" value={selectedId ?? "new"} onChange={(e) => { navigate("field", { field: e.target.value, resetAnalysis: true }); }}><option value="new">新建地块</option>{fields.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{selectedField && <Button variant="outline" size="sm" onClick={() => navigate("field", { field: "new", resetAnalysis: true })}><Plus size={15} />新建</Button>}</div></div><nav aria-label="轮作规划步骤" className={styles.sideNav}>{steps.map((item, index) => <button key={item.id} type="button" disabled={navDisabled(item.id)} aria-current={step === item.id ? "step" : undefined} onClick={() => navigate(item.id)}><span className={styles.stepNumber}>{index + 1}</span>{item.label}</button>)}</nav><Button variant={step === "saved" ? "secondary" : "ghost"} className={styles.savedNav} onClick={() => navigate("saved")}><FileCheck2 size={16} />已存计划</Button><div className={styles.sideNote}><strong>由你的条件出发</strong>先满足农艺与资源限制，再比较用水、覆盖、多样性和投入。<p className="mt-3">当前使用可配置示范规则；实际种植前需要当地核对。</p><Link href="/agriculture" className="mt-4 inline-flex items-center gap-2"><ArrowLeft size={13} />返回农业首页</Link></div></div></aside><main ref={mainRef} tabIndex={-1} aria-label="轮作规划内容" id="field-shift-main" className={`${styles.main} ${step === "comparison" ? styles.mainWide : ""}`}><h1 className={styles.srOnly}>Field Shift 轮作规划</h1>{selectedField && step !== "saved" && <div className={styles.fieldContext}><MapPin size={14} /><strong>{selectedField.name}</strong><span>{formatNumber(selectedField.area_ha, 2)} 公顷</span><span>·</span><span>{selectedField.irrigation_available ? "具备灌溉条件" : "无补灌"}</span></div>}{content}</main></div>
    <Dialog open={Boolean(activeSaveTarget)} onOpenChange={(open) => { if (!open && !savePending) setSaveTarget(null); }}><DialogContent onCloseAutoFocus={restoreSaveFocus}><DialogHeader><DialogTitle>保存这个轮作计划</DialogTitle><DialogDescription>同时保存当时的资料、假设和计算依据，方便之后重开核对。</DialogDescription></DialogHeader><form onSubmit={submitSave} className={styles.dialogForm}><label className={styles.field}>计划名称<Input aria-label="计划名称" disabled={savePending} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label><label className={styles.field}>备注（可选）<Textarea aria-label="计划备注" disabled={savePending} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="例如：和合作社确认豌豆收购渠道" /></label>{saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}<Button type="submit" disabled={savePending}>{savePending ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}{savePending ? "正在保存…" : "确认保存计划"}</Button></form></DialogContent></Dialog>
  </>);
}
