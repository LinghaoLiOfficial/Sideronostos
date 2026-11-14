import { SiBlankPage } from "@/features/si";
import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Crop Rotation Strategy Recommendation · Agrisata" };

export default function RotationRecommendationPage() {
  return <><SiBlankPage /><MultiBotDock module="rotation-recommendation" /></>;
}
