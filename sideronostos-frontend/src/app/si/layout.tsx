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
]);

export default function SiLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (localModuleRoutes.has(pathname)) return <SiShell>{children}</SiShell>;

  return (
    <SiStoryNavigation>
      <SiHeader />
      {children}
    </SiStoryNavigation>
  );
}
