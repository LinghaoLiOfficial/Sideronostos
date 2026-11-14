"use client";

import { useEffect, useSyncExternalStore } from "react";

export type Locale = "en" | "zh-CN";

const storageKey = "agrisata-locale";
const changeEvent = "agrisata:locale-change";

function readLocale(): Locale {
  return window.localStorage.getItem(storageKey) === "zh-CN" ? "zh-CN" : "en";
}

function subscribe(callback: () => void) {
  window.addEventListener(changeEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(changeEvent, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useLocale() {
  const locale = useSyncExternalStore<Locale>(subscribe, readLocale, () => "en");
  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }, [locale]);
  return locale;
}

export function setLocale(locale: Locale) {
  window.localStorage.setItem(storageKey, locale);
  window.dispatchEvent(new Event(changeEvent));
}
