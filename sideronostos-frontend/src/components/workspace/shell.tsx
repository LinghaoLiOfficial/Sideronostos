"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Bell, CalendarDays, FolderKanban, UserRound, Users } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiError, AuthUser, getCurrentUser, listNotifications } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const links = [
  { href: "/workspace/files", label: "个人文件", icon: FolderKanban },
  { href: "/workspace/schedule", label: "个人日程表", icon: CalendarDays },
  { href: "/workspace/groups", label: "群组管理", icon: Users },
];

const personalLinks = [
  { href: "/personal/notifications", label: "消息列表", icon: Bell },
  { href: "/personal/account", label: "账号管理", icon: UserRound },
];
const UserContext = createContext<AuthUser | null>(null);
export function useWorkspaceUser() { return useContext(UserContext); }

export const notificationsChangedEvent = "workspace:notifications-changed";

export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event(notificationsChangedEvent));
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const personal = pathname === "/personal" || pathname.startsWith("/personal/");
  const navigation = personal ? personalLinks : links;
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    getCurrentUser().then((value) => { if (active) setUser(value); }).catch((error: unknown) => {
      if (active && error instanceof ApiError && error.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}&authRequired=1`);
      }
    });
    return () => { active = false; };
  }, [pathname, router]);
  useEffect(() => {
    let active = true;
    const refresh = () => listNotifications().then((value) => { if (active) setUnread(value.unread_count); }).catch(() => undefined);
    const handleNotificationsChanged = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener(notificationsChangedEvent, handleNotificationsChanged);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(notificationsChangedEvent, handleNotificationsChanged);
    };
  }, []);
  const renderLinks = () => navigation.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;
    return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground", active && "brand-gradient-soft border border-primary/25 text-pink-50")}><Icon className="size-4" /><span className="flex-1">{item.label}</span>{item.href.endsWith("notifications") && unread > 0 && <Badge>{unread > 99 ? "99+" : unread}</Badge>}</Link>;
  });
  return <main className="gallery-surface flex h-screen flex-col overflow-hidden">
    <header className="border-b border-white/10 bg-[#191020]/70 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5 sm:px-8">
      <Link href="/workspace/files" aria-label="Agrisata workspace" className="flex items-center"><BrandLogo priority className="w-40 sm:w-44" /></Link>
      {user && <Link href="/personal/notifications" aria-label={`个人中心：${user.display_name}`} className="flex shrink-0 items-center justify-center gap-3 rounded-md px-4 py-2 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-primary sm:min-w-36"><Avatar className="size-8"><AvatarFallback>{user.display_name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><span className="hidden text-sm sm:block">{user.display_name}</span></Link>}
    </div></header>
    <div className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col gap-6 overflow-hidden px-4 py-5 sm:px-8 md:flex-row"><aside className="w-full shrink-0 md:w-56"><div className="space-y-3 md:sticky md:top-5"><div className="pr-4 pl-2 text-base tracking-wider text-white">{personal ? "个人中心" : "工作区"}</div><nav aria-label={personal ? "个人中心导航" : "工作区导航"} className="flex flex-wrap gap-1 md:block md:space-y-1">{renderLinks()}</nav></div></aside>
      {/* Let async content resize the wrapper observed by Radix; a fixed height hides overflow changes. */}
      <ScrollArea type="auto" className="min-h-0 min-w-0 flex-1" viewportClassName="[&>div]:!flex [&>div]:min-h-full [&>div]:flex-col"><section className="flex min-h-0 min-w-0 flex-1 flex-col pr-3"><UserContext.Provider value={user}>{children}</UserContext.Provider></section></ScrollArea>
    </div>
  </main>;
}
