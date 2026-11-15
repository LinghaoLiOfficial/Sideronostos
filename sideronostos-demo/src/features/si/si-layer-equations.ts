export const layerEquations = {
  weather: [
    {
      expression: "GDD(c,d) = max(0, T̂mean(c,d) − Tbase(c))",
      en: "Daily growing degree days. The mean uses the model’s upper and lower temperature cutoffs.",
      zh: "每日有效积温。日均温使用模型设定的温度上下限计算。",
    },
    {
      expression: "e(k) = min { h ≥ s(k) : ∑ GDD(c,d) ≥ Gc }",
      en: "Sum from sowing day s(k) through day h. The first day that reaches the crop threshold Gc is the estimated harvest date.",
      zh: "从播种日 s(k) 累加到第 h 日，第一次达到成熟积温阈值 Gc 的日期为预计收获日。",
    },
  ],
  rain: [
    {
      expression: "Pₑff = ηᴾ × P,  0 ≤ ηᴾ ≤ 1",
      en: "Multiply measured precipitation by the locally calibrated effective fraction to estimate rain available to the root zone.",
      zh: "以本地校准的有效降雨比例 ηᴾ 乘总降水 P，估计可用于根区的雨量。",
    },
    {
      expression: "D̃ₜ = max(0, Dₜ₋₁ + ETc − Pₑff)",
      en: "For the same field and crop candidate, add daily crop ET and subtract effective rain before irrigation.",
      zh: "对同一田块和候选作物，灌溉前缺水量等于昨日缺水量加作物蒸散、减有效降雨，最低为零。",
    },
  ],
  thermal: [
    {
      expression: "ETc(f,k,t) = Kc(k,t) × ET₀(f,t)",
      en: "Modeled crop ET is reference ET times the crop coefficient for the current growth stage. ECOSTRESS actual ET helps check this estimate.",
      zh: "参考蒸散 ET₀ 乘当前生育阶段的作物系数 Kc 得到作物蒸散估计，可用 ECOSTRESS 实际蒸散校验。",
    },
    {
      expression: "NIR(f,k,t) = max(0, D̃(f,k,t) − RAW(f,k,t))",
      en: "Net irrigation demand is the part of the pre-irrigation deficit above the allowable depletion.",
      zh: "灌溉前根区缺水量 D̃ 超出允许消耗量 RAW 的部分即为净灌溉需求。",
    },
  ],
  vegetation: [
    {
      expression: "Bare(f,t) = 1 − ∑ₖ b(f,k,t) x(f,k)",
      en: "The model uses b = 1 for effective cover and x = 1 for a selected candidate. Cover is assessed using imagery and field records.",
      zh: "b = 1 表示有效覆盖，x = 1 表示选中候选方案。覆盖由影像和田间记录共同判定。",
    },
    {
      expression: "TAW = 1000 × (θFC − θWP) × Zr",
      en: "Root-zone available water in millimeters uses local soil limits and root depth Zr in meters. SMAP provides context for the initial moisture state.",
      zh: "田间持水量 θFC 与萎蔫点 θWP 的差值乘根深 Zr（米）并换算为毫米。SMAP 用于辅助估计初始含水状态。",
    },
  ],
  terrain: [
    {
      expression: "χ = σsow × σsoil × σterrain × σclimate",
      en: "The four suitability flags apply to the same field and candidate. Terrain contributes one binary flag based on local criteria.",
      zh: "四个适宜性指标对应同一田块和候选方案。地形指标 σterrain 依据当地坡度、排水和通行条件取 0 或 1。",
    },
    {
      expression: "x(f,k) ≤ χ(f,k)",
      en: "A field–crop candidate can be selected only when it passes every suitability check.",
      zh: "候选方案只有通过全部适宜性筛选才可被选中。",
    },
  ],
  storage: [
    {
      expression: "rclimate = βdrought·rdrought + βheat·rheat\n+ βfrost·rfrost + βexcess·rexcess",
      en: "The candidate’s climate risk is a weighted sum. GRACE anomalies describe regional drought conditions that help contextualize the drought term.",
      zh: "候选方案的气候风险由干旱、高温、霜冻和积涝加权得到。GRACE 水储量异常为干旱项提供区域背景。",
    },
    {
      expression: "Zrisk = ∑f ∑k A(f) × rclimate(f,k) × x(f,k)",
      en: "The optimization sums the selected candidates’ risk weighted by field area A(f).",
      zh: "优化目标对选中候选方案的风险按田块面积 A(f) 加权求和。",
    },
  ],
} as const;
