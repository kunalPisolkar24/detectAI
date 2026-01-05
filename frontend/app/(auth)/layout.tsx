import { ReactNode } from "react"

interface AuthLayoutProps {
  children: ReactNode
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-background relative overflow-hidden">
      <div className="absolute inset-0 -z-10 overflow-hidden opacity-20 pointer-events-none">
        <div className="absolute top-1/4 -left-24 w-96 h-96 rounded-full blur-3xl bg-purple-500/20" />
        <div className="absolute bottom-1/4 -right-24 w-96 h-96 rounded-full blur-3xl bg-blue-500/20" />
      </div>

      <div className="w-full max-w-md space-y-8 z-10">
        {children}
      </div>
    </div>
  )
}