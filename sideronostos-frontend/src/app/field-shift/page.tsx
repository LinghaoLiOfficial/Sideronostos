import { Suspense } from "react";
import { FieldShiftWorkspace } from "@/components/field-shift/workspace";

export const metadata = { title: "Field Shift · Agrisata 轮作规划" };

export default function FieldShiftPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center" role="status">正在打开 Field Shift…</main>}><FieldShiftWorkspace /></Suspense>;
}
