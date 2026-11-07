"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace/shell";
import { WorkspaceFilesManager } from "@/components/workspace/files-manager";
import { ApiError, getCurrentUser, getUserContext, type WorkspaceFile } from "@/lib/api/client";

function personalOrganization(organizations: { id: string; kind: "personal" | "group" }[]) {
  return organizations.find((item) => item.kind === "personal")?.id ?? null;
}

export default function WorkspacePage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([getCurrentUser(), getUserContext()])
      .then(([, context]) => setOrganizationId(personalOrganization(context.organizations)))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/login?next=/workspace/files&authRequired=1");
        }
      })
      .finally(() => setReady(true));
  }, [router]);

  if (!ready) return <WorkspaceShell><div className="flex min-h-64 items-center justify-center"><LoaderCircle className="size-6 animate-spin" /></div></WorkspaceShell>;
  if (!organizationId) return <WorkspaceShell><p className="py-20 text-center text-sm text-destructive">个人文件空间加载失败</p></WorkspaceShell>;

  return <WorkspaceShell><WorkspaceFilesManager
    organizationId={organizationId}
    title="我的文件"
    description="集中管理你的思维导图、知识文档和词汇库"
    onOpenFile={(file: WorkspaceFile) => router.push(`/workspace/files/${file.id}`)}
  /></WorkspaceShell>;
}
