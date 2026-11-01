import { createHash } from "node:crypto";
import { join } from "node:path";
import { copyFile, mkdir, readFile, stat, withFileAccess, writeAtomic } from "@toonflow/file";
import type { FfmpegCommand, FfprobeData } from "@toonflow/ffmpeg/types";
import type { MediaGenerationRequest, MediaModel } from "@toonflow/tools-scaffold/runtime";
import type { DirectorAsset, DirectorGenerationInput, DirectorModel, DirectorProject, DirectorShot, DirectorTask, ShotVersion } from "@/lib/directorTypes";
import conf from "@/utils/conf";
import { createWorkspaceFfmpeg, getStatus } from "@/utils/ffmpeg";
import { generateMedia, listMediaModels, saveMediaAssets, type MediaTaskLifecycle } from "@/utils/media/generation";
import { getMediaProvider, loadMediaProviderSource } from "@/utils/media/provider";
import { resolveWorkspacePath } from "@/utils/workspace/files";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

async function configuredModel(project: DirectorProject, stage: "image" | "video") {
  const selected = project.models[stage];
  if (!selected) invalid(`请先选择${stage === "image" ? "图片" : "视频"}模型，并在设置中配置供应商接口`);
  const model = (await listMediaModels()).find(item => item.providerId === selected.providerId && item.modelId === selected.modelId && item.type === stage);
  if (!model) invalid(`所选${stage === "image" ? "图片" : "视频"}模型不存在，请重新配置`);
  const info = await getMediaProvider(selected.providerId);
  const configurations = conf.get("settings", {}).mediaProviderConfigs;
  const raw = configurations && typeof configurations === "object" && !Array.isArray(configurations)
    ? (configurations as Record<string, unknown>)[selected.providerId] : undefined;
  const config = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const provider = await loadMediaProviderSource(info.source, config);
  if (!provider[stage === "image" ? "generateImage" : "generateVideo"]) invalid("所选供应商不支持此类生成");
  if (provider.rules.some(rule => rule.field === "apiKey") && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) {
    invalid(`请先在媒体模型设置中填写 ${info.label} 的 API Key`);
  }
  if (stage === "image" && model.imageRatios?.length && !model.imageRatios.includes(project.ratio)) invalid(`所选图片模型不支持 ${project.ratio} 画幅`);
  if (stage === "image" && selected.size && model.imageSizes?.length && !model.imageSizes.includes(selected.size)) invalid("所选图片模型不支持此图片尺寸");
  return { selected, model };
}

function imageReferences(project: DirectorProject, version: ShotVersion, model: MediaModel) {
  const characters = project.production?.characters.filter(character => version.characterIds?.includes(character.id)) ?? [];
  const sceneReference = project.production?.sceneReferences?.find(scene => scene.sceneId === version.sceneId)?.referenceImage;
  const references = [...characters.flatMap(character => character.referenceImage ? [{ path: character.referenceImage.path, mimeType: character.referenceImage.mimeType }] : []), ...(sceneReference ? [{ path: sceneReference.path, mimeType: sceneReference.mimeType }] : []), ...(project.referenceImage ? [project.referenceImage] : [])]
    .filter((reference, index, all) => all.findIndex(item => item.path === reference.path) === index);
  if (!references.length) return references;
  const modes = Array.isArray(model.mode) ? model.mode : [];
  if (!modes.includes("singleImage") && !modes.includes("multiReference")) invalid("所选图片模型未声明参考图能力，请选择支持角色参考图的模型");
  const maximum = !modes.includes("multiReference") ? 1 : model.providerId === "openAi" ? 4 : model.providerId === "volcArk" && /^doubao-seedream-4-[05]-/.test(model.modelId) ? 14 : 64;
  if (references.length > maximum) invalid(`所选图片模型最多支持 ${maximum} 张参考图，当前镜头需要 ${references.length} 张。请减少参考图，或选择支持更多参考图的模型`);
  return references;
}

