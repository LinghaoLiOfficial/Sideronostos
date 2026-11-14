"use client";
import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api/daily";

/** A saved plan selects its own immutable run, including links with only a plan ID. */
export function useRotationSnapshots(
  ownerId: string | null,
  requestedRunId: string | null,
  planId: string | null,
) {
  const saved = useQuery({
    queryKey: ["rotation", ownerId, "plan", planId],
    queryFn: () => api.getAnyPlan(ownerId!, planId!),
    enabled: Boolean(ownerId && planId),
    retry: false,
  });
  const runId = planId ? (saved.data?.run_id ?? null) : requestedRunId;
  const run = useQuery({
    queryKey: ["rotation", ownerId, "run", runId],
    queryFn: () => api.getAnyRun(ownerId!, runId!),
    enabled: Boolean(ownerId && runId),
    retry: false,
    refetchInterval: (q) =>
      ["pending", "running"].includes(q.state.data?.status ?? "")
        ? 1800
        : false,
  });
  return { run, saved, runId };
}
