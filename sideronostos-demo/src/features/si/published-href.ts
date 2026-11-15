/** Keep assistant links on implemented, owned pages in the published /si area. */
export function publishedHref(value: unknown, fallback?: string | null): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback ?? null;
  try {
    const parsed = new URL(value, "https://local.invalid");
    if (parsed.origin !== "https://local.invalid") return fallback ?? null;
    if (parsed.pathname === "/field-shift" && parsed.searchParams.has("field")) {
      return `/si/fields?${parsed.searchParams.toString()}${parsed.hash}`;
    }
    if (parsed.pathname === "/si/fields" || parsed.pathname.startsWith("/si/multi-agent/results/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch { /* Invalid URLs do not become links. */ }
  return fallback ?? null;
}
