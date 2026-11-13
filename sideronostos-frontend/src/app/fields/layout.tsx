import type { Metadata } from "next"

import "maplibre-gl/dist/maplibre-gl.css"
import "./fields.css"

export const metadata: Metadata = {
  title: "Field Intelligence | Agrisata",
  description: "Interactive world map and farm partition workspace with NASA Earth observations.",
}

export default function FieldsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
