import { MultiBotDock } from "@/components/bot/MultiBotDock";
import { RotationRecommendationLoading, RotationRecommendationWorkspace } from "@/features/rotation/rotation-recommendation-workspace";
import { Suspense } from "react";

export const metadata = { title: "Crop Rotation Strategy Recommendation · Agrisata" };

export default function RotationRecommendationPage() {
  return (
    <>
      <Suspense fallback={<RotationRecommendationLoading />}>
        <RotationRecommendationWorkspace />
      </Suspense>
      <MultiBotDock module="rotation-recommendation" />
    </>
  );
}
