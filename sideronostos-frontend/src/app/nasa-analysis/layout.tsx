import type { ReactNode } from "react";

import { SiShell } from "@/features/si/si-shell";

import "maplibre-gl/dist/maplibre-gl.css";
import "../fields/fields.css";

export default function NasaAnalysisLayout({ children }: { children: ReactNode }) {
  return <SiShell>{children}</SiShell>;
}
