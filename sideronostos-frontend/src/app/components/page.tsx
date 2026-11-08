"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Bell, Check, ChevronDown, CircleHelp, Command as CommandIcon, Ellipsis, FilePlus2, Filter, Menu, Plus, Search, Settings2, Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContributionCalendar, type ContributionDayDetails } from "@/components/contribution-calendar";
import { GanttChart, defaultGanttColorScheme, type GanttSnapshot } from "@/components/gantt";
import { CitationItem, CollectionNav, DocumentRow, KnowledgeEmpty, KnowledgeSearch, MetadataPanel, TagPicker, type KnowledgeDocument } from "@/components/knowledge";

import { Surface, type SurfaceTone, type SurfaceMaterial } from "@/components/ui/surface";
import { ActionTile, FloatingToolbar, MetricPanel } from "@/components/ui/patterns";
import "./components.css";
const collections = [
  { id: "all", name: "全部知识", count: 128 },
  { id: "research", name: "研究笔记", count: 42 },
  { id: "product", name: "产品资料", count: 36 },
  { id: "archive", name: "灵感存档", count: 50 },
];
const documents: KnowledgeDocument[] = [
  { id: "1", title: "语义检索的设计原则", summary: "从问题理解到可信引用的检索体验设计", collection: "研究笔记", updatedAt: "2 小时前", tags: ["检索", "AI"], initials: "YL" },
  { id: "2", title: "知识图谱中的关系建模", summary: "实体、上下文与知识来源之间的连接方式", collection: "研究笔记", updatedAt: "昨天", tags: ["图谱", "研究"], initials: "LC" },
  { id: "3", title: "工作空间信息架构", summary: "集合、文档与协作权限的产品结构", collection: "产品资料", updatedAt: "3 天前", tags: ["产品", "设计"], initials: "MX" },
  { id: "4", title: "混合检索评估方法", summary: "结合关键词与向量召回，建立可复用的质量评估基线", collection: "研究笔记", updatedAt: "4 天前", tags: ["检索", "研究"], initials: "QZ" },
  { id: "5", title: "知识助手交互规范", summary: "定义问答、引用展开与结果反馈的核心交互模式", collection: "产品资料", updatedAt: "上周", tags: ["AI", "产品"], initials: "SY" },
  { id: "6", title: "团队知识流转灵感", summary: "记录从个人捕获到团队沉淀的轻量协作工作流", collection: "灵感存档", updatedAt: "2 周前", tags: ["设计", "研究"], initials: "HW" },
];
const projectPlan: GanttSnapshot = {
  taskData: [
    { id: "launch", name: "项目启动", type: "task", start: "2026-10-01", end: "2026-10-03", progress: 100, fields: { 负责人: "林悦", 工时: "16" } },
    { id: "research", name: "需求研究", type: "summary", start: "2026-10-04", end: "2026-10-11", progress: 65, open: true, fields: { 负责人: "林悦", 工时: "32" } },
    { id: "interviews", name: "用户访谈", type: "task", start: "2026-10-04", end: "2026-10-07", progress: 100, parent_id: "research", fields: { 负责人: "林悦", 工时: "12" } },
    { id: "synthesis", name: "洞察归纳", type: "task", start: "2026-10-08", end: "2026-10-11", progress: 30, parent_id: "research", fields: { 负责人: "周明", 工时: "20" } },
    { id: "release", name: "版本发布", type: "milestone", start: "2026-10-12", end: "2026-10-12", progress: 0, fields: { 负责人: "周明", 工时: "0" } },
    { id: "review", name: "发布复盘", type: "milestone", start: "2026-10-15", end: "2026-10-15", progress: 0, parent_id: "release", fields: { 负责人: "林悦", 工时: "0" } },
  ],
  edgeData: [],
};
const sections = [
  { id: "overview", label: "设计概览", number: "01" },
  { id: "knowledge", label: "知识组件", number: "02" },
  { id: "inputs", label: "输入与选择", number: "03" },
  { id: "navigation", label: "导航与数据", number: "04" },
  { id: "activity", label: "事项日历", number: "05" },
  { id: "gantt", label: "甘特图", number: "06" },
  { id: "feedback", label: "反馈与浮层", number: "07" },
];