function videoOptions(model: MediaModel, selected: DirectorModel, duration: number) {
  const modes = Array.isArray(model.mode) ? model.mode : [];
  const mode = (["startFrameOptional", "endFrameOptional", "singleImage"] as const).find(value => modes.includes(value));
  const references = modes.find(value => Array.isArray(value) && value.some(item => typeof item === "string" && /^imageReference:[1-9]\d*$/.test(item)));
  if (!mode && !references) invalid("所选视频模型未声明单图或首帧生成能力，请选择支持图生视频的模型");
  const maps = model.durationResolutionMap?.filter(item => item.duration.length && item.resolution.length) ?? [];
  if (!maps.length) invalid("所选视频模型未声明时长和分辨率，请先完善模型能力配置");
  const resolutions = [...new Set(maps.flatMap(item => item.resolution))];
  const resolution = selected.resolution ?? resolutions.find(value => value.toLowerCase() === "720p") ?? resolutions[0]!;
  const durations = [...new Set(maps.filter(item => item.resolution.includes(resolution)).flatMap(item => item.duration))]
    .filter(value => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!durations.length) invalid(`所选视频模型不支持分辨率 ${resolution}`);
  const generationDuration = durations.find(value => value >= duration);
  if (!generationDuration) invalid(`镜头时长超过所选模型支持范围（最长 ${durations.at(-1)} 秒），请缩短镜头或更换模型`);
  // ACT: 使用供应商明确声明的时长，长于镜头的部分在最终合成时裁剪。
  return { mode: mode ?? references as MediaGenerationRequest["mode"], resolution, duration: generationDuration };
}

export async function validateGeneration(project: DirectorProject, stage: "image" | "video" | "all", force = false) {
  const versions = project.shots.map(shot => shot.versions.find(version => version.id === shot.currentVersionId) ?? invalid("镜头当前版本不存在"));
  if ((stage === "image" || stage === "all") && versions.some(version => force || !version.keyframe)) {
    const { model } = await configuredModel(project, "image");
    versions.filter(version => force || !version.keyframe).forEach(version => imageReferences(project, version, model));
  }
  const missingClips = versions.filter(version => force || !version.clip);
  if ((stage === "video" || stage === "all") && missingClips.length) {
    const { model, selected } = await configuredModel(project, "video");
    for (const version of missingClips) {
      videoOptions(model, selected, version.duration + (version.trimStart ?? 0));
      if (stage === "video" && !version.keyframe) invalid("请先生成或导入镜头关键帧，再生成视频");
    }
  }
}

