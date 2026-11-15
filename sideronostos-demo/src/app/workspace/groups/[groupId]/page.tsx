"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Link2, LoaderCircle, Pencil, Plus, Search, Trash2, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { ContributionCalendar, type ContributionDayDetails } from "@/components/contribution-calendar";
import { WorkspaceShell } from "@/components/workspace/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceFilesManager } from "@/components/workspace/files-manager";
import { changeGroupRole, createGroupInviteLink, disbandGroup, ensureGroupTaskPlanning, getCurrentUser, getGroup, getGroupMemberSchedule, Group, GroupMember, inviteGroupUser, leaveGroup, listGroupMembers, removeGroupMember, renameGroup, saveGroupPersonalScheduleDay, searchUsers, UserSearchResult } from "@/lib/api/client";

type Confirm = { kind: "disband" | "leave" | "member"; id?: string; label: string };
const roleLabels = { owner: "所有者", admin: "管理员", member: "普通成员" } as const;
const roleOrder = { owner: 0, admin: 1, member: 2 } as const;
const memberNameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const currentYear = new Date().getFullYear();
const availableYears = [currentYear, currentYear - 1, currentYear - 2];

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>(); const router = useRouter(); const searchParams = useSearchParams();
  const [group, setGroup] = useState<Group | null>(null); const [members, setMembers] = useState<GroupMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null); const [scheduleMemberId, setScheduleMemberId] = useState<string | null>(null);
  const [schedulePickerMode, setSchedulePickerMode] = useState<"self" | "other">("self"); const [scheduleMemberQuery, setScheduleMemberQuery] = useState("");
  const [scheduleYear, setScheduleYear] = useState(currentYear); const [scheduleDetails, setScheduleDetails] = useState<Record<string, ContributionDayDetails>>({});
  const [scheduleLoading, setScheduleLoading] = useState(false); const [savingScheduleDate, setSavingScheduleDate] = useState<string | null>(null); const [scheduleCalendarKey, setScheduleCalendarKey] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null); const [renameOpen, setRenameOpen] = useState(false); const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState(""); const [query, setQuery] = useState(""); const [results, setResults] = useState<UserSearchResult[]>([]);
  const scheduleRequestId = useRef(0); const scheduleSaveId = useRef(0);
  const load = useCallback(async () => { try { const [g, m, me] = await Promise.all([getGroup(groupId), listGroupMembers(groupId), getCurrentUser()]); setGroup(g); setMembers(m.items); setCurrentUserId(me.id); setScheduleMemberId((selected) => selected && m.items.some((member) => member.id === selected) ? selected : me.id); } catch { toast.error("群组加载失败"); } }, [groupId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (query.trim().length < 1) return; let active = true; const timer = window.setTimeout(() => searchUsers(query).then((v) => { if (active) setResults(v.items); }).catch(() => { if (active) setResults([]); }), 250); return () => { active = false; window.clearTimeout(timer); }; }, [query]);
  useEffect(() => { if (!scheduleMemberId) return; const requestId = ++scheduleRequestId.current; const timer = window.setTimeout(() => { setScheduleLoading(true); void getGroupMemberSchedule(groupId, scheduleMemberId, scheduleYear).then((result) => { if (requestId === scheduleRequestId.current) setScheduleDetails(result.days); }).catch(() => { if (requestId === scheduleRequestId.current) { setScheduleDetails({}); toast.error("成员日程加载失败，请稍后重试"); } }).finally(() => { if (requestId === scheduleRequestId.current) setScheduleLoading(false); }); }, 0); return () => window.clearTimeout(timer); }, [groupId, scheduleMemberId, scheduleYear]);
  const scheduleOtherMembers = useMemo(() => {
    const query = scheduleMemberQuery.trim().toLocaleLowerCase();
    return members.filter((member) => member.id !== currentUserId && (!query || `${member.display_name} ${member.email}`.toLocaleLowerCase().includes(query)));
  }, [currentUserId, members, scheduleMemberQuery]);
  const sortedMembers = useMemo(() => [...members].sort((left, right) => {
    if (left.id === currentUserId) return -1;
    if (right.id === currentUserId) return 1;
    const roleDifference = roleOrder[left.role] - roleOrder[right.role];
    if (roleDifference !== 0) return roleDifference;
    return memberNameCollator.compare(left.display_name, right.display_name)
      || memberNameCollator.compare(left.email, right.email)
      || left.id.localeCompare(right.id);
  }), [currentUserId, members]);
  if (!group) return <WorkspaceShell><div className="py-20 text-center text-sm text-muted-foreground">正在加载群组...</div></WorkspaceShell>;
  const canInvite = group.role === "owner" || group.role === "admin";
  const scheduleMember = members.find((member) => member.id === scheduleMemberId) ?? null;
  const canEditSchedule = scheduleMemberId !== null && scheduleMemberId === currentUserId;
  async function executeConfirm() { if (!confirm) return; try { if (confirm.kind === "disband") { await disbandGroup(groupId); router.push("/workspace/groups"); } else if (confirm.kind === "leave") { await leaveGroup(groupId); router.push("/workspace/groups"); } else if (confirm.kind === "member" && confirm.id) { await removeGroupMember(groupId, confirm.id); await load(); } setConfirm(null); toast.success("操作已完成"); } catch { toast.error("操作失败"); } }
  async function updateName() { await renameGroup(groupId, name.trim()); setRenameOpen(false); await load(); }
  async function invite(user: UserSearchResult) { try { await inviteGroupUser(groupId, user.id); toast.success("邀请已发送"); setQuery(""); setResults([]); } catch { toast.error("用户已在群组中或邀请仍待处理"); } }
  async function share() { try { const value = await createGroupInviteLink(groupId); await navigator.clipboard.writeText(`${window.location.origin}${value.url}`); toast.success("一次性邀请链接已复制"); } catch { toast.error("链接生成失败"); } }
  async function openTaskPlanning() { try { const project = await ensureGroupTaskPlanning(groupId); router.push(`/workspace/groups/${groupId}/projects/${project.id}`); } catch { toast.error("任务规划加载失败，请稍后重试"); } }
  async function saveScheduleDay(date: string, details: ContributionDayDetails) { if (!canEditSchedule) return; const previous = scheduleDetails; const saveId = ++scheduleSaveId.current; setScheduleDetails((current) => ({ ...current, [date]: details })); setSavingScheduleDate(date); try { const saved = await saveGroupPersonalScheduleDay(groupId, date, details); if (saveId === scheduleSaveId.current) setScheduleDetails((current) => ({ ...current, [date]: { title: saved.title, items: saved.items } })); toast.success("日程已保存"); } catch { if (saveId === scheduleSaveId.current) { setScheduleDetails(previous); setScheduleCalendarKey((key) => key + 1); toast.error("日程保存失败，已恢复未保存修改"); } } finally { if (saveId === scheduleSaveId.current) setSavingScheduleDate(null); } }
  function changeScheduleMember(memberId: string) { scheduleSaveId.current += 1; setSavingScheduleDate(null); setScheduleCalendarKey((key) => key + 1); setScheduleMemberId(memberId); setSchedulePickerMode(memberId === currentUserId ? "self" : "other"); }
  function selectOwnSchedule() { if (currentUserId) changeScheduleMember(currentUserId); setScheduleMemberQuery(""); }
  function selectOtherSchedules() { scheduleRequestId.current += 1; scheduleSaveId.current += 1; setSchedulePickerMode("other"); setScheduleMemberId(null); setScheduleMemberQuery(""); setScheduleDetails({}); setScheduleLoading(false); setSavingScheduleDate(null); setScheduleCalendarKey((key) => key + 1); }
  function changeScheduleYear(year: number) { scheduleSaveId.current += 1; setSavingScheduleDate(null); setScheduleCalendarKey((key) => key + 1); setScheduleYear(year); }
  return <WorkspaceShell><div className="flex min-h-0 flex-1 flex-col"><div className="mb-6 flex shrink-0 flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2"><Badge variant="outline">{roleLabels[group.role]}</Badge><Badge variant="secondary">{group.member_count} 位成员</Badge></div><h1 className="mt-3 text-2xl font-semibold">{group.name}</h1><p className="mt-2 text-sm text-muted-foreground">群组成员、日程与共享文件空间</p></div><div className="flex flex-wrap gap-2">{canInvite && <><Button variant="outline" onClick={() => setInviteOpen(true)}><Users />邀请成员</Button><Button variant="outline" onClick={share}><Link2 />邀请链接</Button></>}{group.role === "owner" ? <><Button variant="outline" onClick={() => { setName(group.name); setRenameOpen(true); }}><Pencil />改名</Button><Button variant="destructive" onClick={() => setConfirm({ kind: "disband", label: group.name })}><Trash2 />解散</Button></> : <Button variant="destructive" onClick={() => setConfirm({ kind: "leave", label: group.name })}><UserMinus />退出群组</Button>}</div></div>
    <Tabs className="min-h-0 flex-1" defaultValue={searchParams.get("tab") === "files" ? "files" : searchParams.get("tab") === "projects" ? "projects" : "members"}><TabsList><TabsTrigger value="members">成员管理</TabsTrigger><TabsTrigger value="schedule">成员日程</TabsTrigger><TabsTrigger value="files">群组文件</TabsTrigger><TabsTrigger value="projects">任务规划</TabsTrigger></TabsList>
      <TabsContent value="members" className="pt-4"><div className="glass-surface overflow-hidden rounded-lg border">{sortedMembers.map((member) => <div key={member.id} className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 last:border-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{member.display_name}{member.id === currentUserId && <span>（我）</span>}</p><p className="text-xs text-muted-foreground">{member.email}</p></div>{group.role === "owner" && member.role !== "owner" ? <Select value={member.role} onValueChange={(value) => changeGroupRole(groupId, member.id, value as "admin" | "member").then(load)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">管理员</SelectItem><SelectItem value="member">普通成员</SelectItem></SelectContent></Select> : <Badge variant="secondary">{roleLabels[member.role]}</Badge>}{member.role !== "owner" && ((group.role === "owner") || (group.role === "admin" && member.role === "member")) && <Button size="icon-sm" variant="ghost" aria-label={`移除 ${member.display_name}`} onClick={() => setConfirm({ kind: "member", id: member.id, label: member.display_name })}><UserMinus /></Button>}</div>)}</div></TabsContent>
      <TabsContent value="schedule" className="pt-4">
        <Tabs variant="card" value={schedulePickerMode} onValueChange={(value) => value === "self" ? selectOwnSchedule() : selectOtherSchedules()}>
          <TabsList aria-label="日程查看范围"><TabsTrigger value="self">我</TabsTrigger><TabsTrigger value="other">其他成员</TabsTrigger></TabsList>
          <TabsContent value="self">
            <div className="border-b border-white/10 px-5 py-4 sm:px-6"><h2 className="text-base font-semibold">{scheduleMember ? `${scheduleMember.display_name}的日程` : "成员日程"}</h2><p className="mt-1 text-sm text-muted-foreground">仅自己可编辑本群组内的个人日程</p></div>
            {scheduleMemberId !== null && <div className={scheduleLoading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}><div className="flex h-8 items-center justify-end gap-2 px-5 text-xs text-muted-foreground sm:px-6" aria-live="polite">{scheduleLoading ? <><LoaderCircle className="size-4 animate-spin" />正在加载</> : savingScheduleDate ? <><LoaderCircle className="size-4 animate-spin" />正在保存 {savingScheduleDate}</> : null}</div><ContributionCalendar embedded key={`${scheduleMemberId}-${scheduleYear}-${scheduleCalendarKey}`} year={scheduleYear} years={availableYears} dayDetails={scheduleDetails} readOnly={false} ariaLabel={`${scheduleMember?.display_name ?? "成员"}的个人日程表`} onYearChange={changeScheduleYear} onDayDetailsChange={(date, details) => { void saveScheduleDay(date, details); }} /></div>}
          </TabsContent>
          <TabsContent value="other">
            <div className="border-b border-white/10 px-5 py-4 sm:px-6"><h2 className="text-base font-semibold">{scheduleMember ? `${scheduleMember.display_name}的日程` : "成员日程"}</h2><p className="mt-1 text-sm text-muted-foreground">{scheduleMember ? "只读查看此成员在本群组内的个人日程" : "搜索并选择成员以查看其在本群组内的个人日程"}</p></div>
            <div className="p-5 sm:p-6"><Label htmlFor="schedule-member-search">搜索成员</Label><div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="schedule-member-search" aria-label="搜索其他成员" className="pl-9" value={scheduleMemberQuery} onChange={(event) => setScheduleMemberQuery(event.target.value)} placeholder="搜索姓名或邮箱" /></div><div className="mt-2 max-h-48 overflow-auto rounded-md border border-white/10 bg-background/80" role="listbox" aria-label="其他成员">{scheduleOtherMembers.length > 0 ? scheduleOtherMembers.map((member) => <button type="button" role="option" aria-selected={member.id === scheduleMemberId} key={member.id} className="flex w-full items-center justify-between border-b border-white/10 px-3 py-2 text-left last:border-0 hover:bg-primary/10" onClick={() => { changeScheduleMember(member.id); setScheduleMemberQuery(""); }}><span className="min-w-0"><span className="block truncate text-sm">{member.display_name}</span><span className="block truncate text-xs text-muted-foreground">{member.email}</span></span>{member.id === scheduleMemberId && <Check className="size-4 shrink-0 text-pink-200" />}</button>) : <p className="px-3 py-3 text-center text-xs text-muted-foreground">未找到相关成员</p>}</div></div>
            {scheduleMemberId !== null && scheduleMemberId !== currentUserId && <div className={scheduleLoading ? "pointer-events-none opacity-60 transition-opacity border-t border-white/10" : "border-t border-white/10"}><div className="flex h-8 items-center justify-end gap-2 px-5 text-xs text-muted-foreground sm:px-6" aria-live="polite">{scheduleLoading ? <><LoaderCircle className="size-4 animate-spin" />正在加载</> : null}</div><ContributionCalendar embedded key={`${scheduleMemberId}-${scheduleYear}-${scheduleCalendarKey}`} year={scheduleYear} years={availableYears} dayDetails={scheduleDetails} readOnly ariaLabel={`${scheduleMember?.display_name ?? "成员"}的个人日程表`} onYearChange={changeScheduleYear} /></div>}
          </TabsContent>
        </Tabs>
      </TabsContent>
      <TabsContent value="files" className="flex min-h-0 flex-1 flex-col pt-4"><WorkspaceFilesManager organizationId={groupId} title="群组文件" description="管理此群组共享的思维导图、知识文档和词汇库" showHeader={false} showCreator panelClassName="h-full pb-4 sm:pb-4" onOpenFile={(file) => router.push(`/workspace/files/${file.id}?organization=${encodeURIComponent(groupId)}&returnTo=${encodeURIComponent(`/workspace/groups/${groupId}?tab=files`)}`)} /></TabsContent>
      <TabsContent value="projects" className="pt-4"><div className="glass-surface flex min-h-48 flex-col items-center justify-center rounded-lg border"><p className="text-sm">每个群组使用一个独立的甘特图任务规划</p><Button className="mt-4" onClick={() => void openTaskPlanning()}>进入任务规划</Button></div></TabsContent>
    </Tabs>
    <Dialog open={renameOpen} onOpenChange={setRenameOpen}><DialogContent><DialogHeader><DialogTitle>修改群组名称</DialogTitle></DialogHeader><Input value={name} onChange={(e) => setName(e.target.value)} /><DialogFooter showCloseButton><Button onClick={updateName}>保存</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogContent><DialogHeader><DialogTitle>邀请成员</DialogTitle><DialogDescription>按姓名或邮箱查找已验证用户</DialogDescription></DialogHeader><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入至少 1 个字符" /></div><div className="max-h-64 space-y-2 overflow-auto">{query.trim().length > 0 && results.map((user) => <button key={user.id} className="glass-surface flex w-full items-center justify-between rounded-md border p-3 text-left" onClick={() => invite(user)}><span><span className="block text-sm">{user.display_name}</span><span className="text-xs text-muted-foreground">{user.email}</span></span><Plus className="size-4" /></button>)}</div></DialogContent></Dialog>
    <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}><DialogContent><DialogHeader><DialogTitle>确认此操作？</DialogTitle><DialogDescription>你即将处理“{confirm?.label}”。此操作可能无法恢复</DialogDescription></DialogHeader><DialogFooter showCloseButton><Button variant="destructive" onClick={executeConfirm}>确认</Button></DialogFooter></DialogContent></Dialog>
  </div></WorkspaceShell>;
}
