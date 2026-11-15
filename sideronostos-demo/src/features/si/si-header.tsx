"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getCurrentUser, type AuthUser } from "@/lib/api/client";
import { useLocale, type Locale } from "@/lib/i18n/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SiLanguageMenu } from "./si-language-menu";
import { rotationLayersHref, rotationOverviewHref, SiStoryLink } from "./si-story-link";

function NavMenu({ isEnglish, items, modelPage }: {
  isEnglish: boolean;
  items: { label: string; href: string }[];
  modelPage: string | undefined;
}) {
  const [modelExpanded, setModelExpanded] = useState(false);
  const modelOptionsId = useId();

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setModelExpanded(false); }}>
      <DropdownMenuTrigger className="si-header-control">
        {isEnglish ? "Module" : "模块"}<ChevronDown size={15} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="si-header-menu" align="center" sideOffset={16}>
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <SiStoryLink href={item.href}>{item.label}</SiStoryLink>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          className="si-header-model-trigger"
          aria-expanded={modelExpanded}
          aria-controls={modelExpanded ? modelOptionsId : undefined}
          onSelect={(event) => {
            event.preventDefault();
            setModelExpanded((expanded) => !expanded);
          }}
        >
          {isEnglish ? "Explore the rotation model" : "了解轮作模型"}
          <ChevronDown aria-hidden="true" />
        </DropdownMenuItem>
        {modelExpanded && (
          <DropdownMenuGroup id={modelOptionsId} className="si-header-model-options">
            <DropdownMenuItem asChild>
              <SiStoryLink href={rotationOverviewHref} aria-current={modelPage === rotationOverviewHref ? "page" : undefined}>
                {isEnglish ? "Overview" : "总览"}
              </SiStoryLink>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <SiStoryLink href={rotationLayersHref} aria-current={modelPage === rotationLayersHref ? "page" : undefined}>
                {isEnglish ? "Model layers" : "分层讲解"}
              </SiStoryLink>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiPrimaryNavigation({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const isEnglish = locale === "en";
  const modelPage = isLayersRoute(pathname) ? rotationLayersHref : pathname === rotationOverviewHref ? rotationOverviewHref : undefined;
  return (
    <nav className="si-header-nav" aria-label={isEnglish ? "Primary navigation" : "主导航"}>
      <SiStoryLink className="si-header-control" href="/si" aria-current={pathname === "/si" ? "page" : undefined}>{isEnglish ? "Home" : "首页"}</SiStoryLink>
      <NavMenu
        isEnglish={isEnglish}
        modelPage={modelPage}
        items={isEnglish
          ? [
            { label: "Multi-Agent System", href: "/si/multi-agent" },
            { label: "Field Management", href: "/si/field-management" },
            { label: "Remote Sensing Analysis", href: "/si/remote-sensing" },
            { label: "Local Agricultural Knowledge Base", href: "/si/local-knowledge" },
          ]
          : [
            { label: "多智能体", href: "/si/multi-agent" },
            { label: "田地管理", href: "/si/field-management" },
            { label: "遥感分析", href: "/si/remote-sensing" },
            { label: "本地农业知识库", href: "/si/local-knowledge" },
          ]}
      />
      <SiLanguageMenu locale={locale} />
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
  const showLayers = isLayersRoute(pathname);
  const backHref = showLayers ? rotationOverviewHref : pathname === rotationOverviewHref ? "/si" : undefined;
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let active = true;
    getCurrentUser().then((value) => { if (active) setUser(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <header className="si-header">
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
          {user && (
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
