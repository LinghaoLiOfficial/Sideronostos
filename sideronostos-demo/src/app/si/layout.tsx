"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SiHeader } from "@/features/si/si-header";
import { SiStoryNavigation } from "@/features/si/si-story-link";
import { SiShell } from "@/features/si/si-shell";

import "maplibre-gl/dist/maplibre-gl.css";
import "../fields/fields.css";
import "./agronomy.css";

const localModuleRoutes = new Set([
  "/si/chat",
  "/si/field-management",
  "/si/remote-sensing",
  "/si/multi-agent",
]);

export default function SiLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/si/fields") return <div className="si-theme">{children}</div>;

  if (localModuleRoutes.has(pathname) || pathname.startsWith("/si/multi-agent/")) return <div className="si-theme"><SiShell>{children}</SiShell></div>;

  if (pathname === "/si/local-knowledge" || pathname === "/si/rotation-recommendation") {
    return <div className="si-theme si-agronomy-page site-farm-backdrop"><SiHeader />{children}</div>;
  }

  return (
    <div className="si-theme">
      <SiStoryNavigation>
        <SiHeader />
        {children}
      </SiStoryNavigation>
    </div>
  );
}
