"use client";

import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordField } from "@/components/auth/password-field";
import { authErrorMessage, safeNextPath, registrationNextPath, authHref, isFieldShiftDestination } from "@/components/auth/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser, signUp } from "@/lib/api/client";

const MIN_PASSWORD_LENGTH = 8;

function RegisterForm() {
  const { t } = useI18n();

  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");
  const next = requestedNext ? registrationNextPath(requestedNext) : null;
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { getCurrentUser().then(() => router.replace(safeNextPath(next))).catch(() => undefined); }, [router, next]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t("密码至少需要 {0} 位", { "0": MIN_PASSWORD_LENGTH }));
    if (password !== confirmPassword) return setError(t("两次输入的密码不一致"));
    setError("");
    setSubmitting(true);
    try {
      if (next) await signUp(email, password, displayName, next);
      else await signUp(email, password, displayName);
      router.push(authHref("/verify-email", next, { email }));
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell agriculture={isFieldShiftDestination(next)}>
      <Card className="min-w-0 w-full py-6">
        <CardHeader className="px-6"><CardTitle className="text-2xl">{t("创建账户")}</CardTitle></CardHeader>
        <CardContent className="px-6">
          <form className="grid gap-4 pt-8" onSubmit={submit}>
            {error ? <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert> : null}
            <div className="grid gap-2"><Label htmlFor="display-name">{t("用户名")}</Label><Input id="display-name" required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("你的名字")} className="h-10" /></div>
            <div className="grid gap-2"><Label htmlFor="email">{t("邮箱")}</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("you@example.com")} className="h-10" /></div>
            <div className="grid gap-2"><Label htmlFor="password">{t("密码")}</Label><PasswordField id="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("至少 {0} 位", { "0": MIN_PASSWORD_LENGTH })} /></div>
            <div className="grid gap-2"><Label htmlFor="confirm-password">{t("确认密码")}</Label><PasswordField id="confirm-password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t("再次输入密码")} /></div>
            <Button type="submit" size="lg" className="mt-1 h-10" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{submitting ? t("正在创建") : t("创建账户")}</Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">{t("已有账户？ ")}<Link className="text-pink-200 hover:text-pink-100" href={authHref("/login", next)}>{t("返回登录")}</Link></p>
        </CardContent>
      </Card>
    </AuthShell>
  );
}

export default function RegisterPage() {
  const { t } = useI18n();

  return <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">{t("正在加载…")}</div>}><RegisterForm /></Suspense>;
}
