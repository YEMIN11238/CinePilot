const rules = [
  { type: "input", field: "apiKey" as const, title: "OpenAI API Key", value: "", props: { type: "password", showPassword: true, autocomplete: "off" } },
  { type: "input", field: "baseUrl" as const, title: "官方接口地址", value: "https://api.openai.com/v1", props: { readonly: true } },
  {
    type: "select", field: "quality" as const, title: "默认画质", value: "medium",
    options: [{ label: "Low · 草稿", value: "low" }, { label: "Medium · 标准", value: "medium" }, { label: "High · 精细", value: "high" }, { label: "Auto · 模型选择", value: "auto" }],
  },
];

type OpenAiContext = ProviderContext<ProviderConfig<typeof rules>>;
type ReferenceImage = { data: Uint8Array; mimeType: string; extension: string; width: number; height: number };
const maxImageBytes = 50 * 1024 * 1024;

function configuration(context: OpenAiContext) {
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) throw new Error("请先在媒体模型设置中填写 OpenAI API Key");
  let base: URL;
  try { base = new URL(context.config.baseUrl || "https://api.openai.com/v1"); }
  catch { throw new Error("OpenAI 官方接口地址无效"); }
  if (base.origin !== "https://api.openai.com" || !/^\/v1\/?$/.test(base.pathname) || base.username || base.password || base.search || base.hash) {
    throw new Error("OpenAI 官方图片接入只允许 https://api.openai.com/v1，密钥不会发送到其他地址");
  }
  return { apiKey, baseUrl: "https://api.openai.com/v1" };
}

function imageSize(request: ImageRequest) {
  const sizes: Record<string, Record<string, string>> = {
    "1K": { "1:1": "1024x1024", "16:9": "1536x864", "9:16": "864x1536" },
    "2K": { "1:1": "2048x2048", "16:9": "2048x1152", "9:16": "1152x2048" },
  };
  const size = sizes[request.size || "1K"]?.[request.ratio || "1:1"];
  if (!size) throw new Error("当前 GPT Image 2 接入支持 1K/2K，以及 1:1、16:9、9:16 画幅");
  return size;
}

