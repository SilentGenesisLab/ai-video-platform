import type { Metadata } from "next";
import "./globals.css";
import "./account.css";
import "./dark.css";
import "./visual.css";
import ThemePreferences from "@/components/theme-preferences";
export const metadata: Metadata = {
  title: "Frameflow · TVC 广告片制作工作室",
  description:
    "从产品需求到完整广告片。连接 Brief、创意策划、工业分镜、视觉资产、视频片段与成片交付，让团队与 Agent 在同一间 TVC 制作工作室协作。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <ThemePreferences />
        {children}
      </body>
    </html>
  );
}
