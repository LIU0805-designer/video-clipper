/**
 * 视频处理流水线
 *
 * 两种模式：
 * - silence: 去静音拼接（开箱即用，不依赖任何外部 API）
 * - content: 智能提取产品介绍（需百度 ASR + DeepSeek API）
 *
 * 字幕需先运行 npm run setup 下载 Whisper 模型。
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { getFfmpegPath } from "./ffmpeg";
import { detectSilence, type TimeSegment } from "./silence";
import { burnSubtitles } from "./subtitle";
import { recognizePcm } from "../asr/baidu";
import { classifySegments, type TranscriptSegment, type ClassifiedSegment } from "../ai/classify";

const execFileP = promisify(execFile);
const ffmpeg = getFfmpegPath();

/* ──── 类型 ──── */

export interface PipelineOptions {
  silenceDb?: number;
  silenceDuration?: number;
  padding?: number;
  /** 是否尝试生成字幕（需要 Whisper） */
  enableSubtitles?: boolean;
  whisperModel?: "small" | "medium" | "large-v3";
  onProgress?: (step: string, percent: number) => void;
}

export interface PipelineResult {
  outputPath: string;
  subtitles: string;
  segments: TimeSegment[];
  /** 字幕是否成功生成 */
  subtitlesEnabled: boolean;
}

/* ──── 内容筛选流水线类型 ──── */

export interface ContentPipelineOptions {
  silenceDb?: number;
  silenceDuration?: number;
  baiduApiKey: string;
  baiduSecretKey: string;
  onProgress?: (step: string, percent: number) => void;
}

export interface ContentPipelineResult {
  segments: ClassifiedSegment[];
  /** 只含产品介绍的片段 */
  productSegments: TimeSegment[];
  /** 产品介绍总时长（秒） */
  productDuration: number;
}

/* ──── 去静音流水线 ──── */

export async function runPipeline(
  inputPath: string,
  outputDir: string,
  opts: PipelineOptions = {}
): Promise<PipelineResult> {
  const {
    silenceDb = -30,
    silenceDuration = 1.5,
    padding = 0.3,
    enableSubtitles = false,
    whisperModel = "medium",
    onProgress,
  } = opts;

  const basename = path.basename(inputPath, path.extname(inputPath));
  const trimmedPath = path.join(outputDir, `${basename}_trimmed.mp4`);
  const finalPath = path.join(outputDir, `${basename}_final.mp4`);

  let subtitles = "";
  let subtitlesEnabled = false;

  /* ── 步骤 1（可选）：语音识别 ── */
  if (enableSubtitles) {
    try {
      const audioPath = path.join(outputDir, `${basename}_audio.wav`);
      onProgress?.("提取音频", 5);

      await execFileP(ffmpeg, [
        "-y", "-i", inputPath,
        "-vn", "-acodec", "pcm_s16le",
        "-ar", "16000", "-ac", "1",
        audioPath,
      ]);

      onProgress?.("语音识别（可能需要几分钟）", 10);

      const { transcribe } = await import("./transcribe");
      const result = await transcribe(audioPath, whisperModel);
      subtitles = result.subtitles;
      subtitlesEnabled = true;

      // 清理音频
      await fs.unlink(audioPath).catch(() => {});
    } catch (e: any) {
      console.warn("Whisper 不可用，跳過字幕生成:", e.message);
      onProgress?.("字幕生成跳过（Whisper未安装），继续去静音...", 15);
    }
  }

  /* ── 步骤 2：静音检测 ── */
  onProgress?.("检测静音段落", enableSubtitles ? 35 : 15);
  const silenceSegments = await detectSilence(inputPath, {
    db: silenceDb,
    minDuration: silenceDuration,
  });

  const speakingSegments = invertSegments(silenceSegments, Infinity);
  const bufferedSegments = addPadding(speakingSegments, padding);

  onProgress?.(
    `分析完成：检测到 ${silenceSegments.length} 段静音，保留 ${bufferedSegments.length} 段内容`,
    enableSubtitles ? 50 : 30
  );

  /* ── 步骤 3：切割 + 拼接 ── */
  onProgress?.("切割与拼接", enableSubtitles ? 55 : 40);
  await cutAndConcat(inputPath, bufferedSegments, trimmedPath);

  /* ── 步骤 4（可选）：烧录字幕 ── */
  if (subtitlesEnabled && subtitles) {
    onProgress?.("烧录字幕", 80);
    await burnSubtitles(trimmedPath, subtitles, finalPath);
    await fs.unlink(trimmedPath).catch(() => {});
  } else {
    // 无字幕，直接重命名
    await fs.rename(trimmedPath, finalPath);
  }

  onProgress?.("完成", 100);

  return {
    outputPath: finalPath,
    subtitles,
    segments: bufferedSegments,
    subtitlesEnabled,
  };
}

