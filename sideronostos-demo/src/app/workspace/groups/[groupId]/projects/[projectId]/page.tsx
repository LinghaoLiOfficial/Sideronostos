"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { GanttChart, type GanttSnapshot } from "@/components/gantt";
import { Button } from "@/components/ui/button";
import { getGroup, getWorkspaceFile, saveWorkspaceFileContent, type WorkspaceFile } from "@/lib/api/client";

const emptySnapshot: GanttSnapshot = { taskData: [], edgeData: [] };
type SaveStatus = "loading" | "saved" | "saving" | "error";

function isGanttSnapshot(value: unknown): value is GanttSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<GanttSnapshot>;
  return Array.isArray(snapshot.taskData) && Array.isArray(snapshot.edgeData);
}

export default function GroupProjectPage() {
  const { groupId, projectId } = useParams<{ groupId: string; projectId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<WorkspaceFile | null>(null);
  const [groupName, setGroupName] = useState("");
  const [snapshot, setSnapshot] = useState<GanttSnapshot>(emptySnapshot);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<GanttSnapshot>(emptySnapshot);
  const sequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    void Promise.all([getGroup(groupId), getWorkspaceFile(groupId, projectId)]).then(([group, result]) => {
      if (!active) return;
      if (result.type !== "gantt") throw new Error("Not a gantt project");
      const value = isGanttSnapshot(result.content) ? result.content : emptySnapshot;
      setProject(result);
      setGroupName(group.name);
      setSnapshot(value);
      latest.current = value;
      setStatus("saved");
    }).catch(() => {
      if (!active) return;
      toast.error("无法打开此项目");
      router.replace(`/workspace/groups/${groupId}`);
    });
    return () => { active = false; };
  }, [groupId, projectId, router]);

  const save = useCallback((value: GanttSnapshot) => {
    if (pending.current) clearTimeout(pending.current);
    const saveId = ++sequence.current;
    setStatus("saving");
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      await saveWorkspaceFileContent(groupId, projectId, value);
      if (saveId === sequence.current) setStatus("saved");
    }).catch(() => {
      if (saveId === sequence.current) setStatus("error");
    });
    return saveQueue.current;
  }, [groupId, projectId]);

  function change(value: GanttSnapshot) {
    latest.current = value;
    setSnapshot(value);
    setStatus("saving");
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { void save(value); }, 700);
  }

  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);

  if (status === "loading" || !project) return <main className="gallery-surface flex min-h-screen items-center justify-center"><LoaderCircle className="size-6 animate-spin" /></main>;

  return <main className="gallery-surface flex min-h-screen flex-col">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-[#191020]/70 px-4 backdrop-blur-xl sm:px-8">
      <div className="flex min-w-0 items-center gap-3"><Button asChild variant="ghost" size="icon" aria-label="返回任务规划"><Link href={`/workspace/groups/${groupId}?tab=projects`}><ArrowLeft /></Link></Button><div className="min-w-0"><h1 className="truncate text-sm font-medium">{groupName}</h1><p className="text-xs text-muted-foreground">任务规划 · 甘特图</p></div></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        {status === "saving" && <><LoaderCircle className="size-3 animate-spin" />保存中</>}
        {status === "saved" && <><Check className="size-3 text-emerald-300" />已保存</>}
        {status === "error" && <><X className="size-3 text-destructive" />保存失败<Button variant="ghost" size="sm" onClick={() => void save(latest.current)}><RefreshCw />重试</Button></>}
      </div>
    </header>
    <div className="min-h-0 flex-1 p-3 sm:p-6"><div className="h-[calc(100vh-7.5rem)] min-h-[520px] overflow-hidden"><GanttChart snapshot={snapshot} onChange={change} selectedYear={new Date().getFullYear()} height="100%" showDependencyArrows /></div></div>
  </main>;
}
