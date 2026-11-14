"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/translate";
import { useState } from "react";

export function Providers({ children, locale }: { children: React.ReactNode; locale?: Locale }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }));
  return <LocaleProvider initialLocale={locale}><QueryClientProvider client={client}>{children}</QueryClientProvider></LocaleProvider>;
}
