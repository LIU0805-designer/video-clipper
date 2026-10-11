/**
 * 静音检测 — 使用 FFmpeg silencedetect 滤镜
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { getFfmpegPath } from "./ffmpeg";

const execFileP = promisify(execFile);
const ffmpeg = getFfmpegPath();

export interface TimeSegment {
  start: number;
  end: number;
}

interface SilenceOptions {
  db: number;
  minDuration: number;
}

/**
 * 使用 FFmpeg silencedetect 检测静音段落
 *
 * 返回的是静音段列表（start/end）。
 * 调用方需要反转得到有声段。
 */
export async function detectSilence(
  inputPath: string,
  opts: SilenceOptions
): Promise<TimeSegment[]> {
  const { db, minDuration } = opts;

  // silencedetect 的输出在 stderr 上
  const { stderr } = await execFileP(ffmpeg, [
    "-y",
    "-i", inputPath,
    "-af", `silencedetect=noise=${db}dB:d=${minDuration}`,
    "-f", "null",
    "NUL",
  ]);

  const output = stderr;

  // 解析 silencedetect 输出
  // silence_start: 12.34
  // silence_end: 15.67 | silence_duration: 3.33
  const segments: TimeSegment[] = [];
  const startRegex = /silence_start:\s*([\d.]+)/g;
  const endRegex = /silence_end:\s*([\d.]+)/g;

  // 收集所有 silence_start
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = startRegex.exec(output)) !== null) {
    starts.push(parseFloat(match[1]));
  }

  // 收集所有 silence_end
  const ends: number[] = [];
  while ((match = endRegex.exec(output)) !== null) {
    ends.push(parseFloat(match[1]));
  }

  // 配对 start 和 end
  for (let i = 0; i < starts.length && i < ends.length; i++) {
    segments.push({ start: starts[i], end: ends[i] });
  }

  // 如果 start 比 end 多一个（最后一段静音没有 end）→ 忽略
  return segments;
}
