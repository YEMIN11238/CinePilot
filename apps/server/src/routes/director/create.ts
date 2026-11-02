import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, realpath, rm, stat, writeAtomic } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import type { DirectorGenerationInput, DirectorModel, DirectorProject } from "@/lib/directorTypes";
import { creativeTemplates } from "@/lib/directorTemplates";
import u from "@/utils";
import { generationInputSchema, modelsSchema } from "@/utils/director";
import { detectMimeType } from "@/utils/media/priceReference";

const maxReferenceBytes = 8 * 1024 * 1024;
const creativeRequestSchema = z.strictObject({
  kind: z.enum(["image", "video"]), prompt: z.string().trim().min(1).max(6000), style: z.string().trim().max(1000).optional(),
  ratio: z.enum(["16:9", "9:16", "1:1"]), duration: z.union([z.literal(5), z.literal(10)]).optional(), models: modelsSchema.optional(),
  referenceUpload: z.strictObject({ name: z.string().trim().min(1).max(200), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(4).max(Math.ceil(maxReferenceBytes / 3) * 4).refine(value => value.length % 4 === 0, "参考图编码无效") }).optional(),
});
const templateOverridesSchema = z.strictObject({ title: z.string().trim().min(1).max(120), prompt: z.string().trim().min(1).max(6000), motionPrompt: z.string().trim().min(1).max(6000).optional() });
const schema = z.strictObject({ requestId: z.uuid(), kind: z.enum(["canvas", "edit"]), title: z.string().trim().min(1).max(120), templateId: z.string().min(1).max(80).optional(), templateOverrides: templateOverridesSchema.optional(), creativeRequest: creativeRequestSchema.optional() });
type CreativeRequest = z.infer<typeof creativeRequestSchema>;
type CreationRecord = { inputHash: string; focusNodeId?: string; initialGeneration: DirectorGenerationInput | null };
type CreatedProject = { directory: string; title: string; project: DirectorProject; focusNodeId?: string; initialGeneration: DirectorGenerationInput | null };
type CreationNode = { id: string; kind: "text" | "image" | "video"; title: string; text: string; position: { x: number; y: number }; asset?: { path: string; mimeType: string }; generation?: { ratio: CreativeRequest["ratio"]; duration: 5 | 10; model?: DirectorModel; requestId?: string; inputSignature?: string } };
const creating = new Map<string, { signature: string; promise: Promise<CreatedProject> }>();

