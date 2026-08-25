import "./globals.css";

export const metadata = { title: "LOGGLYPH Pilot", description: "LOGGLYPH conversation pilot" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
