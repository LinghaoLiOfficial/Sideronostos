import { LocaleLoading } from "@/components/locale-loading";
import { Suspense } from "react";
import { RotationWorkspace } from "@/components/rotation/workspace";
export const metadata = { title: "Rotation planning · Agrisata" };
export default function RotationPage() {
  return (
    <Suspense fallback={<LocaleLoading message="正在打开轮作规划…" />}>
      <RotationWorkspace mode="rotation" />
    </Suspense>
  );
}
