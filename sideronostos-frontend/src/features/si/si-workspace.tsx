"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Globe2, LoaderCircle, Menu, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getCurrentUser, type AuthUser } from "@/lib/api/client";
import { setLocale, useLocale } from "@/lib/i18n/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function NavMenu({ label, items }: { label: string; items: { label: string; href: string }[] }) {
  return (
    <DropdownMenu>
      <div className="landing-nav-dropdown">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="landing-nav-trigger">
            {label}<ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="landing-nav-popover">
          {items.map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <a href={item.href}>{item.label}</a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
  );
}

export function SiWorkspace() {
  const router = useRouter();
  const locale = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openingFields, setOpeningFields] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let active = true;
    getCurrentUser().then((value) => { if (active) setUser(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function openFields() {
    if (openingFields) return;
    setOpeningFields(true);
    try {
      await getCurrentUser();
      router.push("/si/multi-agent");
    } catch {
      router.push("/login?next=%2Fsi%2Fmulti-agent&authRequired=1");
    } finally {
      setOpeningFields(false);
    }
  }

  return (
    <main className={`landing-page si-landing-page locale-${locale === "en" ? "en" : "zh"}`}>
      <header className="landing-header">
        <div className="landing-nav-shell">
          <a className="landing-wordmark" href="#top" aria-label="Agrisata home">
            <BrandLogo priority className="w-52" />
          </a>
          <nav className={`landing-nav ${menuOpen ? "is-open" : ""}`} aria-label="Primary navigation">
            <a href="#top" onClick={() => setMenuOpen(false)}>{locale === "en" ? "Home" : "首页"}</a>
            <NavMenu
              label={locale === "en" ? "Module" : "模块"}
              items={locale === "en"
                ? [
                  { label: "Multi-Agent System", href: "/si/multi-agent" },
                  { label: "Field Management", href: "/si/field-management" },
                  { label: "Remote Sensing Analysis", href: "/si/remote-sensing" },
                  { label: "Local Agricultural Knowledge Base", href: "/si/local-knowledge" },
                  { label: "Crop Rotation Strategy Recommendation", href: "/si/rotation-recommendation" },
                ]
                : [
                  { label: "多智能体", href: "/si/multi-agent" },
                  { label: "田地管理", href: "/si/field-management" },
                  { label: "遥感分析", href: "/si/remote-sensing" },
                  { label: "本地农业知识库", href: "/si/local-knowledge" },
                  { label: "轮作策略推荐", href: "/si/rotation-recommendation" },
                ]}
            />
            <div className="landing-nav-spacer" />
          </nav>
          <label className="si-language-picker">
            <Globe2 aria-hidden="true" size={16} />
            <span className="sr-only">Language</span>
            <select aria-label="Language" value={locale} onChange={(event) => setLocale(event.target.value as "en" | "zh-CN")}>
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
          {user && (
            <a
              href="/personal/notifications"
              aria-label={`个人中心：${user.display_name}`}
              className="flex shrink-0 items-center justify-center gap-3 rounded-md px-3 py-2 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Avatar className="size-8">
                <AvatarFallback>{user.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm sm:block">{user.display_name}</span>
            </a>
          )}
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

      <section id="top" className="landing-hero">
        <div className="landing-hero-grid" aria-hidden="true" />
        <div className="landing-hero-content">
          <h1>
            <span>{locale === "en" ? "See your fields from space." : "从太空看见你的农田。"}</span>
            <em>{locale === "en" ? "Plan every season with AI intelligence." : "用 AI 智能规划每个种植季。"}</em>
          </h1>
          <p>
            {locale === "en"
              ? "Agrisata brings satellite observations, field data, and AI-powered analysis together to help you explore crop rotations shaped by your land, local conditions, and farm priorities."
              : "Agrisata 将卫星观测、地块数据与 AI 分析结合起来，帮助你根据土地特征、当地条件和农场目标探索适合的轮作方案。"}
          </p>
          <div className="landing-hero-actions">
            <Button
              type="button"
              size="lg"
              className="landing-primary-button"
              onClick={() => void openFields()}
              disabled={openingFields}
              aria-busy={openingFields}
            >
              {openingFields ? <LoaderCircle className="animate-spin" size={17} /> : null}
              {locale === "en" ? "Explore Your Fields" : "探索你的农田"} {!openingFields ? <ArrowRight size={17} /> : null}
            </Button>
            <Button asChild size="lg" variant="outline" className="landing-secondary-button">
              <a href="#top">{locale === "en" ? "Discover the Platform" : "了解平台"}</a>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
