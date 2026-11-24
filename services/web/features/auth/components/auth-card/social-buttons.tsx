import { Github01Icon, GoogleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { AUTH_COPY } from "@/features/auth/constants"

export function SocialButtons() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Button type="button" variant="outline" size="lg" disabled className="w-full">
        <HugeiconsIcon icon={GoogleIcon} size={18} aria-hidden="true" />
        {AUTH_COPY.social.google}
      </Button>
      <Button type="button" variant="outline" size="lg" disabled className="w-full">
        <HugeiconsIcon icon={Github01Icon} size={18} aria-hidden="true" />
        {AUTH_COPY.social.github}
      </Button>
    </div>
  )
}
