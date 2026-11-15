type ObservationDates = { start: string; end: string };
export function observationWindow(
  start: string | null,
  end: string | null,
): { dates?: ObservationDates; error?: string } {
  if (!start && !end) return {};
  const valid = (value: string | null): value is string => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  };
  if (
    !valid(start) ||
    !valid(end) ||
    start > end ||
    (Date.parse(end) - Date.parse(start)) / 86400000 > 1095
  )
    return { error: "请填写有效的观测起止日期，范围不超过三年。" };
  return { dates: { start, end } };
}


/** Match provenance by release identity, independently of the selected map layer. */
export function scienceSourceName(
  releaseId: string | undefined,
  layers: { title: string; source: { release_id?: string } }[],
  profiles: { weather_release_id: string }[],
): string {
  if (!releaseId) return "区域资料";
  const layer = layers.find((item) => item.source.release_id === releaseId);
  if (layer) return layer.title;
  if (profiles.some((item) => item.weather_release_id === releaseId))
    return "历史天气资料";
  return `资料 ${releaseId}`;
}
