/**
 * FFmpeg 路径解析
 *
 * 直接从 node_modules 找到 @ffmpeg-installer 提供的二进制文件，
 * 避免 dynamic require() 与 Turbopack 的兼容问题。
 */

import path from "path";
import fs from "fs";

let _ffmpegPath: string | null = null;
let _ffprobePath: string | null = null;

/**
 * 向上遍历目录，找到 node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe
 */
function findFfmpegBinary(): string | null {
  const binary = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  // 从多个起点向上搜索 node_modules
  const startDirs = [process.cwd(), __dirname];

  for (const start of startDirs) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(dir, "node_modules", "@ffmpeg-installer", "win32-x64", binary);
      if (fs.existsSync(candidate)) return candidate;

      // also check @ffmpeg-installer/ffmpeg's node_modules (npm2 style)
      const npm2 = path.join(dir, "node_modules", "@ffmpeg-installer", "ffmpeg", "node_modules", "@ffmpeg-installer", "win32-x64", binary);
      if (fs.existsSync(npm2)) return npm2;

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function getFfmpegPath(): string {
  if (_ffmpegPath) return _ffmpegPath;

  // 1. 直接查找 @ffmpeg-installer 二进制
  const bundled = findFfmpegBinary();
  if (bundled) {
    _ffmpegPath = bundled;
    return bundled;
  }

  // 2. 回退到系统 PATH
  _ffmpegPath = "ffmpeg";
  return "ffmpeg";
}

export function getFfprobePath(): string {
  if (_ffprobePath) return _ffprobePath;

  const ffmpeg = getFfmpegPath();
  if (ffmpeg !== "ffmpeg") {
    const dir = path.dirname(ffmpeg);
    const probeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    const probePath = path.join(dir, probeName);
    if (fs.existsSync(probePath)) {
      _ffprobePath = probePath;
      return probePath;
    }
  }

  _ffprobePath = "ffprobe";
  return "ffprobe";
}
