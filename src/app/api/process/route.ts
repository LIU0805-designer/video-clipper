/**
 * POST /api/process
 *
 * 接收视频文件 → 处理 → 返回下载链接
 * 通过 SSE 推送实时进度。
 *
 * mode=content: 智能提取产品介绍（需百度ASR + DeepSeek）
 * 默认: 去静音拼接（开箱即用）
 */

import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { runPipeline, runContentPipeline } from "@/lib/video/pipeline";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
const OUTPUTS_DIR = path.join(process.cwd(), "public", "outputs");

export async function POST(req: NextRequest) {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_DIR, { recursive: true });

  try {
    const formData = await req.formData();
    const file = formData.get("video") as File | null;
    const mode = (formData.get("mode") as string) || "silence";

    if (!file) {
      return Response.json({ error: "请上传视频文件" }, { status: 400 });
    }

    const validExt = /\.(mp4|webm|mov|avi|mkv|flv|ts)$/i;
    if (!validExt.test(file.name)) {
      return Response.json(
        { error: "不支持的视频格式，请上传 MP4、MOV、AVI、MKV 等常见格式" },
        { status: 400 }
      );
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ext = path.extname(file.name) || ".mp4";
    const inputPath = path.join(UPLOADS_DIR, `input_${id}${ext}`);
    const workingDir = path.join(OUTPUTS_DIR, id);

    await fs.mkdir(workingDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buffer);

    const encoder = new TextEncoder();
    let aborted = false;
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const safeClose = () => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        };

        const send = (data: object) => {
          if (aborted || closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          send({ type: "progress", step: "上传完成，开始处理...", percent: 0 });

          /* ──── 智能内容提取模式 ──── */
          if (mode === "content") {
            const baiduApiKey = process.env.BAIDU_API_KEY || "";
            const baiduSecretKey = process.env.BAIDU_SECRET_KEY || "";
            if (!baiduApiKey || !baiduSecretKey) {
              send({ type: "error", message: "服务端未配置百度语音识别 API Key，请联系管理员" });
              safeClose();
              return;
            }

            const contentResult = await runContentPipeline(inputPath, workingDir, {
              baiduApiKey,
              baiduSecretKey,
              onProgress: (step, percent) => send({ type: "progress", step, percent }),
            });

            if (!contentResult.productSegments.length) {
              send({ type: "error", message: "未检测到产品介绍内容，请检查视频是否包含产品讲解" });
              safeClose();
              return;
            }

            // 拼接产品介绍片段
            const basename = path.basename(inputPath, ext);
            const trimmedPath = path.join(workingDir, `${basename}_product.mp4`);

            send({ type: "progress", step: "拼接产品介绍片段...", percent: 70 });

            // 动态导入 cutAndConcat（需要实际时长，这里重新调用 pipeline 内部逻辑）
            const { execFile } = await import("child_process");
            const { promisify } = await import("util");
            const { getFfmpegPath } = await import("@/lib/video/ffmpeg");

            const execFileP = promisify(execFile);
            const ffmpeg = getFfmpegPath();
            const duration = contentResult.productSegments.reduce(
              (sum, s) => sum + (s.end - s.start), 0
            );

            send({
              type: "progress",
              step: `筛选出 ${formatDurationStr(duration)} 产品介绍内容，开始拼接...`,
              percent: 75,
            });

            // 切割 + 拼接
            const concatDir = workingDir;
            const concatFile = path.join(concatDir, "concat_list.txt");
            const segmentFiles: string[] = [];

            for (let i = 0; i < contentResult.productSegments.length; i++) {
              const s = contentResult.productSegments[i];
              if (s.end <= s.start) continue;
              const segPath = path.join(concatDir, `_product_${i}.ts`);
              segmentFiles.push(segPath);

              const seekArgs = ["-y", "-ss", String(s.start)];
              if (isFinite(s.end)) seekArgs.push("-to", String(s.end));
              seekArgs.push("-i", inputPath, "-c", "copy", "-f", "mpegts", segPath);

              await execFileP(ffmpeg, seekArgs);
              send({
                type: "progress",
                step: `拼接中 ${i + 1}/${contentResult.productSegments.length}`,
                percent: 75 + Math.floor((i / contentResult.productSegments.length) * 20),
              });
            }

            const concatContent = segmentFiles
              .map((f) => `file '${f.replace(/\\/g, "/")}'`)
              .join("\n");
            await fs.writeFile(concatFile, concatContent);

            await execFileP(ffmpeg, [
              "-y", "-f", "concat", "-safe", "0",
              "-i", concatFile, "-c", "copy", trimmedPath,
            ]);

            // 清理
            await fs.unlink(concatFile).catch(() => {});
            for (const f of segmentFiles) await fs.unlink(f).catch(() => {});

            const finalName = `product_${id}.mp4`;
            const finalPath = path.join(OUTPUTS_DIR, finalName);
            await fs.rename(trimmedPath, finalPath);

            send({
              type: "done",
              downloadUrl: `/outputs/${finalName}`,
              fileName: finalName,
              stats: {
                productSegments: contentResult.productSegments.length,
                productDuration: formatDurationStr(duration),
                totalSegments: contentResult.segments.length,
              },
            });
          } else {
            /* ──── 去静音模式（默认） ──── */
            const result = await runPipeline(inputPath, workingDir, {
              silenceDb: -30,
              silenceDuration: 1.5,
              padding: 0.3,
              enableSubtitles: false,
              onProgress: (step, percent) => send({ type: "progress", step, percent }),
            });

            const finalName = `clip_${id}.mp4`;
            const finalPath = path.join(OUTPUTS_DIR, finalName);
            await fs.rename(result.outputPath, finalPath);

            send({
              type: "done",
              downloadUrl: `/outputs/${finalName}`,
              fileName: finalName,
            });
          }
        } catch (err: any) {
          console.error("处理失败:", err);
          send({ type: "error", message: err.message || "处理视频时出错了" });
        } finally {
          safeClose();
          fs.unlink(inputPath).catch(() => {});
          fs.rm(workingDir, { recursive: true, force: true }).catch(() => {});
        }
      },
      cancel() {
        aborted = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("API error:", error);
    return Response.json(
      { error: error.message || "服务器出错了" },
      { status: 500 }
    );
  }
}

function formatDurationStr(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}
