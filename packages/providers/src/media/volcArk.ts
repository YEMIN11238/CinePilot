const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "火山方舟 API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
  {
    type: "input",
    field: "baseUrl" as const,
    title: "请求地址",
    value: "https://ark.cn-beijing.volces.com/api/v3",
    props: { placeholder: "https://ark.cn-beijing.volces.com/api/v3" },
  },
] as const;

type ArkContext = ProviderContext<ProviderConfig<typeof rules>>;

function configuration(context: ArkContext) {
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) throw new Error("请先填写火山方舟 API Key");
  if (typeof context.config.baseUrl !== "string") throw new Error("火山方舟请求地址必须为有效的 HTTP(S) 地址");
  let base: URL;
  try { base = new URL(context.config.baseUrl.trim() || "https://ark.cn-beijing.volces.com/api/v3"); }
  catch { throw new Error("火山方舟请求地址必须为有效的 HTTP(S) 地址"); }
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("火山方舟请求地址不能包含账号、密码、查询参数或片段");
  }
  return { apiKey, baseUrl: base.href.replace(/\/+$/, "") };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("火山方舟返回了无效的响应格式");
  return value as Record<string, unknown>;
}

function mediaUrl(input: MediaInput) {
  if (input.type === "url") {
    if (!/^https?:\/\//i.test(input.url)) throw new Error("参考图片地址须使用 HTTP(S)");
    return input.url;
  }
  if (!input.mimeType.startsWith("image/")) throw new Error("参考素材须为图片");
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

async function requestJson(context: ArkContext, url: string, apiKey: string, signal: AbortSignal, body?: Record<string, unknown>) {
  const response = await context.tool.fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
    redirect: "error",
  });
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const message = context.tool.errorMessage(data);
    throw new Error(`火山方舟请求失败（HTTP ${response.status}）${message ? `：${message}` : ""}`);
  }
  return object(data);
}

