"use client";
import { useI18n } from "@/lib/i18n/provider";
export function LocaleLoading({message}: {message: string}) { const {t} = useI18n(); return <main className="flex min-h-dvh items-center justify-center" role="status">{t(message)}</main>; }
