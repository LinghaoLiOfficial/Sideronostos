import { MultiBotDock } from "@/components/bot/MultiBotDock";
import { LocalKnowledgeWorkspace } from "@/features/rotation/local-knowledge-workspace";

export const metadata = { title: "Local Agronomy Knowledge · Agrisata" };

export default function LocalKnowledgePage() {
  return <><LocalKnowledgeWorkspace /><MultiBotDock module="local-knowledge" /></>;
}