/* ──── 智能内容筛选流水线 ──── */

/**
 * 对视频进行语音识别 + AI 内容分类，提取产品介绍片段
 *
 * 流程：提取音频 → 静音检测 → 逐段 ASR → DeepSeek 分类 → 返回产品片段
 */
export async function runContentPipeline(
  inputPath: string,
  outputDir: string,
  opts: ContentPipelineOptions
): Promise<ContentPipelineResult> {
  const {
    silenceDb = -30,
    silenceDuration = 1.5,
    baiduApiKey,
    baiduSecretKey,
    onProgress,
  } = opts;

  const basename = path.basename(inputPath, path.extname(inputPath));
  const pcmPath = path.join(outputDir, `${basename}_full.pcm`);

  // 步骤 1: 提取完整音频为原始 PCM（16kHz, 16bit, mono）
  onProgress?.("提取音频中...", 2);
  await execFileP(ffmpeg, [
    "-y", "-i", inputPath, "-vn",
    "-f", "s16le", "-acodec", "pcm_s16le",
    "-ar", "16000", "-ac", "1",
    pcmPath,
  ]);

  // 步骤 2: 静音检测，找到有声段落
  onProgress?.("检测有声段落...", 5);
  const silenceSegments = await detectSilence(inputPath, {
    db: silenceDb,
    minDuration: silenceDuration,
  });
  const duration = await getVideoDuration(inputPath);
  const speaking = invertSegments(silenceSegments, duration);
  const buffered = addPadding(speaking, 0.5);

  const totalSpeaking = buffered
    .filter((s) => isFinite(s.end) && isFinite(s.start))
    .reduce((sum, s) => sum + (s.end - s.start), 0);
  onProgress?.(`检测到 ${buffered.length} 段有声内容，共 ${totalSpeaking > 0 ? formatDuration(totalSpeaking) : "未知时长"}`, 8);

  // 步骤 3: 逐段语音识别
  const pcmBuffer = await fs.readFile(pcmPath);
  const BYTES_PER_SEC = 16000 * 2; // 16kHz * 2 bytes (s16le)
  const CHUNK_SECS = 55; // 百度短语音限制 60s，留 5s 余量

  const allTranscripts: TranscriptSegment[] = [];
  let segIndex = 0;

  for (const seg of buffered) {
    const byteStart = Math.floor(seg.start * BYTES_PER_SEC);
    const byteEnd = Math.min(Math.ceil(seg.end * BYTES_PER_SEC), pcmBuffer.length);
    if (byteEnd <= byteStart) continue;

    let chunkStart = byteStart;
    let chunkNum = 0;

    while (chunkStart < byteEnd) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SECS * BYTES_PER_SEC, byteEnd);
      const chunk = pcmBuffer.subarray(chunkStart, chunkEnd);
      const chunkStartSec = seg.start + chunkNum * CHUNK_SECS;
      const chunkEndSec = chunkStartSec + (chunk.length / BYTES_PER_SEC);

      const progressPct = 10 + Math.floor((segIndex / buffered.length) * 35);
      onProgress?.(`语音识别 ${segIndex + 1}/${buffered.length} 段${chunkNum > 0 ? ` (续${chunkNum})` : ""}...`, progressPct);

      try {
        const text = await recognizePcm(Buffer.from(chunk), baiduApiKey, baiduSecretKey);
        if (text && text.trim()) {
          allTranscripts.push({
            index: segIndex,
            start: chunkStartSec,
            end: chunkEndSec,
            text: text.trim(),
          });
        }
      } catch (e: any) {
        console.warn(`ASR 片段 ${segIndex} 失败:`, e.message);
      }

      chunkStart = chunkEnd;
      chunkNum++;
    }
    segIndex++;
  }

  // 清理 PCM 文件
  await fs.unlink(pcmPath).catch(() => {});

  if (!allTranscripts.length) {
    onProgress?.("未识别到任何语音内容", 100);
    return { segments: [], productSegments: [], productDuration: 0 };
  }

  onProgress?.(`语音识别完成，共 ${allTranscripts.length} 段文本`, 45);

  // 步骤 4: 合并同一原始片段的子块
  const merged = mergeTranscriptChunks(allTranscripts);
  onProgress?.(`合并为 ${merged.length} 个段落`, 48);

  // 步骤 5: DeepSeek 分类
  onProgress?.("AI 分析内容类型...", 50);
  const classified = await classifySegments(merged, (msg) => onProgress?.(msg, 55));

  // 步骤 6: 筛选产品介绍片段
  const productOnly = classified.filter((s) => s.type === "product");
  const productSegments: TimeSegment[] = productOnly.map((s) => ({
    start: s.start,
    end: s.end,
  }));
  const productDuration = productSegments.reduce((sum, s) => sum + (s.end - s.start), 0);

  const chatCount = classified.filter((s) => s.type === "chat").length;
  const productCount = productOnly.length;

  onProgress?.(
    `分析完成：${productCount} 段产品介绍（${formatDuration(productDuration)}），${chatCount} 段闲聊已过滤`,
    60
  );

  return { segments: classified, productSegments, productDuration };
}

