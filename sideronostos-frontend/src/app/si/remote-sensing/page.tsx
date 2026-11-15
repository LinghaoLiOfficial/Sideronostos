import { SiBlankPage } from "@/features/si";
import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Remote Sensing Analysis · Agrisata" };

export default function RemoteSensingPage() {
  return <><SiBlankPage /><MultiBotDock module="remote-sensing" /></>;
}
