"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ContributionCalendar, type ContributionDayDetails } from "@/components/contribution-calendar";
import { WorkspaceShell } from "@/components/workspace/shell";
import { getPersonalSchedule, savePersonalScheduleDay } from "@/lib/api/client";

const currentYear = new Date().getFullYear();
const availableYears = [currentYear, currentYear - 1, currentYear - 2];

export default function PersonalSchedulePage() {
  const [year, setYear] = useState(currentYear);
  const [dayDetails, setDayDetails] = useState<Record<string, ContributionDayDetails>>({});
  const [loading, setLoading] = useState(true);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [calendarKey, setCalendarKey] = useState(0);
  const requestId = useRef(0);
  const saveId = useRef(0);

  const loadSchedule = useCallback(async (targetYear: number) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await getPersonalSchedule(targetYear);
      if (id !== requestId.current) return;
      setDayDetails(result.days);
    } catch {
      if (id === requestId.current) toast.error("日程加载失败，请稍后重试");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // Loading remote schedule data is the synchronization boundary for the selected year.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadSchedule(year); }, [loadSchedule, year]);

  async function saveDay(date: string, details: ContributionDayDetails) {
    const previous = dayDetails;
    const id = ++saveId.current;
    setDayDetails((current) => ({ ...current, [date]: details }));
    setSavingDate(date);
    try {
      const saved = await savePersonalScheduleDay(date, details);
      if (id !== saveId.current) return;
      setDayDetails((current) => ({ ...current, [date]: { title: saved.title, items: saved.items } }));
      toast.success("日程已保存");
    } catch {
      if (id !== saveId.current) return;
      setDayDetails(previous);
      setCalendarKey((value) => value + 1);
      toast.error("日程保存失败，已恢复未保存修改");
    } finally {
      if (id === saveId.current) setSavingDate(null);
    }
  }

  function changeYear(nextYear: number) {
    saveId.current += 1;
    setSavingDate(null);
    setCalendarKey((value) => value + 1);
    setYear(nextYear);
  }

  return <WorkspaceShell>
    <section className="min-w-0 flex-1">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="outline">个人规划</Badge>
          <h1 className="mt-3 text-2xl font-semibold">个人日程表</h1>
          <p className="mt-2 text-sm text-muted-foreground">记录每天的计划、进展和需要回顾的事项</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {loading ? <><LoaderCircle className="size-4 animate-spin" />正在加载</> : savingDate ? <><LoaderCircle className="size-4 animate-spin" />正在保存 {savingDate}</> : <><Check className="size-4 text-emerald-300" />已同步</>}
        </div>
      </div>
      <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
        <ContributionCalendar
          key={calendarKey}
          year={year}
          years={availableYears}
          dayDetails={dayDetails}
          ariaLabel="个人日程表"
          onYearChange={changeYear}
          onDayDetailsChange={(date, details) => { void saveDay(date, details); }}
        />
      </div>
    </section>
  </WorkspaceShell>;
}
