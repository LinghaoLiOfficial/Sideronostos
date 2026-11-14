import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { EvidenceSource, RecordedValue } from "@/lib/api/daily-types";
import { EvidenceValue, SourcesEditor } from "./daily-evidence";
const source: EvidenceSource = {
  id: "lab",
  kind: "observation",
  title: "Soil lab",
  locator: "Report 1",
  region_id: "iowa-engineering",
  quality: "confirmed",
  confirmed: true,
  limitations: ["One sampling point"],
};
describe("sourced farmer inputs", () => {
  it("keeps unknown numeric inputs blank and associates a deliberate zero with the selected source", () => {
    const changes = vi.fn();
    function Form() {
      const [value, setValue] = useState<RecordedValue>();
      return (
        <EvidenceValue
          label="供水上限"
          unit="m3/day"
          value={value}
          sources={{ lab: source }}
          defaultSource="lab"
          onChange={(v) => {
            setValue(v);
            changes(v);
          }}
        />
      );
    }
    render(<Form />);
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "0" },
    });
    expect(changes).toHaveBeenLastCalledWith({
      value: 0,
      unit: "m3/day",
      source_ids: ["lab"],
    });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(changes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        value: null,
        missing_reason: expect.any(String),
      }),
    );
  });
  it("requires renewed confirmation when a source identity is edited", () => {
    const changed = vi.fn();
    render(
      <SourcesEditor
        sources={{ lab: source }}
        region="iowa-engineering"
        start="2027-01-01"
        end="2027-12-31"
        defaultSource="lab"
        onDefaultSource={() => {}}
        onChange={changed}
      />,
    );
    fireEvent.change(screen.getByLabelText("资料名称"), {
      target: { value: "Different lab report" },
    });
    expect(changed).toHaveBeenCalledWith({
      lab: expect.objectContaining({
        title: "Different lab report",
        confirmed: false,
      }),
    });
  });
});

afterEach(cleanup);
