import { Suspense } from "react";
import { NasaRotationWorkspace } from "@/components/rotation/nasa-rotation-workspace";
import { LocaleLoading } from "@/components/locale-loading";

export const metadata = { title: "NASA Rotation Backtest · Agrisata" };

export default function NasaRotationPage() {
  return (
    <Suspense fallback={<LocaleLoading message="正在打开 NASA 轮作回测…" />}>
      <NasaRotationWorkspace />
    </Suspense>
  );
}
