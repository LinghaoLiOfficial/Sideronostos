"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SiHeader } from "@/features/si/si-header";
import { SiStoryNavigation } from "@/features/si/si-story-link";
import { SiShell } from "@/features/si/si-shell";

import "maplibre-gl/dist/maplibre-gl.css";
import "../fields/fields.css";

const localModuleRoutes = new Set([
  "/si/chat",
  "/si/field-management",
  "/si/remote-sensing",
  "/si/local-knowledge",
  "/si/multi-agent",
  "/si/rotation-recommendation",
]);

export default function SiLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/si/fields") return <div className="si-theme">{children}</div>;

  if (localModuleRoutes.has(pathname)) return <div className="si-theme"><SiShell>{children}</SiShell></div>;

  return (
    <div className="si-theme">
      <SiStoryNavigation>
        <SiHeader />
        {children}
      </SiStoryNavigation>
    </div>
  );
}
