"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isLocale, localeKey, localeTag, translate, type Locale, type Translator } from "./translate";
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
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    update(next);
    document.cookie = `${localeKey}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try { window.localStorage.setItem(localeKey, next); } catch { /* Cookie still preserves navigation and refresh. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = localeTag(locale); }, [locale]);
  useEffect(() => {
    const listener = (event: StorageEvent) => { if (event.key === localeKey && isLocale(event.newValue)) setLocale(event.newValue); };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [setLocale]);
  const value = useMemo(() => valueFor(locale, setLocale), [locale, setLocale]);
  return <Language.Provider value={value}>{children}</Language.Provider>;
}
export function useI18n() { return useContext(Language); }
