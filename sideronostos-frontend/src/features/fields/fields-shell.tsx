"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { MessageCircle, Satellite } from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"

export function FieldsShell({ children }: { children: ReactNode }) {
  return (
    <div className="fields-app flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/refer-1" aria-label="Agrisata home" className="flex shrink-0 items-center">
            <BrandLogo priority className="w-36 sm:w-40" />
          </Link>
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Field intelligence</p>
            <p className="hidden truncate text-[11px] text-muted-foreground sm:block">World map and farm partition workspace</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <Link href="/si/multi-agent" className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><MessageCircle className="size-4 text-primary" aria-hidden="true" /><span className="hidden sm:inline">Farmer assistants</span><span className="sr-only sm:hidden">Farmer assistants</span></Link>
          <Satellite className="hidden size-4 text-primary md:block" aria-hidden="true" />
          <span className="hidden md:inline">NASA Earth observations</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
