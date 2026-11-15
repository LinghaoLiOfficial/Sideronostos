"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SurfaceTone = "dark" | "light";
export type SurfaceMaterial = "solid" | "glass";

const SurfaceContext = React.createContext<{ tone: SurfaceTone; material: SurfaceMaterial }>({ tone: "dark", material: "solid" });

export function useSurface() {
  return React.useContext(SurfaceContext).tone;
}

export function useSurfaceAppearance() {
  return React.useContext(SurfaceContext);
}

// Context survives React portals; data-surface restores the CSS variables there.
export function SurfaceProvider({ tone, material = "solid", children }: { tone: SurfaceTone; material?: SurfaceMaterial; children: React.ReactNode }) {
  // Glass is always smoky charcoal, including when placed on a cream surface.
  const appearance = React.useMemo(() => ({ tone: material === "glass" ? "dark" as const : tone, material }), [tone, material]);
  return <SurfaceContext.Provider value={appearance}>{children}</SurfaceContext.Provider>;
}

export function Surface({ tone, material = "solid", className, ...props }: React.ComponentProps<"div"> & { tone?: SurfaceTone; material?: SurfaceMaterial }) {
  const inherited = useSurfaceAppearance();
  const resolved = material === "glass" ? "dark" : tone ?? inherited.tone;
  return <SurfaceProvider tone={resolved} material={material}>
    <div data-slot="surface" data-surface={resolved} data-material={material} data-material-nested={material === "glass" && inherited.material === "glass" || undefined} className={cn("bg-card text-foreground", className)} {...props} />
  </SurfaceProvider>;
}
