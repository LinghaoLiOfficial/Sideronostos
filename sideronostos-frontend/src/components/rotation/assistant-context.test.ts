import { describe, expect, it } from "vitest"
import { buildAssistantContext } from "./assistant-context"

describe("shared farmer context", () => {
  it("binds historical results to snapshots instead of today's edited field", () => {
    const value = buildAssistantContext({ page: "map", revision: 2, fields: [{ id: "field", expected_version: 7 }],
      runId: "historical", optionId: "option-1", changes: ["fields"] })
    expect(value.fields).toEqual([])
    expect(value.run_id).toBe("historical")
    expect(value.draft).toEqual({ dirty: true, changed_fields: ["fields"] })
  })
  it("marks an uncalculated field edit without requiring an existing run", () => {
    expect(buildAssistantContext({ page: "map", revision: 3, fields: [{ id: "field", expected_version: 1 }], changes: ["fields"] }).draft?.dirty).toBe(true)
  })
  it("only binds comparisons with two explicit options and does not label a saved snapshot dirty", () => {
    const saved = buildAssistantContext({ page: "rotation", revision: 4, fields: [], runId: "run", optionId: "option", saved: true, compareRunId: "other", compareOptionId: "option", changes: ["dates"] })
    expect(saved.draft?.dirty).toBe(false); expect(saved.compare_run_id).toBeNull()
    const missing = buildAssistantContext({ page: "map", revision: 1, fields: [], runId: "run", compareRunId: "other", compareOptionId: "option" })
    expect(missing.compare_run_id).toBeNull()
  })
})