export async function generateShotMedia(cwd: string, project: DirectorProject, shot: DirectorShot, version: ShotVersion, stage: "image" | "video", signal?: AbortSignal, lifecycle?: MediaTaskLifecycle): Promise<DirectorAsset> {
  signal?.throwIfAborted();
  const { model, selected } = await configuredModel(project, stage);
  const characters = project.production?.characters.filter(character => version.characterIds?.includes(character.id)) ?? [];
  const references = stage === "image" ? imageReferences(project, version, model) : [];
  const scene = project.production?.scriptVersions.find(script => script.id === project.production?.currentScriptVersionId)?.scenes.find(item => item.id === version.sceneId);
  const sceneReference = project.production?.sceneReferences?.find(item => item.sceneId === version.sceneId)?.referenceImage;
  const prompt = [
    `${project.production ? "AI漫剧" : "短片"}单镜头，画幅 ${project.ratio}。统一风格：${project.style}。`,
    `项目要求：${project.brief}`, `镜头画面：${version.description}`, `摄影与运镜：${version.camera}`,
    ...(project.production ? [
      `角色与行动约束：${project.production.characterConstraints}。连续性要求：${project.production.invariants}`,
      `场次：${JSON.stringify(scene ? { id: scene.id, location: scene.location, action: scene.action } : { id: version.sceneId })}`,
      `出镜角色设定：${JSON.stringify(characters.map(character => ({ id: character.id, name: character.name, appearance: character.appearance, costume: character.costume, props: character.props, goal: character.goal, knownFacts: character.knownFacts, referenceImage: stage === "image" && character.referenceImage ? references.findIndex(reference => reference.path === character.referenceImage!.path) + 1 : undefined })))}`,
      ...(stage === "image" ? [`参考图按角色、场景、项目顺序提供；相同图片去重。场景参考图序号：${sceneReference ? references.findIndex(reference => reference.path === sceneReference.path) + 1 : "无"}；项目参考图序号：${project.referenceImage ? references.findIndex(reference => reference.path === project.referenceImage!.path) + 1 : "无"}。场景参考用于空间布局、环境与光线，人物身份以角色参考为准。`] : []),
      `镜头起始状态：${version.startState || "未补充"}。镜头结束状态：${version.endState || "未补充"}`,
      `对白与说话人ID：${JSON.stringify(version.dialogues ?? [])}。对白用于动作与表情设计，本次不合成对白音频。`,
      "人物只能依据其已知事实采取行动；遵守角色身份、外貌、服装和道具约束。角色一致性与起止状态仍须由编导人工审片确认。",
    ] : []),
    stage === "image" ? "生成单张镜头关键帧。按顺序使用所附角色、场景与项目参考图，保持人物外貌、服装、道具和场景布局；画面不生成字幕、文字或水印。" : "以本镜头关键帧为首帧，保持人物外貌、服装、道具与风格。视频仅接收此镜头关键帧，不接收额外角色参考图；画面不生成字幕、文字或水印，不需要音轨。",
  ].join("\n");
  const request: MediaGenerationRequest = {
    providerId: selected.providerId, modelId: selected.modelId, prompt, ratio: project.ratio,
    outputDirectory: `assets/director/${project.id}/${shot.id}/${version.id}/${crypto.randomUUID().replaceAll("-", "")}`,
  };
  if (stage === "image") {
    if (selected.size) request.size = selected.size;
    if (references.length) request.images = references;
  } else {
    if (!version.keyframe) invalid("请先生成或导入镜头关键帧，再生成视频");
    const options = videoOptions(model, selected, version.duration + (version.trimStart ?? 0));
    Object.assign(request, options);
    if (model.audio === "optional") request.generateAudio = false;
    if (Array.isArray(options.mode)) request.images = [version.keyframe];
    else {
      request.firstFrame = version.keyframe;
      // ACT: 内置供应商对 singleImage 分别读取 images 或 firstFrame，兼容同一张图的两种入口。
      if (options.mode === "singleImage") request.images = [version.keyframe];
    }
  }
  const hash = createHash("sha256").update(JSON.stringify({ ...request, outputDirectory: undefined }));
  const referencePaths = [...new Set([...(request.images ?? []).map(image => image.path), ...(request.firstFrame ? [request.firstFrame.path] : [])])];
  for (const path of referencePaths) {
    const source = await resolveWorkspacePath(cwd, path);
    const info = await stat(source.path);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("参考图必须为不超过 100 MB 的工作区文件");
    hash.update(await readFile(source.path, { signal }));
  }
  const [asset] = await generateMedia(cwd, stage, request, signal, lifecycle);
  if (!asset || asset.mediaType !== stage) invalid("生成服务未返回有效素材");
  return { path: asset.path, mimeType: asset.mimeType, createdAt: new Date().toISOString(), providerId: selected.providerId, modelId: selected.modelId, inputHash: hash.digest("hex") };
}

