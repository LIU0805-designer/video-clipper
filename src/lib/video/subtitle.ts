/**
 * 字幕烧录 — 使用 FFmpeg subtitles 滤镜
 *
 * 将 SRT 字幕硬编码到视频画面中。
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { getFfmpegPath } from "./ffmpeg";

const execFileP = promisify(execFile);
const ffmpeg = getFfmpegPath();

export async function burnSubtitles(
  videoPath: string,
  subtitles: string,
  outputPath: string
): Promise<void> {
  if (!subtitles.trim()) {
    // 没有字幕内容，直接复制视频
    await fs.copyFile(videoPath, outputPath);
    return;
  }

  // 写入临时 SRT 文件
  const srtPath = videoPath.replace(/\.mp4$/i, "_temp.srt");
  await fs.writeFile(srtPath, subtitles, "utf-8");

  // FFmpeg 路径在 Windows 上需要特殊处理
  // subtitles 滤镜需要转义冒号和反斜杠
  const escapedPath = srtPath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:");

  try {
    await execFileP(ffmpeg, [
      "-y",
      "-i", videoPath,
      "-vf", `subtitles='${escapedPath}':force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2'`,
      "-c:v", "libx264",
      "-crf", "23",
      "-preset", "medium",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart", // 适合手机播放
      outputPath,
    ]);
  } finally {
    // 清理临时 SRT
    await fs.unlink(srtPath).catch(() => {});
  }
}
