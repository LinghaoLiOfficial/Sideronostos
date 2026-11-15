"use client";

import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Locale } from "@/lib/i18n/locale";
import { rotationOverviewHref, SiStoryLink } from "./si-story-link";

const modules = [
  { href: "/si/multi-agent", en: "Multi-Agent System", zh: "多智能体" },
  { href: "/si/field-management", en: "Field Management", zh: "田地管理" },
  { href: "/si/remote-sensing", en: "Remote Sensing Analysis", zh: "遥感分析" },
  { href: "/si/local-knowledge", en: "Local Agricultural Knowledge Base", zh: "本地农业知识库" },
  { href: "/si/rotation-recommendation", en: "Crop Rotation Strategy Recommendation", zh: "轮作策略推荐" },
  { href: rotationOverviewHref, en: "Explore the rotation model", zh: "了解轮作模型" },
];

export function SiModuleMenu({ locale, inWorkspace = false, onSelect }: {
  locale: Locale;
  inWorkspace?: boolean;
  onSelect?: () => void;
}) {
  const pathname = usePathname();
  const en = locale === "en";

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger className={inWorkspace ? "landing-nav-trigger" : "si-header-control"}>
        {en ? "Module" : "模块"}<ChevronDown size={15} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className={inWorkspace ? "si-header-menu landing-nav-popover" : "si-header-menu"} align="center" sideOffset={12}>
        {modules.map(({ href, en: english, zh }) => (
          <DropdownMenuItem key={href} asChild onSelect={onSelect}>
            <SiStoryLink href={href} aria-current={pathname === href ? "page" : undefined}>
              {en ? english : zh}
            </SiStoryLink>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return inWorkspace ? <div className="landing-nav-dropdown">{menu}</div> : menu;
}
