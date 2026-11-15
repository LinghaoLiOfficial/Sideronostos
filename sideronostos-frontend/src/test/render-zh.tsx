import React, { type ReactNode } from "react";
import { render as baseRender, type RenderOptions } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n/provider";
/** Existing Chinese journey fixtures explicitly select Chinese; default-English behavior has separate acceptance tests. */
export function render(ui: ReactNode, options: RenderOptions = {}) {
  const Existing = options.wrapper;
  return baseRender(ui, { ...options, wrapper: ({ children }) => <LocaleProvider initialLocale="zh">{Existing ? <Existing>{children}</Existing> : children}</LocaleProvider> });
}
