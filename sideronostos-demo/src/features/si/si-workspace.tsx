"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n/locale";
import { SiOrbitBackground } from "./si-orbit-background";
import { rotationOverviewHref, SiStoryLink } from "./si-story-link";

export function SiWorkspace({ orbitFormulas }: { orbitFormulas?: ReactNode }) {
  const locale = useLocale();
  const isEnglish = locale === "en";

  return (
    <main className={`landing-page si-landing-page locale-${isEnglish ? "en" : "zh"}`}>
      <section id="top" className="landing-hero">
        <SiOrbitBackground storyMedia>{orbitFormulas}</SiOrbitBackground>
        <div className="si-hero-copy">
          <h1>
            <span><strong>see</strong> your <strong>fields</strong></span>{" "}
            <span>from <strong>space</strong></span>{" "}
            <span className="si-hero-title-tail"><small>and</small> <strong>operation research</strong></span>
          </h1>
          <div className="si-hero-links">
            <SiStoryLink href={rotationOverviewHref}>
              {isEnglish ? "Explore the rotation model" : "了解轮作模型"}
            </SiStoryLink>
            <span aria-hidden="true">/</span>
            <Link href="/si/field-management">{isEnglish ? "Start" : "开始"}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
