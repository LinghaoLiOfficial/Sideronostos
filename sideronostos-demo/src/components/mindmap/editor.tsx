"use client";

import {
  MindMapEditor as KanxMindMapEditor,
  type MindMapEditorProps,
} from "kanx-mindmap";

export { parseDocument, serializeDocument } from "kanx-mindmap";
export type { MindMapEditorProps, Tree } from "kanx-mindmap";

/** Shared workspace entry point for the kanx-mindmap editor. */
export function MindMapEditor({
  className,
  locale = "zh-CN",
  title = "Mindmap 编辑器",
  ...props
}: MindMapEditorProps) {
  return (
    <KanxMindMapEditor
      {...props}
      className={["workspace-mindmap-editor", className].filter(Boolean).join(" ")}
      locale={locale}
      title={title}
    />
  );
}
