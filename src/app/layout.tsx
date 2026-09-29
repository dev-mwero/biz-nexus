import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  Instrument_Sans,
} from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

/**
 * Three faces, three jobs.
 *
 * Instrument Sans carries headings — crisp and slightly condensed, so a panel
 * title reads as a label rather than a slogan. Geist handles UI and body copy
 * at the small sizes this density requires. IBM Plex Mono is the instrument
 * layer: every figure, identifier and timestamp, with tabular numerals so
 * columns of money align.
 *
 * The mono is loaded with only the 400 and 500 weights. It is used for data,
 * not for emphasis, and a second weight costs bytes for no reader benefit.
 */

const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BizNexus",
    template: "%s · BizNexus",
  },
  description:
    "A business operating system for small and medium-sized organisations. CRM, sales, finance, inventory and automation on one tenant-safe foundation.",
  applicationName: "BizNexus",
  robots: {
    // The authenticated application must never be indexed. The public
    // marketing surface sets its own directives.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c11" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
