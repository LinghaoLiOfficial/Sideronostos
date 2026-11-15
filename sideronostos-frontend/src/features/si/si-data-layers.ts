export const dataLayers = [
  {
    id: "weather", product: "NASA POWER",
    en: {
      title: "Weather and atmosphere",
      observes: "Daily high and low air temperature, dew point or humidity, wind speed, pressure and radiation.",
      estimates: "Combine daily temperatures with crop-specific thresholds to calculate growing degree days (GDD) and estimate harvest date e(k). Use the weather inputs to estimate reference evapotranspiration (ET₀) and help assess heat and frost exposure.",
      boundary: "Calibrate coarse-grid weather against local stations. Crop maturity and stress thresholds come from local trials or agronomic guidance.",
    },
    zh: {
      title: "气象与大气环境",
      observes: "日最高和最低气温、露点或湿度、风速、气压、辐射。",
      estimates: "逐日气温结合品种温度阈值，计算有效积温 GDD 并估计收获日 e(k)。用气象要素估算参考蒸散 ET₀，并辅助判断高温和霜冻暴露。",
      boundary: "粗网格气象先用本地气象站校准。成熟积温和胁迫阈值由品种试验或当地农艺资料提供。",
    },
  },
  {
    id: "rain", product: "GPM IMERG Final",
    en: {
      title: "Precipitation",
      observes: "Daily precipitation or half-hourly precipitation with quality flags.",
      estimates: "Aggregate rainfall to field-day precipitation P. Apply a locally calibrated effective rainfall rule to estimate Pₑff for the daily root-zone water balance. Use historical heavy-rain events to inform excess-water risk.",
      boundary: "Check against rain gauges. Effective rainfall depends on local runoff, infiltration and crop stage.",
    },
    zh: {
      title: "降水",
      observes: "日降水或半小时降水，以及对应的质量标记。",
      estimates: "按本地农业日汇总降水 P，再用本地规则估计有效降雨 Pₑff，输入逐日根区水量平衡。历史强降雨还可辅助评估积涝风险。",
      boundary: "用田间雨量计校验。有效降雨需考虑径流、渗漏和作物生育期。",
    },
  },
  {
    id: "thermal", product: "ECOSTRESS LST / ET",
    en: {
      title: "Thermal infrared and evapotranspiration",
      observes: "Land surface temperature (LST) and actual evapotranspiration from usable overpasses.",
      estimates: "Use surface temperature to help assess heat stress. Compare actual ET with modeled crop evapotranspiration (ETc) and the water balance to flag discrepancies.",
      boundary: "Surface temperature and air temperature are separate measurements. Actual ET serves as a check on the model. Cloud cover and irregular overpasses limit comparisons.",
    },
    zh: {
      title: "热红外温度与蒸散",
      observes: "有效过境时的地表温度 LST 和实际蒸散发。",
      estimates: "用地表温度辅助识别热胁迫，用实际蒸散校验模型估算的作物蒸散 ETc 和水量平衡。",
      boundary: "地表温度与空气温度分别使用。实际蒸散用于校验。过境不定期且受云影响，比较仅限有效观测。",
    },
  },
  {
    id: "vegetation", product: "HLS L30 / S30 · SMAP SPL4SMGP",
    en: {
      title: "Optical vegetation and surface moisture",
      observes: "HLS surface reflectance for NDVI and NDMI. SMAP supplies regional estimates of surface and root-zone soil moisture.",
      estimates: "Combine cloud-screened HLS observations with field records to estimate effective ground cover b and days of bare soil. Use SMAP as a prior for initial root-zone water deficit and as context for drought risk.",
      boundary: "Keep cloud-masked dates as missing. Calibrate root-zone conditions with field sensors, and obtain field capacity and wilting point from soil data.",
    },
    zh: {
      title: "光学植被与地表水分",
      observes: "HLS 地表反射率用于计算 NDVI、NDMI。SMAP 提供区域尺度的表层和根区土壤含水量。",
      estimates: "HLS 去云后结合田间记录，估计有效覆盖 b 和裸地时间。以 SMAP 作为根区初始缺水量的先验，并辅助评估干旱风险。",
      boundary: "云遮日期保留为缺测。根区水分用田间传感器校准，田间持水量和萎蔫点来自土壤资料。",
    },
  },
  {
    id: "terrain", product: "SRTM",
    en: {
      title: "Terrain",
      observes: "Elevation from a digital elevation model.",
      estimates: "Derive slope, aspect and low-lying terrain indicators for terrain suitability and waterlogging or erosion risk. Elevation can also support ET₀ inputs such as air pressure.",
      boundary: "Check elevation gaps and datum consistency. Confirm actual field drainage and machinery access locally.",
    },
    zh: {
      title: "地形",
      observes: "数字高程模型提供的高程。",
      estimates: "从高程派生坡度、坡向和低洼指标，用于地形适宜性筛选并辅助估计积涝与侵蚀风险。高程还可辅助估算 ET₀ 所需的气压等输入。",
      boundary: "先检查高程空洞及基准一致性，田间实际排水和农机通行条件由现场确认。",
    },
  },
  {
    id: "storage", product: "GRACE / GRACE-FO Mascon",
    en: {
      title: "Gravity-based water storage",
      observes: "Monthly total water storage anomalies at basin or regional scale.",
      estimates: "Describe persistent water-storage deficits or recovery as context for long-term drought risk and planning scenarios.",
      boundary: "Interpret at basin scale and retain the reference period and uncertainty. Use local water rights and supply records for daily irrigation capacity.",
    },
    zh: {
      title: "重力水储量",
      observes: "流域或区域尺度的月总水储量异常。",
      estimates: "识别长期水储量亏缺或恢复，为干旱风险和轮作情景提供区域背景。",
      boundary: "按流域尺度解释，保留基准期和不确定度。每日供水能力仍由本地水权、配额和供水记录确定。",
    },
  },
] as const;
