import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#7c3aed",
};

export const metadata: Metadata = {
  title: "直播剪辑 — 自动去静音加字幕",
  description: "上传直播视频，自动去除静音段落并添加中文字幕。在你自己的电脑上处理，安全隐私。",
  appleWebApp: {
    capable: true,
    title: "直播剪辑",
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-800">
        {children}
      </body>
    </html>
  );
}
