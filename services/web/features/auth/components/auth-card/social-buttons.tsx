import { Github01Icon, GoogleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { AUTH_COPY } from "@/features/auth/constants"

export function SocialButtons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Button type="button" variant="outline" size="lg" disabled className="w-full">
        <HugeiconsIcon
          icon={GoogleIcon}
          size={24}
          aria-hidden="true"
          className="size-6"
        />
        {AUTH_COPY.social.google}
      </Button>
      <Button type="button" variant="outline" size="lg" disabled className="w-full">
        <HugeiconsIcon
          icon={Github01Icon}
          size={24}
          aria-hidden="true"
          className="size-6"
        />
        {AUTH_COPY.social.github}
      </Button>
    </div>
  )
}
