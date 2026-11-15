import { dataLayers } from "./si-data-layers";
import { layerEquations } from "./si-layer-equations";
import { renderMath } from "./si-math";
import { SiModelGuide } from "./si-model-guide";

export type MathTextPart = { text: string } | { mathHtml: string };

function renderMathText(source: string): MathTextPart[] {
  return source.split(/\$([^$]+)\$/).map((part, index) =>
    index % 2 ? { mathHtml: renderMath(part) } : { text: part },
  );
}

// Switchable layers use the same pre-rendered equations on the server and in the browser.
const renderedLayers = dataLayers.map((layer) => ({
  estimates: {
    en: renderMathText(layer.en.estimates),
    zh: renderMathText(layer.zh.estimates),
  },
  equations: layerEquations[layer.id].map(({ latex, en, zh }) => ({
    latex,
    html: renderMath(latex, true),
    en: renderMathText(en),
    zh: renderMathText(zh),
  })),
}));

export type RenderedLayer = (typeof renderedLayers)[number];

export function SiLayerGuide({ initialLayerIndex = 0 }: { initialLayerIndex?: number }) {
  return <SiModelGuide showLayers initialLayerIndex={initialLayerIndex} renderedLayers={renderedLayers} />;
}
