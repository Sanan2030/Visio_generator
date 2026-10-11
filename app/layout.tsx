import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "VisioFlow — İş axınını vizuallaşdır",
  description: "Canlı iş axını redaktoru. Fiqurları sürüklə, keçidlərə izah yaz, diaqramı Visio və izah cədvəlini Word üçün yüklə.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="az"><body>{children}</body></html>;
}
