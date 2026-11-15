import { english, chinese } from "./catalog";
export type Locale = "en" | "zh";
export type Values = Record<string, string | number | null | undefined>;
export const localeKey = "agrisata-locale";
export const localeTag = (locale: Locale) => locale === "zh" ? "zh-CN" : "en-US";
export const isLocale = (value: unknown): value is Locale => value === "en" || value === "zh";
export function translate(locale: Locale, message: string, values?: Values): string {
  const catalogue = locale === "en" ? english : chinese;
  const text = Object.hasOwn(catalogue, message) ? catalogue[message] : message;
  return values ? text.replace(/\{(\w+)\}/g, (whole, key: string) => Object.hasOwn(values, key) ? String(values[key] ?? "") : whole) : text;
}
export type Translator = (message: string, values?: Values) => string;
