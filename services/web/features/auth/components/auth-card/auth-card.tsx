import type { ReactNode } from "react"

import { GradientDivider } from "@/components/ui/gradient-divider"
import { GlassPanel } from "@/components/ui/glass-panel"
import { AUTH_COPY } from "@/features/auth/constants"

import { AuthFooter } from "./auth-footer"
import { AuthHeader } from "./auth-header"
import { SocialButtons } from "./social-buttons"

interface AuthCardProps {
  label: string
  title: string
  backHref: string
  backLabel: string
  children: ReactNode
  showSocial?: boolean
}

export function AuthCard({
  label,
  title,
  backHref,
  backLabel,
  children,
  showSocial = true,
}: AuthCardProps) {
  return (
    <GlassPanel elevated className="w-full">
      <div className="space-y-6 p-6">
        <AuthHeader label={label} title={title} />
        {showSocial && (
          <div className="space-y-4">
            <SocialButtons />
            <div className="flex items-center gap-3">
              <GradientDivider className="flex-1" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {AUTH_COPY.social.divider}
              </span>
              <GradientDivider className="flex-1" />
            </div>
          </div>
        )}
        {children}
        <AuthFooter label={backLabel} href={backHref} />
      </div>
    </GlassPanel>
  )
}
