import { cookies } from "next/headers";
import { isLocale, localeKey, localeTag } from "@/lib/i18n/translate";
import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "Agrisata",
  icons: { icon: "/brand/app-logo-favicon-centered.png" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preference = (await cookies()).get(localeKey)?.value;
  const locale = isLocale(preference) ? preference : "en";
  return (
    <html
      lang={localeTag(locale)}
      data-scroll-behavior="smooth"
      className="dark font-sans"
      suppressHydrationWarning
    >
      <body>
        <Providers locale={locale}>
          <TooltipProvider>{children}<Toaster /></TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
