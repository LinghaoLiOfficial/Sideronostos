import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Crop Rotation Strategy Recommendation · Agrisata" };

export default function RotationRecommendationPage() {
  return <><main aria-label="Crop rotation strategy recommendation" /><MultiBotDock module="rotation-recommendation" /></>;
}
