"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getCurrentUser, type AuthUser } from "@/lib/api/client";
import { isDemoMode } from "@/lib/demo-mode";
import { useLocale, type Locale } from "@/lib/i18n/locale";
import { SiLanguageMenu } from "./si-language-menu";
import { SiModuleMenu } from "./si-module-menu";
import { rotationLayersHref, rotationOverviewHref, SiStoryLink } from "./si-story-link";

export function SiPrimaryNavigation({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const isEnglish = locale === "en";
  return (
    <nav className="si-header-nav" aria-label={isEnglish ? "Primary navigation" : "主导航"}>
      <SiStoryLink className="si-header-control" href="/si" aria-current={pathname === "/si" ? "page" : undefined}>{isEnglish ? "Home" : "首页"}</SiStoryLink>
      <SiModuleMenu locale={locale} />
      <SiLanguageMenu locale={locale} showLabel={pathname === "/si"} />
    </nav>
  );
}

function isLayersRoute(pathname: string) {
  return pathname === rotationLayersHref || pathname.startsWith(rotationLayersHref + "/");
}

export function SiHeader() {
  const pathname = usePathname();
  const locale = useLocale();
  const isEnglish = locale === "en";
  const isHome = pathname === "/si";
  const showProfile = !isHome || !isDemoMode();
  const showLayers = isLayersRoute(pathname);
  const backHref = showLayers ? rotationOverviewHref : pathname === rotationOverviewHref ? "/si" : undefined;
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!showProfile) return;
    let active = true;
    getCurrentUser().then((value) => { if (active) setUser(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [showProfile]);

  return (
    <header className={`site-topbar si-header${isHome ? " si-header-home" : ""}`}>
      <div className="si-header-row">
        <div className="si-header-brand">
          {backHref && (
            <SiStoryLink
              className="si-header-control si-header-back"
              href={backHref}
              aria-label={showLayers ? (isEnglish ? "Back to overview" : "返回总览") : (isEnglish ? "Back to home" : "返回首页")}
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </SiStoryLink>
          )}
          <SiStoryLink href="/si" aria-label={isEnglish ? "Agrisata home" : "Agrisata 首页"}>
            <BrandLogo priority={isHome} className="w-52" />
          </SiStoryLink>
        </div>
        <SiPrimaryNavigation locale={locale} />
        <div className="si-header-end">
          {showProfile && user && (
            <Link
              href="/personal/notifications"
              aria-label={isEnglish ? `Profile: ${user.display_name}` : `个人中心：${user.display_name}`}
              className="si-header-control si-header-profile"
            >
              <Avatar className="size-7">
                <AvatarFallback>{user.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="si-header-user-name">{user.display_name}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
