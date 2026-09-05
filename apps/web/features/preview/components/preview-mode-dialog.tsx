"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { isPreviewModeClient, shouldShowPreviewNotice, setPreviewDontShowNotice } from "@/lib/config/preview"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/core/utils"
import { teko } from "@/lib/core/fonts"

interface PreviewModeDialogProps {
  variant: "auth" | "app"
}

export const PreviewModeDialog = ({ variant }: PreviewModeDialogProps) => {
  const isPreview = isPreviewModeClient()
  const { status } = useSession()
  const [open, setOpen] = useState(false)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    if (!isPreview) return
    if (variant === "app" && status !== "authenticated") return
    // Delay to allow hydration
    const timer = setTimeout(() => {
      if (shouldShowPreviewNotice()) {
        setOpen(true)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [isPreview, variant, status])

  const handleClose = () => {
    if (dontShow) setPreviewDontShowNotice(true)
    setOpen(false)
  }

  if (!isPreview) return null
  if (variant === "app" && status !== "authenticated") return null

  const title = variant === "auth" ? "Preview Mode — Testing Credentials" : "You are in Preview Mode"
  const description =
    variant === "auth"
      ? "This instance is running in preview mode for testing. You can sign in or sign up with any email and password — no real account is created. Google/GitHub sign-in and document upload are disabled."
      : "This instance is running in preview mode. Chats are stored locally in your browser (IndexedDB) and AI results are simulated. Upgrading is local-only and does not charge. Data clears if you clear site data."

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(v) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={cn(teko.className, "text-xl")}>{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2 py-2">
          <Checkbox id="dont-show-preview" checked={dontShow} onCheckedChange={(v) => setDontShow(v === true)} />
          <label htmlFor="dont-show-preview" className="text-sm text-muted-foreground cursor-pointer select-none">
            Don&apos;t show this again
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleClose} className={cn(teko.className, "text-base")}>
            Got it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
