"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { PasswordField } from "@/components/auth/password-field";
import { authErrorMessage, authHref, isFieldShiftDestination } from "@/components/auth/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser, signIn } from "@/lib/api/client";
import { useLocale } from "@/lib/i18n/locale";
import styles from "./login.module.css";

const homeHref = "/si";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const english = locale === "en";
  const agriculture = isFieldShiftDestination(searchParams.get("next"));
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (searchParams.get("authRequired") === "1") {
      toast.warning(english ? "Please sign in" : "请先登录", { id: "auth-required" });
    }
    getCurrentUser().then(() => router.replace(homeHref)).catch(() => undefined);
  }, [english, router, searchParams]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      await getCurrentUser();
      toast.success(english ? "Signed in" : "登录成功");
      router.replace(homeHref);
    } catch (caught) {
      setError(authErrorMessage(caught, locale));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={`${styles.form} locale-${english ? "en" : "zh"}`}>
      <CardHeader>
        <CardTitle className={styles.title}>
          <h1>{english ? "LOGIN" : "登录"}</h1>
        </CardTitle>
        {agriculture && (
          <h2 className={styles.context}>{english ? "Make a grounded choice for your next season" : "为下一轮种植，做一个有依据的选择"}</h2>
        )}
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={submit}>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <div className="grid gap-2">
            <Label htmlFor="email">{english ? "Email" : "邮箱"}</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="h-10" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{english ? "Password" : "密码"}</Label>
            <PasswordField locale={locale} id="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={english ? "Enter your password" : "输入密码"} />
          </div>
          <Button type="submit" size="lg" className="h-10" disabled={submitting}>
            {submitting ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{submitting ? (english ? "Signing in" : "正在登录") : (english ? "Sign in" : "登录")}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">{english ? "Don't have an account? " : "还没有账户？ "}<Link className={styles.register} href={authHref("/register", searchParams.get("next"))}>{english ? "Create one" : "立即注册"}</Link></p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className="text-sm text-muted-foreground">正在加载…</div>}><LoginForm /></Suspense>;
}
