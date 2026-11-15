"use client"

import { useRef } from "react"
import { useLocale } from "@/lib/i18n/locale"
import { ArrowLeft, ExternalLink } from "lucide-react"

const documentUrl = "/models/crop-rotation/Complete-MILP-modeling.pdf"

export function RotationModelPrinciple() {
  const en = useLocale() === "en"
  const disclosure = useRef<HTMLDetailsElement>(null)

  return (
    <details ref={disclosure} className="border-b border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 marker:hidden hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary sm:px-6">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {en ? "How the rotation recommendation model works" : "当前轮作策略推荐模型的原理"}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {en ? "MILP formulation · PDF · 13 pages" : "混合整数线性规划（MILP）建模说明 · PDF · 13 页"}
          </span>
        </span>
        <span className="inline-flex min-h-8 shrink-0 items-center rounded-sm border border-border bg-background px-2.5 text-xs font-medium text-primary">
          {en ? "View model" : "查看原理"}
        </span>
      </summary>
      <div className="border-t border-border px-4 py-4 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
            {en
              ? "The document describes candidate planting plans, field and resource constraints, and a prioritized multi-objective optimization."
              : "文档介绍如何生成候选种植计划，综合田块适宜性、轮作间隔与水和农机等资源约束，并按优先级优化多项目标。"}
          </p>
          <a
            className="inline-flex min-h-9 items-center gap-2 rounded-sm border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
            href={documentUrl}
            target="_blank"
            rel="noreferrer"
          >
            {en ? "Open PDF" : "新标签打开 PDF"}
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        </div>
        <iframe
          className="h-[min(76vh,900px)] min-h-[420px] w-full border border-border bg-background"
          src={`${documentUrl}#view=FitH`}
          title={en ? "MILP model for crop rotation optimization" : "作物轮作优化 MILP 模型原理 PDF"}
        />
        <button
          type="button"
          className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-sm border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => { if (disclosure.current) disclosure.current.open = false }}
        >
          <ArrowLeft aria-hidden="true" size={14} />
          {en ? "Back to recommendations" : "返回推荐结果"}
        </button>
      </div>
    </details>
  )
}
