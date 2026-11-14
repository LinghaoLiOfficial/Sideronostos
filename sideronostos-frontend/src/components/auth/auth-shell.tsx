import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/lib/i18n/locale";

export function AuthShell({ children, agriculture = false, locale = "zh-CN" }: { children: React.ReactNode; agriculture?: boolean; locale?: Locale }) {
  const home = agriculture ? "/agriculture" : "/components";
  const english = locale === "en";
  const copy = agriculture
    ? (english
      ? { badge: "AGRISATA · FIELD SHIFT", title: "Make a grounded choice for your next season", description: "Understand conditions, compare rotations, and save plans from your fields and real constraints.", mobile: "FIELD SHIFT · Crop planning", benefits: ["Record fields and crop history", "Compare rotations within resource limits", "Keep plans and sources ready to review"] }
      : { badge: "AGRISATA · FIELD SHIFT", title: "为下一轮种植，做一个有依据的选择", description: "从你的地块和实际条件出发，了解环境、比较轮作，保存计划与支持它的资料。", mobile: "FIELD SHIFT · 轮作规划", benefits: ["记录地块与种植历史", "比较满足资源限制的轮作", "保留方案与资料，随时重开核对"] })
    : (english
      ? { badge: "", title: "Keep team knowledge clear, trusted, and ready", description: "Connect research, documents, and ideas so every search has a source and every collaboration keeps its context.", mobile: "", benefits: ["Centralize team knowledge", "Keep trusted citations and context", "Securely access your private workspace"] }
      : { badge: "", title: "让团队知识保持清晰、可信、随时可用", description: "连接研究、文档与灵感，让每一次检索都有来源，每一次协作都留下上下文", mobile: "", benefits: ["集中管理团队知识", "保留可信引用与上下文", "安全访问你的专属工作空间"] });
  return (
    <main className={`gallery-surface locale-${english ? "en" : "zh"} relative isolate min-h-screen overflow-hidden px-5 py-8 sm:px-8 lg:px-12`}>
      <div aria-hidden="true" className="gallery-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] min-w-0 w-full max-w-[1280px] items-stretch overflow-hidden rounded-lg border border-white/10 bg-[#160f1d]/45 shadow-2xl shadow-black/30 backdrop-blur-xl lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden border-r border-white/10 p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="relative">
            <Link href={home} aria-label="Agrisata" className="inline-flex"><BrandLogo priority className="w-44" /></Link>
            {copy.badge && <Badge variant="outline" className="mt-16">{copy.badge}</Badge>}
            <h1 className="mt-6 max-w-lg text-4xl font-semibold leading-tight">{copy.title}</h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-muted-foreground">{copy.description}</p>
          </div>
          <div className="relative grid gap-3 text-sm text-pink-100/90">
            {copy.benefits.map((item) => (
              <div key={item} className="flex items-center gap-3"><CheckCircle2 className="size-4 text-pink-300" />{item}</div>
            ))}
          </div>
        </section>
        <section className="flex min-w-0 w-full max-w-full items-center justify-center p-5 sm:p-10 lg:p-14">
          <div className="min-w-0 w-full max-w-md">
            <Link href={home} aria-label="Agrisata" className="mb-10 inline-flex lg:hidden"><BrandLogo priority className="w-44" /></Link>
            {copy.mobile && <p className="mb-5 text-xs tracking-widest text-primary lg:hidden">{copy.mobile}</p>}
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
