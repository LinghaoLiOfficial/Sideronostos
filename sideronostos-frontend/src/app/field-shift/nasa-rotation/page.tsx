import { Suspense } from "react";
import { NasaRotationWorkspace } from "@/components/rotation/nasa-rotation-workspace";

export const metadata = { title: "Field Shift · NASA 轮作回测" };

export default function NasaRotationPage() {
  return (
    <Suspense fallback={<main role="status">正在打开 NASA 轮作回测…</main>}>
      <NasaRotationWorkspace />
    </Suspense>
  );
}
