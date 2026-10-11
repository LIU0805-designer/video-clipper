/**
 * 语音识别 — 使用 Whisper.cpp
 *
 * Windows 环境下需要：
 *   1. whisper-cli.exe 放在 tools/whisper/ 目录下
 *   2. GGML 模型文件放在 tools/whisper/models/ 目录下
 *
 * 运行 npm run setup 会自动下载。
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileP = promisify(execFile);

/* ──── 工具路径 ──── */

const PROJECT_ROOT = path.resolve(process.cwd());
const WHISPER_DIR = path.join(PROJECT_ROOT, "tools", "whisper");
const MODELS_DIR = path.join(WHISPER_DIR, "models");

function getWhisperExe(): string {
  const exePath = path.join(WHISPER_DIR, "whisper-cli.exe");
  if (!fs.existsSync(exePath)) {
    throw new Error(
      `Whisper.cpp 未安装。请运行:\n  npm run setup\n\n` +
        `或手动下载:\n` +
        `  1. whisper.cpp Windows 版: https://github.com/ggerganov/whisper.cpp/releases\n` +
        `  2. 将 whisper-cli.exe 放到 ${WHISPER_DIR}\n` +
        `  3. 将模型文件放到 ${MODELS_DIR}`
    );
  }
  return exePath;
}

function getModelPath(model: string): string {
  const modelFile = path.join(MODELS_DIR, `ggml-${model}.bin`);
  if (!fs.existsSync(modelFile)) {
    throw new Error(
      `Whisper 模型 ${model} 未找到。请运行:\n  npm run setup\n\n` +
        `或手动下载模型文件到 ${modelFile}\n` +
        `下载地址: https://huggingface.co/ggerganov/whisper.cpp/tree/main`
    );
  }
  return modelFile;
}

/* ──── 类型 ──── */

export interface TranscriptionResult {
  /** 完整文本 */
  text: string;
  /** SRT 格式字幕 */
  subtitles: string;
  /** 带时间戳的片段 */
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/* ──── 语音识别 ──── */

export async function transcribe(
  audioPath: string,
  model: "small" | "medium" | "large-v3" = "medium"
): Promise<TranscriptionResult> {
  const whisperExe = getWhisperExe();
  const modelPath = getModelPath(model);

  const outputBase = audioPath.replace(/\.wav$/i, "");

  // whisper-cli -m <model> -f <audio> -of <output_base> -osrt -otxt
  const { stdout, stderr } = await execFileP(whisperExe, [
    "-m", modelPath,
    "-f", audioPath,
    "-of", outputBase,
    "-osrt",     // 生成 .srt 字幕
    "-otxt",     // 生成 .txt 全文
    "-l", "zh",  // 中文
    "--print-progress",
  ]);

  // 读取生成的字幕文件
  const srtPath = outputBase + ".srt";
  let subtitles = "";
  try {
    subtitles = fs.readFileSync(srtPath, "utf-8");
  } catch {
    subtitles = "";
  }

  // 读取全文
  const txtPath = outputBase + ".txt";
  let text = "";
  try {
    text = fs.readFileSync(txtPath, "utf-8");
  } catch {
    text = "";
  }

  // 解析 SRT 得到片段
  const segments = parseSRT(subtitles);

  // 清理临时文件
  try { fs.unlinkSync(srtPath); } catch {}
  try { fs.unlinkSync(txtPath); } catch {}

  return { text, subtitles, segments };
}

/* ──── SRT 解析 ──── */

function parseSRT(srt: string): Array<{ start: number; end: number; text: string }> {
  const segments: Array<{ start: number; end: number; text: string }> = [];
  const blocks = srt.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    // 第二行是时间戳：00:00:01,234 --> 00:00:03,456
    const timeMatch = lines[1]?.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!timeMatch) continue;

    const start =
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000;

    const end =
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000;

    // 剩余行是字幕文本
    const text = lines.slice(2).join(" ").trim();
    if (text) {
      segments.push({ start, end, text });
    }
  }

  return segments;
}
