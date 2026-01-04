"use client"

import { useState } from "react"
import { m, AnimatePresence } from "framer-motion"
import { User, CreditCard } from "lucide-react"

import { cn } from "@/lib/utils"
import { teko } from "@/lib/fonts"
import { GeneralTab } from "./general-tab"
import { BillingTab } from "./billing-tab"

type TabType = "general" | "billing"

interface ProfileViewProps {
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
    image: string | null
    createdAt: Date
    isPremium: boolean
    apiCallCountDaily: number
    apiCallCountTotal: number
    subscriptionEndsAt: Date | null
    paddleSubscriptionStatus: string | null
  }
}

// 1. Define tabs configuration outside to avoid recreation
const TABS = [
  { id: "general", label: "General", icon: User },
  { id: "billing", label: "Billing", icon: CreditCard },
] as const

// 2. Extract Sidebar into its own component
interface SidebarNavProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
}

const SidebarNav = ({ activeTab, onTabChange }: SidebarNavProps) => {
  return (
    <nav className="flex flex-col space-y-1">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id as TabType)}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              isActive
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            <Icon size={16} />
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}

export const ProfileView = ({ user }: ProfileViewProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("general")

  return (
    <div className="flex flex-col md:flex-row gap-8 lg:gap-12 min-h-[calc(100vh-100px)]">
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-60 shrink-0 space-y-6">
        <h1 className={cn("text-3xl font-bold px-2", teko.className)}>Settings</h1>
        <SidebarNav activeTab={activeTab} onTabChange={setActiveTab} />
      </aside>

      {/* Mobile Navigation */}
      <div className="md:hidden flex flex-col space-y-4 mb-4">
        <h1 className={cn("text-3xl font-bold", teko.className)}>Settings</h1>
        <nav className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap",
                  isActive
                    ? "bg-secondary text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Content Area */}
      <main className="flex-1 max-w-2xl">
        <AnimatePresence mode="wait">
          {activeTab === "general" ? (
            <m.div
              key="general"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <GeneralTab user={user} />
            </m.div>
          ) : (
            <m.div
              key="billing"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <BillingTab user={user} />
            </m.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}