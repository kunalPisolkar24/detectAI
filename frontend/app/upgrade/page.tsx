import type { Metadata } from "next"
import { UpgradeView } from "@/features/upgrade/components/upgrade-view"

export const metadata: Metadata = {
  title: "Upgrade Plan | Detect AI",
  description: "Choose a plan that fits your needs",
}

export default function UpgradePage() {
  return <UpgradeView />
}