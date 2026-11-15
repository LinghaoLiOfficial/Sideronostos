import { Suspense } from "react";
import { FieldShiftWorkspace } from "@/components/field-shift/workspace";
import { LocaleLoading } from "@/components/locale-loading";

export const metadata = { title: "Fields · Agrisata" };

export default function PublishedFieldsPage() {
  return <Suspense fallback={<LocaleLoading message="正在打开地块…" />}><FieldShiftWorkspace basePath="/si/fields" /></Suspense>;
}
