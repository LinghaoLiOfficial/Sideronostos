"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, ListChecks, LoaderCircle, MailCheck, Trash2, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { notifyNotificationsChanged, WorkspaceShell } from "@/components/workspace/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import styles from "@/components/workspace/personal.module.css";
import { useLocale } from "@/lib/i18n/locale";
import {
  deleteNotifications,
  getDirectInvitation,
  Invitation,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  Notification,
  respondDirectInvitation,
} from "@/lib/api/client";

import { getInvitationStatusLabel, getNotificationRowBackground, removeTrailingChineseFullStop, shouldLoadInvitationDetails } from "./utils";

export default function NotificationsPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [detailError, setDetailError] = useState("");
  const [responding, setResponding] = useState(false);

  const load = useCallback(() => listNotifications({ unread_only: onlyUnread }).then((value) => {
    setItems(value.items);
    setUnread(value.unread_count);
  }).catch(() => toast.error(locale === "en" ? "Could not load notifications" : "消息加载失败")), [onlyUnread, locale]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected?.invitation_id || !shouldLoadInvitationDetails(selected.type)) return;
    let active = true;
    getDirectInvitation(selected.invitation_id)
      .then((value) => { if (active) setInvite(value); })
      .catch(() => { if (active) setDetailError(locale === "en" ? "This invitation is unavailable, expired, or belongs to another user." : "邀请不存在、已失效或不属于当前用户"); });
    return () => { active = false; };
  }, [selected, locale]);

  async function read(item: Notification) {
    if (!item.read_at) {
      await markNotificationRead(item.id);
      await load();
      notifyNotificationsChanged();
    }
  }

  function openDetail(item: Notification) {
    setInvite(null);
    setDetailError("");
    setSelected(item);
    void read(item).catch(() => toast.error(t("消息状态更新失败", "Could not update the notification")));
  }

  async function readAll() {
    await markAllNotificationsRead();
    await load();
    notifyNotificationsChanged();
    toast.success(t("已全部标记为已读", "All notifications marked as read"));
  }

  function toggleSelecting() {
    setSelecting((current) => {
      if (current) setSelectedIds(new Set());
      return !current;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((current) => current.size === items.length
      ? new Set()
      : new Set(items.map((item) => item.id)));
  }

  async function removeSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      await deleteNotifications([...selectedIds]);
      setDeleteConfirmOpen(false);
      setSelectedIds(new Set());
      setSelecting(false);
      await load();
      notifyNotificationsChanged();
      toast.success(t("所选消息已删除", "Selected notifications deleted"));
    } catch {
      toast.error(t("消息删除失败", "Could not delete notifications"));
    } finally {
      setDeleting(false);
    }
  }

  async function respond(action: "accept" | "decline") {
    if (!selected?.invitation_id) return;
    setResponding(true);
    try {
      const result = await respondDirectInvitation(selected.invitation_id, action);
      setInvite((value) => value ? { ...value, status: result.status } : value);
      toast.success(action === "accept" ? t("已加入群组", "Joined the group") : t("已拒绝邀请", "Invitation declined"));
    } catch {
      toast.error(t("邀请处理失败", "Could not respond to the invitation"));
    } finally {
      setResponding(false);
    }
  }

  function closeDetail() {
    setSelected(null);
    setInvite(null);
    setDetailError("");
  }

  const selectedIsInvitation = selected ? shouldLoadInvitationDetails(selected.type) : false;

  return <WorkspaceShell>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className={styles.title}>{t("通知中心", "Notifications")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t(`${unread} 条未读消息`, `${unread} unread`)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {selecting ? <>
          <Button variant="outline" onClick={toggleAll}><CheckCheck />{selectedIds.size === items.length ? t("取消全选", "Clear selection") : t("全选", "Select all")}</Button>
          <Button variant="destructive" disabled={selectedIds.size === 0} onClick={() => setDeleteConfirmOpen(true)}><Trash2 />{t("删除所选", "Delete selected")}{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</Button>
          <Button size="icon" variant="ghost" aria-label={t("退出选择模式", "Exit selection mode")} onClick={toggleSelecting}><X /></Button>
        </> : <>
          <label className="flex items-center gap-2 text-sm"><Switch checked={onlyUnread} onCheckedChange={setOnlyUnread} />{t("仅看未读", "Unread only")}</label>
          <Button variant="outline" onClick={readAll}><CheckCheck />{t("全部已读", "Mark all as read")}</Button>
          <Button variant="outline" disabled={items.length === 0} onClick={toggleSelecting}><ListChecks />{t("选择消息", "Select notifications")}</Button>
        </>}
      </div>
    </div>

    <div className={styles.list}>
      {items.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center">
        <Bell size={32} className={styles.notificationIcon} />
        <p className="mt-3 text-sm">{t("暂无消息", "No notifications")}</p>
      </div> : items.map((item) => <div
        key={item.id}
        className="notification-row flex items-center gap-4 border-b border-white/10 p-4 transition-colors last:border-0"
        data-unread={!item.read_at}
        data-selected={selectedIds.has(item.id)}
        style={{ backgroundColor: getNotificationRowBackground(!item.read_at, selectedIds.has(item.id), highlightedId === item.id) }}
        onMouseEnter={() => setHighlightedId(item.id)}
        onMouseLeave={() => setHighlightedId((current) => current === item.id ? null : current)}
        onFocusCapture={() => setHighlightedId(item.id)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setHighlightedId((current) => current === item.id ? null : current);
          }
        }}
      >
        {selecting && <Checkbox className="cursor-pointer" checked={selectedIds.has(item.id)} aria-label={`${t("选择消息：", "Select notification: ")}${removeTrailingChineseFullStop(item.title)}`} onCheckedChange={() => toggleSelected(item.id)} />}
        <button className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`${selecting ? selectedIds.has(item.id) ? t("取消选择", "Deselect") : t("选择", "Select") : t("查看消息", "View notification")}${t("：", ": ")}${removeTrailingChineseFullStop(item.title)}`} onClick={() => selecting ? toggleSelected(item.id) : openDetail(item)}>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">{removeTrailingChineseFullStop(item.title)}</h2>
            {!item.read_at && <span className={`${styles.unreadDot} size-2 rounded-full`} />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{removeTrailingChineseFullStop(item.body)}</p>
          <p className="mt-2 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString(locale)}</p>
        </button>
      </div>)}
    </div>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && closeDetail()}>
      <DialogContent className={`${styles.dialog} gap-0 p-0 sm:max-w-[720px]`} closeLabel={t("关闭", "Close")}>
        <DialogHeader className="border-b border-white/10 px-6 py-5 pr-14">
          <DialogTitle className="text-lg">{t("通知详情", "Notification details")}</DialogTitle>
          <DialogDescription>{t("查看消息内容和相关操作", "Read the message and see available actions.")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-72 flex-col items-center justify-center px-8 py-10 text-center sm:px-14">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
            {selected?.type === "group_joined" ? <UserCheck size={28} className={styles.notificationIcon} /> : selectedIsInvitation ? <MailCheck size={28} className={styles.notificationIcon} /> : <Bell size={28} className={styles.notificationIcon} />}
          </div>
          {selected?.type === "group_joined" ? <>
            <Badge className="mt-6" variant="secondary">{t("已加入", "Joined")}</Badge>
            <h2 className="mt-4 text-2xl font-semibold">{removeTrailingChineseFullStop(selected.title)}</h2>
            <p className="mt-3 text-base text-muted-foreground">{removeTrailingChineseFullStop(selected.body)}</p>
          </> : !selectedIsInvitation && selected ? <>
            <Badge className="mt-6" variant="secondary">{selected.type === "group_role_changed" ? t("权限变更", "Permissions changed") : t("通知", "Notification")}</Badge>
            <h2 className="mt-4 text-2xl font-semibold">{removeTrailingChineseFullStop(selected.title)}</h2>
            <p className="mt-3 text-base text-muted-foreground">{removeTrailingChineseFullStop(selected.body)}</p>
          </> : detailError ? <p className="mt-6 text-sm text-destructive">{detailError}</p> : invite ? <>
            <Badge className="mt-6" variant="secondary">{getInvitationStatusLabel(invite.status, locale)}</Badge>
            <h2 className="mt-4 text-2xl font-semibold">{t(`加入 ${invite.group_name}`, `Join ${invite.group_name}`)}</h2>
            <p className="mt-3 text-base text-muted-foreground">{t(`${invite.inviter_name} 邀请你加入群组`, `${invite.inviter_name} invited you to join the group.`)}</p>
          </> : <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />{t("正在读取邀请...", "Loading invitation…")}
          </div>}
        </div>
        <DialogFooter className="mx-0 mb-0 px-6 py-4">
          {selected && !selectedIsInvitation ? <>
            <Button variant="outline" onClick={closeDetail}>{t("关闭", "Close")}</Button>
            {selected.group_id && <Button onClick={() => router.push(`/workspace/groups/${selected.group_id}`)}>{t("进入群组", "Open group")}</Button>}
          </> : invite?.status === "pending" ? <>
            <Button variant="outline" disabled={responding} onClick={() => respond("decline")}>{t("拒绝", "Decline")}</Button>
            <Button disabled={responding} onClick={() => respond("accept")}>{responding && <LoaderCircle className="animate-spin" />}{t("同意加入", "Accept")}</Button>
          </> : invite ? <Button onClick={() => {
            if (invite.status === "accepted") router.push(`/workspace/groups/${invite.group_id}`);
            else closeDetail();
          }}>{invite.status === "accepted" ? t("进入群组", "Open group") : t("关闭", "Close")}</Button> : <Button variant="outline" onClick={closeDetail}>{t("关闭", "Close")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={deleteConfirmOpen} onOpenChange={(open) => !deleting && setDeleteConfirmOpen(open)}>
      <DialogContent className={styles.dialog} closeLabel={t("关闭", "Close")}>
        <DialogHeader><DialogTitle>{t("删除所选消息？", "Delete selected notifications?")}</DialogTitle><DialogDescription>{t(`将从消息列表中删除 ${selectedIds.size} 条记录，此操作不会改变相关邀请或群组状态`, `Delete ${selectedIds.size} selected notifications. Related invitations and groups will stay as they are.`)}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => setDeleteConfirmOpen(false)}>{t("关闭", "Close")}</Button>
          <Button variant="destructive" disabled={deleting} onClick={removeSelected}>{deleting && <LoaderCircle className="animate-spin" />}{t("确认删除", "Confirm deletion")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </WorkspaceShell>;
}
