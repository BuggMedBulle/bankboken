import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bankboken — Helo & Halvis",
  description: "En enkel, privat utgiftsbok för Helo och Halvis.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sv"><body className={manrope.variable}>{children}</body></html>;
}
