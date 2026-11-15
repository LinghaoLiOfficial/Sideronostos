import { NASAAnalysis } from "@/features/fields/nasa-analysis";

export const metadata = { title: "NASA Analysis · Agrisata" };

export default function NasaAnalysisPage() {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <NASAAnalysis />
    </main>
  );
}