function wait(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 3000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function imageSize(request: ImageRequest) {
  if (request.size && request.size !== "2K") throw new Error("当前 Seedream 接入支持 2K 图片尺寸");
  const sizes: Record<string, string> = {
    "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "16:9": "2560x1440",
    "9:16": "1440x2560", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344",
  };
  const size = sizes[request.ratio || "1:1"];
  if (!size) throw new Error("当前 Seedream 模型不支持所选画面比例");
  return size;
}

export default {
  id: "volcArk",
  label: "火山方舟",
  icon: "",
  version: "2.0.0",
  readme: "火山方舟官方接口。视频使用 Seedance 1.0，图片使用 Seedream 4.0 / 4.5。请先在方舟控制台开通相应模型；同一把 API Key 的模型权限与额度由账户决定。保存配置不会创建生成任务。",
  rules,
  models: [
    {
      id: "doubao-seedance-1-0-pro-fast-251015",
      label: "Seedance 1.0 Pro Fast",
      type: "video",
      mode: ["text", "startFrameOptional"],
      audio: false,
      durationResolutionMap: [{ duration: [5, 10], resolution: ["480p", "720p", "1080p"] }],
    },
    {
      id: "doubao-seedance-1-0-pro-250528",
      label: "Seedance 1.0 Pro",
      type: "video",
      mode: ["text", "startFrameOptional"],
      audio: false,
      durationResolutionMap: [{ duration: [5, 10], resolution: ["480p", "720p", "1080p"] }],
    },
    {
      id: "doubao-seedream-4-0-250828",
      label: "Seedream 4.0",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["2K"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
    },
    {
      id: "doubao-seedream-4-5-251128",
      label: "Seedream 4.5",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageSizes: ["2K"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
    },
  ] satisfies ProviderModel[],
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const { apiKey, baseUrl } = configuration(this);
    if (!["doubao-seedance-1-0-pro-fast-251015", "doubao-seedance-1-0-pro-250528"].includes(request.model)) throw new Error("请选择已支持的 Seedance 1.0 模型");
    if (![5, 10].includes(request.duration ?? 5)) throw new Error("当前 Seedance 1.0 接入支持 5 秒或 10 秒视频");
    if (!["480p", "720p", "1080p"].includes(request.resolution ?? "720p")) throw new Error("Seedance 1.0 不支持所选分辨率");
    if (request.generateAudio) throw new Error("Seedance 1.0 不支持生成音频");
    if (request.lastFrame || request.videos?.length || request.audios?.length || (request.images?.length ?? 0) > 1 || Array.isArray(request.mode)) throw new Error("当前 Seedance 1.0 接入支持文字或单张首帧图片生成视频");
    const firstFrame = request.firstFrame ?? request.images?.[0];
    const content: Record<string, unknown>[] = [{ type: "text", text: request.prompt }];
    if (firstFrame) content.push({ type: "image_url", image_url: { url: mediaUrl(firstFrame) }, role: "first_frame" });
    // ACT: 一次提交最多等待 10 分钟；不自动重提，避免超时后重复创建收费任务。
    const deadline = AbortSignal.timeout(10 * 60_000);
    const signal = this.signal ? AbortSignal.any([this.signal, deadline]) : deadline;
    let taskId = "";
    try {
      const task = await requestJson(this, `${baseUrl}/contents/generations/tasks`, apiKey, signal, {
        model: request.model, content, ratio: request.ratio || "9:16", resolution: request.resolution || "720p", duration: request.duration ?? 5, watermark: false,
      });
      if (typeof task.id !== "string" || !task.id) throw new Error("火山方舟提交未返回任务 ID，请在控制台确认结果后再重试");
      taskId = task.id;
      while (true) {
        await wait(signal);
        const result = await requestJson(this, `${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, apiKey, signal);
        const status = result.status;
        if (status === "succeeded") {
          const url = object(result.content).video_url;
          if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("视频生成成功，但未返回有效视频地址");
          return [{ mediaType: "video", type: "url", url, mimeType: "video/mp4" }];
        }
        if (["failed", "cancelled", "canceled", "expired"].includes(String(status))) {
          const reason = this.tool.errorMessage(result);
          throw new Error(`视频任务 ${taskId} ${status === "expired" ? "已过期" : status === "failed" ? "生成失败" : "已取消"}${reason ? `：${reason}` : ""}`);
        }
      }
    } catch (error) {
      if (signal.aborted) {
        const timedOut = deadline.aborted || signal.reason?.name === "TimeoutError";
        throw new Error(`${timedOut ? "等待视频任务超时" : "已停止等待视频任务"}${taskId ? `（任务 ID：${taskId}）` : "，提交结果尚未确认"}。上游任务可能仍在继续，请先到方舟控制台查看结果，不要直接重试，以免重复扣费。`);
      }
      const reason = this.tool.errorMessage(error);
      if (taskId && !reason.includes(taskId)) throw new Error(`视频任务 ${taskId} 查询或读取结果失败${reason ? `：${reason}` : ""}。请先到方舟控制台查看结果，不要直接重试，以免重复扣费。`);
      if (!taskId && !/HTTP 4\d\d/.test(reason)) throw new Error(`视频提交结果尚未确认${reason ? `：${reason}` : ""}。请先到方舟控制台核对任务，不要直接重试，以免重复扣费。`);
      throw error;
    }
  },
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const { apiKey, baseUrl } = configuration(this);
    if (!["doubao-seedream-4-0-250828", "doubao-seedream-4-5-251128"].includes(request.model)) throw new Error("请选择已支持的 Seedream 模型");
    if (request.n !== undefined && request.n !== 1) throw new Error("当前 Seedream 接入每次生成一张图片");
    if (request.mask) throw new Error("当前 Seedream 接入不支持蒙版编辑");
    if ((request.images?.length ?? 0) > 14) throw new Error("Seedream 每次最多接收 14 张参考图");
    const images = request.images?.map(mediaUrl);
    const deadline = AbortSignal.timeout(5 * 60_000);
    const signal = this.signal ? AbortSignal.any([this.signal, deadline]) : deadline;
    const result = await requestJson(this, `${baseUrl}/images/generations`, apiKey, signal, {
      model: request.model, prompt: request.prompt, size: imageSize(request), response_format: "b64_json", stream: false, watermark: false,
      sequential_image_generation: "disabled", ...(images?.length ? { image: images.length === 1 ? images[0] : images } : {}),
    });
    const entries = Array.isArray(result.data) ? result.data : [];
    const assets: MediaAsset[] = [];
    for (const value of entries) {
      const item = object(value);
      if (typeof item.b64_json === "string" && item.b64_json) assets.push({ mediaType: "image", type: "base64", data: item.b64_json, mimeType: "image/jpeg" });
      else if (typeof item.url === "string" && /^https?:\/\//i.test(item.url)) assets.push({ mediaType: "image", type: "url", url: item.url, mimeType: "image/jpeg" });
    }
    if (!assets.length) throw new Error(this.tool.errorMessage(result) || "火山方舟未返回有效图片");
    return assets;
  },
} satisfies ProviderDefinition<typeof rules>;
