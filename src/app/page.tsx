"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileVideo, Download, Loader2, CheckCircle2, XCircle, Scissors, Brain } from "lucide-react";

interface ProgressState {
  step: string;
  percent: number;
}

type Mode = "silence" | "content";

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("silence");
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ productSegments: number; productDuration: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File | null) => {
    setError(null);
    setDownloadUrl(null);
    setProgress(null);
    setStats(null);
    if (f) {
      const ext = f.name.split(".").pop()?.toLowerCase();
      if (!ext || !["mp4", "webm", "mov", "avi", "mkv", "flv", "ts"].includes(ext)) {
        setError("不支持的格式，请选择视频文件（MP4、MOV、AVI 等）");
        return;
      }
      if (f.size > 2 * 1024 * 1024 * 1024) {
        setError("文件太大，目前支持最大 2GB");
        return;
      }
      setFile(f);
    }
  }, []);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0] || null);
  };

  const handleProcess = async () => {
    if (!file || processing) return;

    setProcessing(true);
    setError(null);
    setStats(null);
    setProgress({ step: "正在上传...", percent: 0 });

    try {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("mode", mode);

      const res = await fetch("/api/process", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "处理失败");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              setProgress({ step: data.step, percent: data.percent });
            } else if (data.type === "done") {
              setDownloadUrl(data.downloadUrl);
              setProgress({ step: "处理完成！", percent: 100 });
              if (data.stats) setStats(data.stats);
            } else if (data.type === "error") {
              throw new Error(data.message);
            }
          } catch (e: any) {
            if (e.message && !e.message.includes("JSON")) throw e;
          }
        }
      }
    } catch (e: any) {
      setError(e.message || "处理过程中出现错误");
      setProgress(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setProgress(null);
    setDownloadUrl(null);
    setError(null);
    setStats(null);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 to-white flex flex-col">
      {/* 顶部 */}
      <header className="py-6 px-4 text-center shrink-0">
        <div className="inline-flex items-center gap-2.5 mb-3">
          <Scissors size={28} className="text-violet-500" />
          <h1 className="text-2xl font-bold text-slate-800">直播剪辑</h1>
        </div>

        {/* 模式选择 */}
        <div className="inline-flex bg-slate-100 rounded-xl p-1 gap-1">
          <button
            onClick={() => { setMode("silence"); setError(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === "silence"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            ✂️ 去静音拼接
          </button>
          <button
            onClick={() => { setMode("content"); setError(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === "content"
                ? "bg-white text-violet-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            🧠 智能提取产品介绍
          </button>
        </div>
      </header>

      {/* 主体 */}
      <main className="flex-1 px-4 pb-8 max-w-lg mx-auto w-full">
        {/* 上传区 */}
        {!file && (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${
              dragging
                ? "border-violet-400 bg-violet-50 scale-[1.02]"
                : "border-slate-300 hover:border-violet-300 hover:bg-violet-50/50"
            }`}
          >
            <Upload size={40} className="mx-auto mb-4 text-slate-400" />
            <p className="text-slate-600 font-medium mb-1">点击选择视频 或 拖拽到此处</p>
            <p className="text-xs text-slate-400">支持 MP4、MOV、AVI、MKV 等格式 · 最大 2GB</p>
            <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] || null)} />
          </div>
        )}

        {/* 文件已选中 + 开始处理按钮 */}
        {file && !processing && !downloadUrl && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                <FileVideo size={20} className="text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
              </div>
              <button onClick={handleReset} className="text-xs text-slate-400 hover:text-red-500">移除</button>
            </div>
            <button onClick={handleProcess}
              className={`w-full py-3 rounded-xl text-white font-medium active:scale-[0.98] transition-all ${
                mode === "content"
                  ? "bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
                  : "bg-violet-500 hover:bg-violet-600"
              }`}>
              {mode === "content" ? (
                <span className="inline-flex items-center gap-2">
                  <Brain size={18} /> 智能提取产品介绍
                </span>
              ) : (
                "开始去静音拼接"
              )}
            </button>
          </div>
        )}

        {/* 处理中 */}
        {processing && progress && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center">
            <Loader2 size={36} className="mx-auto mb-4 text-violet-500 animate-spin" />
            <p className="text-slate-700 font-medium mb-1">{progress.step}</p>
            <p className="text-xs text-slate-400 mb-4">{progress.percent}%</p>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(progress.percent, 5)}%` }} />
            </div>
            <p className="text-[11px] text-slate-400 mt-3">处理中，请不要关闭页面</p>
          </div>
        )}

        {/* 完成 */}
        {downloadUrl && !processing && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-6 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
            <p className="text-slate-700 font-medium mb-1">处理完成！</p>
            {stats ? (
              <p className="text-xs text-slate-400 mb-1">
                提取了 {stats.productSegments} 段产品介绍，共 {stats.productDuration}
              </p>
            ) : (
              <p className="text-xs text-slate-400 mb-5">已自动去除静音段落并完成拼接</p>
            )}
            <a href={downloadUrl} download
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 text-white font-medium hover:bg-emerald-600 active:scale-[0.98] transition-all mt-3">
              <Download size={18} /> 下载视频
            </a>
            <button onClick={handleReset}
              className="block w-full mt-3 py-2 text-sm text-slate-400 hover:text-violet-500 transition-colors">
              处理另一个视频
            </button>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
            <XCircle size={36} className="mx-auto mb-3 text-red-400" />
            <p className="text-red-600 font-medium mb-3">{error}</p>
            <button onClick={handleReset}
              className="px-5 py-2 rounded-xl bg-white text-red-500 border border-red-200 hover:bg-red-50 transition-colors text-sm">
              重新开始
            </button>
          </div>
        )}
      </main>

      <footer className="py-4 text-center text-[11px] text-slate-400 shrink-0">
        视频处理在你自己的电脑上完成，不会上传到任何云端服务器
      </footer>
    </div>
  );
}
