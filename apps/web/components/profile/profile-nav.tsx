"use client";

import React, { useEffect, useState } from "react";
import { Logo } from "@/components/common";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import { useTheme } from "next-themes";
import { useSession, signOut } from "next-auth/react";
import { Sun, Moon, User, Settings, LogOut, MessageCircle } from "lucide-react";

export const ProfileNav = () => {
  const [isMobile, setIsMobile] = useState(false);
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const getUserInitials = (name: string | undefined) => {
    if (!name) return "U";
    return name.split(" ").map((word) => word[0]).join("");
  };

  if (!session) return null;

  return (
    <div className="w-full bg-background/80 dark:bg-muted/50 backdrop-blur-md fixed top-0 px-8 py-2 z-50 shadow-sm">
      <header className="container mx-auto flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-4 ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="cursor-pointer">
                {session.user?.image ? (
                  <AvatarImage src={session.user.image} alt={session.user.name || "User"} />
                ) : (
                    // @ts-ignore
                  <AvatarFallback>{getUserInitials(session.user?.name)}</AvatarFallback>
                )}
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 mt-3 z-50">
              <DropdownMenuItem asChild className="flex items-center gap-2">
                <Link href="/chat" className="flex items-center gap-2">
                  <MessageCircle size={16} /> Chat
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="flex items-center gap-2">
                <Link href="/settings" className="flex items-center gap-2">
                  <Settings size={16} /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="flex items-center gap-2"
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                {theme === "dark" ? "Light Mode" : "Dark Mode"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/" })}
                className="flex items-center gap-2 text-red-500"
              >
                <LogOut size={16} /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </div>
  );
};
