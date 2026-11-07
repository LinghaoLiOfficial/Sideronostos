"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type ContributionDayDetails = { title: string; items: string[] };

type ContributionDay = { date: string; count: number; month: number; day: number };
type CalendarCell = ContributionDay | null;

export type ContributionCalendarProps = {
  dayDetails: Record<string, ContributionDayDetails>;
  year?: number;
  years?: number[];
  onYearChange?: (year: number) => void;
  onDayClick?: (date: string, count: number) => void;
  onDayDetailsChange?: (date: string, details: ContributionDayDetails) => void;
  readOnly?: boolean;
  embedded?: boolean;
  className?: string;
  ariaLabel?: string;
};

const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const weekNames = ["一", "二", "三", "四", "五", "六", "日"];
const intensityClasses = ["bg-(--calendar-0)", "bg-(--calendar-1)", "bg-(--calendar-2)", "bg-(--calendar-3)", "bg-(--calendar-4)"];

function pad(value: number) { return String(value).padStart(2, "0"); }
function dateKey(year: number, month: number, day: number) { return `${year}-${pad(month + 1)}-${pad(day)}`; }
function buildWeeks(year: number) {
  const first = (new Date(year, 0, 1).getDay() + 6) % 7;
  const totalDays = (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime()) / 86400000;
  const days: CalendarCell[] = Array.from({ length: first }, () => null);
  for (let index = 0; index < totalDays; index += 1) {
    const date = new Date(year, 0, index + 1);
    const month = date.getMonth();
    const day = date.getDate();
    const key = dateKey(year, month, day);
    days.push({ date: key, count: 0, month, day });
  }
  while (days.length % 7) days.push(null);
  return Array.from({ length: days.length / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
}

function intensity(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 7) return 3;
  return 4;
}

function scheduleTitle(title: string) {
  return title.replaceAll("贡献", "事项");
}

export function ContributionCalendar({ year: controlledYear, years, onYearChange, onDayClick, onDayDetailsChange, dayDetails, readOnly = false, embedded = false, className, ariaLabel = "事项日历" }: ContributionCalendarProps) {
  const currentYear = new Date().getFullYear();
  const [internalYear, setInternalYear] = useState(controlledYear ?? currentYear);
  const year = controlledYear ?? internalYear;
  const availableYears = useMemo(() => Array.from(new Set([...(years?.length ? years : [currentYear, currentYear - 1, currentYear - 2]), year])).sort((a, b) => b - a), [years, currentYear, year]);
  const weeks = useMemo(() => buildWeeks(year), [year]);
  const monthStarts = useMemo(() => monthNames.map((name, month) => ({ name, weekIndex: weeks.findIndex((week) => week.some((cell) => cell?.month === month)) })).filter((item) => item.weekIndex >= 0), [weeks]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailOverrides, setDetailOverrides] = useState<Record<string, ContributionDayDetails>>({});
  const [editing, setEditing] = useState(false);
  const [draftItems, setDraftItems] = useState<string[]>([]);
  const calendarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (calendarRef.current?.contains(event.target as Node)) return;
      setSelectedDate(null);
      setEditing(false);
      setDraftItems([]);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);
  const countForDate = (date: string) => {
    const details = detailOverrides[date] ?? dayDetails[date];
    return details?.items.length ?? 0;
  };
  const total = weeks.flat().reduce((sum, cell) => sum + (cell ? countForDate(cell.date) : 0), 0);
  const changeYear = (value: string) => {
    const nextYear = Number(value);
    setInternalYear(nextYear);
    setSelectedDate(null);
    setEditing(false);
    setDraftItems([]);
    onYearChange?.(nextYear);
  };
  const selectedDetails = selectedDate ? detailOverrides[selectedDate] ?? dayDetails[selectedDate] : undefined;
  const selectedDateParts = selectedDate?.split("-");
  const selectedTitle = selectedDetails?.title
    ? scheduleTitle(selectedDetails.title)
    : (selectedDateParts ? `${selectedDateParts[0]}年${Number(selectedDateParts[1])}月${Number(selectedDateParts[2])}日事项` : "日期详情");
  const beginEditing = () => {
    setDraftItems(selectedDetails?.items ? [...selectedDetails.items] : []);
    setEditing(true);
  };
  const cancelEditing = () => {
    setEditing(false);
    setDraftItems([]);
  };
  const saveEditing = () => {
    if (!selectedDate) return;
    const details = { title: selectedTitle, items: draftItems };
    setDetailOverrides((current) => ({ ...current, [selectedDate]: details }));
    onDayDetailsChange?.(selectedDate, details);
    setEditing(false);
  };

  return <TooltipProvider><div ref={calendarRef} className={cn(embedded ? "p-5 sm:p-6" : "glass-surface rounded-lg border p-5 sm:p-6", className)} aria-label={ariaLabel}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-lg font-semibold">{total.toLocaleString()} 个事项</p></div>
      <Select value={String(year)} onValueChange={changeYear}>
      <SelectTrigger aria-label="选择年份" className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent>{availableYears.map((item) => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="grid min-w-0 items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="min-w-0">
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[860px] grid-cols-[1rem_1fr] gap-x-2">
            <div aria-hidden="true" />
            <div className="relative h-5 text-xs text-muted-foreground">{monthStarts.map(({ name, weekIndex }) => <span key={name} className="absolute top-0" style={{ left: `${weekIndex * 16}px` }}>{name}</span>)}</div>
            <div className="grid grid-rows-7 gap-1 pt-1 text-right text-[10px] text-muted-foreground">{weekNames.map((name, index) => <span key={name} className={cn(index % 2 ? "invisible" : "flex items-center justify-end")}>{name}</span>)}</div>
            <div className="grid auto-cols-[12px] grid-flow-col grid-rows-7 gap-1 pt-1">
              {weeks.flatMap((week, weekIndex) => week.map((cell, dayIndex) => {
                if (!cell) return <span key={`empty-${weekIndex}-${dayIndex}`} aria-hidden="true" className="size-3 rounded-[3px]" />;
                const contributionCount = countForDate(cell.date);
                const level = intensity(contributionCount);
                const label = `${cell.date}：${contributionCount} 个事项`;
                const clearActiveDate = () => setActiveDate((active) => active === cell.date ? null : active);
                return <Tooltip key={cell.date} open={activeDate === cell.date} onOpenChange={(open) => {
                  if (open) setActiveDate(cell.date);
                  else clearActiveDate();
                }}><TooltipTrigger asChild><button type="button" aria-label={label} onPointerEnter={() => setActiveDate(cell.date)} onFocus={() => setActiveDate(cell.date)} onBlur={clearActiveDate} onClick={() => { setEditing(false); setDraftItems([]); setSelectedDate(cell.date); onDayClick?.(cell.date, contributionCount); }} className={cn("size-3 rounded-[3px] border-[0.5px] border-border transition-transform hover:scale-125 focus-visible:z-10 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-ring", intensityClasses[level], selectedDate === cell.date && "ring-1 ring-ring")} /></TooltipTrigger><TooltipContent side="top" sideOffset={-4} className="pointer-events-none">{label}</TooltipContent></Tooltip>;
              }))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span aria-live="polite">{activeDate ? `${activeDate}：${countForDate(activeDate)} 个事项` : "选中单元格查看详情"}</span>
          <span className="flex items-center gap-2"><span>少</span>{intensityClasses.map((tone, index) => <span key={tone} aria-label={`事项数量等级 ${index}`} className={cn("size-3 rounded-[3px] border border-border", tone)} />)}<span>多</span></span>
        </div>
      </div>
      <aside role="region" aria-label="日期详情" className="glass-surface flex h-56 min-w-0 flex-col rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="min-w-0 break-words text-sm font-semibold">{selectedTitle}</h3>
          {!readOnly && selectedDate && !editing && <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label="编辑日期事项" onClick={beginEditing}><Pencil /></Button>}
          {!readOnly && editing && <div className="flex shrink-0 items-center gap-1"><Button type="button" variant="ghost" size="icon" className="size-7" aria-label="保存日期事项" onClick={saveEditing}><Check /></Button><Button type="button" variant="ghost" size="icon" className="size-7" aria-label="取消编辑日期事项" onClick={cancelEditing}><X /></Button></div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {editing ? <div className="space-y-2"><div className="space-y-2">{draftItems.map((item, index) => <div key={index} className="flex items-center gap-2"><Input aria-label={`事项 ${index + 1}`} value={item} onChange={(event) => setDraftItems((items) => items.map((current, itemIndex) => itemIndex === index ? event.target.value : current))} /><Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`删除事项 ${index + 1}`} onClick={() => setDraftItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button></div>)}</div><Button type="button" variant="outline" size="sm" onClick={() => setDraftItems((items) => [...items, ""])}><Plus />新增事项</Button></div> : <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">{selectedDetails?.items?.length ? selectedDetails.items.map((item, index) => <li key={`${item}-${index}`} className="flex min-w-0 gap-2"><span aria-hidden="true" className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-primary" /><span className="min-w-0 break-words">{item}</span></li>) : <li className="text-muted-foreground">{selectedDate ? "暂无事项" : "点击任意单元格查看事项明细"}</li>}</ul>}
        </div>
      </aside>
    </div>
  </div></TooltipProvider>;
}

export default ContributionCalendar;
