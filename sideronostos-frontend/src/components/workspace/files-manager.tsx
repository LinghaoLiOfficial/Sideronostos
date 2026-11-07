"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FilePlus2, FileText, LoaderCircle, MoreHorizontal, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { KnowledgeEmpty, KnowledgeSearch } from "@/components/knowledge";
import { createWorkspaceFile, deleteWorkspaceFile, listWorkspaceFiles, renameWorkspaceFile, type WorkspaceFile, type WorkspaceFileType } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;
const fileTypes: WorkspaceFileType[] = ["mindmap", "markdown", "vocabulary"];

type FilesManagerProps = {
  organizationId: string;
  title: string;
  description: string;
  onOpenFile: (file: WorkspaceFile) => void;
  showHeader?: boolean;
  panelClassName?: string;
  showCreator?: boolean;
};

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function WorkspaceFilesManager({ organizationId, title, description, onOpenFile, showHeader = true, panelClassName, showCreator = false }: FilesManagerProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [fileType, setFileType] = useState<WorkspaceFileType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkspaceFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceFile | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<WorkspaceFileType>("mindmap");

  const loadFiles = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const requestedTypes = fileType === "all" ? fileTypes : [fileType];
      const pageSize = fileType === "all" ? 100 : PAGE_SIZE;
      const pagesToLoad = fileType === "all" ? Math.ceil((page * PAGE_SIZE) / pageSize) : 1;
      const results = await Promise.all(requestedTypes.flatMap((type) => Array.from({ length: pagesToLoad }, (_, index) =>
        listWorkspaceFiles(organizationId, { page: fileType === "all" ? index + 1 : page, page_size: pageSize, query, type }),
      )));
      if (currentRequest !== requestId.current) return;
      const matchingResults = results.map((result, index) => ({
        result,
        type: requestedTypes[Math.floor(index / pagesToLoad)],
      }));
      const matchingFiles = matchingResults.flatMap(({ result, type }) => result.items.filter((file) => file.type === type));
      matchingFiles.sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.name.localeCompare(right.name, "zh-CN"));
      if (fileType === "all") {
        const total = requestedTypes.reduce((sum, type, typeIndex) => {
          const firstPageIndex = typeIndex * pagesToLoad;
          const firstPage = results[firstPageIndex];
          const fallback = matchingResults[firstPageIndex].result.items.filter((file) => file.type === type).length;
          return sum + (firstPage.total ?? fallback);
        }, 0);
        setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));
        setFiles(matchingFiles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
      } else {
        const result = results[0];
        const visibleFiles = result.items.filter((file) => file.type === fileType);
        setTotalPages(result.total_pages ?? Math.max(1, Math.ceil((result.total ?? visibleFiles.length) / PAGE_SIZE)));
        setFiles(visibleFiles);
      }
      setError(null);
    } catch {
      if (currentRequest === requestId.current) setError("文件加载失败，请稍后重试");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [organizationId, page, query, fileType]);

  // The loader synchronizes the remote list whenever its query inputs change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadFiles(); }, [loadFiles]);

  async function createFile() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createWorkspaceFile(organizationId, { name: name.trim(), type });
      setCreateOpen(false);
      setName("");
      await loadFiles();
      toast.success("文件已创建");
    } catch {
      toast.error("创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function renameFile() {
    if (!renameTarget || !name.trim()) return;
    setBusy(true);
    try {
      await renameWorkspaceFile(organizationId, renameTarget.id, name.trim());
      setRenameTarget(null);
      setName("");
      await loadFiles();
      toast.success("名称已更新");
    } catch {
      toast.error("重命名失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFile() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteWorkspaceFile(organizationId, deleteTarget.id);
      setDeleteTarget(null);
      await loadFiles();
      toast.success("文件已删除");
    } catch {
      toast.error("删除失败");
    } finally {
      setBusy(false);
    }
  }

  return <TooltipProvider><section className="min-w-0 flex flex-1 flex-col">
    {showHeader && <div className="mb-6 flex shrink-0 flex-wrap items-end justify-between gap-4">
      <div><Badge variant="outline">文件管理</Badge><h1 className="mt-3 text-2xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>
      <Button className="md:hidden" onClick={() => setCreateOpen(true)}><FilePlus2 />新建文件</Button>
    </div>}
    <div className={cn("glass-surface flex min-h-0 flex-1 flex-col rounded-lg border p-4 sm:p-6", panelClassName)}>
      <div className="flex shrink-0 flex-wrap gap-3">
        <KnowledgeSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="搜索文件名称..." className="min-w-[220px] flex-1" />
        <Select value={fileType} onValueChange={(value) => { setFileType(value as WorkspaceFileType | "all"); setPage(1); }}><SelectTrigger className="w-[150px]"><SelectValue placeholder="全部类型" /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem><SelectItem value="mindmap">Mindmap</SelectItem><SelectItem value="markdown">Markdown</SelectItem><SelectItem value="vocabulary">词汇库</SelectItem></SelectContent></Select>
        <Button onClick={() => setCreateOpen(true)}><Plus />新建文件</Button>
      </div>
      {error && <p className="mt-5 shrink-0 text-sm text-destructive">{error}</p>}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
          {files.length === 0 && !loading ? <KnowledgeEmpty title="还没有文件" description="创建思维导图或词汇库，开始整理你的知识" action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus />新建文件</Button>} /> : <div className="mt-6 grid items-start gap-4 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{files.map((file) => {
            const openFile = () => file.type === "mindmap" || file.type === "vocabulary" ? onOpenFile(file) : toast.info("Markdown 编辑功能暂未开放");
            return <Card key={file.id} interactive size="sm" className="relative gap-0 p-4">
              <button type="button" aria-label={`打开 ${file.name}`} className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={openFile} />
              <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3"><span className="brand-gradient-soft flex size-10 items-center justify-center rounded-md border border-primary/20 text-pink-100">{file.type === "mindmap" ? <Network className="size-5" /> : file.type === "vocabulary" ? <BookOpen className="size-5" /> : <FileText className="size-5" />}</span><div className="pointer-events-auto"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`${file.name} 操作`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { setRenameTarget(file); setName(file.name); }}><Pencil />重命名</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(file)}><Trash2 />删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
              <div className="pointer-events-none relative z-10 mt-5 min-w-0"><Tooltip><TooltipTrigger asChild><span className="pointer-events-auto block min-w-0 max-w-full"><h2 className="truncate text-sm font-medium">{file.name}</h2></span></TooltipTrigger><TooltipContent>{file.name}</TooltipContent></Tooltip><p className="mt-2 text-xs text-muted-foreground">{file.type === "mindmap" ? "思维导图" : file.type === "vocabulary" ? "词汇库" : "Markdown 文档"}</p>{showCreator && <p className="mt-4 truncate text-xs text-[#C4A1FF]" title={file.creator_display_name ?? "未知用户"}>创建者：{file.creator_display_name ?? "未知用户"}</p>}<p className={cn("text-xs text-muted-foreground", showCreator ? "mt-1" : "mt-5")}>更新于 {formatUpdatedAt(file.updated_at)}</p></div>
            </Card>;
          })}</div>}
        </div>
        {loading && <div className="absolute inset-0 flex items-center justify-center"><LoaderCircle className="size-6 animate-spin text-pink-200" /></div>}
      </div>
      {totalPages > 1 && <Pagination className="mt-4 shrink-0"><PaginationContent><PaginationItem><PaginationPrevious href="#" text="上一页" className={page === 1 ? "pointer-events-none opacity-40" : ""} onClick={(event) => { event.preventDefault(); setPage(Math.max(1, page - 1)); }} /></PaginationItem>{Array.from({ length: totalPages }, (_, i) => i + 1).map((number) => <PaginationItem key={number}><PaginationLink href="#" isActive={page === number} onClick={(event) => { event.preventDefault(); setPage(number); }}>{number}</PaginationLink></PaginationItem>)}<PaginationItem><PaginationNext href="#" text="下一页" className={page === totalPages ? "pointer-events-none opacity-40" : ""} onClick={(event) => { event.preventDefault(); setPage(Math.min(totalPages, page + 1)); }} /></PaginationItem></PaginationContent></Pagination>}
    </div>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>新建文件</DialogTitle><DialogDescription>选择文件类型并设置名称</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label htmlFor="create-name">文件名称</Label><Input id="create-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品路线图" /></div><div className="grid gap-2"><Label>文件类型</Label><Select value={type} onValueChange={(value) => setType(value as WorkspaceFileType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mindmap">Mindmap</SelectItem><SelectItem value="markdown">Markdown</SelectItem><SelectItem value="vocabulary">词汇库</SelectItem></SelectContent></Select></div></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={busy || !name.trim()} onClick={createFile}>{busy && <LoaderCircle className="animate-spin" />}创建</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}><DialogContent><DialogHeader><DialogTitle>重命名文件</DialogTitle></DialogHeader><Input value={name} onChange={(event) => setName(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setRenameTarget(null)}>取消</Button><Button disabled={busy || !name.trim()} onClick={renameFile}>保存</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}><DialogContent><DialogHeader><DialogTitle>确认删除</DialogTitle><DialogDescription>删除“{deleteTarget?.name}”后将从文件列表中移除</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="destructive" disabled={busy} onClick={deleteFile}>{busy && <LoaderCircle className="animate-spin" />}确认删除</Button></DialogFooter></DialogContent></Dialog>
  </section></TooltipProvider>;
}
