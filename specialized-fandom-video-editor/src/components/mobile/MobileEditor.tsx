import { MobileTopBar } from './MobileTopBar';
import { MobilePreview } from './MobilePreview';
import { MobileTimeline } from './MobileTimeline';
import { MobileDock } from './MobileDock';
import { ExportDialog } from '../ExportDialog';
import { HelpModal, Toasts } from '../Overlays';
import { AiModal } from '../AiModal';

export function MobileEditor() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#07070b] text-zinc-100 select-none">
      <MobileTopBar />
      <MobilePreview />
      <MobileTimeline />
      <MobileDock />

      {/* Shared Modals */}
      <AiModal />
      <ExportDialog />
      <HelpModal />
      <Toasts />
    </div>
  );
}
