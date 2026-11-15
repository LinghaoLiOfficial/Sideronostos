"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "./si-model-guide.module.css";

export const rotationOverviewHref = "/si/rotation-recommendation";
export const rotationLayersHref = `${rotationOverviewHref}/layers`;

const story = ["/si", rotationOverviewHref, rotationLayersHref];
const posters = [
  "/images/si/orbit-scene.webp",
  "/images/si/rotation-overview-poster.webp",
  "/images/si/rotation-layers-poster.webp",
];
const Navigate = createContext<((href: string) => boolean) | null>(null);
const StoryTransitioning = createContext(false);

function storyIndex(path: string) {
  return path.startsWith(`${rotationLayersHref}/`) ? 2 : story.indexOf(path);
}

export function useSiStoryTransition() {
  return useContext(StoryTransitioning);
}

export function SiStoryNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const transition = useRef<HTMLDivElement>(null);
  const active = useRef<{ href: string; finish: () => void } | null>(null);
  const routeCommit = useRef<(() => void) | null>(null);
  const [destination, setDestination] = useState<string | null>(null);

  useLayoutEffect(() => {
    routeCommit.current?.();
  }, [pathname]);

  useEffect(() => {
    const next = storyIndex(pathname) + 1;
    if (next <= 0 || next >= story.length) return;

    router.prefetch(story[next]);
    const poster = new Image();
    poster.src = posters[next];
    void poster.decode().catch(() => undefined);
  }, [pathname, router]);

  function navigate(href: string) {
    const from = storyIndex(pathname);
    const to = storyIndex(href);
    const overlay = transition.current;
    if (!overlay || from < 0 || to < 0 || from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if (active.current?.href === href) return true;
    active.current?.finish();

    setDestination(href);
    const media = document.querySelector<HTMLElement>("[data-si-story-media]");
    const forward = to > from;
    const backdrop = overlay.firstElementChild as HTMLElement;
    const poster = backdrop.firstElementChild as HTMLElement;
    backdrop.dataset.storyLook = to === 2 ? "layers" : "overview";
    poster.style.backgroundImage = `url("${posters[to]}")`;
    overlay.hidden = false;

    const zoom = media?.animate(
      [{ transform: "scale(1)" }, { transform: forward ? "scale(1.30)" : "scale(.99)" }],
      { duration: 580, easing: "cubic-bezier(.35, 0, .4, 1)", fill: "forwards" },
    );
    const approach = backdrop.animate(
      [{ transform: forward ? "scale(1.14)" : "scale(1.05)" }, { transform: "scale(1)" }],
      { duration: 1000, easing: "cubic-bezier(.22, .65, .3, 1)", fill: "both" },
    );
    const cover = overlay.animate(
      [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .17 }, { opacity: 1, offset: 1 }],
      { duration: 540, easing: "ease-in-out", fill: "both" },
    );
    let reveal: Animation | undefined;

    const finish = () => {
      if (active.current?.finish !== finish) return;
      overlay.hidden = true;
      cover.cancel();
      approach.cancel();
      reveal?.cancel();
      zoom?.cancel();
      active.current = null;
      setDestination(null);
    };

    active.current = { href, finish };

    const swap = async () => {
      const commit = () => new Promise<void>((resolve) => {
        function finish() {
          window.clearTimeout(timeout);
          routeCommit.current = null;
          resolve();
        }
        const timeout = window.setTimeout(finish, 1800);
        routeCommit.current = finish;
        router.push(href);
      });

      try {
        await cover.finished;
        await commit();
        if (active.current?.finish !== finish) return;
        reveal = overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 320,
          easing: "ease-out",
        });
        await reveal.finished;
      } finally {
        finish();
      }
    };

    void swap().catch(() => undefined);
    return true;
  }

  return (
    <Navigate.Provider value={navigate}>
      <StoryTransitioning.Provider value={destination === pathname}>
        {children}
      </StoryTransitioning.Provider>
      <div ref={transition} className={styles.storyTransition} aria-hidden="true" hidden>
        <div className={styles.backdrop}>
          <div className={styles.storyPoster} />
        </div>
      </div>
    </Navigate.Provider>
  );
}

export function SiStoryLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  const navigate = useContext(Navigate);

  return <Link {...props} href={href} onNavigate={(event) => {
    if (navigate?.(href)) event.preventDefault();
  }} />;
}
