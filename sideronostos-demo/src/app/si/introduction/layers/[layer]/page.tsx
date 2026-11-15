import { notFound } from "next/navigation";
import { dataLayers } from "@/features/si/si-data-layers";
import { SiModelGuide } from "@/features/si/si-model-guide";

export { metadata } from "../page";

export function generateStaticParams() {
  return dataLayers.map(({ id }) => ({ layer: id }));
}

export default async function IntroductionLayerPage({ params }: {
  params: Promise<{ layer: string }>;
}) {
  const { layer } = await params;
  const index = dataLayers.findIndex(({ id }) => id === layer);
  if (index < 0) notFound();

  return <SiModelGuide key={layer} showLayers initialLayerIndex={index} />;
}
