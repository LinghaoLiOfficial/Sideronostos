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
  expect(screen.getByText(/GPM_3IMERGDF/)).toBeInTheDocument();
  const selections = JSON.parse(localStorage.getItem("agrisata-demo-observation-selections") ?? "{}");
  expect(Object.values(selections)[0]).toMatchObject({ kind: "point", center: [field.longitude, field.latitude] });
});

it("shows the saved field's SMAP sample in the soil action", async () => {
  render(<Observations botId="remote-soil" language="en" userId="owner" conversationId="chat" ensureConversation={async () => "chat"} onAsk={vi.fn()} scope="soil-test" />);
  await userEvent.selectOptions(await screen.findByLabelText("Which field?"), field.id);
  await userEvent.click(screen.getByRole("button", { name: "Check observations" }));
  expect(await screen.findByText("0.25 m³/m³")).toBeInTheDocument();
  expect(screen.getByText(/SMAP SPL4SMGP/)).toBeInTheDocument();
  expect(screen.getByText(/regional SMAP context/i)).toBeInTheDocument();
});

it("offers only years covered by the demo release for rainfall", async () => {
  render(<Observations botId="remote-weather" language="en" userId="owner" conversationId="chat" ensureConversation={async () => "chat"} onAsk={vi.fn()} scope="weather-test" />);
  await userEvent.selectOptions(await screen.findByLabelText("Which field?"), field.id);
  const years = screen.getByRole("combobox", { name: "Available year" });
  expect(Array.from(years.querySelectorAll("option")).map((option) => option.value)).toEqual(["2024", "2023", "2022"]);
  expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
  await userEvent.selectOptions(years, "2023");
  await userEvent.click(screen.getByRole("button", { name: "Check observations" }));
  expect(await screen.findByText("873.234981 mm")).toBeInTheDocument();
});
