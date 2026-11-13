import { Suspense } from "react";
import { RotationWorkspace } from "@/components/rotation/workspace";
export const metadata = { title: "Field Shift · 多地块轮作规划" };
export default function RotationPage() {
  return (
    <Suspense fallback={<main role="status">正在打开轮作规划…</main>}>
      <RotationWorkspace mode="rotation" />
    </Suspense>
  );
}
