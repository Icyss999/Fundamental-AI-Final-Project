import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Shantell_Sans } from "next/font/google";
import { SessionRoot } from "@/components/app/session";
import "./globals.css";

// Lettering (the name, headings, the narrator): made for comic lettering, with a bounce axis.
const shantell = Shantell_Sans({
  variable: "--font-shantell",
  subsets: ["latin"],
  axes: ["BNCE", "INFM"],
});

// Reading and controls: designed for legibility (distinct Il1 and 0O).
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
});

// File paths and code.
const atkinsonMono = Atkinson_Hyperlegible_Mono({
  variable: "--font-atkinson-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kosmos",
  description: "Paste a repository and see how its code is organised, where bugs likely hide, and how to tidy it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${shantell.variable} ${atkinson.variable} ${atkinsonMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {/* The analysis and the AI's work live above the pages, so they carry from the waiting screen to the map. */}
        <SessionRoot>{children}</SessionRoot>
      </body>
    </html>
  );
}
