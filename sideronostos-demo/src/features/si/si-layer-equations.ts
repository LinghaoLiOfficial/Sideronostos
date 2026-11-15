export const layerEquations = {
  weather: [
    {
      latex: String.raw`\operatorname{GDD}(c,d)=\max\!\bigl(0,\widehat T_{\mathrm{mean}}(c,d)-T_{\mathrm{base}}(c)\bigr)`,
      en: "Daily growing degree days. The mean uses the model’s upper and lower temperature cutoffs.",
      zh: "每日有效积温。日均温使用模型设定的温度上下限计算。",
    },
    {
      latex: String.raw`\begin{aligned}
        e(k)&=\min\bigl\{h\ge s(k):\\
        &\qquad \sum_{d=s(k)}^{h}\operatorname{GDD}(c,d)\ge G_c\bigr\}
      \end{aligned}`,
      en: "Sum from sowing day $s(k)$ through day $h$. The first day that reaches the crop threshold $G_c$ is the estimated harvest date.",
      zh: "从播种日 $s(k)$ 累加到第 $h$ 日，第一次达到成熟积温阈值 $G_c$ 的日期为预计收获日。",
    },
  ],
  rain: [
    {
      latex: String.raw`P_{\mathrm{eff}}=\eta^{P}\times P,\qquad 0\le\eta^{P}\le 1`,
      en: "Multiply measured precipitation by the locally calibrated effective fraction to estimate rain available to the root zone.",
      zh: String.raw`以本地校准的有效降雨比例 $\eta^{P}$ 乘总降水 $P$，估计可用于根区的雨量。`,
    },
    {
      latex: String.raw`\widetilde D_t=\max\!\bigl(0,D_{t-1}+\mathrm{ET}_c-P_{\mathrm{eff}}\bigr)`,
      en: "For the same field and crop candidate, add daily crop ET and subtract effective rain before irrigation.",
      zh: "对同一田块和候选作物，灌溉前缺水量等于昨日缺水量加作物蒸散、减有效降雨，最低为零。",
    },
  ],
  thermal: [
    {
      latex: String.raw`\mathrm{ET}_c(f,k,t)=K_c(k,t)\times\mathrm{ET}_0(f,t)`,
      en: "Modeled crop ET is reference ET times the crop coefficient for the current growth stage. ECOSTRESS actual ET helps check this estimate.",
      zh: String.raw`参考蒸散 $\mathrm{ET}_0$ 乘当前生育阶段的作物系数 $K_c$ 得到作物蒸散估计，可用 ECOSTRESS 实际蒸散校验。`,
    },
    {
      latex: String.raw`\begin{aligned}
        &\operatorname{NIR}(f,k,t)=\max\bigl(0,\\
        &\qquad\widetilde D(f,k,t)-\operatorname{RAW}(f,k,t)\bigr)
      \end{aligned}`,
      en: "Net irrigation demand is the part of the pre-irrigation deficit above the allowable depletion.",
      zh: String.raw`灌溉前根区缺水量 $\widetilde D$ 超出允许消耗量 $\mathrm{RAW}$ 的部分即为净灌溉需求。`,
    },
  ],
  vegetation: [
    {
      latex: String.raw`\operatorname{Bare}(f,t)=1-\sum_k b(f,k,t)\,x(f,k)`,
      en: "The model uses $b=1$ for effective cover and $x=1$ for a selected candidate. Cover is assessed using imagery and field records.",
      zh: "$b=1$ 表示有效覆盖，$x=1$ 表示选中候选方案。覆盖由影像和田间记录共同判定。",
    },
    {
      latex: String.raw`\mathrm{TAW}=1000\times(\theta_{\mathrm{FC}}-\theta_{\mathrm{WP}})\times Z_r`,
      en: "Root-zone available water in millimeters uses local soil limits and root depth $Z_r$ in meters. SMAP provides context for the initial moisture state.",
      zh: String.raw`田间持水量 $\theta_{\mathrm{FC}}$ 与萎蔫点 $\theta_{\mathrm{WP}}$ 的差值乘根深 $Z_r$（米）并换算为毫米。SMAP 用于辅助估计初始含水状态。`,
    },
  ],
  terrain: [
    {
      latex: String.raw`\chi=\sigma_{\mathrm{sow}}\times\sigma_{\mathrm{soil}}\times\sigma_{\mathrm{terrain}}\times\sigma_{\mathrm{climate}}`,
      en: "The four suitability flags apply to the same field and candidate. Terrain contributes one binary flag based on local criteria.",
      zh: String.raw`四个适宜性指标对应同一田块和候选方案。地形指标 $\sigma_{\mathrm{terrain}}$ 依据当地坡度、排水和通行条件取 $0$ 或 $1$。`,
    },
    {
      latex: String.raw`x(f,k)\le\chi(f,k)`,
      en: "A field–crop candidate can be selected only when it passes every suitability check.",
      zh: "候选方案只有通过全部适宜性筛选才可被选中。",
    },
  ],
  storage: [
    {
      latex: String.raw`\begin{aligned}
        r_{\mathrm{climate}}&=\beta_{\mathrm{drought}}\cdot r_{\mathrm{drought}}+\beta_{\mathrm{heat}}\cdot r_{\mathrm{heat}}\\
        &\quad+\beta_{\mathrm{frost}}\cdot r_{\mathrm{frost}}+\beta_{\mathrm{excess}}\cdot r_{\mathrm{excess}}
      \end{aligned}`,
      en: "The candidate’s climate risk is a weighted sum. GRACE anomalies describe regional drought conditions that help contextualize the drought term.",
      zh: "候选方案的气候风险由干旱、高温、霜冻和积涝加权得到。GRACE 水储量异常为干旱项提供区域背景。",
    },
    {
      latex: String.raw`Z_{\mathrm{risk}}=\sum_f\sum_k A(f)\times r_{\mathrm{climate}}(f,k)\times x(f,k)`,
      en: "The optimization sums the selected candidates’ risk weighted by field area $A(f)$.",
      zh: "优化目标对选中候选方案的风险按田块面积 $A(f)$ 加权求和。",
    },
  ],
} as const;