async function prepareCreativeGraph(directory: string, project: DirectorProject, input: CreativeRequest) {
  const promptId = randomUUID();
  const nodes: CreationNode[] = [{ id: promptId, kind: "text", title: "创作要求", text: input.prompt, position: { x: 80, y: 100 } }];
  const edges: { id: string; source: string; target: string }[] = [];
  const reference = project.referenceImage;
  const style = input.style && input.style !== input.prompt ? input.style : "";
  if (style) nodes.push({ id: randomUUID(), kind: "text", title: "画面风格", text: style, position: { x: 80, y: 430 } });
  if (reference) nodes.push({ id: randomUUID(), kind: "image", title: input.referenceUpload!.name.slice(0, 120), text: "", asset: reference, position: { x: 80, y: 650 } });
  const needsFrame = input.kind === "video" && !reference;
  const firstKind = needsFrame ? "image" : input.kind;
  const first: CreationNode = {
    id: randomUUID(), kind: firstKind, title: needsFrame ? "生成视频首帧" : firstKind === "image" ? "生成图片" : "生成视频", position: { x: 470, y: 100 },
    text: needsFrame ? "先为上游视频要求生成一张静态首帧，主体清晰、构图稳定，保留后续运动空间，不拼接多个画面。" : "",
    generation: { ratio: input.ratio, duration: input.duration ?? 5, ...(project.models[firstKind] ? { model: { ...project.models[firstKind]! } } : {}) },
  };
  edges.push(...nodes.map(node => ({ id: randomUUID(), source: node.id, target: first.id })));
  nodes.push(first);
  if (needsFrame) {
    const video: CreationNode = { id: randomUUID(), kind: "video", title: "生成视频", text: "保持首帧主体与画面风格，按照上游创作要求生成单一连续镜头。", position: { x: 860, y: 100 }, generation: { ratio: input.ratio, duration: input.duration ?? 5, ...(project.models.video ? { model: { ...project.models.video } } : {}) } };
    nodes.push(video); edges.push({ id: randomUUID(), source: first.id, target: video.id });
  }
  if (nodes.some(node => (node.generation?.model?.modelId.length ?? 0) > 200)) throw Object.assign(new Error("所选模型 ID 超过画布支持的 200 字，请在模型设置中检查后重试"), { status: 400 });
  const requestId = randomUUID();
  first.generation!.requestId = requestId;
  let initialGeneration: DirectorGenerationInput | null = null;
  const model = first.generation!.model;
  if (model && u.mediaProvider.getMediaProviderApiKey(model.providerId)) {
    const fields = { nodeId: first.id, kind: firstKind, prompt: [input.prompt, style, first.text].filter(Boolean).join("\n\n"), ...(reference ? { reference } : {}), model, ratio: input.ratio, ...(firstKind === "video" ? { duration: first.generation!.duration } : {}) };
    initialGeneration = generationInputSchema.parse({ ...fields, requestId });
    first.generation!.inputSignature = JSON.stringify(fields);
  }
  await writeAtomic(join(directory, "directorCreativeGraph.json"), `${JSON.stringify({ cinePilotCreativeGraph: 1, nodes, edges, positions: Object.fromEntries(nodes.map(node => [node.id, node.position])), appliedInputs: {} }, null, 2)}\n`, { exclusive: true });
  return { focusNodeId: first.id, initialGeneration };
}

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("请在本机创作页面新建项目"), { status: 403 });
  const { requestId, ...input } = schema.parse(req.body);
  const sourceTemplate = input.templateId ? creativeTemplates.find(item => item.id === input.templateId) : undefined;
  if (input.templateId && !sourceTemplate) throw Object.assign(new Error("未找到此创作模板，请刷新模板库后重试"), { status: 400 });
  if (input.templateOverrides && !sourceTemplate) throw Object.assign(new Error("自定义模板内容必须指定模板"), { status: 400 });
  if (input.templateOverrides?.motionPrompt !== undefined && sourceTemplate?.outputKind !== "video") throw Object.assign(new Error("图片模板不接受视频动作，请修改图片描述"), { status: 400 });
  const template = sourceTemplate ? { ...sourceTemplate, ...input.templateOverrides } : undefined;
  if ((template || input.creativeRequest) && input.kind !== "canvas") throw Object.assign(new Error("此创作请求需要创建画布项目"), { status: 400 });
  if (template && input.creativeRequest) throw Object.assign(new Error("模板与直接生成请求不能同时提交"), { status: 400 });
  const signature = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = creating.get(requestId);
  if (previous && previous.signature !== signature) throw Object.assign(new Error("同一次创建的内容已变化，请重新发起新项目"), { status: 409 });
  if (!previous) {
    const promise = (async (): Promise<CreatedProject> => {
      const workspaceRoot = join(dirname(u.conf.path), "workspaces");
      await mkdir(workspaceRoot, { recursive: true });
      const root = await realpath(workspaceRoot);
      const name = `project${requestId.replaceAll("-", "")}`;
      const destination = await u.workspaceFile.resolveWorkspacePath(root, name);
      const existing = await stat(destination.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
      if (existing) {
        let record: Partial<CreationRecord> = {};
        try { record = JSON.parse(await readFile(join(destination.path, "directorCreate.json"), "utf8")); }
        catch { /* 未识别的原项目保留，不能覆盖。 */ }
        if (record.inputHash !== signature) throw Object.assign(new Error("同一次创建的内容已变化，原项目已保留"), { status: 409 });
        const directory = await u.workspace.resolveWorkspace(req, destination.path);
        const project = await u.director.readProject(directory);
        if (!project) throw Object.assign(new Error("已有项目不完整，请先检查项目文件"), { status: 409 });
        const initialGeneration = record.initialGeneration ? generationInputSchema.parse(record.initialGeneration) : null;
        return { directory, title: project.title, project, ...(typeof record.focusNodeId === "string" ? { focusNodeId: record.focusNodeId } : {}), initialGeneration: initialGeneration && u.mediaProvider.getMediaProviderApiKey(initialGeneration.model.providerId) ? initialGeneration : null };
      }
      const draftRoot = join(dirname(u.conf.path), "directorDrafts");
      await mkdir(draftRoot, { recursive: true });
      const temporary = await u.workspaceFile.resolveWorkspacePath(await realpath(draftRoot), name);
      try { await mkdir(temporary.path); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") throw Object.assign(new Error("上次创建被中断，请核对已有项目，或发起新项目"), { status: 409 });
        throw cause;
      }
      try {
        const record: CreationRecord = { inputHash: signature, initialGeneration: null };
        await writeAtomic(join(temporary.path, "directorCreate.json"), `${JSON.stringify(record)}\n`, { exclusive: true });
        const creative = input.creativeRequest;
        if (template?.outputKind === "video" && [template.prompt, template.motionPrompt ?? "保持首帧主体与风格，生成单一连续镜头。"].join("\n\n").length > 12000) throw Object.assign(new Error("首帧描述与视频动作合并后超过 12000 字，请精简后再创建模板项目"), { status: 400 });
        if (creative?.models) {
          const available = await u.mediaGeneration.listMediaModels();
          for (const kind of ["image", "video"] as const) {
            const model = creative.models[kind];
            if (model && !available.some(item => item.type === kind && item.providerId === model.providerId && item.modelId === model.modelId)) throw Object.assign(new Error(`所选${kind === "image" ? "图片" : "视频"}模型不可用，请刷新模型列表`), { status: 400 });
          }
        }
        let referenceImage: DirectorProject["referenceImage"];
        if (creative?.referenceUpload) {
          const upload = creative.referenceUpload;
          const bytes = Buffer.from(upload.base64, "base64");
          const mimeType = detectMimeType(bytes, "");
          if (!bytes.length || bytes.length > maxReferenceBytes || bytes.toString("base64") !== upload.base64 || mimeType !== upload.mimeType) throw Object.assign(new Error("参考图内容或类型无效，请选择 8 MB 以内的 PNG、JPEG 或 WebP 图片"), { status: 400 });
          let dimensions;
          try { dimensions = await new Bun.Image(bytes).metadata(); }
          catch { throw Object.assign(new Error("参考图无法打开，请重新选择图片"), { status: 400 }); }
          if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 32000000) throw Object.assign(new Error("参考图像素超过限制，请使用不超过 3200 万像素的图片"), { status: 400 });
          const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[upload.mimeType];
          const path = `referenceInput.${extension}`;
          await writeAtomic(join(temporary.path, path), bytes, { exclusive: true });
          referenceImage = { path, mimeType };
        }
        const project = await u.director.createProject(temporary.path, { title: input.templateOverrides?.title ?? input.title, brief: creative?.prompt ?? template?.prompt ?? (input.kind === "canvas" ? "自由画布创作" : "已有素材剪辑"), style: creative?.style || template?.description || "遵循导入素材与当前创作要求", shots: [], ratio: creative?.ratio ?? template?.ratio ?? "16:9", creationKind: input.kind, ...(creative?.models ? { models: creative.models } : {}), ...(referenceImage ? { referenceImage } : {}) });
        if (referenceImage) await rm(join(temporary.path, referenceImage.path));
        if (creative) Object.assign(record, await prepareCreativeGraph(temporary.path, project, creative));
        if (template) {
          if ([project.models.image, ...(template.outputKind === "video" ? [project.models.video] : [])].some(model => model && model.modelId.length > 200)) throw Object.assign(new Error("默认模型 ID 超过画布支持的 200 字，请在模型设置中检查后重试"), { status: 400 });
          const promptId = randomUUID();
          const imageId = randomUUID();
          const videoId = randomUUID();
          const generation = { ratio: template.ratio, duration: template.duration };
          const imageNode = { id: imageId, kind: "image", title: template.outputKind === "video" ? "02 · 生成首帧" : "02 · 生成图片", text: template.outputKind === "video" ? "依据上游创作描述，生成一个静态首帧。主体清晰、构图稳定，保留后续运动空间。不要将多个镜头拼接在同一张图片中。" : "依据上游描述生成完整图片，严格遵循角色设定、构图与画面风格。", generation: { ...generation, ...(project.models.image ? { model: { ...project.models.image } } : {}) }, position: { x: 470, y: 100 } };
          const nodes = [
            { id: promptId, kind: "text", title: "01 · 创作描述", text: template.prompt, position: { x: 80, y: 100 } },
            imageNode,
            ...(template.outputKind === "video" ? [{ id: videoId, kind: "video", title: "03 · 生成视频", text: template.motionPrompt ?? "保持首帧主体与风格，生成单一连续镜头。", generation: { ...generation, ...(project.models.video ? { model: { ...project.models.video } } : {}) }, position: { x: 860, y: 100 } }] : []),
          ];
          const edges = [{ id: randomUUID(), source: promptId, target: imageId }, ...(template.outputKind === "video" ? [{ id: randomUUID(), source: imageId, target: videoId }] : [])];
          await writeAtomic(join(temporary.path, "directorCreativeGraph.json"), `${JSON.stringify({ cinePilotCreativeGraph: 1, nodes, edges, positions: Object.fromEntries(nodes.map(node => [node.id, node.position])), appliedInputs: {} }, null, 2)}\n`, { exclusive: true });
          await writeAtomic(join(temporary.path, "directorTemplate.json"), `${JSON.stringify({ schemaVersion: 1, source: "CinePilot", templateId: template.id, templateTitle: sourceTemplate!.title, templateVersion: 1, ...(input.templateOverrides ? { overrides: input.templateOverrides } : {}), createdAt: new Date().toISOString() }, null, 2)}\n`, { exclusive: true });
        }
        await writeAtomic(join(temporary.path, "directorCreate.json"), `${JSON.stringify(record)}\n`);
        await u.workspaceFile.renameWorkspaceFile(temporary.path, destination.path);
        const directory = await u.workspace.resolveWorkspace(req, destination.path);
        return { directory, title: project.title, project, ...(record.focusNodeId ? { focusNodeId: record.focusNodeId } : {}), initialGeneration: record.initialGeneration };
      } catch (cause) {
        await rm(temporary.path, { recursive: true, force: true }).catch(cleanupFailure => console.warn("空白项目目录清理失败", cleanupFailure));
        throw cause;
      }
    })().finally(() => { creating.delete(requestId); });
    creating.set(requestId, { signature, promise });
  }
  res.set("Cache-Control", "no-store").json(success(await creating.get(requestId)!.promise));
});
