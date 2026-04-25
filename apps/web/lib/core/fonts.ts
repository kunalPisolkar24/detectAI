import { Merriweather, Inter, Teko } from "next/font/google";

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

export const teko = Teko({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"], 
  variable: "--font-teko",
  display: "swap",
});