/* ──── 辅助函数 ──── */

function invertSegments(silence: TimeSegment[], totalDuration: number): TimeSegment[] {
  if (silence.length === 0) return [{ start: 0, end: totalDuration }];
  const speaking: TimeSegment[] = [];
  let cursor = 0;
  for (const s of silence) {
    if (s.start > cursor + 0.1) speaking.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < totalDuration - 0.1) speaking.push({ start: cursor, end: totalDuration });
  return speaking;
}

function addPadding(segments: TimeSegment[], pad: number): TimeSegment[] {
  return segments.map((s) => ({ start: Math.max(0, s.start - pad), end: s.end + pad }));
}

async function cutAndConcat(
  inputPath: string,
  segments: TimeSegment[],
  outputPath: string
): Promise<void> {
  if (segments.length === 0) throw new Error("没有可以保留的片段");

  // 获取视频实际时长
  const duration = await getVideoDuration(inputPath);

  if (segments.length === 1) {
    const s = segments[0];
    const args = buildCutArgs(s, duration, inputPath, outputPath);
    await execFileP(ffmpeg, args);
    return;
  }

  const concatDir = path.dirname(outputPath);
  const concatFile = path.join(concatDir, "concat_list.txt");
  const segmentFiles: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const segPath = path.join(concatDir, `_seg_${i}.ts`);
    segmentFiles.push(segPath);
    const args = buildCutArgs(s, duration, inputPath, segPath, true);
    await execFileP(ffmpeg, args);
  }

  const concatContent = segmentFiles.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n");
  await fs.writeFile(concatFile, concatContent);

  await execFileP(ffmpeg, [
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatFile, "-c", "copy", outputPath,
  ]);

  await fs.unlink(concatFile).catch(() => {});
  for (const f of segmentFiles) await fs.unlink(f).catch(() => {});
}

/** 获取视频实际时长（秒） */
async function getVideoDuration(inputPath: string): Promise<number> {
  try {
    const { getFfprobePath } = await import("./ffmpeg");
    const ffprobe = getFfprobePath();
    const { stdout } = await execFileP(ffprobe, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", inputPath,
    ]);
    return parseFloat(stdout.trim()) || Infinity;
  } catch {
    return Infinity;
  }
}

/** 构建切割命令参数，处理末尾 Infinity 的情况 */
function buildCutArgs(
  s: TimeSegment,
  duration: number,
  inputPath: string,
  outputPath: string,
  forceTs?: boolean
): string[] {
  const end = isFinite(s.end) ? s.end : duration;
  const args = ["-y", "-ss", String(s.start)];
  if (isFinite(end)) {
    args.push("-to", String(end));
  }
  args.push("-i", inputPath);
  if (forceTs) {
    args.push("-c", "copy", "-f", "mpegts");
  } else {
    args.push("-c", "copy");
  }
  args.push(outputPath);
  return args;
}

/** 将同一原始片段的 ASR 子块合并 */
function mergeTranscriptChunks(chunks: TranscriptSegment[]): TranscriptSegment[] {
  if (!chunks.length) return [];

  const merged: TranscriptSegment[] = [];
  let current = { ...chunks[0] };

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];
    if (next.index === current.index) {
      // 同一原始片段：合并文本，扩展时间范围
      current.end = next.end;
      current.text = current.text + " " + next.text;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

/** 格式化秒数为 mm:ss */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}
