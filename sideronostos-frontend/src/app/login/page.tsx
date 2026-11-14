"use client";

import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordField } from "@/components/auth/password-field";
import { authErrorMessage, safeNextPath, authHref, isFieldShiftDestination } from "@/components/auth/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser, signIn } from "@/lib/api/client";

function LoginForm() {
  const { t } = useI18n();

  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (searchParams.get("authRequired") === "1") {
      toast.warning(t("请先登录"), { id: "auth-required", description: isFieldShiftDestination(searchParams.get("next") ?? "/fields") ? t("登录后继续你的轮作规划") : t("登录后即可访问你的工作空间") });
    }
    getCurrentUser().then(() => router.replace(safeNextPath(searchParams.get("next") ?? "/fields"))).catch(() => undefined);
  }, [router, searchParams, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      await getCurrentUser();
      toast.success(t("登录成功"), { description: isFieldShiftDestination(searchParams.get("next") ?? "/fields") ? t("正在返回轮作规划") : t("正在进入你的工作空间") });
      router.replace(safeNextPath(searchParams.get("next") ?? "/fields"));
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell agriculture={isFieldShiftDestination(searchParams.get("next") ?? "/fields")}><Card className="min-w-0 w-full py-6">
      <CardHeader className="px-6">
        <CardTitle className="text-2xl">{t("欢迎回来")}</CardTitle>
      </CardHeader>
      <CardContent className="px-6">
        <form className="grid gap-5 pt-8" onSubmit={submit}>
          {error ? <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert> : null}
          <div className="grid gap-2">
            <Label htmlFor="email">{t("邮箱")}</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("you@example.com")} className="h-10" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t("密码")}</Label>
            <PasswordField id="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("输入密码")} />
          </div>
          <Button type="submit" size="lg" className="h-10" disabled={submitting}>
            {submitting ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{submitting ? t("正在登录") : t("登录")}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">{t("还没有账户？ ")}<Link className="text-pink-200 hover:text-pink-100" href={authHref("/register", searchParams.get("next") ?? "/fields")}>{t("立即注册")}</Link></p>
      </CardContent>
    </Card></AuthShell>
  );
}

export default function LoginPage() {
  const { t } = useI18n();

  return <Suspense fallback={<div className="text-sm text-muted-foreground">{t("正在加载…")}</div>}><LoginForm /></Suspense>;
}
