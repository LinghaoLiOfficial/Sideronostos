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

function AccountContent() {
  const user = useWorkspaceUser();
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
    if (!currentPassword) { setError("请输入当前密码"); return; }
    if (newPassword.length < 8 || newPassword.length > 256) {
      setError("新密码需要 8–256 个字符"); return;
    }
    if (newPassword !== confirmation) { setError("两次输入的新密码不一致"); return; }
    inFlight.current = true;
    setBusy("password");
    try {
      await changePassword(currentPassword, newPassword);
      setAccessToken(null);
      setCurrentPassword(""); setNewPassword(""); setConfirmation("");
      toast.success("密码已修改，请重新登录");
      router.replace("/login?next=%2Fpersonal%2Faccount");
    } catch (caught) {
      setError(caught instanceof ApiError ? authErrorMessage(caught) : "密码修改失败，请稍后重试");
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
      setLogoutError("退出登录失败，请重试");
      inFlight.current = false;
      setBusy(null);
    }
  }

  if (!user) return <p className="py-20 text-center text-sm text-muted-foreground">正在加载账号信息...</p>;
  return <div className="w-full max-w-3xl space-y-6">
    <div><Badge variant="outline">账号管理</Badge><h1 className="mt-3 text-2xl font-semibold">账号管理</h1><p className="mt-2 text-sm text-muted-foreground">查看账号信息与管理登录安全</p></div>
    <Card className="glass-surface">
      <CardHeader><CardTitle>用户信息</CardTitle></CardHeader>
      <CardContent><dl className="grid gap-4 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">用户名</dt><dd className="break-all">{user.display_name}</dd>
        <dt className="text-muted-foreground">邮箱</dt><dd className="break-all">{user.email}</dd>
        <dt className="text-muted-foreground">邮箱验证状态</dt><dd><Badge variant={user.email_verified ? "secondary" : "outline"}>{user.email_verified ? "已验证" : "未验证"}</Badge></dd>
      </dl></CardContent>
    </Card>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Card className="glass-surface">
      <CardHeader><CardTitle>修改密码</CardTitle><p className="text-sm text-muted-foreground">修改后所有设备的登录将失效，需要重新登录</p></CardHeader>
      <CardContent><form onSubmit={submit} noValidate className="grid gap-5">
        <div className="grid gap-2"><Label htmlFor="current-password">当前密码</Label><PasswordField id="current-password" autoComplete="current-password" required disabled={busy !== null} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="new-password">新密码</Label><PasswordField id="new-password" autoComplete="new-password" required minLength={8} maxLength={256} disabled={busy !== null} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="confirm-password">确认新密码</Label><PasswordField id="confirm-password" autoComplete="new-password" required maxLength={256} disabled={busy !== null} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
        <Button type="submit" disabled={busy !== null} className="justify-self-start">{busy === "password" && <LoaderCircle className="animate-spin" />}{busy === "password" ? "正在修改" : "修改密码"}</Button>
      </form></CardContent>
    </Card>
    <Card className="glass-surface"><CardHeader><CardTitle>退出账户</CardTitle></CardHeader><CardContent><Button variant="destructive" disabled={busy !== null} onClick={() => { setLogoutError(""); setLogoutOpen(true); }}><LogOut />退出登录</Button></CardContent></Card>
    <Dialog open={logoutOpen} onOpenChange={(open) => busy !== "logout" && setLogoutOpen(open)}>
      <DialogContent showCloseButton={busy !== "logout"}>
        <DialogHeader><DialogTitle>确认退出登录？</DialogTitle><DialogDescription>退出后，当前设备需要重新登录才能继续使用。</DialogDescription></DialogHeader>
        {logoutError && <Alert variant="destructive"><AlertDescription>{logoutError}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy === "logout"} onClick={() => setLogoutOpen(false)}>取消</Button><Button variant="destructive" disabled={busy === "logout"} onClick={logout}>{busy === "logout" && <LoaderCircle className="animate-spin" />}{busy === "logout" ? "正在退出" : "确认退出"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

export default function AccountPage() {
  return <WorkspaceShell><AccountContent /></WorkspaceShell>;
}
