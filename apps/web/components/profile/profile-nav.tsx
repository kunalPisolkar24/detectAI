"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import { cn } from "@workspace/ui/lib/utils"
import { Logo } from "@/components/common"
import { useSession, signOut } from "next-auth/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import {
  Sun,
  Moon,
  LogOut,
  MessageCircle,
  User,
} from "lucide-react"

export const ProfileNav = () => {
  const [mounted, setMounted] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const { data: session }: any = useSession()

  useEffect(() => {
    setMounted(true)
  }, [])

  const getUserInitials = (name: string | undefined) => {
    if (!name) return "U"
    return name.split(" ").map((word) => word[0]).join("").toUpperCase()
  }

  if (!mounted || !session) return null

  return (
    <motion.div
      className={cn(
        "w-full fixed top-0 z-50 left-0 right-0 transition-all duration-300",
        theme === "dark"
          ? "bg-black/80 backdrop-blur-md shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
          : "bg-white/80 backdrop-blur-md shadow-[0_2px_10px_rgba(0,0,0,0.1)]"
      )}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <header className="container mx-auto flex items-center justify-between py-2 px-4 sm:px-6">
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Logo />
        </motion.div>

        <motion.div
          className="flex items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <DropdownMenu onOpenChange={setIsDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <motion.div
                className="flex items-center gap-2 cursor-pointer"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <Avatar
                  className={cn(
                    "h-9 w-9 transition-all duration-300 border-2",
                    isDropdownOpen
                      ? theme === "dark" ? "border-blue-400" : "border-blue-600"
                      : theme === "dark" ? "border-white/20 hover:border-white/40" : "border-black/10 hover:border-black/30",
                  )}
                >
                  {session.user?.image ? (
                    <AvatarImage src={session.user.image} alt={session.user.name || "User"} className="object-cover" />
                  ) : (
                    <AvatarFallback className={cn("select-none", theme === "dark" ? "bg-gradient-to-br from-blue-600 to-purple-600 text-white" : "bg-gradient-to-br from-blue-500 to-purple-500 text-white")}>
                      {getUserInitials(session.user?.name)}
                    </AvatarFallback>
                  )}
                </Avatar>
              </motion.div>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                align="end"
                className={cn("w-56 mt-2 p-1.5 z-50 border", theme === "dark" ? "bg-black/90 border-white/10" : "bg-white/95 border-black/10")}
            >
              <div className="px-2 py-1.5 mb-1">
                <p className={cn("text-sm font-medium truncate", theme === "dark" ? "text-white" : "text-black")}>
                  {session.user?.name || "User"}
                </p>
                <p className={cn("text-xs truncate", theme === "dark" ? "text-neutral-400" : "text-neutral-600")}>
                  {session.user?.email || ""}
                </p>
              </div>
              <DropdownMenuSeparator className={theme === "dark" ? "bg-white/10 my-1" : "bg-black/10 my-1"} />
              <DropdownMenuItem asChild className="p-0">
                <Link href="/chat" className="flex items-center gap-2 cursor-pointer w-full px-2 py-1.5 rounded-[inherit]">
                    <MessageCircle size={16} className={theme === "dark" ? "text-blue-400" : "text-blue-600"} />
                    <span>Chat</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                 onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                 className="flex items-center gap-2 cursor-pointer w-full px-2 py-1.5"
              >
                 {theme === "dark" ? ( <><Sun size={16} className="text-blue-400" /><span>Light Mode</span></> ) :
                                       ( <><Moon size={16} className="text-blue-600" /><span>Dark Mode</span></> ) }
              </DropdownMenuItem>
              <DropdownMenuSeparator className={theme === "dark" ? "bg-white/10 my-1" : "bg-black/10 my-1"} />
              <DropdownMenuItem
                 onClick={() => signOut({ callbackUrl: "/" })}
                 className="flex items-center gap-2 cursor-pointer w-full px-2 py-1.5 text-red-500 focus:bg-red-500/10 focus:text-red-600 dark:focus:text-red-400"
              >
                 <LogOut size={16} />
                 <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </motion.div>
      </header>
    </motion.div>
  )
}