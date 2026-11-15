import { SiWorkspace } from "@/features/si";
import { SiHomeFormulas } from "@/features/si/si-home-formulas";

export const metadata = {
  title: "Agrisata",
};

export default function SiPage() {
  return <SiWorkspace orbitFormulas={<SiHomeFormulas />} />;
}
