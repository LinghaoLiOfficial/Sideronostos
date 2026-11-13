import { Suspense } from "react";
import { RotationWorkspace } from "@/components/rotation/workspace";
export const metadata = { title: "Field Shift · 地图与轮作助手" };
export default function MapPage() {
  return (
    <Suspense fallback={<main role="status">正在打开地图…</main>}>
      <RotationWorkspace mode="map" />
    </Suspense>
  );
}
