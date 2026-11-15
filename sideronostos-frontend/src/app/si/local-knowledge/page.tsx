import { SiBlankPage } from "@/features/si";
import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Local Agricultural Knowledge Base · Agrisata" };

export default function LocalKnowledgePage() {
  return <><SiBlankPage /><MultiBotDock module="local-knowledge" /></>;
}
