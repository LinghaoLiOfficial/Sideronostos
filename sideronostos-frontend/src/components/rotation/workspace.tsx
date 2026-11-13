"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { buildAssistantContext } from "./assistant-context";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { useScienceQueries } from "./use-science-queries";
import { useWorkspaceSession } from "./use-workspace-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Layers, Map, Plus, Sprout } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { ApiError, type AuthUser } from "@/lib/api/client";
import * as fieldsApi from "@/lib/api/field-shift";
import * as api from "@/lib/api/rotation";
import type { Field } from "@/lib/api/field-shift-types";
import type {
  ChangedCondition,
  Geometry,
  RegionSelection,
  RotationInput,
  RunV2,
  ScienceFact,
} from "@/lib/api/rotation-types";
import { observationWindow, scienceSourceName } from "./workspace-state";
import { AssistantDock } from "./assistant-dock";
import {
  labels,
  dataStatus,
  missingReason,
  readableUnit,
} from "./science-presentation";
import { MapCanvas } from "./map-canvas";
import { PlannerForm } from "./planner-form";
import { allOptions, RunResults, SavedPlan } from "./results";
import { fieldInput, formatValue as n, runStatus } from "./planning-model";
import { errorMessage } from "../field-shift/model";
import styles from "./workspace.module.css";

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className={styles.notice} role="status">
      {children}
    </p>
  );
}
function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className={styles.error} role="alert">
      {errorMessage(error)}{" "}
      <button type="button" onClick={retry}>
        重试
      </button>
    </div>
  );
}
function Header({
  mode,
  user,
  search = "",
}: {
  mode: "map" | "rotation";
  user?: AuthUser;
  search?: string;
}) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/refer-2">
        <Sprout size={25} />
        <span>
          Agrisata <small>FIELD SHIFT</small>
        </span>
      </Link>
      <nav aria-label="Field Shift 工作区">
        <Link
          aria-current={mode === "map" ? "page" : undefined}
          href={`/fields${search ? "?" + search : ""}`}
        >
          <Map size={16} />
          地图
        </Link>
        <Link
          aria-current={mode === "rotation" ? "page" : undefined}
          href={`/field-shift/rotation${search ? "?" + search : ""}`}
        >
          <Sprout size={16} />
          轮作规划
        </Link>
      </nav>
      <Link
        className={styles.account}
        href={user ? "/personal/account" : "/field-shift"}
      >
        {user?.display_name ?? "地块管理"}
      </Link>
    </header>
  );
}
export function RotationWorkspace({ mode }: { mode: "map" | "rotation" }) {
  const search = useSearchParams();
  const { session, ready } = useWorkspaceSession();
  if (!ready)
    return (
      <Surface tone="light" className={styles.app}>
        <Header mode={mode} />
        <main className={styles.empty} role="status">
          正在确认登录状态…
        </main>
      </Surface>
    );
  if (
    (session.error instanceof ApiError && session.error.status === 401) ||
    (session.data && !session.data.email_verified)
  )
    return (
      <Surface tone="light" className={styles.app}>
        <Header mode={mode} />
        <main className={styles.empty}>
          <Sprout size={38} />
          <h1>从你的地块，开始下一轮种植</h1>
          <p>登录后可以查看区域数据、比较轮作，并保存你的计划。</p>
          {session.data && !session.data.email_verified && (
            <p>请先完成邮箱验证。</p>
          )}
          <Link
            className={styles.primary}
            href={`/login?next=${encodeURIComponent(`/field-shift/${mode}?${search}`)}`}
          >
            登录并继续 <ArrowRight size={16} />
          </Link>
        </main>
      </Surface>
    );
  if (session.error || !session.data)
    return (
      <Surface tone="light" className={styles.app}>
        <Header mode={mode} />
        <main className={styles.empty}>
          <QueryError
            error={session.error}
            retry={() => void session.refetch()}
          />
        </main>
      </Surface>
    );
  return (
    <OwnerWorkspace key={session.data.id} owner={session.data} mode={mode} />
  );
}
function OwnerWorkspace({
  owner,
  mode,
}: {
  owner: AuthUser;
  mode: "map" | "rotation";
}) {
  const navigation = useWorkspaceNavigation(`/field-shift/${mode}`);
  const { search, latestSearch, revision: contextRevision, setRevision: setContextRevision } = navigation;
  const client = useQueryClient();
  const requestedField = search.get("field"),
    selectionId = search.get("selection"),
    runId = search.get("run"),
    optionId = search.get("option"),
    planId = search.get("plan"),
    compareId = search.get("compare"),
    compareOptionId = search.get("compareOption");
  const [selectionError, setSelectionError] = useState<string | null>(null),
    [selecting, setSelecting] = useState(false);
  const layerId = search.get("layer") ?? "";
  const window = observationWindow(
    search.get("obsStart"),
    search.get("obsEnd"),
  );
  const dates = window.dates;
  const dateBasis = `${search.get("obsStart") ?? ""}:${search.get("obsEnd") ?? ""}`;
  const [dateDraft, setDateDraft] = useState<{
    basis: string;
    start: string;
    end: string;
  } | null>(null);
  const dateStart =
    dateDraft?.basis === dateBasis ? dateDraft.start : (dates?.start ?? "");
  const dateEnd =
    dateDraft?.basis === dateBasis ? dateDraft.end : (dates?.end ?? "");

  const [changes, setChanges] = useState<ChangedCondition[]>([]),
    [draftFields, setDraftFields] = useState<RotationInput["fields"]>([]),
    [openRequest, setOpenRequest] = useState<{ id: number; text: string }>(),
    [boundaryBusy, setBoundaryBusy] = useState(false),
    [boundaryMessage, setBoundaryMessage] = useState<string | null>(null),
    [savedMessage, setSavedMessage] = useState<string | null>(null);
  const selectionSeq = useRef(0),
    abort = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionSeq.current++;
      abort.current?.abort();
    };
  }, []);
  const fields = useQuery({
    queryKey: ["field-shift", owner.id, "fields"],
    queryFn: fieldsApi.listFields,
    retry: false,
  });
  const profiles = useQuery({
    queryKey: ["rotation", owner.id, "profiles"],
    queryFn: api.listRotationProfiles,
    retry: false,
    staleTime: 300000,
  });
  const selectedField = fields.data?.items.find((f) => f.id === requestedField),
    profile = profiles.data?.items[0];
  const { selection, facts, layers, manifest } = useScienceQueries(owner.id, selectionId, layerId, dates);
  const run = useQuery({
    queryKey: ["rotation", owner.id, "run", runId],
    queryFn: () => api.getRun(runId!),
    enabled: Boolean(runId),
    retry: false,
    refetchInterval: (q) =>
      ["pending", "running"].includes(q.state.data?.status ?? "")
        ? 1800
        : false,
  });
  const plans = useQuery({
    queryKey: ["rotation", owner.id, "plans"],
    queryFn: api.listRotationPlans,
    enabled: mode === "rotation",
    retry: false,
  });
  const saved = useQuery({
    queryKey: ["rotation", owner.id, "plan", planId],
    queryFn: () => api.getRotationPlan(planId!),
    enabled: Boolean(planId),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["rotation", owner.id, "runs"],
    queryFn: api.listRuns,
    enabled: mode === "rotation",
    retry: false,
  });
  function navigate(patch: Record<string, string | null>, nextMode = mode) {
    navigation.navigate(patch, `/field-shift/${nextMode}`);
  }
  async function selectRegion(
    kind: RegionSelection["kind"],
    geometry: Geometry,
  ) {
    const sequence = ++selectionSeq.current;
    abort.current?.abort();
    abort.current = new AbortController();
    setSelecting(true);
    setSelectionError(null);
    setBoundaryMessage(null);
    try {
      const selected = await api.createSelection(
        kind,
        geometry,
        contextRevision + 1,
        abort.current.signal,
      );
      if (!mounted.current || sequence !== selectionSeq.current) return false;
      client.setQueryData(
        ["rotation", owner.id, "selection", selected.id],
        selected,
      );
      navigate({ selection: selected.id });
      return true;
    } catch (cause) {
      if (mounted.current && sequence === selectionSeq.current)
        setSelectionError(
          kind === "polygon" &&
            cause instanceof ApiError &&
            cause.status === 422
            ? "区域未能保存。请检查边界是否交叉、范围是否过大或顶点过多；顶点已保留，可以撤回修正。"
            : errorMessage(cause),
        );
      return false;
    } finally {
      if (mounted.current && sequence === selectionSeq.current)
        setSelecting(false);
    }
  }
  function selectField(field: Field) {
    selectionSeq.current++;
    abort.current?.abort();
    setSelecting(false);
    setBoundaryMessage(null);
    navigate({ field: field.id });
  }
  const updateField = useCallback(
    (field: Field) => {
      if (!mounted.current) return;
      client.setQueryData<{ items: Field[] }>(
        ["field-shift", owner.id, "fields"],
        (old) => ({
          items: (old?.items ?? []).map((f) =>
            f.id === field.id && f.version <= field.version ? field : f,
          ),
        }),
      );
      setContextRevision((value) => value + 1);
    },
    [client, owner.id, setContextRevision],
  );
  async function saveBoundary() {
    if (!selectedField || selectedField.farm_id || selection.data?.kind !== "polygon") return;
    const origin = { field: selectedField.id, selection: selection.data.id };
    setBoundaryBusy(true);
    setBoundaryMessage(null);
    try {
      const field = await fieldsApi.updateField(
        selectedField.id,
        { ...fieldInput(selectedField), geometry: selection.data.geometry },
        selectedField.version,
      );
      if (!mounted.current) return;
      updateField(field);
      const params = new URLSearchParams(latestSearch.current);
      if (
        params.get("field") === origin.field &&
        params.get("selection") === origin.selection
      )
        setBoundaryMessage(
          "边界已保存。经营面积保持你填写的数值，地块版本已更新。",
        );
    } catch (cause) {
      if (mounted.current) setBoundaryMessage(errorMessage(cause));
    } finally {
      if (mounted.current) setBoundaryBusy(false);
    }
  }
  function updateRun(value: RunV2) {
    client.setQueryData(["rotation", owner.id, "run", value.id], value);
    void client.invalidateQueries({ queryKey: ["rotation", owner.id, "runs"] });
    if (mounted.current && latestSearch.current === search.toString())
      navigate({
        run: value.id,
        option: null,
        plan: null,
        compare: null,
        compareOption: null,
      });
  }
  const onDraft = useCallback(
    (next: ChangedCondition[], chosen: RotationInput["fields"]) => {
      setChanges((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
      setDraftFields((old) =>
        JSON.stringify(old) === JSON.stringify(chosen) ? old : chosen,
      );
      setContextRevision((value) => value + 1);
    },
    [setContextRevision],
  );
  const fieldStale =
    run.data?.field_snapshots.some((snapshot) => {
      const current = fields.data?.items.find((f) => f.id === snapshot.id);
      return !current || current.version !== snapshot.version;
    }) ?? false;
  const visibleChanges: ChangedCondition[] =
    fieldStale && !changes.includes("fields")
      ? [...changes, "fields"]
      : changes;
  const hasRun = Boolean(
      run.data && (!planId || saved.data?.run_id === run.data.id),
    ),
    actualOption =
      run.data &&
      allOptions(run.data).find(
        (o) => o.id === (planId ? saved.data?.option_id : optionId),
      );
  const context = buildAssistantContext({
    revision: contextRevision, page: mode,
    selection: selection.data ? { id: selection.data.id, revision: selection.data.revision } : null,
    dates, fields: mode === "rotation" ? draftFields.filter(f => fields.data?.items.some(current => current.id === f.id && current.version === f.expected_version))
      : selectedField ? [{ id: selectedField.id, expected_version: selectedField.version }] : [],
    runId: hasRun ? run.data!.id : null, optionId: actualOption?.id,
    compareRunId: compareId, compareOptionId, saved: Boolean(planId), changes: visibleChanges,
  });
  const contextLabel = [
    hasRun
      ? run.data!.field_snapshots.map((f) => f.name).join("、")
      : (selectedField?.name ?? "未选择经营地块"),
    selection.data
      ? `地图${{ point: "选点", polygon: "区域", viewport: "视野" }[selection.data.kind]} ${selection.data.center.map((v) => n(v, 3)).join(", ")}`
      : "未选地图区域",
    actualOption
      ? actualOption.id === "baseline"
        ? "基准种法"
        : actualOption.id.replace("option-", "方案 ")
      : hasRun
        ? "未选择方案"
        : "",
    dates ? `${dates.start}—${dates.end}` : "全部已发布观测",
  ]
    .filter(Boolean)
    .join(" · ");
  function applyDates(event: FormEvent) {
    event.preventDefault();
    const next = observationWindow(dateStart, dateEnd);
    if (!next.dates) {
      setSelectionError(next.error ?? "请填写观测起止日期。");
      return;
    }
    navigate({ obsStart: dateStart, obsEnd: dateEnd });
    setSelectionError(null);
  }
  const dataSidebar = (
    <>
      <section className={styles.sidebarSection}>
        <p className={styles.eyebrow}>YOUR LAND, YOUR DECISIONS</p>
        <h1>先了解这片土地</h1>
        <p className={styles.help}>查看已准备的数据，再讨论下一轮种植。</p>
        <label>
          我的经营地块
          <select
            value={selectedField?.id ?? ""}
            onChange={(e) => {
              const f = fields.data?.items.find((f) => f.id === e.target.value);
              if (f) selectField(f);
              else navigate({ field: null });
            }}
          >
            <option value="">选择已有地块</option>
            {fields.data?.items.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · {f.area_ha} ha
              </option>
            ))}
          </select>
        </label>
        {fields.isPending && <p role="status">正在读取地块…</p>}
        {fields.error && (
          <QueryError
            error={fields.error}
            retry={() => void fields.refetch()}
          />
        )}
        <div className={styles.sidebarLinks}>
          <Link href={`/field-shift?field=${selectedField?.id ?? "new"}`}>
            {selectedField ? "编辑地块与历史" : "创建地块"} <Plus size={13} />
          </Link>
          <Link href={`/field-shift/rotation?${search}`}>
            开始轮作规划 <ArrowRight size={13} />
          </Link>
        </div>
        {requestedField && !selectedField && !fields.isPending && (
          <Notice>此地块当前不可用，请重新选择。</Notice>
        )}
      </section>
      <section className={styles.sidebarSection}>
        <h2>
          <Layers size={16} />
          已发布数据
        </h2>
        <label>
          地图图层
          <select
            value={layerId}
            onChange={(e) => navigate({ layer: e.target.value || null })}
          >
            <option value="">仅显示底图</option>
            {layers.data?.items.map((layer) => (
              <option key={layer.id} value={layer.id}>
                SMAP 表层土壤水分 · {layer.pass} · {layer.start.slice(0, 10)}
              </option>
            ))}
          </select>
        </label>
        {layers.error && (
          <QueryError
            error={layers.error}
            retry={() => void layers.refetch()}
          />
        )}
        {window.error && (
          <Notice>
            {window.error}当前显示全部已发布观测，请重新应用日期。
          </Notice>
        )}
        <details className={styles.details}>
          <summary>按观测日期筛选数据</summary>
          <form onSubmit={applyDates}>
            <div className={styles.twoColumns}>
              <label>
                开始
                <input
                  type="date"
                  value={dateStart}
                  required
                  onChange={(e) =>
                    setDateDraft({
                      basis: dateBasis,
                      start: e.target.value,
                      end: dateEnd,
                    })
                  }
                />
              </label>
              <label>
                结束
                <input
                  type="date"
                  value={dateEnd}
                  min={dateStart}
                  required
                  onChange={(e) =>
                    setDateDraft({
                      basis: dateBasis,
                      start: dateStart,
                      end: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className={styles.actions}>
              <button>应用日期</button>
              <button
                type="button"
                onClick={() => {
                  setDateDraft(null);
                  setSelectionError(null);
                  navigate({ obsStart: null, obsEnd: null });
                }}
              >
                查看全部
              </button>
            </div>
          </form>
        </details>
        <p className={styles.help}>
          图层日期与查询日期分别显示。2025 年历史天气和 2026
          年卫星观测是不同资料，不表示未来预报。
        </p>
      </section>
      <section className={styles.sidebarSection}>
        <h2>所选区域的资料</h2>
        {selecting && <p role="status">正在保存选区…</p>}
        {selectionError && (
          <p className={styles.error} role="alert">
            {selectionError}
          </p>
        )}
        {selection.error && (
          <QueryError
            error={selection.error}
            retry={() => void selection.refetch()}
          />
        )}{" "}
        {!selectionId && !selecting && (
          <p className={styles.help}>
            点击地图选点、画一个区域，或明确采用当前视野。仅拖动地图不会改变助手的选区。
          </p>
        )}
        {selection.data && (
          <>
            <div className={styles.selectionMeta}>
              <strong>
                {
                  {
                    point: "地图选点",
                    polygon: "手绘区域",
                    viewport: "已采用的视野",
                  }[selection.data.kind]
                }
              </strong>
              <span>
                {selection.data.center.map((v) => n(v, 4)).join(", ")}
              </span>
              {selection.data.area_ha != null && (
                <span>几何面积 {n(selection.data.area_ha, 2)} ha</span>
              )}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  selectionSeq.current++;
                  abort.current?.abort();
                  setSelecting(false);
                  navigate({ selection: null });
                }}
              >
                清除选区
              </button>
            </div>
            {selection.data.kind === "polygon" && selectedField && !selectedField.farm_id && (
              <details className={styles.details}>
                <summary>将区域保存为「{selectedField.name}」的边界</summary>
                <p className={styles.help}>
                  经营面积：{n(selectedField.area_ha, 2)} ha；绘制面积：
                  {n(selection.data.area_ha, 2)}{" "}
                  ha。保存只更新边界与版本，请在地块管理中核对面积。
                </p>
                <button
                  type="button"
                  disabled={boundaryBusy}
                  onClick={() => void saveBoundary()}
                >
                  {boundaryBusy ? "正在保存…" : "保存为此地块边界"}
                </button>
              </details>
            )}
            {boundaryMessage && <Notice>{boundaryMessage}</Notice>}
          </>
        )}
        {facts.isFetching && <p role="status">正在读取已发布的区域事实…</p>}
        {facts.error && (
          <QueryError error={facts.error} retry={() => void facts.refetch()} />
        )}{" "}
        {facts.data?.facts.map((fact, index) => (
          <ScienceRow key={fact.id + ":" + index} fact={fact} />
        ))}
        {facts.data?.unavailable.map((missing, index) => (
          <Notice key={index}>
            <strong>
              {scienceSourceName(
                missing.release_id,
                layers.data?.items ?? [],
                profiles.data?.items ?? [],
              )}
              ：
            </strong>{" "}
            {missingReason[missing.reason] ?? "该范围暂无适用资料。"}
            {!missingReason[missing.reason] && missing.detail
              ? ` · ${missing.detail}`
              : ""}
          </Notice>
        ))}
        {facts.data &&
          !facts.data.facts.length &&
          !facts.data.unavailable.length && (
            <Notice>该区域与日期没有已发布的资料。缺测不能解释为零。</Notice>
          )}
      </section>
      <p className={styles.sidebarFooter}>
        初始地图停在研发天气样本附近，尚未确定业务试点。
      </p>
    </>
  );
  let planningBody: ReactNode;
  if (planId) {
    planningBody = (
      <>
        {saved.isPending ? (
          <p role="status">正在恢复保存时的计划…</p>
        ) : saved.error ? (
          <QueryError error={saved.error} retry={() => void saved.refetch()} />
        ) : saved.data ? (
          <SavedPlan plan={saved.data} />
        ) : null}
        <button type="button" onClick={() => navigate({ plan: null })}>
          返回规划
        </button>
      </>
    );
  } else {
    planningBody = (
      <>
        {profiles.isPending ||
        fields.isPending ||
        Boolean(runId && run.isPending) ? (
          <p role="status">正在恢复你的规划资料…</p>
        ) : profiles.error || fields.error ? (
          <QueryError
            error={profiles.error ?? fields.error}
            retry={() => {
              void profiles.refetch();
              void fields.refetch();
            }}
          />
        ) : profile ? (
          <PlannerForm
            owner={owner.id}
            profile={profile}
            fields={fields.data?.items ?? []}
            run={run.data}
            selectedFieldId={selectedField?.id}
            onRun={updateRun}
            onDraft={onDraft}
            onFieldSaved={updateField}
          />
        ) : (
          <Notice>当前没有可用的农艺参数包。</Notice>
        )}
        {run.error && (
          <QueryError error={run.error} retry={() => void run.refetch()} />
        )}
        {run.data && (
          <RunResults
            key={run.data.id}
            owner={owner.id}
            run={run.data}
            changes={visibleChanges}
            selectedOptionId={optionId}
            onSelect={(id) => navigate({ option: id })}
            onExplain={(option) => {
              navigate({ option: option.id });
              setOpenRequest({
                id: Date.now(),
                text: "请解释这个方案的主要取舍，以及我需要核对什么。",
              });
            }}
            onUpdate={updateRun}
            onSaved={(plan) => {
              client.setQueryData(
                ["rotation", owner.id, "plan", plan.id],
                plan,
              );
              void client.invalidateQueries({
                queryKey: ["rotation", owner.id, "plans"],
              });
              setSavedMessage("计划已保存，包含本次输入、结果与来源。");
              navigate({ plan: plan.id });
            }}
            compareRunId={compareId}
            compareOptionId={compareOptionId}
            onCompare={(id, option) =>
              navigate({ compare: id, compareOption: option })
            }
          />
        )}
      </>
    );
  }
  return (
    <Surface tone="light" className={styles.app}>
      <Header mode={mode} user={owner} search={search.toString()} />
      <div
        className={mode === "map" ? styles.mapLayout : styles.planningLayout}
      >
        <main
          className={
            mode === "map" ? styles.mapSidebar : styles.planningContent
          }
        >
          {mode === "map" ? (
            dataSidebar
          ) : (
            <>
              <div className={styles.planningNavigation}>
                <Link href={`/fields?${search}`}>
                  <ArrowLeft size={14} />
                  返回地图
                </Link>
                <details>
                  <summary>计算与已存计划</summary>
                  <label>
                    计算历史
                    <select
                      value={runId ?? ""}
                      onChange={(e) =>
                        navigate({
                          run: e.target.value || null,
                          option: null,
                          plan: null,
                          compare: null,
                          compareOption: null,
                        })
                      }
                    >
                      <option value="">新规划</option>
                      {history.data?.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {new Date(item.created_at).toLocaleString()} ·{" "}
                          {runStatus[
                            item.id === run.data?.id
                              ? run.data.status
                              : item.status
                          ] ?? item.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    已存计划
                    <select
                      value={planId ?? ""}
                      onChange={(e) => {
                        const chosen = plans.data?.items.find(
                          (p) => p.id === e.target.value,
                        );
                        navigate({
                          plan: chosen?.id ?? null,
                          ...(chosen
                            ? {
                                run: chosen.run_id,
                                option: chosen.option_id,
                                compare: null,
                                compareOption: null,
                              }
                            : {}),
                        });
                      }}
                    >
                      <option value="">选择已存计划</option>
                      {plans.data?.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(history.error || plans.error) && (
                    <QueryError
                      error={history.error ?? plans.error}
                      retry={() => {
                        void history.refetch();
                        void plans.refetch();
                      }}
                    />
                  )}
                </details>
              </div>
              {savedMessage && <Notice>{savedMessage}</Notice>}
              {planningBody}
            </>
          )}
        </main>
        <section className={styles.mapStage} aria-label="地图与轮作助手">
          <MapCanvas
            fields={fields.data?.items ?? []}
            selectedField={selectedField}
            selection={selection.data ?? null}
            layer={manifest.data ?? null}
            onSelect={selectRegion}
            onField={selectField}
          />
          {manifest.error && (
            <div className={styles.mapError}>
              <QueryError
                error={manifest.error}
                retry={() => void manifest.refetch()}
              />
            </div>
          )}
          {mode === "rotation" && (
            <div className={styles.mapSummary}>
              正在规划{" "}
              {run.data ? run.data.field_snapshots.length : draftFields.length}{" "}
              个经营地块 · 地图选区用于查询背景
            </div>
          )}
          <AssistantDock
            ownerId={owner.id}
            context={context}
            contextLabel={contextLabel}
            contextPending={selecting || Boolean((runId || planId) && !hasRun) || Boolean(selectionId && !selection.data)}
            openRequest={openRequest}
            onAction={(action) => {
              if (action === "open_planner" || action === "edit_conditions") {
                navigate({ plan: null }, "rotation");
                setTimeout(
                  () => document.getElementById("planning-conditions")?.focus(),
                  50,
                );
              } else if (action === "choose_field") navigation.navigate({}, "/fields");
            }}
          />
        </section>
      </div>
    </Surface>
  );
}

function ScienceRow({ fact }: { fact: ScienceFact }) {
  return (
    <article className={styles.scienceRow}>
      <div>
        <strong>
          {labels[fact.metric] ?? fact.metric}
          {fact.pass ? ` · ${fact.pass}` : ""}
        </strong>
        <b>
          {fact.value == null
            ? "暂无有效值"
            : `${n(fact.value, 4)} ${readableUnit(fact.unit)}`}
        </b>
      </div>
      <p>
        {fact.period?.start?.slice(0, 10)}—{fact.period?.end?.slice(0, 10)} ·{" "}
        {dataStatus[fact.status] ?? "资料状态待核对"}
      </p>
      <details>
        <summary>来源与限制</summary>
        <p>
          {String(
            fact.source.product ?? fact.source.release_id ?? fact.data_kind,
          )}
        </p>
        {fact.acquired_at && <p>采集时间：{fact.acquired_at}</p>}
        {fact.retrieval_qual_flag != null && (
          <p>检索质量标记：{fact.retrieval_qual_flag}</p>
        )}
        <ul>
          {fact.limitations.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
        {typeof fact.source.url === "string" &&
          /^https?:\/\//.test(fact.source.url) && (
            <a href={fact.source.url} target="_blank" rel="noreferrer">
              原始来源
            </a>
          )}
      </details>
    </article>
  );
}
