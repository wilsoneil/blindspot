import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getAppContext } from "@/lib/app-data";
import { themesToCss } from "@/lib/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blindspot",
  description: "Find the gaps in your chess and train only those.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { settings } = await getAppContext();
  return (
    <html lang="en" data-theme={settings.theme}>
      <head>
        {/* Every theme's colours as CSS variables; data-theme on <html> picks one. */}
        <style>{themesToCss()}</style>
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">♞ Blindspot</Link>
            <nav className="nav">
              <Link href="/">Home</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
