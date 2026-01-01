import type { Metadata } from "next";
import { ThemeProvider } from "@/providers";
import { LazyMotionProvider } from "@/components/providers/lazy-motion-provider";
import { Toaster } from "@/components/ui/sonner"; 
import { inter } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Detect AI - AI Text Detection",
  description: "Detect AI generated text with high accuracy.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased min-h-screen flex flex-col`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <LazyMotionProvider>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </LazyMotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}