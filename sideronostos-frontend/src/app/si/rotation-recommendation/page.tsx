import { SiModelGuide } from "@/features/si/si-model-guide";
import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Crop Rotation Strategy Recommendation · Agrisata" };

export default function RotationRecommendationPage() {
  return <><SiModelGuide /><MultiBotDock module="rotation-recommendation" /></>;
}
