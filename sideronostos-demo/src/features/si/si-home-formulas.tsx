import { renderMath } from "./si-math";

const formulas = [
  { name: "objective", latex: String.raw`\min Z=\sum_{f,k}c_{fk}x_{fk}` },
  { name: "budget", latex: String.raw`\sum_{f,k}a_{fk}x_{fk}\le B` },
  { name: "binary", latex: String.raw`x_{fk}\in\{0,1\}` },
  { name: "flow", latex: String.raw`\sum_j y_{ij}-\sum_j y_{ji}=b_i` },
  { name: "worst-case", latex: String.raw`\min_x\max_{\omega\in\Omega}L(x,\omega)` },
  { name: "risk", latex: String.raw`Z_{\mathrm{risk}}=\sum_{f,k}A_f r_{fk}x_{fk}` },
  { name: "overlap", latex: String.raw`\sum_{k\in K_{f,t}}x_{fk}\le 1` },
].map(({ name, latex }) => ({ name, html: renderMath(latex) }));

export function SiHomeFormulas() {
  return (
    <div className="si-hero-formulas" aria-hidden="true">
      {formulas.map(({ name, html }) => (
        <span key={name} className="si-hero-formula" data-formula={name} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </div>
  );
}
