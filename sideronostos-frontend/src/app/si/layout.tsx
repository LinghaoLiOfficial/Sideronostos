import type { ReactNode } from "react";
import { SiHeader } from "@/features/si/si-header";
import { SiStoryNavigation } from "@/features/si/si-story-link";

export default function SiLayout({ children }: { children: ReactNode }) {
  return (
    <SiStoryNavigation>
      <SiHeader />
      {children}
    </SiStoryNavigation>
  );
}
