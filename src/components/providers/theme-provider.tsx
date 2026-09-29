"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Client boundary for theming.
 *
 * The `.dark` class lands on <html>, which only a client component can do
 * without a flash of the wrong theme. Everything below this provider is a
 * server component, so the cost of making the shell interactive stops here
 * rather than propagating down the tree.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
