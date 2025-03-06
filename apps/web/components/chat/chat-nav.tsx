// "use client";

// import React, { useEffect, useState } from "react";
// import { Logo } from "@/components/common";
// import Link from "next/link";
// import { Button } from "@workspace/ui/components/button";
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuTrigger,
// } from "@workspace/ui/components/dropdown-menu";
// import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
// import { ChatTheme } from "./chat-theme";

// import ChangeModel from "./change-model";

// export const ChatNav = () => {
//   const [isMobile, setIsMobile] = useState(false);

//   const [isUserLoggedIn, setIsUserLoggedIn] = useState(true);


//   // Check if the screen is mobile or tablet
//   useEffect(() => {
//     const handleResize = () => {
//       setIsMobile(window.innerWidth <= 768); // You can adjust this based on your needs
//     };

//     handleResize(); // Initialize on mount
//     window.addEventListener("resize", handleResize);

//     return () => window.removeEventListener("resize", handleResize);
//   }, []);

//   return (
//     <div className="w-full bg-background/80 dark:bg-muted/50 backdrop-blur-md fixed top-0 px-8 py-2 z-50 shadow-sm overflow-hidden">
//       <header className="container mx-auto flex items-center justify-between">
//         <Logo />

//         {/* ✅ Right section: Sign-in (desktop) + Avatar (both mobile & desktop) */}
//         <div className="flex items-center gap-4 ml-auto">
//           {/* Show Sign-in button only if user is NOT logged in */}
//           {!isUserLoggedIn && (
//             <Link
//               href="/auth/signup"
//               className="text-sm font-medium hover:underline underline-offset-4 hidden md:block"
//             >
//               <Button className="border" variant="secondary">
//                 Sign in
//               </Button>
//             </Link>
//           )}

//           {/* Avatar stays at top right on mobile */}
//           {isUserLoggedIn && (
//             <DropdownMenu>
//               <DropdownMenuTrigger asChild>
//                 <Avatar className="cursor-pointer">
//                   <AvatarImage
//                     src="https://github.com/shadcn.png"
//                     alt="@shadcn"
//                   />
//                   <AvatarFallback>CN</AvatarFallback>
//                 </Avatar>
//               </DropdownMenuTrigger>
//               <DropdownMenuContent align="end" className="w-48 mt-3 z-50">
//                 <DropdownMenuItem asChild>
//                   <Link href="/profile">Profile</Link>
//                 </DropdownMenuItem>
//                 <DropdownMenuItem asChild>
//                   <Link href="/settings">Settings</Link>
//                 </DropdownMenuItem>
//                 {/* <DropdownMenuItem asChild>
//                   <Link href="/pricing">Pricing</Link>
//                 </DropdownMenuItem> */}
//                 <ChatTheme />
//                 <DropdownMenuItem asChild>
//                   <Link href="/login">Sign Out</Link>
//                 </DropdownMenuItem>
//               </DropdownMenuContent>
//             </DropdownMenu>
//           )}

//           {isMobile && (
//             <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-10">
//               <ChangeModel />
//             </div>
//           )}
//         </div>
//       </header>
//     </div>
//   );
// };

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
import { Sun, Moon, User, Settings, LogOut } from "lucide-react";
import ChangeModel from "./change-model";

export const ChatNav = () => {
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

  if (!session) return null; // Only authenticated users can access this page

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
                <Link href="/profile" className="flex items-center gap-2">
                  <User size={16} /> Profile
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
          {isMobile && (
            <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-10">
              <ChangeModel />
            </div>
          )}
        </div>
      </header>
    </div>
  );
};
