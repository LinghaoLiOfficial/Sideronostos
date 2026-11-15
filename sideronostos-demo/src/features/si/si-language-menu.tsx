"use client";

import { ChevronDown, Globe2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Locale } from "@/lib/i18n/locale";
import { useI18n } from "@/lib/i18n/provider";

export function SiLanguageMenu({ locale, align = "center", showLabel = false }: {
  locale: Locale;
  align?: "center" | "end";
  showLabel?: boolean;
}) {
  const isEnglish = locale === "en";
  const { setLocale } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="si-header-control"
        aria-label={isEnglish ? "Language: English" : "语言：简体中文"}
      >
        <Globe2 size={16} aria-hidden="true" />
        {showLabel && (
          <>
            {isEnglish ? "English" : "简体中文"}
            <ChevronDown size={15} aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="si-header-menu" align={align} sideOffset={16}>
        <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value === "zh-CN" ? "zh" : "en")}>
          <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh-CN">{isEnglish ? "Simplified Chinese" : "简体中文"}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
