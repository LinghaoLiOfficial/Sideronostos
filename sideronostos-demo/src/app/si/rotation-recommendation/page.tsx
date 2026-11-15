import { MultiBotDock } from "@/components/bot/MultiBotDock";
import { RotationRecommendationWorkspace } from "@/features/rotation/rotation-recommendation-workspace";
import { Suspense } from "react";

export const metadata = { title: "Crop Rotation Strategy Recommendation · Agrisata" };

export default function RotationRecommendationPage() {
  return (
    <>
      <Suspense fallback={<main role="status">正在打开轮作策略推荐…</main>}>
        <RotationRecommendationWorkspace />
      </Suspense>
      <MultiBotDock module="rotation-recommendation" />
    </>
  );
}
