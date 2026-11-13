"use client"
import { useQuery } from "@tanstack/react-query"
import { getCurrentUser } from "@/lib/api/client"

/** Recheck identity before mounting owner-bound map, form and assistant state. */
export function useWorkspaceSession() {
  const session = useQuery({ queryKey: ["field-shift", "session"], queryFn: getCurrentUser,
    retry: false, staleTime: 0, gcTime: 0, refetchOnMount: "always" })
  return { session, ready: session.isFetchedAfterMount && !session.isFetching }
}
