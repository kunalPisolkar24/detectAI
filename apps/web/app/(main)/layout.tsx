import { Sidebar } from "@/features/chat/components/layout/sidebar"
import { MobileHeader } from "@/features/chat/components/layout/mobile-header"
import { PreviewModeDialog } from "@/features/preview/components/preview-mode-dialog"

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <MobileHeader />
        {children}
      </div>
      <PreviewModeDialog variant="app" />
    </div>
  )
}