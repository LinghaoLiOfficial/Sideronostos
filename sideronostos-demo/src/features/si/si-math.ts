import katex from "katex";
import "katex/dist/katex.min.css";

export function renderMath(latex: string, displayMode = false) {
  return katex.renderToString(latex, {
    displayMode,
    output: "htmlAndMathml",
    strict: "error",
    trust: false,
  });
}
