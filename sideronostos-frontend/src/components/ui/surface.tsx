"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SurfaceTone = "dark" | "light";

const SurfaceContext = React.createContext<SurfaceTone>("dark");

export function useSurface() {
  return React.useContext(SurfaceContext);
}

// Context survives React portals; data-surface restores the CSS variables there.
export function SurfaceProvider({ tone, children }: { tone: SurfaceTone; children: React.ReactNode }) {
  return <SurfaceContext.Provider value={tone}>{children}</SurfaceContext.Provider>;
}

export function Surface({ tone, className, ...props }: React.ComponentProps<"div"> & { tone?: SurfaceTone }) {
  const inherited = useSurface();
  const resolved = tone ?? inherited;
  return <SurfaceProvider tone={resolved}>
    <div data-slot="surface" data-surface={resolved} className={cn("bg-background text-foreground", className)} {...props} />
  </SurfaceProvider>;
}
