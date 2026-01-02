export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {children}
      </div>
    </div>
  )
}