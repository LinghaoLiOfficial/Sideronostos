import { createDemoObservations } from "@/features/fields/demo-data";
import { demoFields, demoProfile, demoRelease } from "./data";
import { iowaAnnual } from "./iowa-backend-data";

const answer = (text: string, suggestions: string[] = []) => ({
  paragraphs: [{ text, evidence_ids: [] }], actions: [], needs_clarification: false,
  facts: [], citations: [], warnings: [], suggestions,
});

export function demoRetrievalAnswer(question: string, botId: string, language: string) {
  if (!['remote-water', 'remote-soil', 'remote-weather', 'local-knowledge-guide'].includes(botId)) return null;
  const zh = language === 'zh';
  const text = question.toLowerCase();
  if (botId === 'local-knowledge-guide') {
    const cropNames = zh
      ? ['玉米播种窗口', '春燕麦播种窗口', '干籽豌豆播种窗口']
      : ['Maize sowing window', 'Spring oat sowing window', 'Dry field pea sowing window'];
    if (/price|market|variety|cultivar|价格|行情|品种/.test(text)) return answer(zh
      ? 'Iowa 演示参数包没有实时作物价格或当前品种资料。可查询参数包中的玉米、春燕麦或干籽豌豆播种窗口；这些是未按地块校准的工程基准。'
      : 'The Iowa demo profile has no live crop price or current variety feed. You can check its maize, spring oat, or dry field pea sowing windows; these are uncalibrated benchmark settings.', cropNames);
    const cropId = /maize|corn|玉米/.test(text) ? 'maize'
      : /\boat\b|燕麦/.test(text) ? 'oat'
      : /\bpea\b|豌豆/.test(text) ? 'pea' : null;
    const crop = demoProfile.crops.find((item) => item.id === cropId);
    if (crop) {
      const calendar = demoProfile.sources[crop.parameter_origins.calendar];
      const date = (value: string) => zh ? `${Number(value.slice(0, 2))}月${Number(value.slice(3))}日`
        : `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(value.slice(0, 2)) - 1]} ${Number(value.slice(3))}`;
      return answer(zh
        ? `${crop.name}的演示播种窗口为 ${date(crop.sow_start_mmdd)}至${date(crop.sow_end_mmdd)}。来源：${calendar?.title ?? 'Iowa benchmark'}（${demoProfile.id}）。这是未按当地地块或品种校准的工程基准，不是种植建议。`
        : `${crop.name} demo sowing window: ${date(crop.sow_start_mmdd)} to ${date(crop.sow_end_mmdd)}. Source: ${calendar?.title ?? 'Iowa benchmark'} (${demoProfile.id}). This is an uncalibrated engineering benchmark, not a planting recommendation.`);
    }
    return answer(zh
      ? `Iowa 演示参数包（${demoProfile.id}）可查询玉米、春燕麦和干籽豌豆的播种窗口；数据未按地块校准。请选择一项。`
      : `The Iowa demo profile (${demoProfile.id}) contains sowing windows for maize, spring oat, and dry field pea. The settings are not locally calibrated. Choose a topic.`, cropNames);
  }
  const rain = /rain|precip|降雨|降水/.test(text);
  const et0 = /et[₀0]|evapo|蒸散/.test(text);
  const soil = /moisture|smap|土壤水分|土壤湿度/.test(text);
  const count = Number(rain) + Number(et0) + Number(soil);
  const year = /\b20\d{2}\b/.exec(text)?.[0];
  const soilChoices = [1, 2, 3, 4].map((number) => zh
    ? `Field ${number} 2024年土壤湿度` : `Field ${number} soil moisture in 2024`);

  if (botId === 'remote-soil' || (botId === 'remote-water' && soil && count === 1)) {
    const fieldMatch = /field\s*([1-4])\b|地块\s*([1-4])(?!\d)|地块\s*([一二三四])/.exec(text);
    const index = fieldMatch ? Number(fieldMatch[1] || fieldMatch[2] || ({ 一: 1, 二: 2, 三: 3, 四: 4 } as Record<string, number>)[fieldMatch[3]]) - 1 : -1;
    if (year && year !== '2024') return answer(zh
      ? 'SMAP 演示样本仅有 2024-07-16。可选择 Field 1、Field 2、Field 3 或 Field 4。'
      : 'The available SMAP demo sample is 2024-07-16. Choose Field 1, Field 2, Field 3, or Field 4.', soilChoices);
    if (index < 0) return answer(zh
      ? '请选择 Field 1、Field 2、Field 3 或 Field 4；可用的 SMAP 演示日期为 2024-07-16。'
      : 'Choose Field 1, Field 2, Field 3, or Field 4. The available SMAP demo date is 2024-07-16.', soilChoices);
    const sample = createDemoObservations(demoFields[index], '2024-07-16').find((item) => item.metric === 'Surface soil moisture');
    if (!sample) return null;
    return answer(zh
      ? `Field ${index + 1} 的 2024-07-16 SMAP 表层土壤湿度演示值为 ${sample.value} ${sample.unit}。来源：${sample.sourceProduct}（${demoRelease.id}）。这是预计算的演示样本，属于区域背景，不是实时或田间实测。`
      : `Field ${index + 1} surface soil moisture on 2024-07-16: ${sample.value} ${sample.unit}. Source: ${sample.sourceProduct} (${demoRelease.id}). This is a precomputed demo sample of regional context, not a live or field sensor reading.`);
  }

  if (count === 1 && (rain || et0)) {
    const availableYears = '2022, 2023, 2024';
    if (!year || !iowaAnnual.some((row) => String(row.year) === year)) return answer(zh
      ? `请选择有资料的年份：${availableYears}。可查询降雨量或参考蒸散量 ET₀。`
      : `Choose an available year: ${availableYears}. You can ask for rainfall or reference ET₀.`,
      [2022, 2023, 2024].map((value) => zh ? `${value}年${rain ? '降雨量' : '参考蒸散量 ET₀'}` : `${value} ${rain ? 'rainfall' : 'reference ET₀'}`));
    const row = iowaAnnual.find((item) => String(item.year) === year)!;
    const value = rain ? row.rain_mm : row.et0_mm;
    const metric = rain ? (zh ? '降雨量' : 'Rainfall') : (zh ? '参考蒸散量 ET₀' : 'Reference ET₀');
    const product = rain ? 'GPM_3IMERGDF' : 'NASA POWER + SRTM FAO-56';
    return answer(zh
      ? `Iowa 区域 ${year} 年${metric}为 ${value} mm。来源：${product}（${demoRelease.id}）。这是区域历史演示资料，不代表单块田的测量或未来预报。`
      : `Iowa regional ${metric.toLowerCase()} in ${year}: ${value} mm. Source: ${product} (${demoRelease.id}). This is historical regional demo data, not a field measurement or forecast.`);
  }

  const options = botId === 'remote-soil'
    ? (zh ? 'SMAP 表层土壤湿度：Field 1–4，2024-07-16。' : 'SMAP surface soil moisture: Fields 1–4 on 2024-07-16.')
    : botId === 'remote-weather'
      ? (zh ? '降雨量或参考蒸散量 ET₀：2022、2023、2024 年。' : 'Rainfall or reference ET₀: 2022, 2023, 2024.')
      : (zh ? '降雨量或参考蒸散量 ET₀：2022、2023、2024 年；SMAP 表层土壤湿度：Field 1–4，2024-07-16。' : 'Rainfall or reference ET₀: 2022, 2023, 2024. SMAP surface soil moisture: Fields 1–4 on 2024-07-16.');
  const suggestions = botId === 'remote-soil' ? soilChoices : botId === 'remote-weather'
    ? (zh ? ['2024年降雨量', '2024年参考蒸散量 ET₀'] : ['2024 rainfall', '2024 reference ET₀'])
    : (zh ? ['2024年降雨量', '2024年参考蒸散量 ET₀', 'Field 1 2024年土壤湿度']
      : ['2024 rainfall', '2024 reference ET₀', 'Field 1 soil moisture in 2024']);
  return answer(zh ? `可查询的演示资料：${options}` : `Available demo data: ${options}`, suggestions);
}
