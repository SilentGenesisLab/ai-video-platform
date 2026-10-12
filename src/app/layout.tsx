import type { Metadata } from "next";
import "./globals.css";
import "./account.css";
export const metadata: Metadata = {
  title: "Frameflow · AI 视频工作台",
  description: "从产品洞察到成片交付，让每一步创作有迹可循。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
