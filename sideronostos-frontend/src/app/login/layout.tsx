import type { ReactNode } from "react";
import { SiHeader } from "@/features/si/si-header";
import { SiOrbitBackground } from "@/features/si/si-orbit-background";
import styles from "./login.module.css";

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiHeader />
      <main className={styles.page}>
        <SiOrbitBackground />
        {children}
      </main>
    </>
  );
}
