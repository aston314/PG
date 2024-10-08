// import { WebSocketServer } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { serve } from "https://deno.land/std@0.180.0/http/server.ts";
import { LRU } from "https://deno.land/x/lru@1.0.2/mod.ts";
import { franc } from 'https://esm.sh/franc-min@6.1.0';

// 全局配置
const config = {
  DEEPLX_API_URL: "https://api.deeplx.org/MN2ioAtWVa42Z_RyQBYaN2pOXUbdgygDdX09YnnuH9s/translate",
  BATCH_SIZE: 10,
  SUBTITLE_SEPARATOR: "\n",
  SUBTITLE_MARKER: "‖",
  OPTIMAL_TEXT_LENGTH: 1000,
  DELAY_BETWEEN_REQUESTS: 1000,
  INITIAL_BATCH_SIZE: 10,
  SEND_REPORTS: false,
  ALERT_THRESHOLD: 1000, // 毫秒
  NTFY_TOPIC: "aston",
  NTFY_URL: "https://ntfy.sh/aston",
  LANGUAGE_DETECTION_SAMPLE_SIZE: 10,
  LANGUAGE_DETECTION_THRESHOLD: 7,
};

const languageCodeMapping: { [key: string]: string } = {
  'cmn': 'ZH',    // 简体中文
  'zho': 'ZH',    // 中文（通用）
  'yue': 'ZH-TW', // 粤语，映射到繁体中文
  'eng': 'EN',    // 英语
  'jpn': 'JA',    // 日语
  'kor': 'KO',    // 韩语
  'fra': 'FR',    // 法语
  'deu': 'DE',    // 德语
  'spa': 'ES',    // 西班牙语
  'rus': 'RU',    // 俄语
  'por': 'PT',    // 葡萄牙语
  'ita': 'IT',    // 意大利语
  'nld': 'NL',    // 荷兰语
  'pol': 'PL',    // 波兰语
  'bul': 'BG',    // 保加利亚语
  'ces': 'CS',    // 捷克语
  'dan': 'DA',    // 丹麦语
  'ell': 'EL',    // 希腊语
  'est': 'ET',    // 爱沙尼亚语
  'fin': 'FI',    // 芬兰语
  'hun': 'HU',    // 匈牙利语
  'ind': 'ID',    // 印度尼西亚语
  'lit': 'LT',    // 立陶宛语
  'lav': 'LV',    // 拉脱维亚语
  'nob': 'NB',    // 挪威语（博克马尔语）
  'nno': 'NB',    // 挪威语（尼诺斯克语）
  'ron': 'RO',    // 罗马尼亚语
  'slk': 'SK',    // 斯洛伐克语
  'slv': 'SL',    // 斯洛文尼亚语
  'swe': 'SV',    // 瑞典语
  'tur': 'TR',    // 土耳其语
  'ukr': 'UK',    // 乌克兰语
};

// 缓存配置
const translationCache = new LRU<string, string>(1000);

// 接口定义
interface SubtitleEntry {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  translatedText?: string;
  originalSubtitles?: SubtitleEntry[];
}

// 性能监控模块
class PerformanceMonitor {
  private samples: Map<string, number[]> = new Map();
  private readonly sampleSize = 10;
  private dailyData: number[] = [];

  private updateMetric(metric: string, value: number) {
    if (!this.samples.has(metric)) {
      this.samples.set(metric, []);
    }
    const samples = this.samples.get(metric)!;
    samples.push(value);
    if (samples.length > this.sampleSize) {
      samples.shift();
    }
  }

  private getAverageMetric(metric: string): number {
    const samples = this.samples.get(metric) || [];
    if (samples.length === 0) return 0;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  updateApiResponseTime(responseTime: number) {
    this.updateMetric('apiResponseTime', responseTime);
    this.dailyData.push(responseTime);
  }

  getAverageApiResponseTime(): number {
    return this.getAverageMetric('apiResponseTime');
  }

  getDailyData(): number[] {
    return [...this.dailyData];
  }

  clearDailyData() {
    this.dailyData = [];
  }

  logPerformanceMetrics() {
    console.log(`[Performance] Average API Response Time: ${this.getAverageApiResponseTime().toFixed(2)}ms`);
  }
}

// 性能分析器
class PerformanceAnalyzer {
  static async analyzeDailyPerformance(performanceData: number[]) {
    const avgResponseTime = performanceData.reduce((a, b) => a + b, 0) / performanceData.length;
    const maxResponseTime = Math.max(...performanceData);
    
    console.log(`每日性能报告：`);
    console.log(`平均响应时间：${avgResponseTime.toFixed(2)}ms`);
    console.log(`最大响应时间：${maxResponseTime}ms`);

    if (config.SEND_REPORTS) {
      await this.sendAlert(`每日性能报告：平均响应时间：${avgResponseTime.toFixed(2)}ms，最大响应时间：${maxResponseTime}ms`);
    }

    if (avgResponseTime > config.ALERT_THRESHOLD) {
      await this.sendAlert(`警告：平均响应时间 (${avgResponseTime.toFixed(2)}ms) 超过阈值`);
    }
  }

