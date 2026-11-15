import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const analysisDir = path.resolve(process.env.NASA_ANALYSIS_DIR ?? path.resolve(process.cwd(), "../data/nasa/iowa-2022-2024/analysis/non-appeears"))
  try {
    const image = await readFile(path.join(analysisDir, "srtm-terrain.png"))
    return new NextResponse(image, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    })
  } catch {
    return NextResponse.json({ error: "SRTM terrain image is not available." }, { status: 404 })
  }
}