function Demo({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><h3 className="mb-4 text-xs font-medium text-muted-foreground">{title}</h3>{children}</div>;
}

function Examples({ sectionId, tone, material }: { sectionId: string; tone: SurfaceTone; material: SurfaceMaterial }) {
  const toastOptions = { className: `surface-toast surface-toast-${tone}${material === "glass" ? " surface-toast-glass" : ""}`, style: { colorScheme: tone } };
  const notify = {
    success: (message: string, options = {}) => toast.success(message, { ...toastOptions, ...options }),
    error: (message: string, options = {}) => toast.error(message, { ...toastOptions, ...options }),
    info: (message: string, options = {}) => toast.info(message, { ...toastOptions, ...options }),
  };
  const uid = useId();
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [collection, setCollection] = useState("all");
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [documentOpen, setDocumentOpen] = useState(false);
  const documentTrigger = useRef<HTMLElement | null>(null);
  const [density, setDensity] = useState([65]);
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const [contributionYear, setContributionYear] = useState(2026);
  const [contributionDetails, setContributionDetails] = useState<Record<string, ContributionDayDetails>>({ "2026-01-01": { title: "研究记录更新", items: ["整理本周检索结果", "补充文档来源引用", "同步研究结论"] } });
  const [ganttSnapshot, setGanttSnapshot] = useState<GanttSnapshot>(() => structuredClone(projectPlan));
  const [ganttYear, setGanttYear] = useState(2026);
  const filtered = useMemo(() => documents.filter((item) =>
    (collection === "all" || (collection === "research" && item.collection === "研究笔记") || (collection === "product" && item.collection === "产品资料") || (collection === "archive" && item.collection === "灵感存档")) &&
    (!tags.length || tags.some((tag) => item.tags.includes(tag))) &&
    (!query || [item.title, item.summary, item.collection, ...item.tags].some((value) => value.toLowerCase().includes(query.toLowerCase())))
  ), [query, tags, collection]);
  const openDocument = (id: string) => {
    documentTrigger.current = window.document.activeElement as HTMLElement | null;
    setSelectedDocument(id);
    setDocumentOpen(true);
  };


  const activeDocument = documents.find(item => item.id === selectedDocument);
  return <>
    <Dialog open={documentOpen} onOpenChange={setDocumentOpen}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); documentTrigger.current?.focus(); }}><DialogHeader><DialogTitle>{activeDocument?.title ?? "文档详情"}</DialogTitle><DialogDescription>{activeDocument?.summary}</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2">{activeDocument?.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div><MetadataPanel fields={[{ label: "所属集合", value: activeDocument?.collection ?? "" }, { label: "最近更新", value: activeDocument?.updatedAt ?? "" }]} /></DialogContent></Dialog>
    {sectionId === "overview" && <div className="ds-pattern-stack">
      <MetricPanel title="让信息，流动起来。" eyebrow="WORKSPACE / LIVE PULSE" action={<Badge>实时同步</Badge>}
        metrics={[{ label: "知识条目", value: "128", detail: "+12% 本月增长" }, { label: "连接来源", value: "24", detail: "+4 新增来源" }, { label: "本周引用", value: "86", detail: "+18% 使用增长" }]} />
      <div className="grid gap-3 @xl:grid-cols-2"><ActionTile icon={<Search className="size-5" />} title="发现知识" description="连接来源，找到可信答案" onClick={() => notify.info("已打开知识搜索")} /><ActionTile icon={<FilePlus2 className="size-5" />} title="开始记录" description="将想法沉淀为团队资产" onClick={() => setDialogOpen(true)} /></div>
      <Card size="sm"><CardHeader><CardTitle>共同构建，而非孤立存储。</CardTitle><CardDescription>信息卡使用紧凑标题，指标面板以大数字和分隔线建立层次。</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-3"><Badge>进行中</Badge><Badge variant="secondary">12 条更新</Badge><Badge variant="outline">团队空间</Badge><Separator orientation="vertical" className="h-5" /><AvatarGroup><Avatar className="size-7"><AvatarFallback>YL</AvatarFallback></Avatar><Avatar className="size-7"><AvatarFallback>LC</AvatarFallback></Avatar></AvatarGroup></CardContent></Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>开始记录</DialogTitle><DialogDescription>捕获一个值得保留的想法。</DialogDescription></DialogHeader><Input aria-label="记录标题" placeholder="输入标题" /><Button onClick={() => { setDialogOpen(false); notify.success("已创建记录"); }}>创建记录</Button></DialogContent></Dialog>
    </div>}
    {sectionId === "knowledge" && <><div className="grid gap-6 @2xl:grid-cols-[180px_minmax(0,1fr)]">
              <div className="space-y-8"><Demo title="集合导航"><CollectionNav collections={collections} value={collection} onChange={setCollection} /></Demo><Demo title="标签选择"><TagPicker tags={["检索", "AI", "图谱", "研究", "产品", "设计"]} selected={tags} onChange={setTags} /></Demo></div>
              <div className="min-w-0"><Demo title="搜索 · 文档网格 · 空状态"><div className="glass rounded-md p-4 @sm:p-5"><div className="mb-4 flex flex-wrap items-center gap-3"><KnowledgeSearch value={query} onChange={setQuery} className="min-w-0 flex-1" /><Badge variant="outline">{filtered.length} 条结果</Badge></div><div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @3xl:grid-cols-3">{filtered.length ? filtered.map((item) => <DocumentRow key={item.id} document={item} selected={selectedDocument === item.id} onOpen={openDocument} />) : <div className="col-span-full"><KnowledgeEmpty action={<Button variant="outline" size="sm" onClick={() => { setQuery(""); setTags([]); setCollection("all"); }}>清除筛选</Button>} /></div>}</div></div></Demo></div>
            </div>
            <div className="mt-8 grid gap-8 @2xl:grid-cols-2"><Demo title="元数据"><MetadataPanel fields={[{ label: "所属集合", value: "研究笔记" }, { label: "最近编辑", value: "2026-09-30 09:42" }, { label: "创建者", value: "Y. Lin" }, { label: "访问级别", value: "团队可见" }]} /></Demo><Demo title="引用条目"><div className="space-y-2"><CitationItem index={1} title="语义检索的设计原则" source="研究笔记 · 第 4 段" href="#knowledge" /><CitationItem index={2} title="工作空间信息架构" source="产品资料 · 第 2 段" href="#knowledge" /></div></Demo></div></>}
    {sectionId === "inputs" && <><div className="grid gap-x-6 gap-y-10 @2xl:grid-cols-2">
              <Demo title="行动尺寸 · 搜索操作栏" className="col-span-full"><div className="mb-5 flex flex-wrap gap-3"><Button size="hero" onClick={() => notify.success("已开始探索")}>开始探索 <ArrowRight /></Button><Button size="action" variant="secondary" onClick={() => notify.info("设置已保存")}><Settings2 />管理来源</Button></div><FloatingToolbar tone={tone} material={material} aria-label="搜索操作栏" className="w-full rounded-2xl"><KnowledgeSearch value={query} onChange={setQuery} className="min-w-0 flex-1" /><Button size="action" onClick={() => notify.info(query ? `搜索：${query}` : "请输入搜索内容")}><Search />搜索</Button></FloatingToolbar></Demo>
              <Demo title="按钮 · 尺寸 · 状态"><div className="flex flex-wrap items-center gap-2"><Button onClick={() => notify.success("已创建文档")}><Plus />新建文档</Button><Button variant="secondary"><Filter />筛选</Button><Button variant="outline">描边按钮</Button><Button variant="ghost">次要操作</Button><Button variant="destructive">移除</Button><Button disabled>不可用</Button><Button disabled aria-busy="true"><Loader2 className="animate-spin" />加载中</Button><Button variant="link">链接按钮</Button><Button size="sm">小按钮</Button><Button size="icon" variant="outline" aria-label="更多操作"><Ellipsis /></Button></div></Demo>
              <Demo title="文本输入 · 标签 · 错误状态"><div className="grid gap-4"><div className="grid gap-2"><Label htmlFor={`${uid}-demo-title`}>文档标题</Label><Input id={`${uid}-demo-title`} placeholder="输入文档标题" /></div><div className="grid gap-2"><Label htmlFor={`${uid}-demo-error`}>必填字段</Label><Input id={`${uid}-demo-error`} aria-invalid="true" aria-describedby={`${uid}-demo-error-hint`} placeholder="请输入内容" /><span id={`${uid}-demo-error-hint`} className="text-xs text-destructive">此字段不能为空</span></div><div className="grid gap-2"><Label htmlFor={`${uid}-demo-note`}>摘要</Label><Textarea id={`${uid}-demo-note`} placeholder="记录关键想法..." /></div></div></Demo>
              <Demo title="复选框 · 单选 · 开关"><div className="space-y-5"><label className="flex items-center gap-3 text-sm"><Checkbox defaultChecked />允许团队成员评论</label><div className="flex items-center gap-3"><Switch id={`${uid}-demo-notify`} defaultChecked /><Label htmlFor={`${uid}-demo-notify`}>开启更新提醒</Label></div><RadioGroup defaultValue="team" className="flex gap-6"><label className="flex items-center gap-2 text-sm"><RadioGroupItem value="team" />团队可见</label><label className="flex items-center gap-2 text-sm"><RadioGroupItem value="private" />仅自己</label></RadioGroup></div></Demo>
              <Demo title="下拉选择 · 可搜索选项 · 滑块"><div className="grid max-w-sm gap-5"><Select defaultValue="research"><SelectTrigger className="w-full"><SelectValue placeholder="选择集合" /></SelectTrigger><SelectContent><SelectItem value="research">研究笔记</SelectItem><SelectItem value="product">产品资料</SelectItem><SelectItem value="archive">灵感存档</SelectItem></SelectContent></Select><Combobox items={["语义检索", "知识图谱", "信息架构"]}><ComboboxInput placeholder="查找主题" /><ComboboxContent><ComboboxEmpty>没有匹配主题</ComboboxEmpty><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox><div><div className="mb-3 flex justify-between text-xs text-muted-foreground"><span>结果密度</span><span>{density[0]}%</span></div><Slider aria-label="结果密度" value={density} onValueChange={setDensity} min={0} max={100} /></div></div></Demo>
            </div></>}
    {sectionId === "navigation" && <><div className="grid gap-10 @2xl:grid-cols-2">
              <Demo title="面包屑 · 标签页"><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="/components">知识空间</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink href="#knowledge">研究笔记</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>语义检索</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb><Tabs defaultValue="recent" className="mt-6"><TabsList><TabsTrigger value="recent">最近访问</TabsTrigger><TabsTrigger value="saved">已收藏</TabsTrigger><TabsTrigger value="shared">共享给我</TabsTrigger></TabsList><TabsContent value="recent" className="pt-3 text-sm text-muted-foreground">最近更新的知识条目会显示在这里</TabsContent><TabsContent value="saved" className="pt-3 text-sm text-muted-foreground">已收藏 12 条内容</TabsContent><TabsContent value="shared" className="pt-3 text-sm text-muted-foreground">团队共享的内容</TabsContent></Tabs></Demo>
              <Demo title="卡片标签页"><Tabs variant="card" defaultValue="overview"><TabsList aria-label="卡片标签页示例"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="activity">活动</TabsTrigger></TabsList><TabsContent value="overview" className="p-5"><p className="font-medium">研究空间概览</p><p className="mt-2 text-sm text-muted-foreground">标签与内容卡片共享连续边界，适合承载完整工作区</p></TabsContent><TabsContent value="activity" className="p-5"><p className="font-medium">最近活动</p><p className="mt-2 text-sm text-muted-foreground">查看团队成员的最新更新</p></TabsContent></Tabs></Demo>
              <Demo title="折叠内容 · 滚动区域"><Accordion type="single" collapsible defaultValue="one"><AccordionItem value="one"><AccordionTrigger>什么是知识集合？</AccordionTrigger><AccordionContent>集合用于组织相关文档，也可以按照项目或主题进行归档</AccordionContent></AccordionItem><AccordionItem value="two"><AccordionTrigger>如何管理引用？</AccordionTrigger><AccordionContent>引用条目会记录来源与上下文，方便回溯</AccordionContent></AccordionItem></Accordion><ScrollArea className="glass-surface mt-4 h-28 rounded-md border p-3"><div className="space-y-3 text-sm text-muted-foreground">{["研究笔记 · 检索策略", "产品资料 · 信息架构", "灵感存档 · 工作流", "研究笔记 · 图谱结构", "产品资料 · 协作权限"].map((item) => <div key={item}>{item}</div>)}</div></ScrollArea></Demo>
            </div>
            <Demo title="表格 · 分页" className="mt-10"><div className="glass-surface overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>文档</TableHead><TableHead>集合</TableHead><TableHead>标签</TableHead><TableHead className="text-right">更新</TableHead></TableRow></TableHeader><TableBody>{documents.slice(page - 1, page).map((item) => <TableRow key={item.id}><TableCell className="font-medium">{item.title}</TableCell><TableCell>{item.collection}</TableCell><TableCell>{item.tags.join(" / ")}</TableCell><TableCell className="text-right">{item.updatedAt}</TableCell></TableRow>)}</TableBody></Table></div><Pagination className="mt-4"><PaginationContent><PaginationItem><PaginationPrevious href="#navigation" text="上一页" aria-disabled={page === 1} className={page === 1 ? "pointer-events-none opacity-40" : ""} onClick={(event) => { event.preventDefault(); setPage(Math.max(1, page - 1)); }} /></PaginationItem>{[1, 2, 3].map((number) => <PaginationItem key={number}><PaginationLink href="#navigation" isActive={page === number} onClick={(event) => { event.preventDefault(); setPage(number); }}>{number}</PaginationLink></PaginationItem>)}<PaginationItem><PaginationNext href="#navigation" text="下一页" aria-disabled={page === 3} className={page === 3 ? "pointer-events-none opacity-40" : ""} onClick={(event) => { event.preventDefault(); setPage(Math.min(3, page + 1)); }} /></PaginationItem></PaginationContent></Pagination></Demo></>}
    {sectionId === "activity" && <><div className="max-w-5xl"><Demo title="Schedule calendar · 年度事项分布"><ContributionCalendar year={contributionYear} years={[2026, 2025, 2024]} dayDetails={contributionDetails} onDayDetailsChange={(date, details) => setContributionDetails((current) => ({ ...current, [date]: details }))} onYearChange={setContributionYear} onDayClick={(date, count) => notify.info(`${date} · ${count} 个事项`)} /></Demo></div></>}
    {sectionId === "gantt" && <><Demo title="Gantt chart · 受控项目计划"><GanttChart snapshot={ganttSnapshot} onChange={setGanttSnapshot} selectedYear={ganttYear} onYearChange={setGanttYear} nativeProps={{ gridWidth: 360 }} colorScheme={defaultGanttColorScheme} height={480} /></Demo></>}
    {sectionId === "feedback" && <><div className="grid gap-10 @2xl:grid-cols-2">
              <Demo title="提示 · 进度 · 骨架屏"><div className="space-y-5"><Alert><CircleHelp className="size-4" /><AlertTitle>同步完成</AlertTitle><AlertDescription>所有知识来源均已更新</AlertDescription></Alert><div className="flex items-center gap-3"><Progress value={72} className="flex-1" /><span className="text-xs text-muted-foreground">72%</span></div><div className="flex items-center gap-3"><Skeleton className="size-9 rounded-md" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div></div></Demo>
              <Demo title="弹窗 · 侧边栏 · 下拉菜单 · 气泡提示"><div className="flex flex-wrap gap-2"><Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger asChild><Button><FilePlus2 />新建文档</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>新建文档</DialogTitle><DialogDescription>为新的知识条目设置标题</DialogDescription></DialogHeader><Label htmlFor={`${uid}-new-document`}>文档标题</Label><Input id={`${uid}-new-document`} value={documentName} onChange={(event) => setDocumentName(event.target.value)} placeholder="例如：研究摘要" /><DialogFooter><Button disabled={!documentName.trim()} onClick={() => { notify.success("文档已创建", { description: documentName }); setDocumentName(""); setDialogOpen(false); }}>创建</Button></DialogFooter></DialogContent></Dialog><Sheet><SheetTrigger asChild><Button variant="outline"><Menu />详情面板</Button></SheetTrigger><SheetContent><SheetHeader><SheetTitle>文档详情</SheetTitle><SheetDescription>来源与访问权限</SheetDescription></SheetHeader><div className="p-4"><MetadataPanel fields={[{ label: "创建者", value: "Y. Lin" }, { label: "状态", value: "已同步" }]} /></div></SheetContent></Sheet><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><Settings2 />操作<ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>工作空间</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => notify.success("已保存设置")}><Check />保存设置</DropdownMenuItem><DropdownMenuItem onSelect={() => notify.info("已发送提醒")}><Bell />发送提醒</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Popover><PopoverTrigger asChild><Button variant="ghost"><Filter />快速筛选</Button></PopoverTrigger><PopoverContent className="w-60"><p className="mb-3 text-sm font-medium">筛选条件</p><TagPicker tags={["检索", "AI", "产品"]} selected={tags} onChange={setTags} /></PopoverContent></Popover><Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label="帮助"><CircleHelp /></Button></TooltipTrigger><TooltipContent>组件使用帮助</TooltipContent></Tooltip></div></Demo>
              <Demo title="命令菜单"><Command defaultValue="preview-idle" className="max-w-md border border-border"><CommandInput placeholder="搜索命令或文档..." /><CommandList><CommandEmpty>没有匹配结果</CommandEmpty><CommandGroup heading="快速操作"><CommandItem onSelect={() => notify.info("已打开搜索")}><Search />搜索知识</CommandItem><CommandItem onSelect={() => setDialogOpen(true)}><Plus />新建文档</CommandItem><CommandItem onSelect={() => notify.success("已打开设置")}><Settings2 />工作空间设置</CommandItem></CommandGroup></CommandList></Command></Demo>
              <Demo title="通知 · 操作反馈"><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => notify.success("同步完成", { description: "3 条文档已更新" })}><Bell />成功通知</Button><Button variant="outline" onClick={() => notify.error("同步失败", { description: "请检查连接后重试" })}>错误通知<ArrowRight /></Button><Button variant="ghost" onClick={() => notify.info("正在处理")}>信息提示</Button></div><div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground"><CommandIcon className="size-4" />弹层支持键盘焦点与 Esc 关闭</div></Demo>
            </div></>}
  </>;
}

