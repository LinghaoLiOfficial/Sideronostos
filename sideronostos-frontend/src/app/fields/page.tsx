"use client"

import { Suspense } from "react"
import dynamic from "next/dynamic"

const FieldsWorkspace = dynamic(
  () => import("@/features/fields/fields-workspace").then((module) => module.FieldsWorkspace),
  {
    ssr: false,
    loading: () => (
      <main className="flex h-dvh items-center justify-center bg-background">
        <div className="size-7 animate-spin rounded-full border-2 border-muted border-t-primary" aria-label="Loading field workspace" />
      </main>
    ),
  },
)

export default function FieldsPage() {
  return <Suspense fallback={<p role="status">正在读取工作区…</p>}><FieldsWorkspace /></Suspense>
}