export async function validateCanvasGeneration(project: DirectorProject, input: DirectorGenerationInput) {
  const { model, selected } = await configuredModel({ ...project, ratio: input.ratio, models: { [input.kind]: input.model } }, input.kind);
  if (input.kind === "video") {
    if (!input.reference) invalid("请先连接或上传一张首帧图片，再生成视频");
    const options = videoOptions(model, selected, input.duration ?? 5);
    if (options.duration !== (input.duration ?? 5)) invalid("所选视频模型不支持此生成时长，请选择模型明确支持的时长");
  } else if (input.reference && (!Array.isArray(model.mode) || !model.mode.includes("singleImage") && !model.mode.includes("multiReference"))) {
    invalid("所选图片模型未声明参考图能力，请移除参考或更换模型");
  }
  return { model, selected };
}

export async function generateCanvasMedia(cwd: string, project: DirectorProject, task: DirectorTask, signal: AbortSignal, lifecycle: MediaTaskLifecycle): Promise<DirectorAsset> {
  const input = task.generation;
  if (!input) invalid("生成节点缺少输入快照");
  const { model, selected } = await validateCanvasGeneration(project, input);
  const request: MediaGenerationRequest = {
    providerId: selected.providerId, modelId: selected.modelId, prompt: input.prompt, ratio: input.ratio,
    outputDirectory: `assets/director/${project.id}/canvas/${task.id}`,
  };
  if (input.kind === "image") {
    if (selected.size) request.size = selected.size;
    if (input.reference) request.images = [input.reference];
  } else {
    const options = videoOptions(model, selected, input.duration ?? 5);
    Object.assign(request, options);
    if (model.audio === "optional") request.generateAudio = false;
    if (Array.isArray(options.mode)) request.images = [input.reference!];
    else {
      request.firstFrame = input.reference;
      if (options.mode === "singleImage") request.images = [input.reference!];
    }
  }
  const [asset] = await generateMedia(cwd, input.kind, request, signal, lifecycle);
  if (!asset || asset.mediaType !== input.kind) invalid("生成服务未返回有效素材");
  return { path: asset.path, mimeType: asset.mimeType, createdAt: new Date().toISOString(), providerId: selected.providerId, modelId: selected.modelId, inputHash: task.inputHash };
}

