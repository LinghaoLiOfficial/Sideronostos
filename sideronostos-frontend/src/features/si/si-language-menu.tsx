"use client";

import { ChevronDown, Globe2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale, type Locale } from "@/lib/i18n/locale";

export function SiLanguageMenu({ locale, align = "center" }: { locale: Locale; align?: "center" | "end" }) {
  const isEnglish = locale === "en";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="si-header-control"
        aria-label={isEnglish ? "Language: English" : "语言：简体中文"}
      >
        <Globe2 size={16} aria-hidden="true" />
        {isEnglish ? "English" : "简体中文"}
        <ChevronDown size={15} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="si-header-menu" align={align} sideOffset={16}>
        <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
          <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh-CN" lang="zh-CN">简体中文</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
