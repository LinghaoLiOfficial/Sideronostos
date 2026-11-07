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
  }).catch(() => toast.error("消息加载失败")), [onlyUnread]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected?.invitation_id || !shouldLoadInvitationDetails(selected.type)) return;
    let active = true;
    getDirectInvitation(selected.invitation_id)
      .then((value) => { if (active) setInvite(value); })
      .catch(() => { if (active) setDetailError("邀请不存在、已失效或不属于当前用户"); });
    return () => { active = false; };
  }, [selected]);

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
    void read(item).catch(() => toast.error("消息状态更新失败"));
  }

  async function readAll() {
    await markAllNotificationsRead();
    await load();
    notifyNotificationsChanged();
    toast.success("已全部标记为已读");
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
      toast.success("所选消息已删除");
    } catch {
      toast.error("消息删除失败");
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
      toast.success(action === "accept" ? "已加入群组" : "已拒绝邀请");
    } catch {
      toast.error("邀请处理失败");
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
        <Badge variant="outline">消息列表</Badge>
        <h1 className="mt-3 text-2xl font-semibold">通知中心</h1>
        <p className="mt-2 text-sm text-muted-foreground">{unread} 条未读消息</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {selecting ? <>
          <Button variant="outline" onClick={toggleAll}><CheckCheck />{selectedIds.size === items.length ? "取消全选" : "全选"}</Button>
          <Button variant="destructive" disabled={selectedIds.size === 0} onClick={() => setDeleteConfirmOpen(true)}><Trash2 />删除所选{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</Button>
          <Button size="icon" variant="ghost" aria-label="退出选择模式" onClick={toggleSelecting}><X /></Button>
        </> : <>
          <label className="flex items-center gap-2 text-sm"><Switch checked={onlyUnread} onCheckedChange={setOnlyUnread} />仅看未读</label>
          <Button variant="outline" onClick={readAll}><CheckCheck />全部已读</Button>
          <Button variant="outline" disabled={items.length === 0} onClick={toggleSelecting}><ListChecks />选择消息</Button>
        </>}
      </div>
    </div>

    <div className="glass-surface overflow-hidden rounded-lg border">
      {items.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center">
        <Bell className="size-8 text-pink-200/70" />
        <p className="mt-3 text-sm">暂无消息</p>
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
        {selecting && <Checkbox className="cursor-pointer" checked={selectedIds.has(item.id)} aria-label={`选择消息：${removeTrailingChineseFullStop(item.title)}`} onCheckedChange={() => toggleSelected(item.id)} />}
        <button className="min-w-0 flex-1 cursor-pointer text-left" aria-label={`${selecting ? selectedIds.has(item.id) ? "取消选择" : "选择" : "查看消息"}：${removeTrailingChineseFullStop(item.title)}`} onClick={() => selecting ? toggleSelected(item.id) : openDetail(item)}>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">{removeTrailingChineseFullStop(item.title)}</h2>
            {!item.read_at && <span className="size-2 rounded-full bg-pink-400" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{removeTrailingChineseFullStop(item.body)}</p>
          <p className="mt-2 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("zh-CN")}</p>
        </button>
      </div>)}
    </div>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && closeDetail()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b border-white/10 px-6 py-5 pr-14">
          <DialogTitle className="text-lg">通知详情</DialogTitle>
          <DialogDescription>查看消息内容和相关操作</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-72 flex-col items-center justify-center px-8 py-10 text-center sm:px-14">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
            {selected?.type === "group_joined" ? <UserCheck className="size-7 text-pink-200" /> : selectedIsInvitation ? <MailCheck className="size-7 text-pink-200" /> : <Bell className="size-7 text-pink-200" />}
          </div>
          {selected?.type === "group_joined" ? <>
            <Badge className="mt-6" variant="secondary">已加入</Badge>
            <h2 className="mt-4 text-2xl font-semibold">{removeTrailingChineseFullStop(selected.title)}</h2>
            <p className="mt-3 text-base text-muted-foreground">{removeTrailingChineseFullStop(selected.body)}</p>
          </> : !selectedIsInvitation && selected ? <>
            <Badge className="mt-6" variant="secondary">{selected.type === "group_role_changed" ? "权限变更" : "通知"}</Badge>
            <h2 className="mt-4 text-2xl font-semibold">{removeTrailingChineseFullStop(selected.title)}</h2>
            <p className="mt-3 text-base text-muted-foreground">{removeTrailingChineseFullStop(selected.body)}</p>
          </> : detailError ? <p className="mt-6 text-sm text-destructive">{detailError}</p> : invite ? <>
            <Badge className="mt-6" variant="secondary">{getInvitationStatusLabel(invite.status)}</Badge>
            <h2 className="mt-4 text-2xl font-semibold">加入 {invite.group_name}</h2>
            <p className="mt-3 text-base text-muted-foreground">{invite.inviter_name} 邀请你加入群组</p>
          </> : <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />正在读取邀请...
          </div>}
        </div>
        <DialogFooter className="mx-0 mb-0 px-6 py-4">
          {selected && !selectedIsInvitation ? <>
            <Button variant="outline" onClick={closeDetail}>关闭</Button>
            {selected.group_id && <Button onClick={() => router.push(`/workspace/groups/${selected.group_id}`)}>进入群组</Button>}
          </> : invite?.status === "pending" ? <>
            <Button variant="outline" disabled={responding} onClick={() => respond("decline")}>拒绝</Button>
            <Button disabled={responding} onClick={() => respond("accept")}>{responding && <LoaderCircle className="animate-spin" />}同意加入</Button>
          </> : invite ? <Button onClick={() => {
            if (invite.status === "accepted") router.push(`/workspace/groups/${invite.group_id}`);
            else closeDetail();
          }}>{invite.status === "accepted" ? "进入群组" : "关闭"}</Button> : <Button variant="outline" onClick={closeDetail}>关闭</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={deleteConfirmOpen} onOpenChange={(open) => !deleting && setDeleteConfirmOpen(open)}>
      <DialogContent>
        <DialogHeader><DialogTitle>删除所选消息？</DialogTitle><DialogDescription>将从消息列表中删除 {selectedIds.size} 条记录，此操作不会改变相关邀请或群组状态</DialogDescription></DialogHeader>
        <DialogFooter showCloseButton><Button variant="destructive" disabled={deleting} onClick={removeSelected}>{deleting && <LoaderCircle className="animate-spin" />}确认删除</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </WorkspaceShell>;
}
