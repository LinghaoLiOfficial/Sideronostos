export const labels: Record<string, string> = {
  soil_moisture: "表层土壤水分",
  surface_soil_moisture: "表层土壤水分",
  rainfall_total: "累计降雨",
  reference_et0_total: "参考蒸散总量",
  rainfall_mm: "累计降雨",
  precipitation_mm: "累计降雨",
  reference_et_mm: "参考蒸散",
  et0_mm: "参考蒸散",
  temperature_c: "平均气温",
  tmean_c: "平均气温",
};
export const dataStatus: Record<string, string> = {
  available: "有效数据",
  no_recommended_retrieval: "质量筛选后暂无有效值",
  outside_coverage: "超出观测覆盖范围",
  incomplete_period: "所选时段资料不完整",
};
export const missingReason: Record<string, string> = {
  no_prepared_area_statistics:
    "该区域尚未准备面积统计，不能用中心点代替整个区域。",
  outside_time_coverage: "所选日期不在这份资料的覆盖期内。",
  asset_unavailable: "这份资料的本地文件暂不可用，请稍后重试。",
  no_prepared_weather_for_location: "该位置尚无匹配的已发布历史天气。",
  no_published_scientific_data: "当前尚未发布适用的科学数据。",
};
export const readableUnit = (unit: string | undefined) =>
  unit === "m3/m3" ? "m³/m³" : (unit ?? "");
