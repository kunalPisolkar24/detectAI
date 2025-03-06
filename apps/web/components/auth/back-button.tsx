import Link from "next/link"
import { Button } from '@workspace/ui/components/button'

export const BackButton = ({label, href}: any) => {
  return (
    <Button variant="link" className="font-normal w-full" size="sm" asChild>
      <Link href={href}>
        {label}
      </Link>
    </Button>
  )
}
