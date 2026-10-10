import type { Metadata } from "next";
import "./globals.css";
import { AuthGate } from "@/components/auth/auth-gate";

export const metadata: Metadata = {
  title: "Eureka Atlas",
  description: "Enterprise data semantic governance platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
