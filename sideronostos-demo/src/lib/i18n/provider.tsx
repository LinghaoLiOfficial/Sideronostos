"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isLocale, localeKey, localeTag, translate, type Locale, type Translator } from "./translate";
import { setLocale as setLegacyLocale, useLocale } from "./locale";
type LanguageContext = { locale: Locale; setLocale: (locale: Locale) => void; t: Translator; number: (value: number, options?: Intl.NumberFormatOptions) => string; date: (value: Date | string, options?: Intl.DateTimeFormatOptions) => string };
function valueFor(locale: Locale, setLocale: (locale: Locale) => void): LanguageContext {
  return { locale, setLocale, t: (message, values) => translate(locale, message, values), number: (value, options) => new Intl.NumberFormat(localeTag(locale), options).format(value), date: (value, options) => new Intl.DateTimeFormat(localeTag(locale), options).format(new Date(value)) };
}
const Language = createContext<LanguageContext>(valueFor("en", () => {}));
function storedLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith(`${localeKey}=`))?.split("=")[1];
  if (isLocale(cookie)) return cookie;
  try { const value = window.localStorage.getItem(localeKey); if (isLocale(value)) return value; } catch { /* Private browsing may disable storage. */ }
  return "en";
}
export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, update] = useState<Locale>(() => initialLocale ?? storedLocale());
  const legacyLocale = useLocale();
  const previousLegacy = useRef(legacyLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    update(next);
    document.cookie = `${localeKey}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try { setLegacyLocale(next === "zh" ? "zh-CN" : "en"); } catch { /* Cookie still preserves navigation and refresh. */ }
  }, []);
  useEffect(() => { try { setLegacyLocale(locale === "zh" ? "zh-CN" : "en"); } catch { /* Cookie remains available. */ } }, []);
  useEffect(() => {
    if (legacyLocale === previousLegacy.current) return;
    previousLegacy.current = legacyLocale;
    update(legacyLocale === "zh-CN" ? "zh" : "en");
  }, [legacyLocale]);
  useEffect(() => { document.documentElement.lang = localeTag(locale); }, [locale]);
  useEffect(() => {
    const listener = (event: StorageEvent) => { if (event.key === localeKey && (isLocale(event.newValue) || event.newValue === "zh-CN")) setLocale(event.newValue === "zh-CN" ? "zh" : event.newValue as Locale); };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [setLocale]);
  const value = useMemo(() => valueFor(locale, setLocale), [locale, setLocale]);
  return <Language.Provider value={value}>{children}</Language.Provider>;
}
export function useI18n() { return useContext(Language); }
