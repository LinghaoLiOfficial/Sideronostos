import { MultiBotDock } from "@/components/bot/MultiBotDock";
import { LocalKnowledgeWorkspace } from "@/features/rotation/local-knowledge-workspace";

export const metadata = { title: "Local Agronomy Knowledge · Agrisata" };

export default function LocalKnowledgePage() {
  return (
    <><main className="si-agronomy-main">
      <LocalKnowledgeWorkspace />
    </main><MultiBotDock module="local-knowledge" /></>
  );
}
