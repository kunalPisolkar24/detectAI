import { Merriweather, Inter } from "next/font/google";

export const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
  variable: "--font-merriweather",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});