  private static async sendAlert(message: string) {
    const title = "字幕翻译服务性能报告";

    try {
      const response = await fetch(config.NTFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic: config.NTFY_TOPIC,
          title: title,
          message: message,
          priority: 3,
        }),
      });

      if (response.ok) {
        console.log("警报发送成功");
      } else {
        console.error("发送警报失败:", response.statusText);
      }
    } catch (error) {
      console.error("发送警报时出错:", error);
    }
  }
}

// 限流器
class RateLimiter {
  private queue: (() => Promise<void>)[] = [];
  private running = 0;
  private lastRunTime = 0;

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
      this.runNext();
    });
  }

  private async runNext() {
    if (this.running >= 3 || this.queue.length === 0) return;

    const now = Date.now();
    if (now - this.lastRunTime < 1000) {
      setTimeout(() => this.runNext(), 1000 - (now - this.lastRunTime));
      return;
    }

    this.running++;
    this.lastRunTime = now;
    const next = this.queue.shift();
    if (next) {
      await next();
      this.running--;
      this.runNext();
    }
  }
}

const rateLimiter = new RateLimiter();
const performanceMonitor = new PerformanceMonitor();

async function translateWithDeepLX(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  subtitleId: string,
  signal: AbortSignal
): Promise<string> {
  const cacheKey = `${sourceLanguage}-${targetLanguage}-${subtitleId}-${text}`;
  console.log(`[DeepLX] 尝试翻译文本 (subtitleId: ${subtitleId})`);
  const cachedTranslation = translationCache.get(cacheKey);
  if (cachedTranslation) {
    console.log(`[DeepLX] 使用缓存的翻译结果 (subtitleId: ${subtitleId})`);
    return cachedTranslation;
  }

  return rateLimiter.schedule(async () => {
    if (signal.aborted) {
      console.log(`[DeepLX] 翻译被中止 (subtitleId: ${subtitleId})`);
      throw new Error("Translation aborted");
    }
    try {
      console.log(`[DeepLX] 等待 ${config.DELAY_BETWEEN_REQUESTS}ms 后发送请求 (subtitleId: ${subtitleId})`);
      await new Promise(resolve => setTimeout(resolve, config.DELAY_BETWEEN_REQUESTS));
      
      console.log(`[DeepLX] 发送翻译请求到 API (subtitleId: ${subtitleId})`);
      const startTime = Date.now();
      const response = await fetch(config.DEEPLX_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          source_lang: sourceLanguage,
          target_lang: targetLanguage,
        }),
        signal,
      });
      const endTime = Date.now();
      performanceMonitor.updateApiResponseTime(endTime - startTime);

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[DeepLX] 遇到限流，等待后重试 (subtitleId: ${subtitleId})`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          return translateWithDeepLX(text, sourceLanguage, targetLanguage, subtitleId, signal);
        }
        throw new Error(`DeepLX API error: ${response.statusText}`);
      }

      const result = await response.json();
      const translation = result.data;
      console.log(`[DeepLX] 翻译成功: ${translation.substring(0, 50)}... (subtitleId: ${subtitleId})`);
      
      const markerRegex = new RegExp(`${config.SUBTITLE_MARKER}.*?${config.SUBTITLE_MARKER}`, 'g');
      const markers = text.match(markerRegex) || [];
      let translatedTextWithMarkers = translation;
      markers.forEach((marker, index) => {
        translatedTextWithMarkers = translatedTextWithMarkers.replace(
          new RegExp(`^(.{${index * marker.length}})(.*)`, 's'),
          `$1${marker}$2`
        );
      });

      translationCache.set(cacheKey, translatedTextWithMarkers);
      return translatedTextWithMarkers;
    } catch (error) {
      console.error(`[DeepLX] 翻译失败 (subtitleId: ${subtitleId}):`, error);
      throw error;
    }
  });
}

async function translateWithFallback(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  subtitleId: string,
  signal: AbortSignal
): Promise<string> {
  try {
    console.log(`[Fallback] 尝试整体翻译 (subtitleId: ${subtitleId})`);
    return await translateWithDeepLX(text, sourceLanguage, targetLanguage, subtitleId, signal);
  } catch (error) {
    console.error(`[Fallback] 整体翻译失败 (subtitleId: ${subtitleId}):`, error);
    if (signal.aborted) {
      console.log(`[Fallback] 翻译被中止 (subtitleId: ${subtitleId})`);
      throw new Error("Translation aborted");
    }
    const parts = text.split(config.SUBTITLE_SEPARATOR);
    console.log(`[Fallback] 尝试单独翻译 ${parts.length} 个部分 (subtitleId: ${subtitleId})`);
    const translatedParts = [];
    for (let i = 0; i < parts.length; i++) {
      if (signal.aborted) {
        console.log(`[Fallback] 翻译过程中被中止 (subtitleId: ${subtitleId})`);
        throw new Error("Translation aborted");
      }
      try {
        const partId = `${subtitleId}-part${i}`;
        const translatedPart = await translateWithDeepLX(parts[i], sourceLanguage, targetLanguage, partId, signal);
        translatedParts.push(translatedPart);
      } catch (partError) {
        console.error(`[Fallback] 部分翻译失败 (subtitleId: ${subtitleId}, part: ${i}):`, partError);
        translatedParts.push(`[翻译失败] ${parts[i]}`);
      }
    }
    console.log(`[Fallback] 单独翻译完成 (subtitleId: ${subtitleId})`);
    return translatedParts.join(config.SUBTITLE_SEPARATOR);
  }
}

function initializeSubtitles(subtitles: SubtitleEntry[]): SubtitleEntry[] {
  return subtitles.map(sub => ({
    ...sub,
    id: `${sub.startTime}-${sub.endTime}`
  }));
}

function mergeSubtitles(subtitles: SubtitleEntry[]): SubtitleEntry[] {
  console.log(`[Merger] 开始合并 ${subtitles.length} 条字幕`);
  const mergedSubtitles: SubtitleEntry[] = [];
  let currentGroup: SubtitleEntry[] = [];
  let currentLength = 0;

  for (const subtitle of subtitles) {
    if (currentLength + subtitle.text.length > config.OPTIMAL_TEXT_LENGTH && currentGroup.length > 0) {
      mergedSubtitles.push(mergeGroup(currentGroup));
      currentGroup = [];
      currentLength = 0;
    }
    currentGroup.push(subtitle);
    currentLength += subtitle.text.length;
  }

  if (currentGroup.length > 0) {
    mergedSubtitles.push(mergeGroup(currentGroup));
  }

  console.log(`[Merger] 合并完成，得到 ${mergedSubtitles.length} 个合并组`);
  return mergedSubtitles;
}

function mergeGroup(group: SubtitleEntry[]): SubtitleEntry {
  const mergedText = group.map(sub => sub.text.replace(/\n/g, '<br>')).join(config.SUBTITLE_SEPARATOR);
  return {
    id: `merged_${group[0].id}_to_${group[group.length - 1].id}`,
    startTime: group[0].startTime,
    endTime: group[group.length - 1].endTime,
    text: mergedText,
    originalSubtitles: group
  };
}

function splitMergedSubtitle(mergedSubtitle: SubtitleEntry): SubtitleEntry[] {
  console.log(`[Splitter] 拆分合并的字幕: ${mergedSubtitle.id}`);
  const translatedText = mergedSubtitle.translatedText || '';
  const originalSubtitles = mergedSubtitle.originalSubtitles || [];
  const translatedParts = translatedText.split(config.SUBTITLE_SEPARATOR);
  
  return originalSubtitles.map((original, index) => {
    const translatedPart = translatedParts[index] || '';
    return {
      ...original,
      translatedText: translatedPart || `[翻译失败] ${original.text}`
    };
  });
}

function handleWebSocket(socket: WebSocket) {
  console.log("[WebSocket] 新的 WebSocket 连接已建立");
  let subtitles: SubtitleEntry[] = [];
  let heartbeatInterval: number;
  let isTranslating = false;
  let isConnected = true;
  let abortController: AbortController | null = null;
  const translatedSubtitleIds = new Set<string>();
  let shouldStopTranslation = false;

  const heartbeat = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: "heartbeat" }));
    } else {
      clearInterval(heartbeatInterval);
    }
  };

  heartbeatInterval = setInterval(heartbeat, 30000);

  async function stopTranslation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    isTranslating = false;
    shouldStopTranslation = false;
    console.log("[WebSocket] 翻译已停止");
    if (isConnected) {
      socket.send(JSON.stringify({ action: "translationStopped" }));
    }
  }

  socket.onmessage = async (event) => {
    if (!isConnected) return;

    try {
      const data = JSON.parse(event.data);

      switch (data.action) {
        case "initialize":
          subtitles = initializeSubtitles(data.subtitles);
          translatedSubtitleIds.clear();
          isTranslating = false;
          if (!Array.isArray(subtitles) || subtitles.length === 0) {
            throw new Error("无效的字幕数组");
          }
          console.log(`[WebSocket] 初始化字幕数组，长度: ${subtitles.length}`);
          socket.send(JSON.stringify({ action: "initialized" }));
          break;

        case "translate":
          console.log("[WebSocket] 收到翻译请求");
          if (isTranslating) {
            console.log("[WebSocket] 翻译已在进行中，忽略新的请求");
            return;
          }

          const { timestamp, sourceLanguage, targetLanguage } = data;
          const currentTime = typeof timestamp === 'number' ? timestamp : parseFloat(timestamp);

          console.log(`[WebSocket] 开始翻译，时间戳: ${currentTime}, 源语言: ${sourceLanguage}, 目标语言: ${targetLanguage}`);
          
          isTranslating = true;
          shouldStopTranslation = false;
          abortController = new AbortController();
          const signal = abortController.signal;

          const subtitlesToTranslate = subtitles.filter(sub => sub.startTime >= currentTime && !translatedSubtitleIds.has(sub.id));
          console.log(`[Translator] 筛选出 ${subtitlesToTranslate.length} 条字幕需要翻译`);

          // Language detection logic
          const sampleSize = Math.min(config.LANGUAGE_DETECTION_SAMPLE_SIZE, subtitlesToTranslate.length);
          const samples = subtitlesToTranslate.slice(0, sampleSize);
          const detectedLanguages = samples.map(sample => {
            const detectedCode = franc(sample.text) as string;
            return languageCodeMapping[detectedCode] || detectedCode;
          });

          console.log(`[Translator] 检测到的语言: ${detectedLanguages.join(', ')}`);

          const validDetections = detectedLanguages.filter(lang => lang !== 'und');
          const targetLangCount = validDetections.filter(lang => lang === targetLanguage).length;
          const detectionThreshold = Math.max(1, Math.floor(validDetections.length * 0.6));

          const detectedLanguage = validDetections.length > 0
            ? validDetections.reduce((a, b, i, arr) =>
                arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b
              )
            : 'unknown';

          if (targetLangCount >= detectionThreshold) {
            console.log(`[Translator] 检测到字幕主要是目标语言 (${targetLanguage})，跳过翻译`);
            socket.send(JSON.stringify({
              action: "languageDetected",
              language: detectedLanguage,
              message: "Source language matches target language, translation skipped"
            }));
            socket.send(JSON.stringify({ action: "translationComplete" }));
            isTranslating = false;
            abortController = null;
          } else {
            console.log(`[Translator] 检测到字幕不是目标语言，继续翻译`);
            socket.send(JSON.stringify({
              action: "languageDetected",
              language: detectedLanguage,
              message: "Source language differs from target language, proceeding with translation"
            }));
            
            try {
              const initialBatch = subtitlesToTranslate.slice(0, config.INITIAL_BATCH_SIZE);
              console.log(`[Translator] 开始初始快速翻译，包含 ${initialBatch.length} 条字幕`);
              
              const translatedInitialBatch = await Promise.all(initialBatch.map(async (item) => {
                if (shouldStopTranslation) throw new Error("Translation stopped");
                const translatedText = await translateWithFallback(
                  item.text,
                  sourceLanguage,
                  targetLanguage,
                  item.id,
                  signal
                );
                translatedSubtitleIds.add(item.id);
                return { ...item, translatedText };
              }));

              if (isConnected && !shouldStopTranslation) {
                console.log(`[WebSocket] 发送初始快速翻译结果，包含 ${translatedInitialBatch.length} 条字幕`);
                socket.send(JSON.stringify({
                  action: "translationResult",
                  subtitles: translatedInitialBatch
                }));
              }

              console.log(`[Translator] 合并前的字幕数量: ${subtitlesToTranslate.length}`);
              const remainingSubtitles = subtitlesToTranslate.slice(config.INITIAL_BATCH_SIZE);
              const mergedSubtitles = mergeSubtitles(remainingSubtitles);
              console.log(`[Translator] 合并后的剩余字幕数量: ${mergedSubtitles.length}`);

              for (let i = 0; i < mergedSubtitles.length; i += config.BATCH_SIZE) {
                if (!isConnected || shouldStopTranslation) {
                  console.log("[Translator] 连接已断开或收到停止命令，停止翻译");
                  break;
                }

                const batch = mergedSubtitles.slice(i, i + config.BATCH_SIZE);
                console.log(`[Translator] 处理批次 ${i / config.BATCH_SIZE + 1}, 包含 ${batch.length} 条合并字幕`);

                const translatedBatch = await Promise.all(batch.map(async (item) => {
                  if (shouldStopTranslation) throw new Error("Translation stopped");
                  try {
                    console.log(`[Translator] 翻译文本: ${item.text.substring(0, 50)}...`);
                    const translatedText = await translateWithFallback(
                      item.text,
                      sourceLanguage,
                      targetLanguage,
                      item.id,
                      signal
                    );
                    console.log(`[Translator] 翻译完成: ${translatedText.substring(0, 50)}...`);
                    return { ...item, translatedText };
                  } catch (error) {
                    console.error(`[Translator] 翻译失败: ${error.message}`);
                    if (error.name === 'AbortError' || error.message === "Translation stopped") {
                      throw error;
                    }
                    return { ...item, translatedText: `[翻译失败] ${item.text}` };
                  }
                }));

                if (isConnected && !shouldStopTranslation) {
                  const distributedResults = translatedBatch.flatMap(splitMergedSubtitle);
                  distributedResults.forEach(sub => translatedSubtitleIds.add(sub.id));
                  console.log(`[WebSocket] 发送翻译结果，包含 ${distributedResults.length} 条字幕`);
                  socket.send(JSON.stringify({
                    action: "translationResult",
                    subtitles: distributedResults
                  }));
                }
              }

              if (isConnected && !shouldStopTranslation) {
                console.log(`[WebSocket] 翻译完成，共翻译 ${subtitlesToTranslate.length} 条字幕`);
                socket.send(JSON.stringify({ action: "translationComplete" }));
              }
            } catch (error) {
              console.error("[Translator] 翻译过程中出错:", error);
              if (error.message === "Translation stopped") {
                console.log("[Translator] 翻译被手动停止");
              } else if (error.name !== 'AbortError' && isConnected) {
                socket.send(JSON.stringify({ action: "error", message: error.message }));
              }
            } finally {
              isTranslating = false;
              abortController = null;
              shouldStopTranslation = false;
            }
          }
          performanceMonitor.logPerformanceMetrics();
          break;

        case "stopTranslation":
          console.log("[WebSocket] 收到停止翻译请求");
          shouldStopTranslation = true;
          await stopTranslation();
          break;

        case "closeConnection":
          console.log("[WebSocket] 收到关闭连接请求");
          socket.close();
          break;

        case "heartbeatResponse":
          console.log("[WebSocket] 收到心跳响应");
          break;

        default:
          console.warn(`[WebSocket] 收到未知操作: ${data.action}`);
      }
    } catch (error) {
      console.error("[WebSocket] 处理消息时出错:", error);
      if (isConnected) {
        socket.send(JSON.stringify({ action: "error", message: error.message }));
      }
    }
  };

  socket.onclose = () => {
    console.log("[WebSocket] 连接已关闭");
    isConnected = false;
    clearInterval(heartbeatInterval);
    if (isTranslating) {
      stopTranslation();
    }
  };

  socket.onerror = async (error) => {
    console.error("[WebSocket] 发生错误:", error);
    if (isTranslating) {
      await stopTranslation();
    }
  };
}

async function handleHttp(req: Request): Promise<Response> {
  console.log("Received request:", req.method, req.url);
  console.log("Headers:", JSON.stringify(Object.fromEntries(req.headers), null, 2));

  const forwardedProto = req.headers.get("x-forwarded-proto") || "";
  const isSecure = forwardedProto.includes("https");
  console.log("Forwarded Proto:", forwardedProto);
  console.log("Is Secure:", isSecure);

  // 强制 HTTPS
  if (!isSecure) {
    const httpsUrl = `https://${req.headers.get("host")}${new URL(req.url).pathname}`;
    return new Response("Redirecting to HTTPS", {
      status: 301,
      headers: { "Location": httpsUrl }
    });
  }

  // 检查 WebSocket 相关头部
  const upgrade = req.headers.get("upgrade") || "";
  const connection = req.headers.get("connection") || "";
  console.log("Upgrade Header:", upgrade);
  console.log("Connection Header:", connection);

  if (upgrade.toLowerCase() === "websocket" && connection.toLowerCase().includes("upgrade")) {
    try {
      console.log("Attempting to upgrade to WebSocket");
      const { socket, response } = Deno.upgradeWebSocket(req);
      console.log("WebSocket upgrade successful");
      
      // 添加 CORS 头到 WebSocket 升级响应
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

      const corsResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });

      handleWebSocket(socket);
      return corsResponse;
    } catch (err) {
      console.error("Failed to upgrade to WebSocket:", err);
      console.error("Error details:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
      return new Response(`WebSocket upgrade failed: ${err.message}`, { status: 400 });
    }
  }

  console.log("Not a WebSocket upgrade request");
  return new Response("request isn't trying to upgrade to websocket.");
}

   // async function handleHttp(req: Request): Promise<Response> {
   //   console.log("Received request:", req.method, req.url);
   //   console.log("Headers:", JSON.stringify(Object.fromEntries(req.headers), null, 2));

   //   const forwardedProto = req.headers.get("x-forwarded-proto") || "";
   //   const isSecure = forwardedProto.includes("https");
   //   console.log("Forwarded Proto:", forwardedProto);
   //   console.log("Is Secure:", isSecure);

   //   // 检查 WebSocket 相关头部
   //   let upgrade = req.headers.get("upgrade") || "";
   //   let connection = req.headers.get("connection") || "";
   //   const secWebSocketKey = req.headers.get("sec-websocket-key");
   //   console.log("Upgrade Header:", upgrade);
   //   console.log("Connection Header:", connection);
   //   console.log("Sec-WebSocket-Key:", secWebSocketKey);

   //   // 如果存在 sec-websocket-key 但缺少其他头部，手动添加它们
   //   if (secWebSocketKey && (!upgrade || !connection)) {
   //     const newHeaders = new Headers(req.headers);
   //     if (!upgrade) newHeaders.set("upgrade", "websocket");
   //     if (!connection) newHeaders.set("connection", "Upgrade");
       
   //     // 创建新的请求对象，包含修改后的头部
   //     req = new Request(req.url, {
   //       method: req.method,
   //       headers: newHeaders,
   //       body: req.body
   //     });
       
   //     upgrade = "websocket";
   //     connection = "Upgrade";
   //   }

   //   // 更宽松的 WebSocket 检查
   //   if (upgrade.toLowerCase() === "websocket" && connection.toLowerCase().includes("upgrade")) {
   //     try {
   //       console.log("Attempting to upgrade to WebSocket");
   //       const { socket, response } = Deno.upgradeWebSocket(req);
   //       console.log("WebSocket upgrade successful");
         
   //       // 添加 CORS 头到 WebSocket 升级响应
   //       const headers = new Headers(response.headers);
   //       headers.set("Access-Control-Allow-Origin", "*");
   //       headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

   //       const corsResponse = new Response(response.body, {
   //         status: response.status,
   //         statusText: response.statusText,
   //         headers: headers,
   //       });

   //       handleWebSocket(socket);
   //       return corsResponse;
   //     } catch (err) {
   //       console.error("Failed to upgrade to WebSocket:", err);
   //       console.error("Error details:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
   //       return new Response(`WebSocket upgrade failed: ${err.message}`, { status: 400 });
   //     }
   //   }

   //   console.log("Not a WebSocket upgrade request");
   //   return new Response("request isn't trying to upgrade to websocket.");
   // }

console.log("WebSocket 字幕翻译服务器正在运行，地址为 http://localhost:8000");
await serve(handleHttp, { port: 8000 });

// 添加每日分析的定时器
const dailyAnalysisInterval = setInterval(async () => {
  const dailyData = performanceMonitor.getDailyData();
  await PerformanceAnalyzer.analyzeDailyPerformance(dailyData);
  performanceMonitor.clearDailyData();
}, 24 * 60 * 60 * 1000); // 每24小时运行一次

// 确保在程序退出时清理定时器
Deno.addSignalListener("SIGINT", () => {
  clearInterval(dailyAnalysisInterval);
  // 其他清理代码...
  Deno.exit();
});

console.log("WebSocket 字幕翻译服务器正在运行，地址为 ws://localhost:8000");