export async function queryArkTask(cwd: string, project: DirectorProject, task: DirectorTask, signal: AbortSignal): Promise<{ status: "pending" | "failed"; message: string } | { status: "succeeded"; asset: DirectorAsset }> {
  if (task.providerId !== "volcArk" || !task.providerTaskId || !task.providerEndpoint) invalid("该任务没有可恢复的方舟任务 ID，请到供应商控制台核对结果");
  const info = await getMediaProvider("volcArk");
  const configurations = conf.get("settings", {}).mediaProviderConfigs;
  const value = configurations && typeof configurations === "object" && !Array.isArray(configurations) ? (configurations as Record<string, unknown>).volcArk : undefined;
  const config = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const provider = await loadMediaProviderSource(info.source, config, signal, undefined, cwd);
  const apiKey = typeof provider.config.apiKey === "string" ? provider.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) invalid("请先配置方舟 API Key，再查询原任务");
  if (typeof provider.config.baseUrl !== "string") invalid("方舟请求地址无效，请恢复提交任务时使用的地址");
  let base: URL;
  let endpoint: URL;
  try {
    base = new URL(provider.config.baseUrl.trim() || "https://ark.cn-beijing.volces.com/api/v3");
    endpoint = new URL(`${base.href.replace(/\/+$/, "")}/contents/generations/tasks`);
  }
  catch { invalid("方舟请求地址无效，请恢复提交任务时使用的地址"); }
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || endpoint.href !== task.providerEndpoint) invalid("方舟请求地址已改变，请恢复原地址后查询，系统不会重新提交");
  const response = await fetch(`${endpoint.href}/${encodeURIComponent(task.providerTaskId)}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal, redirect: "error" });
  if (!response.ok) throw new Error(`查询原视频任务失败（HTTP ${response.status}），系统没有重新提交任务`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || Array.isArray(result)) invalid("方舟任务查询返回无效内容");
  const record = result as Record<string, unknown>;
  if (["failed", "cancelled", "canceled", "expired"].includes(String(record.status))) return { status: "failed", message: provider.tool.errorMessage(result) || "上游任务已失败或取消，可核对后重新生成" };
  if (record.status !== "succeeded") return { status: "pending", message: "上游任务仍在排队或生成中，稍后可再次查询；系统没有重新提交" };
  const content = record.content && typeof record.content === "object" && !Array.isArray(record.content) ? record.content as Record<string, unknown> : {};
  if (typeof content.video_url !== "string" || !/^https?:\/\//i.test(content.video_url)) invalid("原视频任务已完成，但没有可下载的视频地址");
  const [asset] = await saveMediaAssets(cwd, "video", [{ mediaType: "video", type: "url", url: content.video_url, mimeType: "video/mp4" }], `assets/director/${project.id}/recovered/${task.id}`, signal);
  if (!asset) invalid("原视频任务结果没有保存成功");
  return { status: "succeeded", asset: { path: asset.path, mimeType: asset.mimeType, createdAt: new Date().toISOString(), providerId: task.providerId, modelId: task.modelId, inputHash: task.inputHash } };
}

async function probe(cwd: string, path: string, signal?: AbortSignal): Promise<FfprobeData> {
  signal?.throwIfAborted();
  const source = await resolveWorkspacePath(cwd, path);
  const { tools } = await getStatus();
  if (!tools.ffprobe.path || tools.ffprobe.error) invalid("当前操作需要可用的 FFprobe，请先完成 FFmpeg 配置");
  const executable = tools.ffprobe.path;
  return withFileAccess([source.path], "read", async () => {
    // ACT: fluent 的 ffprobe 子进程不接受 command.kill；使用现有可执行文件入口明确限制 15 秒与取消信号。
    const child = Bun.spawn([executable, "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm,ogg,wav,mp3,flac,aac", "-show_streams", "-show_format", "-print_format", "json", "-i", source.path], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: 15000, signal,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "FFREPORT")),
    });
    const [output, error, code] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    signal?.throwIfAborted();
    if (code !== 0) invalid(`媒体读取失败：${error.slice(0, 500) || "文件无效或探测超时"}`);
    const data = JSON.parse(output) as FfprobeData;
    if (!Array.isArray(data.streams) || !data.format) invalid("媒体探测未返回有效信息");
    return data;
  }, signal);
}

export async function validateAudio(cwd: string, path: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(15000);
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const metadata = await probe(cwd, path, signal);
  const audio = metadata.streams.find(stream => stream.codec_type === "audio");
  const streamDuration = Number(audio?.duration);
  const duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(metadata.format.duration);
  if (!audio || metadata.streams.some(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic) || !Number.isFinite(duration) || duration <= 0) invalid("音频文件须包含有效音轨，且不能是视频文件");
  return duration;
}

export async function readVideoDuration(cwd: string, path: string) {
  const metadata = await probe(cwd, path, AbortSignal.timeout(15000));
  const video = metadata.streams.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  const streamDuration = Number(video?.duration);
  const duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(metadata.format.duration);
  if (!video || !Number.isFinite(duration) || duration < 1) invalid("视频须包含至少 1 秒的有效画面");
  return duration;
}

function run(command: FfmpegCommand, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const cancel = () => command.kill("SIGKILL");
  signal?.addEventListener("abort", cancel, { once: true });
  return new Promise<void>((resolve, reject) => {
    command.on("start", () => { if (signal?.aborted) cancel(); });
    command.on("error", error => reject(signal?.aborted ? signal.reason : error));
    command.on("end", () => signal?.aborted ? reject(signal.reason) : resolve());
    command.run();
  }).finally(() => signal?.removeEventListener("abort", cancel));
}

async function copySubtitleFont(directory: string) {
  const candidates = process.platform === "darwin"
    ? ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]
    : process.platform === "win32"
      ? [join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "msyh.ttc"), join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "simhei.ttf")]
      : ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"];
  for (const candidate of candidates) {
    const info = await stat(candidate).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!info?.isFile()) continue;
    const target = join(directory, "subtitleFont.ttc");
    await copyFile(candidate, target);
    return "subtitleFont.ttc";
  }
  invalid("导出中文字幕需要系统中文字体，请安装 Noto Sans CJK 后重试");
}

function wrapSubtitle(text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  let width = 0;
  for (const char of text.replaceAll("\r", "")) {
    const size = /[\u0000-\u007f]/.test(char) ? 0.55 : 1;
    if (char === "\n" || width + size > maxWidth) {
      lines.push(line);
      line = "";
      width = 0;
      if (char === "\n") continue;
    }
    if (char.charCodeAt(0) < 32) continue;
    line += char;
    width += size;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export async function composeProject(cwd: string, project: DirectorProject, signal?: AbortSignal, mode: "video" | "storyboard" = "video"): Promise<DirectorAsset> {
  const timeout = AbortSignal.timeout(10 * 60 * 1000);
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const ffmpeg = await createWorkspaceFfmpeg(cwd, signal);
  const shortEdge = project.exportSettings?.resolution === "1080p" ? 1080 : 720;
  const longEdge = shortEdge === 1080 ? 1920 : 1280;
  const frameSize = project.ratio === "16:9" ? { width: longEdge, height: shortEdge } : project.ratio === "1:1" ? { width: shortEdge, height: shortEdge } : { width: shortEdge, height: longEdge };
  const subtitleScale = shortEdge / 720;
  const subtitleSize = 32 * subtitleScale;
  const originalAudio = project.originalAudio === true && mode === "video";
  const shots = [...project.shots].sort((left, right) => left.order - right.order);
  const versions = shots.map(shot => shot.versions.find(version => version.id === shot.currentVersionId) ?? invalid("镜头当前版本不存在"));
  if (!versions.length) invalid("当前项目还没有镜头，请先添加镜头后再导出");
  if (versions.some(version => mode === "storyboard" ? !version.keyframe : !version.clip)) invalid(mode === "storyboard" ? "请先为每个镜头生成或导入关键帧，再合成分镜预览" : "请先为每个镜头生成或导入视频，再合成成片");
  const folder = `assets/director/${project.id}/exports/${crypto.randomUUID().replaceAll("-", "")}`;
  const destination = await resolveWorkspacePath(cwd, folder, true);
  await mkdir(destination.path, { recursive: true });
  const font = versions.some(version => version.subtitle.trim()) ? await copySubtitleFont(destination.path) : undefined;
  const segments: string[] = [];
  for (const [index, version] of versions.entries()) {
    signal.throwIfAborted();
    const asset = mode === "storyboard" ? version.keyframe! : version.clip!;
    const source = await resolveWorkspacePath(cwd, asset.path);
    const info = await stat(source.path);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid(`第 ${index + 1} 镜头素材无效或超过 100 MB`);
    let streamIndex = 0;
    let audioStreamIndex: number | undefined;
    if (mode === "video") {
      const metadata = await probe(cwd, asset.path, signal);
      const video = metadata.streams.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
      const streamDuration = Number(video?.duration);
      const duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(metadata.format.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) invalid(`第 ${index + 1} 镜头不包含有效视频`);
      if ((version.trimStart ?? 0) >= duration) invalid(`第 ${index + 1} 镜头的裁剪入点超过素材时长（${duration.toFixed(2)} 秒）`);
      streamIndex = video.index;
      audioStreamIndex = metadata.streams.find(stream => stream.codec_type === "audio")?.index;
    } else {
      try { await new Bun.Image(await readFile(source.path, { signal })).metadata(); }
      catch { invalid(`第 ${index + 1} 镜头不是有效关键帧图片`); }
    }
    const filters = [`scale=${frameSize.width}:${frameSize.height}:force_original_aspect_ratio=decrease`, `pad=${frameSize.width}:${frameSize.height}:(ow-iw)/2:(oh-ih)/2`, "setsar=1", "fps=30", `tpad=stop_mode=clone:stop_duration=${version.duration}`, `trim=duration=${version.duration}`, "setpts=PTS-STARTPTS"];
    if (version.subtitle.trim() && font) {
      const textPath = join(destination.path, `subtitle${index}.txt`);
      await writeAtomic(textPath, wrapSubtitle(version.subtitle, Math.floor((frameSize.width - 80 * subtitleScale) / subtitleSize)), { exclusive: true });
      // ACT: 滤镜文件路径只含已校验的 UUID 与固定文件名，避免工作目录中的引号或冒号进入滤镜语法。
      filters.push(`drawtext=fontfile='${folder}/${font}':textfile='${folder}/subtitle${index}.txt':expansion=none:fontcolor=white:fontsize=${subtitleSize}:line_spacing=${8 * subtitleScale}:box=1:boxcolor=black@0.45:boxborderw=${12 * subtitleScale}:x=(w-text_w)/2:y=h-text_h-${Math.round(frameSize.height * 0.078125)}:enable='gte(t,${version.subtitleStart ?? 0})*lt(t,${version.subtitleEnd ?? version.duration})'`);
    }
    const segment = `${folder}/segment${index}.mp4`;
    const command = ffmpeg(asset.path).inputOptions("-protocol_whitelist", "file");
    if (mode === "storyboard") command.inputOptions("-f", "image2", "-pattern_type", "none", "-loop", "1", "-framerate", "30");
    else {
      command.inputOptions("-format_whitelist", "mov,matroska,webm");
      if (version.trimStart) command.inputOptions("-ss", String(version.trimStart));
    }
    command.duration(version.duration).videoCodec("libx264").format("mp4").videoFilters(filters)
      .outputOptions("-map", `0:${streamIndex}`, "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    if (originalAudio) {
      command.audioCodec("aac").audioBitrate("192k").audioFrequency(48000).audioChannels(2);
      if (audioStreamIndex !== undefined) command.outputOptions("-map", `0:${audioStreamIndex}`).audioFilters(["apad", `atrim=duration=${version.duration}`, "asetpts=PTS-STARTPTS"]);
      // ACT: 无声镜头补同规格静音轨，使有对白与无声素材可以按相同时长安全拼接。
      else command.complexFilter(`anullsrc=sample_rate=48000:channel_layout=stereo,atrim=duration=${version.duration}[segmentAudio]`).outputOptions("-map", "[segmentAudio]");
    } else command.noAudio();
    await run(command.output(segment), signal);
    segments.push(segment);
  }
  // ACT: 清单只引用当前导出目录生成的固定文件名，不将用户路径写入 concat 协议。
  const manifest = `${folder}/segments.txt`;
  await writeAtomic(join(destination.path, "segments.txt"), segments.map((_segment, index) => `file 'segment${index}.mp4'`).join("\n") + "\n", { exclusive: true });
  const path = `${folder}/finalVideo.mp4`;
  const expected = versions.reduce((sum, version) => sum + version.duration, 0);
  const finalCommand = ffmpeg(manifest).inputOptions("-f", "concat", "-safe", "1", "-protocol_whitelist", "file", "-format_whitelist", "concat,mov").videoCodec("copy").format("mp4");
  const audioTracks = (project.audioTracks ?? []).filter(track => !track.muted && track.volume > 0);
  const audioFilters: string[] = [];
  const audioLabels: string[] = [];
  let audioInput = 1;
  if (originalAudio || project.music || audioTracks.length) {
    audioFilters.push(originalAudio
      ? `[0:a:0]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[baseAudio]`
      : `anullsrc=sample_rate=48000:channel_layout=stereo,atrim=duration=${expected}[baseAudio]`);
    audioLabels.push("[baseAudio]");
  }
  if (project.music) {
    const source = await resolveWorkspacePath(cwd, project.music.asset.path);
    const info = await stat(source.path);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("配乐文件无效或超过 100 MB");
    await validateAudio(cwd, project.music.asset.path, signal);
    finalCommand.input(project.music.asset.path).inputOptions("-stream_loop", "-1", "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm,ogg,wav,mp3,flac,aac");
    audioFilters.push(`[${audioInput++}:a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${expected},asetpts=PTS-STARTPTS,volume=${project.music.volume}[backgroundAudio]`);
    audioLabels.push("[backgroundAudio]");
  }
  const shotStarts = new Map<string, number>();
  let shotStart = 0;
  shots.forEach((shot, index) => { shotStarts.set(shot.id, shotStart); shotStart += versions[index]!.duration; });
  for (const [index, track] of audioTracks.entries()) {
    const source = await resolveWorkspacePath(cwd, track.asset.path);
    const info = await stat(source.path);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid(`声音“${track.label}”文件无效或超过 100 MB`);
    const sourceDuration = await validateAudio(cwd, track.asset.path, signal);
    if (track.shotId && !shotStarts.has(track.shotId)) invalid(`声音“${track.label}”绑定的镜头已不存在`);
    const start = (track.shotId ? shotStarts.get(track.shotId)! : 0) + track.start;
    if (start >= expected) invalid(`声音“${track.label}”的起点超出成片时长，请调整位置`);
    if (track.trimStart + track.duration > sourceDuration + 0.05) invalid(`声音“${track.label}”的裁剪范围超出音频时长，请重新调整`);
    const duration = Math.min(track.duration, expected - start);
    finalCommand.input(track.asset.path).inputOptions("-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm,ogg,wav,mp3,flac,aac");
    const label = `trackAudio${index}`;
    audioFilters.push(`[${audioInput++}:a:0]atrim=start=${track.trimStart}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${track.volume},adelay=${Math.round(start * 1000)}:all=1[${label}]`);
    audioLabels.push(`[${label}]`);
  }
  if (audioLabels.length) {
    audioFilters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=false:latency=true[mixedAudio]`);
    finalCommand.complexFilter(audioFilters).outputOptions("-map", "0:v:0", "-map", "[mixedAudio]").audioCodec("aac").audioBitrate("192k").audioFrequency(48000).audioChannels(2).duration(expected);
  } else finalCommand.noAudio();
  await run(finalCommand.outputOptions("-movflags", "+faststart").output(path), signal);
  const result = await probe(cwd, path, signal);
  const actual = Number(result.format.duration);
  const video = result.streams.find(stream => stream.codec_type === "video");
  if (!video || video.width !== frameSize.width || video.height !== frameSize.height || !Number.isFinite(actual) || Math.abs(actual - expected) > 0.15) invalid("成片校验失败，请检查画幅与镜头时长后重新合成");
  if (audioLabels.length && !result.streams.some(stream => stream.codec_type === "audio")) invalid("成片缺少所选音轨，请重新合成");
  return {
    path, mimeType: "video/mp4", createdAt: new Date().toISOString(),
    inputHash: createHash("sha256").update(JSON.stringify({ mode, ratio: project.ratio, exportSettings: project.exportSettings, originalAudio, music: project.music, audioTracks: project.audioTracks, shots: shots.map((shot, index) => ({ shotId: shot.id, versionId: versions[index]!.id, source: mode === "storyboard" ? versions[index]!.keyframe : versions[index]!.clip, subtitle: versions[index]!.subtitle, duration: versions[index]!.duration, trimStart: versions[index]!.trimStart ?? 0, subtitleStart: versions[index]!.subtitleStart ?? 0, subtitleEnd: versions[index]!.subtitleEnd ?? versions[index]!.duration })) })).digest("hex"),
  };
}
