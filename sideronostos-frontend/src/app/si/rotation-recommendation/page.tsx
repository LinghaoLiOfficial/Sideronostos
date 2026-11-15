import { MultiBotDock } from "@/components/bot/MultiBotDock";
import { NasaRotationWorkspace } from "@/components/rotation/nasa-rotation-workspace";
import { Suspense } from "react";

export const metadata = { title: "Crop Rotation Strategy Recommendation · Agrisata" };

export default function RotationRecommendationPage() {
  return (
    <>
      <Suspense fallback={<main role="status">正在打开轮作策略推荐…</main>}>
        <NasaRotationWorkspace hideHeader hideMap hideReleaseBar compactReleaseBar />
      </Suspense>
      <MultiBotDock module="rotation-recommendation" />
    </>
  );
}
