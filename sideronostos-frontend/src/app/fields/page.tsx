"use client"
import { LocaleLoading } from "@/components/locale-loading";

import { Suspense } from "react"
import dynamic from "next/dynamic"

const FieldsWorkspace = dynamic(
  () => import("@/features/fields/fields-workspace").then((module) => module.FieldsWorkspace),
  {
    ssr: false,
    loading: () => <LocaleLoading message="正在读取工作区…" />,
  },
)

export default function FieldsPage() {
  return <Suspense fallback={<LocaleLoading message="正在读取工作区…" />}><FieldsWorkspace /></Suspense>
}