export default function ComponentsPage() {
  return <div className="design-system gallery-surface">
    <header className="ds-header"><Link href="/landing" aria-label="Agrisata" className="ds-wordmark"><BrandLogo className="w-44" /></Link><span className="ds-header-label">Design system / 01</span><Button asChild variant="outline" size="sm"><Link href="/landing">探索平台 <ArrowRight /></Link></Button></header>
    <div className="ds-layout">
      <aside className="ds-sidebar"><p className="ds-index-label">THE LIBRARY</p><nav aria-label="组件分类">{sections.map(item => <a key={item.id} href={`#${item.id}`}><span>{item.number}</span>{item.label}</a>)}</nav><div className="ds-sidebar-note"><span className="ds-status-dot" /> One system.<br />Every surface.<p>黑灰为底，荧光绿点亮行动。<br />米白表面为重点信息留白。</p></div></aside>
      <main className="ds-main">
        <div className="ds-intro"><p className="ds-eyebrow"><span className="ds-status-dot" /> AGRISATA / DESIGN LANGUAGE</p><h1>Clarity, by design.<br /><em>让复杂，归于清晰。</em></h1><div className="ds-intro-bottom"><p>从一个按钮到完整工作流。为 Agrisata 构建一致、平静而清晰的界面语言。</p><Badge variant="outline">单一主题 · 三种组件表面</Badge></div></div>
        <section className="ds-foundations" aria-label="基础设计规范"><div><span className="ds-eyebrow">01 / PALETTE</span><div className="ds-swatches">{[{color:"#090a0a",label:"Canvas"},{color:"#242626",label:"Panel"},{color:"#bdff72",label:"Action"},{color:"#e9ebe5",label:"Soft surface"}].map(item=><div key={item.color}><i style={{background:item.color}} /><strong>{item.label}</strong><code>{item.color}</code></div>)}</div></div><div className="ds-type-spec"><span className="ds-eyebrow">02 / TYPE & SPACE</span><strong>Aa <span>清晰有序</span></strong><p>Geist / 系统中文字体 · 正文 14px / 1.6</p><p>间距 4 / 8 / 12 / 16 / 24 / 32 · 圆角 8 / 16 / 20px</p><p>深灰承载操作，米白突出内容，烟灰玻璃连接环境。</p></div></section>
        <section className="ds-reference-patterns" aria-label="参考页组合模式">
          <div className="ds-pattern-copy"><span className="ds-eyebrow">FROM THE PRODUCT / INTO THE SYSTEM</span><h2>界面有层次，<br />行动有焦点。</h2><p>提炼自 Landing 的横向流程卡、Agriculture 的数据叠层和 Agriculture App 的浮动导航。实心与玻璃各司其职，共用一套交互语言。</p><Button size="action" asChild><a href="#overview">探索组件 <ArrowRight /></a></Button></div>
          <div className="ds-photo-stage"><MetricPanel material="glass" title="Field intelligence." eyebrow="NORTH FIELD / CONNECTED" metrics={[{label:"覆盖面积",value:"128",detail:"公顷 / 已连接"},{label:"健康指数",value:"86",detail:"状态良好"},{label:"节省投入",value:"24%",detail:"相比上一季"}]} /><FloatingToolbar aria-label="浮动操作示例"><Button variant="ghost" size="icon" aria-label="查找地块"><Search /></Button><Button variant="ghost" size="icon" aria-label="地块通知"><Bell /></Button><Button size="action" asChild><a href="#knowledge">进入工作空间 <ArrowRight /></a></Button></FloatingToolbar></div>
        </section>
        {sections.map(section => <section key={section.id} id={section.id} className="gallery-section ds-section"><div className="ds-section-heading"><div><span className="ds-eyebrow">{section.number} / COMPONENTS</span><h2>{section.label}</h2></div><span className="ds-section-caption">同一数据 · 独立交互 · 局部表面</span></div><div className={`ds-preview-pair ${["activity","gantt"].includes(section.id) ? "ds-preview-pair-wide" : ""}`}>{([{tone:"dark",material:"solid",label:"深灰表面"},{tone:"light",material:"solid",label:"米白表面"},{tone:"dark",material:"glass",label:"烟灰玻璃"}] as const).map(({tone,material,label})=><div key={label} className={`ds-preview-stage ${material === "glass" ? "ds-preview-stage-glass" : ""}`}><Surface tone={tone} material={material} className="ds-preview @container" aria-label={`${section.label} · ${label}示例`}><div className="ds-preview-label"><span><i />{label}</span><code>{material === "glass" ? 'material="glass"' : `tone="${tone}"`}</code></div><div className="ds-preview-content"><Examples sectionId={section.id} tone={tone} material={material} /></div></Surface></div>)}</div></section>)}
        <footer className="ds-footer"><span>AGRISATA. / BUILT FOR CLARITY.</span><Link href="/landing">探索 Agrisata <ArrowRight className="size-3" /></Link></footer>
      </main>
    </div>
  </div>;
}
