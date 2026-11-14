"use client";
import { useI18n } from "@/lib/i18n/provider";
import { isLocale } from "@/lib/i18n/translate";
/** One explicit language control shared by the farmer journey, without navigating or resetting drafts. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return <label className={`inline-flex shrink-0 items-center ${className}`}>
    <span className="sr-only">Language / 语言</span>
    <select aria-label="Language / 语言" value={locale} onChange={e => { if (isLocale(e.target.value)) setLocale(e.target.value); }} className="min-h-10 max-w-28 rounded-md border border-current/20 bg-transparent px-2 text-xs text-inherit focus-visible:outline-2 focus-visible:outline-offset-2">
      <option value="en">English</option><option value="zh">中文</option>
    </select>
  </label>;
}
