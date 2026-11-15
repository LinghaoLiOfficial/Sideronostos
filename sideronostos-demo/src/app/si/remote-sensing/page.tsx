import { RemoteSensingWorkspace } from "@/features/fields/nasa-analysis";
import { MultiBotDock } from "@/components/bot/MultiBotDock";

export const metadata = { title: "Remote Sensing Analysis · Agrisata" };

export default function RemoteSensingPage() {
  return (
    <><main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RemoteSensingWorkspace />
    </main><MultiBotDock module="remote-sensing" /></>
  );
}
