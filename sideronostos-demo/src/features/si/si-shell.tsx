"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Check, Globe2, Menu, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCurrentUser, type AuthUser } from "@/lib/api/client";
import { useLocale } from "@/lib/i18n/locale";
import { useI18n } from "@/lib/i18n/provider";

import { SiModuleMenu } from "./si-module-menu";

export function SiShell({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const { setLocale } = useI18n();
  const pathname = usePathname();
  const isViewportWorkspace = pathname === "/si/multi-agent" || pathname === "/si/remote-sensing";
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const moduleCopy: Record<string, { en: [string, string]; zh: [string, string] }> = {
    "/nasa-analysis": {
      en: ["NASA analysis", "Historical NASA observations for the Iowa benchmark area"],
      zh: ["NASA 分析", "Iowa 基准区域的 NASA 历史观测数据"],
    },
    "/si/field-management": {
      en: ["Field management", "Manage fields, boundaries, and farm data"],
      zh: ["田地管理", "管理田地边界与农场数据"],
    },
    "/si/remote-sensing": {
      en: ["Remote sensing analysis", "Satellite imagery and crop monitoring"],
      zh: ["遥感分析", "卫星影像与作物监测"],
    },
  };
  const activeModule = moduleCopy[pathname];
  const activeCopy = activeModule?.[locale === "en" ? "en" : "zh"];

  useEffect(() => {
    let active = true;
    getCurrentUser().then((value) => { if (active) setUser(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <div className={`landing-page si-landing-page site-farm-backdrop locale-${locale === "en" ? "en" : "zh"}${isViewportWorkspace ? " si-multi-agent-shell" : ""}`}>
      <header className="landing-header site-topbar">
        <div className="landing-nav-shell">
          <div className="si-brand-context">
            <a className="landing-wordmark" href="/si" aria-label="Agrisata home">
              <BrandLogo priority className="w-52" />
            </a>
            {activeCopy && (
              <div className="si-product-context">
                <span className="si-product-divider" aria-hidden="true" />
                <div className="si-product-copy">
                  <p>{activeCopy[0]}</p>
                  <small>{activeCopy[1]}</small>
                </div>
              </div>
            )}
          </div>
          <nav className={`landing-nav ${menuOpen ? "is-open" : ""}`} aria-label="Primary navigation">
            <a href="/si" onClick={() => setMenuOpen(false)}>{locale === "en" ? "Home" : "首页"}</a>
            <SiModuleMenu locale={locale} inWorkspace onSelect={() => setMenuOpen(false)} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="si-language-picker"
                  aria-label={locale === "en" ? "Language: English" : "语言：简体中文"}
                >
                  <Globe2 aria-hidden="true" size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="si-language-popover">
                <DropdownMenuItem onSelect={() => setLocale("en")}>
                  <span>English</span>
                  {locale === "en" ? <Check aria-hidden="true" size={15} /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLocale("zh")}>
                  <span>{locale === "en" ? "Simplified Chinese" : "简体中文"}</span>
                  {locale === "zh-CN" ? <Check aria-hidden="true" size={15} /> : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="landing-nav-spacer" />
          </nav>
          <div className="si-header-actions">
            {user && (
              <a
                href="/personal/notifications"
                aria-label={locale === "en" ? `Profile: ${user.display_name}` : `个人中心：${user.display_name}`}
                className="flex shrink-0 items-center justify-center gap-3 rounded-md px-3 py-2 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Avatar className="size-8">
                  <AvatarFallback>{user.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm sm:block">{user.display_name}</span>
              </a>
            )}
          </div>
          <Button
            className="landing-menu-button"
            variant="ghost"
            size="icon-lg"
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </Button>
        </div>
      </header>
      {isViewportWorkspace ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
    </div>
  );
}
