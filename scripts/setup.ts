/**
 * 环境设置脚本
 *
 * 下载 Whisper.cpp Windows 可执行文件和 GGML 模型文件。
 *
 * 运行: npx tsx scripts/setup.ts
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import https from "https";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

const TOOLS_DIR = path.join(process.cwd(), "tools", "whisper");
const MODELS_DIR = path.join(TOOLS_DIR, "models");

/* ──── Whisper.cpp 下载配置 ──── */

// whisper.cpp 下载源（优先国内镜像）
const WHISPER_VERSION = "v1.7.4";
const WHISPER_URLS = [
  `https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`,
];

// 模型选择（默认 medium）
const MODEL = process.env.WHISPER_MODEL || "medium";
const MODEL_URLS: Record<string, string[]> = {
  small: [
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
  ],
  medium: [
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
  ],
  "large-v3": [
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
  ],
};

/** 逐个尝试 URL 下载，直到成功 */
async function tryDownload(urls: string[], dest: string, label: string): Promise<void> {
  for (let i = 0; i < urls.length; i++) {
    try {
      await downloadFile(urls[i], dest, i === 0 ? label : `${label} (备用源 ${i + 1})`);
      return;
    } catch (e: any) {
      if (i < urls.length - 1) {
        console.log(`  源 ${i + 1} 失败，尝试备用源...`);
        // 删除未完成的文件
        try { fs.unlinkSync(dest); } catch {}
      } else {
        throw e;
      }
    }
  }
}

/* ──── 下载函数 ──── */

async function downloadFile(
  url: string,
  dest: string,
  label: string
): Promise<void> {
  // 检查是否已存在
  if (fs.existsSync(dest)) {
    console.log(`  ✓ ${label} 已存在，跳过`);
    return;
  }

  console.log(`  ↓ 下载 ${label}...`);
  console.log(`    地址: ${url}`);

  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (response) => {
        // 处理重定向
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(dest);
            https.get(redirectUrl, (res2) => {
              pipeline(res2, file)
                .then(() => resolve())
                .catch(reject);
            });
            return;
          }
        }

        const total = parseInt(response.headers["content-length"] || "0", 10);
        let downloaded = 0;

        response.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(0);
            process.stdout.write(`\r    进度: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB)`);
          }
        });

        pipeline(response, file)
          .then(() => {
            console.log("");
            console.log(`  ✓ ${label} 下载完成`);
            resolve();
          })
          .catch(reject);
      })
      .on("error", reject);
  });
}

/* ──── 主流程 ──── */

async function main() {
  console.log("╔══════════════════════════════════╗");
  console.log("║   直播剪辑工具 — 环境设置       ║");
  console.log("╚══════════════════════════════════╝\n");

  // 1. 创建目录
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  console.log("① FFmpeg: 已通过 npm 包内置，无需额外安装 ✓\n");

  // 2. 下载 Whisper.cpp
  console.log("② 检查 Whisper.cpp...");
  const whisperExe = path.join(TOOLS_DIR, "whisper-cli.exe");

  if (!fs.existsSync(whisperExe)) {
    console.log("  下载 Whisper.cpp Windows 版本...");
    console.log(`  版本: ${WHISPER_VERSION}`);

    const zipPath = path.join(TOOLS_DIR, "whisper.zip");
    await tryDownload(WHISPER_URLS, zipPath, "Whisper.cpp");

    // 解压（Windows 自带 tar 命令可解 ZIP）
    console.log("  解压中...");
    try {
      execSync(`tar -xf "${zipPath}" -C "${TOOLS_DIR}"`, { stdio: "pipe" });
    } catch {
      // tar 解 ZIP 可能失败，提示用户手动解压
      console.log("  自动解压失败，请手动解压 whisper.zip 到 tools/whisper/");
      console.log(`  确保 ${whisperExe} 存在`);
      process.exit(1);
    }

    // 删除 ZIP
    fs.unlinkSync(zipPath);
    console.log("  ✓ Whisper.cpp 安装完成");
  } else {
    console.log("  ✓ Whisper.cpp 已安装，跳过");
  }

  // 3. 下载模型
  console.log(`\n③ 下载 Whisper 模型 (${MODEL})...`);
  const modelUrls = MODEL_URLS[MODEL];
  if (!modelUrls) {
    console.error(`  ✗ 未知模型: ${MODEL}，可选: small, medium, large-v3`);
    process.exit(1);
  }

  const modelPath = path.join(MODELS_DIR, `ggml-${MODEL}.bin`);
  await tryDownload(modelUrls, modelPath, `Whisper ${MODEL} 模型`);

  // 4. 完成
  console.log("\n══════════════════════════════════");
  console.log("  ✓ 环境设置完成！");
  console.log("  运行: npm run dev");
  console.log("  然后打开浏览器访问");
  console.log("══════════════════════════════════\n");
}

main().catch((e) => {
  console.error("\n  ✗ 设置失败:", e.message);
  process.exit(1);
});
