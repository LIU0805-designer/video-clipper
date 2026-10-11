/**
 * DeepSeek 内容分类
 *
 * 将语音转录文本发给 DeepSeek，区分「产品介绍」和「闲聊」片段。
 */

const DEEPSEEK_BASE = "https://api.deepseek.com/v1/chat/completions";

function getDeepseekApiKey(): string {
  return process.env.DEEPSEEK_API_KEY || "";
}

export interface TranscriptSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface ClassifiedSegment extends TranscriptSegment {
  type: "product" | "chat" | "other";
  summary: string;
}

/**
 * 分析转录片段，区分产品介绍、闲聊、其他
 */
export async function classifySegments(
  segments: TranscriptSegment[],
  onProgress?: (msg: string) => void
): Promise<ClassifiedSegment[]> {
  if (!segments.length) return [];

  const apiKey = getDeepseekApiKey();
  if (!apiKey) {
    console.warn("未配置 DEEPSEEK_API_KEY，跳过内容分类");
    // 没有 AI 分类时，全部标记为 product（保守策略）
    return segments.map((s) => ({
      ...s,
      type: "product" as const,
      summary: "",
    }));
  }

  // 构建给 AI 的上下文
  const transcriptText = segments
    .map((s) => `[${s.index}] ${formatTime(s.start)}-${formatTime(s.end)}: ${s.text}`)
    .join("\n");

  const prompt = `你是一个直播内容分析助手。下面是一段直播录像的语音转文字结果，每条前面有编号和时间戳。

请分析每一段的内容类型：
- **product（产品介绍）**：主播正在讲解产品的功效、成分、使用方法、价格优惠、使用效果对比等核心卖点
- **chat（闲聊互动）**：主播与工作人员闲聊、回答弹幕、打招呼、说笑话、拉家常等
- **other（其他）**：开场白、结束语、过渡、纯感叹词等

请以 JSON 数组格式返回，每个元素包含 index（编号）、type（类型）、summary（一句话概括该段内容）。

只返回 JSON 数组，不要其他文字。例如：
[{"index":0,"type":"chat","summary":"主播和助理聊午饭吃什么"},{"index":1,"type":"product","summary":"介绍洗面奶的氨基酸成分和温和配方"}]

以下是转录文本：
${transcriptText}`;

  onProgress?.(`正在分析 ${segments.length} 段内容...`);

  try {
    const res = await fetch(DEEPSEEK_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.warn("DeepSeek API 调用失败:", res.status);
      return segments.map((s) => ({ ...s, type: "product" as const, summary: "" }));
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";

    // 提取 JSON 数组
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn("DeepSeek 返回格式异常，使用默认分类");
      return segments.map((s) => ({ ...s, type: "product" as const, summary: "" }));
    }

    const classified = JSON.parse(match[0]) as Array<{
      index: number;
      type: "product" | "chat" | "other";
      summary: string;
    }>;

    // 合并回原始片段
    return segments.map((s) => {
      const found = classified.find((c) => c.index === s.index);
      return {
        ...s,
        type: found?.type || "other",
        summary: found?.summary || "",
      };
    });
  } catch (e: any) {
    console.warn("DeepSeek 分类出错:", e.message);
    return segments.map((s) => ({ ...s, type: "product" as const, summary: "" }));
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
