/**
 * 百度短语音识别 API 客户端
 *
 * 免费额度: 50,000次/天，每次最长 60 秒音频
 * 文档: https://ai.baidu.com/tech/speech/asr
 */

const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const ASR_URL = "https://vop.baidu.com/server_api";

let _tokenCache: { token: string; expiresAt: number } | null = null;

/** 获取百度 OAuth access token（自动缓存） */
export async function getAccessToken(
  apiKey: string,
  secretKey: string
): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: apiKey,
    client_secret: secretKey,
  });

  const res = await fetch(`${TOKEN_URL}?${params}`, { method: "POST" });
  const data = await res.json();

  if (data.error) {
    throw new Error(`百度鉴权失败: ${data.error_description || data.error}`);
  }

  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return _tokenCache.token;
}

/** 单次短语音识别结果 */
export interface AsrSegment {
  start: number;  // 在原视频中的起始时间（秒）
  end: number;    // 在原视频中的结束时间（秒）
  text: string;   // 识别出的文本
}

/**
 * 识别一段 PCM 音频（≤60秒）
 *
 * @param pcmBuffer  PCM 16kHz 16bit mono 原始音频
 * @param apiKey     百度 API Key
 * @param secretKey  百度 Secret Key
 * @returns 识别出的文本，失败返空字符串
 */
export async function recognizePcm(
  pcmBuffer: Buffer,
  apiKey: string,
  secretKey: string
): Promise<string> {
  const token = await getAccessToken(apiKey, secretKey);

  // 百度 ASR 要求 raw PCM 二进制 + Content-Type: audio/pcm;rate=16000
  const res = await fetch(
    `${ASR_URL}?dev_pid=1537&token=${encodeURIComponent(token)}&cuid=video-clipper`,
    {
      method: "POST",
      headers: {
        "Content-Type": "audio/pcm;rate=16000",
        "Content-Length": String(pcmBuffer.length),
      },
      body: pcmBuffer,
    }
  );

  const data = await res.json();

  if (data.err_no !== 0) {
    console.warn(`百度ASR识别失败 [${data.err_no}]: ${data.err_msg}`);
    return "";
  }

  // result 是字符串数组，拼接起来
  return (data.result || []).join("");
}
