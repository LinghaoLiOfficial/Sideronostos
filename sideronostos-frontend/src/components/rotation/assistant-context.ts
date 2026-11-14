import type { AssistantContext, ChangedCondition } from "@/lib/api/rotation-types"

export function buildAssistantContext(input: {
  page: AssistantContext["page"]; revision: number; fields: NonNullable<AssistantContext["fields"]>
  selection?: AssistantContext["selection"]; dates?: AssistantContext["dates"]
  runId?: string | null; optionId?: string | null; compareRunId?: string | null; compareOptionId?: string | null
  saved?: boolean; changes?: ChangedCondition[]
}): AssistantContext {
  const comparison = Boolean(input.runId && input.optionId && input.compareRunId && input.compareOptionId && !input.saved)
  const changes = input.saved ? [] : [...new Set(input.changes ?? [])]
  return { revision: input.revision, page: input.page, fields: input.runId ? [] : input.fields,
    selection: input.selection ?? null, dates: input.dates, run_id: input.runId ?? null,
    option_id: input.runId ? input.optionId ?? null : null,
    compare_run_id: comparison ? input.compareRunId : null, compare_option_id: comparison ? input.compareOptionId : null,
    draft: { dirty: changes.length > 0, changed_fields: changes } }
}
