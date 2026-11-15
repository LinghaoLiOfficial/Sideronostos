import { createDemoObservations } from "@/features/fields/demo-data";
import { demoFields, demoRelease } from "./data";
import { iowaAnnual } from "./iowa-backend-data";

const answer = (text: string, suggestions: string[] = []) => ({
  paragraphs: [{ text, evidence_ids: [] }], actions: [], needs_clarification: false,
  facts: [], citations: [], warnings: [], suggestions,
});

export function demoRetrievalAnswer(question: string, botId: string, language: string) {
  if (!['remote-water', 'remote-soil', 'remote-weather'].includes(botId)) return null;
  const zh = language === 'zh';
  const text = question.toLowerCase();
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
