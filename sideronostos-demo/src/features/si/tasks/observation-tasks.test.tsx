import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { demoFieldsApi } from "@/lib/demo/data";
import { Observations } from "./observation-tasks";

const field = demoFieldsApi()[0];
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); });

it("completes the demo water observation from a saved polygon field", async () => {
  render(<Observations botId="remote-water" language="en" userId="owner" conversationId="chat" ensureConversation={async () => "chat"} onAsk={vi.fn()} scope="observation-test" />);
  await userEvent.selectOptions(await screen.findByLabelText("Which field?"), field.id);
  expect(screen.getByLabelText("What would you like to check?")).toHaveValue("rainfall_total");
  await userEvent.click(screen.getByRole("button", { name: "Check observations" }));
  expect(await screen.findByText("1049.312467 mm")).toBeInTheDocument();
  expect(screen.getByText(/not field boundary averages/i)).toBeInTheDocument();
  const selections = JSON.parse(localStorage.getItem("agrisata-demo-observation-selections") ?? "{}");
  expect(Object.values(selections)[0]).toMatchObject({ kind: "point", center: [field.longitude, field.latitude] });
});

it("explains unavailable soil moisture without losing the selected field", async () => {
  render(<Observations botId="remote-soil" language="en" userId="owner" conversationId="chat" ensureConversation={async () => "chat"} onAsk={vi.fn()} scope="soil-test" />);
  await userEvent.selectOptions(await screen.findByLabelText("Which field?"), field.id);
  await userEvent.click(screen.getByRole("button", { name: "Check observations" }));
  expect(await screen.findByText(/No published soil moisture reading is available/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Which field?")).toHaveValue(field.id);
});
