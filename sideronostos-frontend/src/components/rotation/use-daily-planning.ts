"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import type { Field } from "@/lib/api/field-shift-types";
import type { ServerFarmHeader } from "@/lib/api/farms";
import type {
  DailyDraft,
  DailyInput,
  DailyProfile,
  DailyReadiness,
  DailyRun,
} from "@/lib/api/daily-types";
import type { ChangedCondition } from "@/lib/api/rotation-types";
import * as api from "@/lib/api/daily";
import { errorMessage } from "../field-shift/model";
import {
  activePlanningFields,
  clearPendingDaily,
  dailyChanges,
  dailyDraftSchema,
  emptyDailyDraft,
  prepareDailyRequest,
  readDailyDraft,
  readPendingDaily,
  saveDailyDraft,
  savePendingDaily,
  selectDailyFields,
} from "./daily-model";

type Props = {
  owner: string;
  profile: DailyProfile;
  fields: Field[];
  farms: ServerFarmHeader[];
  run?: DailyRun;
  selectedFieldId?: string;
  historyDirty: boolean;
  onRun: (run: DailyRun) => void;
  onDraft: (changes: ChangedCondition[], fields: DailyDraft["fields"]) => void;
};
export function draftFromDailyRun(run: DailyRun): DailyDraft {
  const { idempotency_key: _key, ...draft } = run.request;
  void _key;
  return dailyDraftSchema.parse(draft);
}
/** Mount with an owner/profile key. Late requests are additionally fenced by owner and input basis. */
export function useDailyPlanning({
  owner,
  profile,
  fields,
  farms,
  run,
  selectedFieldId,
  historyDirty,
  onRun,
  onDraft,
}: Props) {
  const [draft, setDraft] = useState<DailyDraft>(() => {
    const stored = readDailyDraft(owner, profile);
    if (stored) return stored;
    if (
      run?.request.profile_id === profile.id &&
      run.provenance.profile_sha256 === profile.sha256
    )
      return draftFromDailyRun(run);
    const chosen = activePlanningFields(fields, farms).find(
      (f) => f.id === selectedFieldId,
    );
    return selectDailyFields(
      emptyDailyDraft(profile),
      chosen ? [chosen] : [],
      profile,
    );
  });
  const [pending, setPending] = useState<DailyInput | null>(() =>
    readPendingDaily(owner),
  );
  const [checked, setChecked] = useState<{
    basis: string;
    value: DailyReadiness;
  } | null>(null);
  const [checking, setChecking] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [storageError, setStorageError] = useState(false);
  const basis = JSON.stringify({
    draft,
    owner,
    profile: profile.sha256,
    fields: fields
      .filter((f) => draft.fields.some((c) => c.id === f.id))
      .map((f) => [f.id, f.version, f.partition_revision]),
    farms: farms.map((f) => [f.id, f.partition_revision]),
  });
  const latest = useRef({ owner, basis }),
    mounted = useRef(true),
    inFlight = useRef(false),
    sequence = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    latest.current = { owner, basis };
  }, [owner, basis]);
  useEffect(() => {
    mounted.current = true;
    const requestSequence = sequence;
    return () => {
      mounted.current = false;
      requestSequence.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    onDraft(run ? dailyChanges(run.request, draft) : [], draft.fields);
  }, [draft, run, onDraft]);
  const readiness =
    checked?.basis === basis && !historyDirty ? checked.value : null;
  const runActive = run?.status === "pending" || run?.status === "running";
  function replaceDraft(next: DailyDraft) {
    sequence.current++;
    controller.current?.abort();
    setChecking(false);
    setChecked(null);
    setError(null);
    setDraft(next);
    try {
      saveDailyDraft(owner, profile, next);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  async function check() {
    if (historyDirty) {
      setError("请先保存或放弃前茬修改，再检查资料。");
      return;
    }
    setError(null);
    setChecked(null);
    let body: DailyDraft;
    try {
      const { idempotency_key: _key, ...value } = prepareDailyRequest(
        draft,
        profile,
        fields,
        farms,
        crypto.randomUUID(),
      );
      void _key;
      body = value;
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    const token = ++sequence.current,
      captured = { owner, basis };
    controller.current?.abort();
    controller.current = new AbortController();
    setChecking(true);
    try {
      const report = await api.checkDailyReadiness(
        owner,
        body,
        controller.current.signal,
      );
      if (
        mounted.current &&
        token === sequence.current &&
        latest.current.owner === captured.owner &&
        latest.current.basis === captured.basis
      )
        setChecked({ basis, value: report });
    } catch (cause) {
      if (
        mounted.current &&
        token === sequence.current &&
        latest.current.basis === basis
      )
        setError(errorMessage(cause));
    } finally {
      if (mounted.current && token === sequence.current) setChecking(false);
    }
  }
  async function send(previous?: DailyInput) {
    if (inFlight.current) return;
    setError(null);
    if (
      !previous &&
      (pending || !readiness?.ready || historyDirty || runActive)
    ) {
      setError(
        pending
          ? "上一次提交状态未确认，请先按原请求重试。"
          : historyDirty
            ? "请先保存或放弃前茬修改。"
            : runActive
              ? "当前计算仍在进行，请等待或取消。"
              : "请先检查当前资料，满足计算条件后再提交。",
      );
      return;
    }
    let request: DailyInput;
    try {
      request =
        previous ??
        prepareDailyRequest(draft, profile, fields, farms, crypto.randomUUID());
      savePendingDaily(owner, request);
    } catch (cause) {
      setError(errorMessage(cause));
      const existing = readPendingDaily(owner);
      if (existing) setPending(existing);
      else setStorageError(true);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setPending(request);
    try {
      const value = await api.createDailyRun(owner, request);
      // Clear only this owner's durable pending request. A new account never receives this callback.
      try {
        clearPendingDaily(owner, request.idempotency_key);
      } catch {
        /* Exact replay remains safe if storage is unavailable. */
      }
      if (mounted.current && latest.current.owner === owner) {
        setPending(null);
        onRun(value);
      }
    } catch (cause) {
      // These responses explicitly reject the input before enqueueing. Network/5xx/auth/account
      // uncertainty retains the original bytes and key, even after a profile release changes.
      if (cause instanceof ApiError && [400, 422].includes(cause.status)) {
        try {
          clearPendingDaily(owner, request.idempotency_key);
        } catch {
          /* Recovery may replay a rejected request. */
        }
        if (mounted.current && latest.current.owner === owner) {
          setPending(null);
          setChecked(null);
        }
      }
      if (mounted.current && latest.current.owner === owner)
        setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current && latest.current.owner === owner)
        setSubmitting(false);
    }
  }
  return {
    draft,
    replaceDraft,
    pending,
    readiness,
    checking,
    submitting,
    error,
    storageError,
    runActive,
    check,
    submit: () => send(),
    retryPending: () => (pending ? send(pending) : Promise.resolve()),
  };
}
