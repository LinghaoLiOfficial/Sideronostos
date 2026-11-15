"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { toast } from "sonner";
import { WorkspaceShell, useWorkspaceUser } from "@/components/workspace/shell";
import { PasswordField } from "@/components/auth/password-field";
import { authErrorMessage } from "@/components/auth/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiError, changePassword, setAccessToken, signOut } from "@/lib/api/client";
import { useLocale } from "@/lib/i18n/locale";
import styles from "@/components/workspace/personal.module.css";

function AccountContent() {
  const user = useWorkspaceUser();
  const locale = useLocale();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [busy, setBusy] = useState<"password" | "logout" | null>(null);
  const inFlight = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setError("");
    if (!currentPassword) { setError(t("请输入当前密码", "Enter your current password")); return; }
    if (newPassword.length < 8 || newPassword.length > 256) {
      setError(t("新密码需要 8–256 个字符", "Use 8–256 characters for the new password")); return;
    }
    if (newPassword !== confirmation) { setError(t("两次输入的新密码不一致", "The new passwords do not match")); return; }
    inFlight.current = true;
    setBusy("password");
    try {
      await changePassword(currentPassword, newPassword);
      setAccessToken(null);
      setCurrentPassword(""); setNewPassword(""); setConfirmation("");
      toast.success(t("密码已修改，请重新登录", "Password changed. Sign in again."));
      router.replace("/login?next=%2Fpersonal%2Faccount");
    } catch (caught) {
      setError(caught instanceof ApiError ? authErrorMessage(caught, locale) : t("密码修改失败，请稍后重试", "Could not change your password. Try again."));
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("logout");
    setLogoutError("");
    try {
      await signOut();
      router.replace("/login");
    } catch {
      setLogoutError(t("退出登录失败，请重试", "Could not sign out. Try again."));
      inFlight.current = false;
      setBusy(null);
    }
  }

  if (!user) return <p className="py-20 text-center text-sm text-muted-foreground">{t("正在加载账号信息...", "Loading account…")}</p>;
  return <div className="w-full max-w-3xl space-y-6">
    <h1 className={styles.title}>{t("账号管理", "Account")}</h1>
    <Card className={styles.accountCard}>
      <CardHeader><CardTitle>{t("用户信息", "User information")}</CardTitle></CardHeader>
      <CardContent><dl className="grid gap-4 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">{t("用户名", "Username")}</dt><dd className="break-all">{user.display_name}</dd>
        <dt className="text-muted-foreground">{t("邮箱", "Email")}</dt><dd className="break-all">{user.email}</dd>
        <dt className="text-muted-foreground">{t("邮箱验证状态", "Email verification")}</dt><dd><Badge variant={user.email_verified ? "secondary" : "outline"}>{user.email_verified ? t("已验证", "Verified") : t("未验证", "Unverified")}</Badge></dd>
      </dl></CardContent>
    </Card>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Card className={styles.accountCard}>
      <CardHeader><CardTitle>{t("修改密码", "Change password")}</CardTitle><p className="text-sm text-muted-foreground">{t("修改后所有设备的登录将失效，需要重新登录", "Changing your password signs you out on all devices.")}</p></CardHeader>
      <CardContent><form onSubmit={submit} noValidate className="grid gap-5">
        <div className="grid gap-2"><Label htmlFor="current-password">{t("当前密码", "Current password")}</Label><PasswordField id="current-password" autoComplete="current-password" required disabled={busy !== null} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="new-password">{t("新密码", "New password")}</Label><PasswordField id="new-password" autoComplete="new-password" required minLength={8} maxLength={256} disabled={busy !== null} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="confirm-password">{t("确认新密码", "Confirm new password")}</Label><PasswordField id="confirm-password" autoComplete="new-password" required maxLength={256} disabled={busy !== null} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
        <Button type="submit" disabled={busy !== null} className="justify-self-start">{busy === "password" && <LoaderCircle className="animate-spin" />}{busy === "password" ? t("正在修改", "Changing password…") : t("修改密码", "Change password")}</Button>
      </form></CardContent>
    </Card>
    <Card className={styles.accountCard}><CardHeader><CardTitle>{t("退出账户", "Session")}</CardTitle></CardHeader><CardContent><Button variant="destructive" disabled={busy !== null} onClick={() => { setLogoutError(""); setLogoutOpen(true); }}><LogOut />{t("退出登录", "Sign out")}</Button></CardContent></Card>
    <Dialog open={logoutOpen} onOpenChange={(open) => busy !== "logout" && setLogoutOpen(open)}>
      <DialogContent className={styles.dialog} showCloseButton={busy !== "logout"} closeLabel={t("关闭", "Close")}>
        <DialogHeader><DialogTitle>{t("确认退出登录？", "Sign out?")}</DialogTitle><DialogDescription>{t("退出后，当前设备需要重新登录才能继续使用。", "You will need to sign in again on this device.")}</DialogDescription></DialogHeader>
        {logoutError && <Alert variant="destructive"><AlertDescription>{logoutError}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy === "logout"} onClick={() => setLogoutOpen(false)}>{t("取消", "Cancel")}</Button><Button variant="destructive" disabled={busy === "logout"} onClick={logout}>{busy === "logout" && <LoaderCircle className="animate-spin" />}{busy === "logout" ? t("正在退出", "Signing out…") : t("确认退出", "Confirm sign out")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

export default function AccountPage() {
  return <WorkspaceShell><AccountContent /></WorkspaceShell>;
}
