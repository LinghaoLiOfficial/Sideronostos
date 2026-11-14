"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordField(props: Omit<React.ComponentProps<typeof Input>, "type">) {
  const { t } = useI18n();

  const [visible, setVisible] = useState(false);
  return (
    <div className="relative min-w-0 w-full">
      <Input {...props} type={visible ? "text" : "password"} className="h-10 w-full min-w-0 pr-10" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1.5"
        aria-label={visible ? t("隐藏密码") : t("显示密码")}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
