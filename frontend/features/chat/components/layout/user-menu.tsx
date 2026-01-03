"use client"

import { useSession, signOut } from "next-auth/react"
import { useTheme } from "next-themes"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import {
  User,
  LogOut,
  Sun,
  Moon,
  ChevronsUpDown,
  CircleFadingArrowUp
} from "lucide-react"
import { inter } from "@/lib/fonts"

import { useRouter } from "next/navigation"
import { useChatUIStore } from "../../stores/ui-store"

interface UserMenuProps {
  isCollapsed: boolean
}

export const UserMenu = ({ isCollapsed }: UserMenuProps) => {
  const router = useRouter()
  const { userType } = useChatUIStore()
  const { data: session } = useSession()
  const { setTheme, resolvedTheme } = useTheme()

  const user = session?.user

  const initials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
    : "U"

  const isDark = resolvedTheme === "dark"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-auto p-2 hover:bg-black/5 dark:hover:bg-white/5 w-full group",
            isCollapsed ? "justify-center" : "justify-start gap-3"
          )}
        >
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={user?.image || ""} alt={user?.name || "User"} />
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white font-medium text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>

          {!isCollapsed && (
            <>
              <div className="flex flex-col items-start text-left overflow-hidden flex-1 min-w-0">
                <span className={cn("text-sm font-medium truncate w-full text-foreground", inter.className)}>
                  {user?.name || "User"}
                </span>
                <span className="text-xs text-muted-foreground truncate w-full">
                  {user?.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60 p-1" sideOffset={8}>
        <DropdownMenuLabel className="font-normal px-2 py-1.5">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.name}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem className="cursor-pointer">
          <User className="mr-2 h-4 w-4" />
          <span>Profile</span>
        </DropdownMenuItem>

        {userType === "free" && (
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => router.push("/upgrade")}
          >
            <CircleFadingArrowUp className="mr-2 h-4 w-4" />
            <span>Upgrade Plan</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="cursor-pointer"
        >
          {isDark ? (
            <>
              <Sun className="mr-2 h-4 w-4" />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="mr-2 h-4 w-4" />
              <span>Dark Mode</span>
            </>
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/" })}
          className="cursor-pointer"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}