async function readImage(context: OpenAiContext, input: MediaInput, signal: AbortSignal): Promise<ReferenceImage> {
  signal.throwIfAborted();
  let data: Uint8Array;
  if (input.type === "url") {
    let source: URL;
    try { source = new URL(input.url); } catch { throw new Error("参考图片地址无效"); }
    if (!["https:", "http:"].includes(source.protocol) || source.username || source.password) throw new Error("参考图片须为不含凭据的 HTTP(S) 地址");
    // 读取参考图不附带 OpenAI 凭据，且不跟随跳转。
    const response = await context.tool.fetch(source.href, { signal, redirect: "error" });
    if (!response.ok) throw new Error(`读取参考图片失败（HTTP ${response.status}）`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("参考图片内容为空");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxImageBytes) throw new Error("参考图片不能超过 50 MB");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    data = Buffer.concat(chunks, total);
  } else if (input.type === "base64") {
    const encoded = input.data.replace(/^data:[^;,]+;base64,/, "").replace(/\s/g, "");
    if (encoded.length > Math.ceil(maxImageBytes / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error("参考图片的 base64 无效或超过 50 MB");
    data = Buffer.from(encoded, "base64");
  } else data = input.data;
  if (!data.byteLength || data.byteLength > maxImageBytes) throw new Error("参考图片为空或超过 50 MB");
  let metadata: MediaImageInfo;
  try { metadata = await context.tool.media.inspectImage({ type: "binary", data, mimeType: input.mimeType || "image/png" }); }
  catch { throw new Error("参考图片无法读取，请使用有效的 PNG、JPEG 或 WebP 图片"); }
  const extension = metadata.format === "jpeg" ? "jpg" : metadata.format;
  if (!["png", "jpg", "webp"].includes(extension)) throw new Error("参考图片仅支持 PNG、JPEG、WebP");
  return { data, mimeType: metadata.format === "jpeg" ? "image/jpeg" : `image/${extension}`, extension, width: metadata.width, height: metadata.height };
}

function editBody(fields: Record<string, string | number>, images: ReferenceImage[], mask?: ReferenceImage) {
  const boundary = `----cinePilotOpenAi${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts: (string | Uint8Array<ArrayBuffer>)[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const append = (name: string, image: ReferenceImage, filename: string) => {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${image.mimeType}\r\n\r\n`, new Uint8Array(image.data), "\r\n");
  };
  images.forEach((image, index) => append("image[]", image, `reference${index + 1}.${image.extension}`));
  if (mask) append("mask", mask, "mask.png");
  parts.push(`--${boundary}--\r\n`);
  return { body: new Blob(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export default {
  id: "openAi",
  label: "OpenAI 官方图片",
  icon: "",
  version: "1.0.0",
  readme: "OpenAI 官方 Images API，使用 GPT Image 2。支持文生图和参考图编辑；当前接入每次生成1张、最多4张参考图，这是本接入范围，不代表官方完整上限。1K/2K 按目标画幅请求原生尺寸，不进行裁剪。默认 Medium，可切换 Low 制作小样。模型权限和费用由账户决定，保存配置不会创建生成任务。文档：https://developers.openai.com/api/docs/guides/image-generation",
  rules,
  models: [
    { id: "gpt-image-2", label: "GPT Image 2", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1K", "2K"], imageRatios: ["1:1", "16:9", "9:16"] },
  ] satisfies ProviderModel[],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const { apiKey, baseUrl } = configuration(this);
    if (request.model !== "gpt-image-2") throw new Error("请选择已接入的 GPT Image 2 模型");
    if (!request.prompt.trim() || request.prompt.length > 32000) throw new Error("图片提示词不能为空或超过 32000 字符");
    if ((request.n ?? 1) !== 1) throw new Error("当前 OpenAI 图片接入每次生成1张，请分次生成候选");
    if (request.outputFormat && request.outputFormat !== "png") throw new Error("当前 OpenAI 图片接入输出 PNG 格式");
    if ((request.images?.length ?? 0) > 4) throw new Error("当前 OpenAI 图片接入最多使用4张参考图，请减少引用");
    if (request.mask && !request.images?.length) throw new Error("使用区域蒙版前，请先提供待编辑图片");
    const quality = request.quality || this.config.quality || "medium";
    if (!["low", "medium", "high", "auto"].includes(quality)) throw new Error("GPT Image 2 画质须为 low、medium、high 或 auto");
    const deadline = AbortSignal.timeout(10 * 60_000);
    const signal = this.signal ? AbortSignal.any([this.signal, deadline]) : deadline;
    const images: ReferenceImage[] = [];
    for (const image of request.images ?? []) images.push(await readImage(this, image, signal));
    const mask = request.mask ? await readImage(this, request.mask, signal) : undefined;
    if (mask && (mask.mimeType !== "image/png" || mask.width !== images[0]!.width || mask.height !== images[0]!.height)) throw new Error("区域蒙版须为与第一张参考图尺寸一致的透明 PNG 图片");
    const fields = { model: request.model, prompt: request.prompt, n: 1, size: imageSize(request), quality, output_format: "png" };
    const multipart = images.length ? editBody(fields, images, mask) : undefined;
    signal.throwIfAborted();
    const response = await this.tool.fetch(`${baseUrl}/images/${multipart ? "edits" : "generations"}`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": multipart?.contentType || "application/json", Accept: "application/json" },
      body: multipart?.body || JSON.stringify(fields), signal, redirect: "error",
    });
    const result: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (!response.ok) {
      const detail = this.tool.errorMessage(result);
      throw new Error(`OpenAI 图片请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
    }
    const data = result && typeof result === "object" && "data" in result ? result.data : undefined;
    if (!Array.isArray(data) || data.length !== 1 || typeof data[0]?.b64_json !== "string" || !data[0].b64_json) throw new Error("OpenAI 未返回有效的图片内容，请核对账户请求记录后再重试");
    const encoded = data[0].b64_json.replace(/\s/g, "");
    if (encoded.length > Math.ceil(maxImageBytes / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error("OpenAI 返回的图片内容无效或超过 50 MB");
    const bytes = Buffer.from(encoded, "base64");
    let image: MediaImageInfo;
    try { image = await this.tool.media.inspectImage({ type: "binary", data: bytes, mimeType: "image/png" }); }
    catch { throw new Error("OpenAI 返回的图片无法读取"); }
    const [width, height] = fields.size.split("x").map(Number);
    if (image.format !== "png" || image.width !== width || image.height !== height) throw new Error("OpenAI 返回的图片格式或尺寸与请求不一致，请核对请求记录");
    return [{ mediaType: "image", type: "base64", data: encoded, mimeType: "image/png" }];
  },
} satisfies ProviderDefinition<typeof rules>;
