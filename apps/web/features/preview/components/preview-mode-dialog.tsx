"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Ban, CreditCard, Database, FlaskConical, KeyRound, Sparkles, Upload } from "lucide-react"
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
import { inter, teko } from "@/lib/core/fonts"

interface PreviewModeDialogProps {
  variant: "auth" | "app"
}

interface PreviewBullet {
  icon: typeof KeyRound
  text: string
}

const AUTH_BULLETS: PreviewBullet[] = [
  { icon: KeyRound, text: "Sign in with any email and password — no real account is created." },
  { icon: Ban, text: "Google/GitHub sign-in is disabled in preview." },
  { icon: Upload, text: "Document upload is disabled in preview." },
]

const APP_BULLETS: PreviewBullet[] = [
  { icon: Database, text: "Chats stay in this browser and clear with site data." },
  { icon: Sparkles, text: "AI results are simulated for testing." },
  { icon: CreditCard, text: "Upgrading is local-only — you will never be charged." },
]

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

  const eyebrow = variant === "auth" ? "Preview sign-in" : "Preview environment"
  const bullets = variant === "auth" ? AUTH_BULLETS : APP_BULLETS

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(v) }}>
      <AlertDialogContent className="relative my-2 max-h-[calc(100svh-2rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-md">
        <div aria-hidden="true" className="absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-70" />
        <AlertDialogHeader>
          <div className="flex items-start gap-3.5 pt-1 text-left">
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2.5 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-300">
              <FlaskConical size={20} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={cn("text-[11px] font-bold uppercase tracking-widest opacity-60", inter.className)}>
                {eyebrow}
              </span>
              <AlertDialogTitle className={cn("text-3xl font-medium leading-none tracking-wide", teko.className)}>
                Preview Mode
              </AlertDialogTitle>
            </div>
          </div>
          <AlertDialogDescription className="sr-only">
            This instance is running in preview mode for testing.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-3 rounded-xl border border-black/5 bg-neutral-50/80 p-4 sm:p-5 dark:border-white/10 dark:bg-white/5">
          {bullets.map((bullet) => (
            <li key={bullet.text} className="flex items-start gap-3">
              <bullet.icon size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
              <span className={cn("text-sm leading-relaxed text-neutral-700 dark:text-neutral-200", inter.className)}>
                {bullet.text}
              </span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter className="flex-row items-center justify-between gap-4 sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Checkbox id="dont-show-preview" checked={dontShow} onCheckedChange={(v) => setDontShow(v === true)} />
            <label htmlFor="dont-show-preview" className={cn("truncate text-[13px] text-muted-foreground cursor-pointer select-none", inter.className)}>
              Don&apos;t show this again
            </label>
          </div>
          <AlertDialogAction
            onClick={handleClose}
            className={cn("shrink-0 bg-gradient-to-r from-blue-600 to-purple-600 px-6 text-white border-0 tracking-wide text-lg", teko.className)}
          >
            GOT IT
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
