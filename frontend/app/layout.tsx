import type { Metadata } from "next";
import { ThemeProvider } from "@/providers";
import { inter } from "@/lib/fonts";
import "./globals.css";
import { Footer } from "@/features/landing/footer";
import {Navigation} from "@/features/landing/navigation";

export const metadata: Metadata = {
  title: "Detect AI - AI Text Detection",
  description: "Detect AI generated text with high accuracy using advanced machine learning models.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Navigation />
          <main className="flex-grow pt-20">
            {children}
          </main>
          <Footer/>
        </ThemeProvider>
      </body>
    </html>
  );
}
