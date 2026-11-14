"use client"

import { useI18n } from "@/lib/i18n/provider";
import { LanguageSwitch } from "@/components/language-switch";
import Link from "next/link"
import type { ReactNode } from "react"
import type { AuthUser } from "@/lib/api/client"

import { BrandLogo } from "@/components/brand-logo"

export function FieldsShell({ children, user, fieldId, plannerHref }: { children: ReactNode; user?: AuthUser | null; fieldId?: string; plannerHref?: string }) {
  const { t } = useI18n();

  return (
    <div className="fields-app flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-b border-border bg-sidebar px-3 py-2 sm:flex sm:min-h-16 sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/fields" aria-label={t("Agrisata home")} className="flex shrink-0 items-center"><BrandLogo priority className="w-24 sm:w-36" /></Link>
          <div className="hidden min-w-0 lg:block"><p className="text-sm font-medium">{t("Field intelligence")}</p><p className="text-[11px] text-muted-foreground">{t("World map and farm partition workspace")}</p></div>
        </div>
        <nav aria-label={t("农场工作区导航")} className="order-3 col-span-2 flex min-w-0 items-center justify-between gap-3 text-xs sm:order-none sm:ml-auto">
          <Link className="inline-flex min-h-10 items-center" href={fieldId ? `/field-shift?field=${encodeURIComponent(fieldId)}` : "/field-shift"}>{t("地块资料")}</Link>
          <Link className="inline-flex min-h-10 items-center" href={plannerHref ?? (fieldId ? `/field-shift/rotation?field=${encodeURIComponent(fieldId)}` : "/field-shift/rotation")}>{t("轮作规划")}</Link>
          <Link className="inline-flex min-h-10 max-w-28 items-center truncate" href={user ? "/personal/account" : `/login?next=${encodeURIComponent(typeof window === "undefined" ? "/fields" : window.location.pathname + window.location.search)}`}>{user?.display_name ?? t("登录")}</Link>
        </nav>
        <LanguageSwitch className="col-start-2 row-start-1" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
