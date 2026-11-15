"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n/locale";
import { SiOrbitBackground } from "./si-orbit-background";
import { rotationOverviewHref, SiStoryLink } from "./si-story-link";

export function SiWorkspace() {
  const locale = useLocale();
  const isEnglish = locale === "en";

  return (
    <main className={`landing-page si-landing-page locale-${isEnglish ? "en" : "zh"}`}>
      <section id="top" className="landing-hero">
        <SiOrbitBackground storyMedia />
        <div className="si-hero-copy">
          <h1>see your fields from space</h1>
          <div className="si-hero-links">
            <SiStoryLink className="si-hero-primary-link" href={rotationOverviewHref}>
              {isEnglish ? "Explore the rotation model" : "了解轮作模型"}
            </SiStoryLink>
            <Link href="/si/multi-agent">{isEnglish ? "Open multi-agent" : "进入多智能体"}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
