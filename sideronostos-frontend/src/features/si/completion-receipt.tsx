"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import NextImage from "next/image";

type Props = {
  href: string;
  message: string;
  language: "en" | "zh";
  linkLabel: string;
  fileName: string;
  children?: ReactNode;
  captureKey?: string;
};

function inlineStyles(source: Element, target: Element) {
  const computed = getComputedStyle(source);
  const style = (target as HTMLElement).style;
  for (const property of Array.from(computed)) {
    style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }
  for (let index = 0; index < source.children.length; index += 1) {
    inlineStyles(source.children[index], target.children[index]);
  }
}

async function screenshot(node: HTMLElement): Promise<string> {
  const box = node.getBoundingClientRect();
  const width = Math.ceil(box.width);
  const height = Math.ceil(box.height);
  if (!width || !height) throw new Error("Completion card is not visible");
  const clone = node.cloneNode(true) as HTMLElement;
  inlineStyles(node, clone);
  const html = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.scale(2, 2);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

export function CompletionReceipt({ href, message, language, linkLabel, fileName, children, captureKey }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const frame = requestAnimationFrame(() => {
      if (!card.current) return;
      screenshot(card.current).then((value) => {
        if (live) setImage(value);
      }).catch(() => { if (live) setFailed(true); });
    });
    return () => { live = false; cancelAnimationFrame(frame); };
  }, [href, message, captureKey]);
  const zh = language === "zh";
  return <div>
    <div ref={card} className="rounded-lg border border-border bg-card p-4 text-foreground">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{zh ? "任务已完成" : "Task completed"}</p>
      <Link href={href} className="mt-2 inline-flex rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground underline-offset-2 hover:underline">{linkLabel}</Link>
      <p className="mt-2 text-sm leading-6">{message}</p>
      {children}
    </div>
    {image && <figure className="mt-3"><NextImage unoptimized src={image} width={288} height={192} alt={zh ? "已完成任务的界面截图" : "Completed task screenshot"} className="max-h-48 w-auto max-w-[18rem] rounded-md border border-border object-contain" /><figcaption className="mt-1 text-xs text-muted-foreground">{zh ? "这张截图记录了本次操作的完成状态与结果入口。" : "This screenshot records the completed task and its result link."}</figcaption><a href={image} download={fileName} className="mt-1 inline-block text-primary underline">{zh ? "下载截图" : "Download screenshot"}</a></figure>}
    {failed && <p role="status" className="mt-2 text-xs text-muted-foreground">{zh ? "截图生成失败，请使用上方链接查看结果。" : "The screenshot could not be captured. Open the result above."}</p>}
  </div>;
}
