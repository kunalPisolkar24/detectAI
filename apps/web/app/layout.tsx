import { Geist, Geist_Mono } from "next/font/google";
import "@workspace/ui/styles/globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";
import { CustomSessionProvider } from "@/lib/custom-session-provider";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontSans.variable} ${fontMono.variable} font-sans antialiased `}
      >
        <Providers>
          <CustomSessionProvider>{children}</CustomSessionProvider>
        </Providers>
        <Toaster richColors />
      </body>
    </html>
  );
}
