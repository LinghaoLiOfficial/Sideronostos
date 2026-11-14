"use client";

import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { LoaderCircle, Mail, XCircle } from "lucide-react";

import { AuthShell } from "@/components/auth/auth-shell";
import { authErrorMessage, registrationNextPath, authHref, isFieldShiftDestination } from "@/components/auth/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resendVerification, verifyEmail } from "@/lib/api/client";

type State = "waiting" | "verifying" | "verified" | "failed";

function VerifyEmailContent() {
  const { t } = useI18n();

  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const next = searchParams.get("next") ? registrationNextPath(searchParams.get("next")) : null;
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [state, setState] = useState<State>(token ? "verifying" : "waiting");
  const [message, setMessage] = useState(token ? t("正在验证你的邮箱…") : t("验证邮件已发送，请检查收件箱"));
  const [resending, setResending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(() => { setState("verified"); setMessage("邮箱验证成功，请前往登录"); })
      .catch((error) => { setState("failed"); setMessage(authErrorMessage(error)); });
  }, [token]);

  async function resend(event: FormEvent) {
    event.preventDefault();
    if (!email) return;
    setResending(true);
    try {
      if (next) await resendVerification(email, next);
      else await resendVerification(email);
      setState("waiting");
      setMessage(t("如果该邮箱需要验证，新的验证邮件已经发送"));
    } catch (error) {
      setState("failed");
      setMessage(authErrorMessage(error));
    } finally {
      setResending(false);
    }
  }

  const Icon = state === "failed" ? XCircle : LoaderCircle;
  return (
    <AuthShell agriculture={isFieldShiftDestination(next)}><Card className="min-w-0 w-full py-7 text-center">
      <CardHeader className="items-center px-6">
        {state !== "waiting" && state !== "verified" ? <span className="brand-gradient-soft mb-3 flex size-14 items-center justify-center rounded-2xl border border-primary/25 text-pink-100"><Icon className={state === "verifying" ? "animate-spin" : ""} /></span> : null}
        <CardTitle className="text-2xl">{t("验证邮箱")}</CardTitle>
      </CardHeader>
      <CardContent className="px-6">
        <Alert variant={state === "failed" ? "destructive" : "default"} className="mt-10 mb-10 text-center"><AlertDescription>{t(message)}</AlertDescription></Alert>
        {state === "verified" ? <Button asChild className="mt-6 h-10 w-full"><Link href={authHref("/login", next, email ? { email } : {})}>{t("前往登录")}</Link></Button> : null}
        {state !== "verified" && state !== "verifying" ? (
          <form className="mt-6 grid gap-3 text-left" onSubmit={resend}>
            <Label htmlFor="verify-email" className="text-primary">{t("没有收到？重新发送")}</Label>
            <Input id="verify-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("you@example.com")} className="h-10" />
            <Button type="submit" variant="secondary" className="h-10" disabled={resending}>{resending ? <LoaderCircle className="animate-spin" /> : <Mail />}{resending ? t("正在发送") : t("重新发送")}</Button>
          </form>
        ) : null}
        <p className="mt-6 text-sm text-muted-foreground"><Link className="text-pink-200 hover:text-pink-100" href={authHref("/login", next)}>{t("返回登录")}</Link></p>
      </CardContent>
    </Card></AuthShell>
  );
}

export default function VerifyEmailPage() {
  const { t } = useI18n();

  return <Suspense fallback={<div className="text-sm text-muted-foreground">{t("正在加载…")}</div>}><VerifyEmailContent /></Suspense>;
}
