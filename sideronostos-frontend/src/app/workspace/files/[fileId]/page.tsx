"use client";

import "kanx-mindmap/styles.css";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getUserContext, getWorkspaceFile, type WorkspaceFile } from "@/lib/api/client";
import { MindMapEditor, parseDocument, serializeDocument, type Tree } from "@/components/mindmap/editor";
import { VocabularyEditor } from "@/components/vocabulary/editor";
import { parseVocabularyDocument, type VocabularyDocument } from "@/components/vocabulary/document";
import { useFileAutosave } from "@/components/workspace/use-file-autosave";

const initialTree: Tree = { rootId: "root", nodes: { root: { id: "root", parentId: null, children: [], kind: "text", text: "中心主题", collapsed: false } } };
type LoadedFile = { organizationId: string; file: WorkspaceFile; tree?: Tree; vocabulary?: VocabularyDocument };

export default function WorkspaceFilePage() {
  const { fileId } = useParams<{ fileId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const requestedOrganization = searchParams.get("organization");
  const requestedReturnTo = searchParams.get("returnTo");
  const backHref = requestedReturnTo?.startsWith("/workspace/groups/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : requestedOrganization ? `/workspace/groups/${encodeURIComponent(requestedOrganization)}?tab=files` : "/workspace/files";

  useEffect(() => {
    let cancelled = false;
    getUserContext().then(async (context) => {
      const organizationId = requestedOrganization ?? context.organizations.find((item) => item.kind === "personal")?.id;
      if (!organizationId) throw new Error("No organization");
      const file = await getWorkspaceFile(organizationId, fileId);
      const result: LoadedFile = { organizationId, file };
      if (file.type === "mindmap") result.tree = file.content ? parseDocument(file.content) : initialTree;
      else if (file.type === "vocabulary") result.vocabulary = parseVocabularyDocument(file.content);
      else throw new Error("Unsupported file type");
      if (!cancelled) setLoaded(result);
    }).catch(() => {
      if (!cancelled) { toast.error("无法打开此文件"); router.replace(backHref); }
    });
    return () => { cancelled = true; };
  }, [fileId, requestedOrganization, router, backHref]);

  if (!loaded || loaded.file.id !== fileId || (requestedOrganization && loaded.organizationId !== requestedOrganization)) return <main className="gallery-surface flex min-h-screen items-center justify-center"><LoaderCircle className="size-6 animate-spin" /></main>;
  return <FileEditor key={`${loaded.organizationId}/${fileId}`} loaded={loaded} backHref={backHref} />;
}

function FileEditor({ loaded: { organizationId, file, tree, vocabulary }, backHref }: { loaded: LoadedFile; backHref: string }) {
  const router = useRouter();
  const [value, setValue] = useState<Tree>(tree ?? initialTree);
  const [vocabularyValue, setVocabularyValue] = useState<VocabularyDocument>(vocabulary ?? { version: 1, entries: [] });
  const [leaving, setLeaving] = useState(false);
  const { status, change, flush } = useFileAutosave(organizationId, file.id, vocabulary ?? serializeDocument(tree ?? initialTree));

  async function back() {
    if (leaving) return;
    setLeaving(true);
    if (await flush()) router.replace(backHref);
    else { setLeaving(false); toast.error("保存失败，请重试后返回"); }
  }
  return <main className="gallery-surface flex h-dvh min-h-0 flex-col overflow-hidden">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-[#191020]/70 px-4 backdrop-blur-xl sm:px-8">
      <div className="flex min-w-0 items-center gap-3"><Button asChild variant="ghost" size="icon" aria-label="返回文件管理"><Link href={backHref} aria-disabled={leaving} onClick={(event) => { event.preventDefault(); void back(); }}><ArrowLeft /></Link></Button><div className="min-w-0"><h1 className="truncate text-sm font-medium">{file.name}</h1><p className="text-xs text-muted-foreground">{file.type === "vocabulary" ? "词汇库" : "Mindmap"}</p></div></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">{status === "saving" && <><LoaderCircle className="size-3 animate-spin" />保存中</>}{status === "saved" && <><Check className="size-3 text-emerald-300" />已保存</>}{status === "error" && <><X className="size-3 text-destructive" />保存失败<Button variant="ghost" size="sm" onClick={() => { void flush(); }}><RefreshCw />重试</Button></>}</div>
    </header>
    <div className="min-h-0 flex-1 p-3 sm:p-6"><div className="h-full min-h-0 overflow-hidden rounded-lg border border-white/15 bg-[#170f22]/80">
      {file.type === "vocabulary" ? <VocabularyEditor value={vocabularyValue} disabled={leaving} onChange={(content) => { setVocabularyValue(content); change(content); }} /> : <MindMapEditor value={value} onChange={(content) => { if (!leaving) { setValue(content); change(serializeDocument(content)); } }} />}
    </div></div>
  </main>;
}
