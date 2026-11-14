"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/locale";

export function PasswordField({ locale = "zh-CN", ...props }: Omit<React.ComponentProps<typeof Input>, "type"> & { locale?: Locale }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative min-w-0 w-full">
      <Input {...props} type={visible ? "text" : "password"} className="h-10 w-full min-w-0 pr-10" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1.5"
        aria-label={visible ? (locale === "en" ? "Hide password" : "隐藏密码") : (locale === "en" ? "Show password" : "显示密码")}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
