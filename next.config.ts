import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许上传大视频文件（最大 2GB）
  serverExternalPackages: [],
  // 允许手机通过 WiFi 访问开发服务器
  allowedDevOrigins: ["192.168.2.4", "localhost"],
  experimental: {
    // Next.js 16 App Router 默认支持大文件上传
  },
};

export default nextConfig;
