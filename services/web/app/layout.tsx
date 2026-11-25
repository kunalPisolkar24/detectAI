import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { inter, merriweather, teko } from "@/lib/fonts";
import { MotionProvider } from "@/providers/motion-provider";
import { QueryProvider } from "@/providers/query-provider";
import { SessionProvider } from "@/providers/session-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "DetectAI",
  description: "DetectAI web application",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${teko.variable} ${merriweather.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <MotionProvider>
            <QueryProvider>
              <SessionProvider>
                <TooltipProvider>{children}</TooltipProvider>
              </SessionProvider>
            </QueryProvider>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
