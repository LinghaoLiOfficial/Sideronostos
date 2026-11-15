import { SiBlankPage } from "@/features/si";
import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Field Management · Agrisata" };

export default function FieldManagementPage() {
  return <><SiBlankPage /><MultiBotDock module="field-management" /></>;
}
