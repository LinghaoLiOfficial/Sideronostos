import { LocaleLoading } from "@/components/locale-loading";
import { Suspense } from "react";
import { FieldShiftWorkspace } from "@/components/field-shift/workspace";

export const metadata = { title: "Field details · Agrisata" };

export default function FieldShiftPage() {
  return <Suspense fallback={<LocaleLoading message="正在打开 Field Shift…" />}><FieldShiftWorkspace /></Suspense>;
}
