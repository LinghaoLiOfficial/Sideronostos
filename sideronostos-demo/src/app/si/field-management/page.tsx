import { EmbeddedFieldsWorkspace } from "@/features/fields/embedded-fields-workspace";
import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Field Management · Agrisata" };

export default function FieldManagementPage() {
  return <><EmbeddedFieldsWorkspace /><MultiBotDock module="field-management" /></>;
}
