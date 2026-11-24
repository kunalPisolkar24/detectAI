import { ArrowLeft } from "lucide-react"

import { TextLink } from "@/components/ui/text-link"

interface AuthFooterProps {
  label: string
  href: string
}

export function AuthFooter({ label, href }: AuthFooterProps) {
  return (
    <div className="text-center">
      <TextLink href={href}>
        <ArrowLeft className="size-3" aria-hidden="true" />
        {label}
      </TextLink>
    </div>
  )
}
