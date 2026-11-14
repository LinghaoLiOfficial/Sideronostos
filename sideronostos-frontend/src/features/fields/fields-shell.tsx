"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import type { AuthUser } from "@/lib/api/client"
import { MessageCircle, Satellite } from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"

export function FieldsShell({ children, user, fieldId, plannerHref }: { children: ReactNode; user?: AuthUser | null; fieldId?: string; plannerHref?: string }) {
  return (
    <div className="fields-app flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/refer-1" aria-label="Agrisata home" className="flex shrink-0 items-center">
            <BrandLogo priority className="w-28 sm:w-40" />
          </Link>
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-medium">Field intelligence</p>
            <p className="hidden truncate text-[11px] text-muted-foreground sm:block">World map and farm partition workspace</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <nav aria-label="农场工作区导航" className="flex min-w-0 items-center gap-3 text-foreground"><Link href={fieldId ? `/field-shift?field=${encodeURIComponent(fieldId)}` : "/field-shift"} className="hidden sm:inline">地块资料</Link><Link href={plannerHref ?? (fieldId ? `/field-shift/rotation?field=${encodeURIComponent(fieldId)}` : "/field-shift/rotation")}>轮作规划</Link><Link className="max-w-24 truncate" href={user ? "/personal/account" : `/login?next=${encodeURIComponent(typeof window === "undefined" ? "/fields" : window.location.pathname + window.location.search)}`}>{user?.display_name ?? "登录"}</Link></nav>
          <Link href="/si/multi-agent" className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><MessageCircle className="size-4 text-primary" aria-hidden="true" /><span className="hidden sm:inline">Farmer assistants</span><span className="sr-only sm:hidden">Farmer assistants</span></Link>
          <Satellite className="hidden size-4 text-primary md:block" aria-hidden="true" />
          <span className="hidden 2xl:inline">NASA Earth observations</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
