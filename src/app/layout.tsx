import type { Metadata } from "next";
import { Lato } from "next/font/google";
import "./globals.css";
import { BusyCursor } from "@/components/busy-cursor";

// One typeface for body and headings (compact business-app look); the
// CSS variables keep their old names so every utility class still resolves.
const lato = Lato({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
});

const latoDisplay = Lato({
  variable: "--font-display-raw",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
});

export const metadata: Metadata = {
  title: "TrueQuote LV",
  description: "BOM, GA and costing tool for LV switchboard quoting",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${lato.variable} ${latoDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-on-surface">
        <BusyCursor />
        {children}
      </body>
    </html>
  );
}
