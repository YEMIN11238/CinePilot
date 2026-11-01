import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, readFile, rm, stat, writeAtomic } from "@toonflow/file";
import { z } from "zod";
import type {
  DirectorAsset, DirectorCreateInput, DirectorGenerationInput, DirectorModels, DirectorPlanInput, DirectorProject,
  DirectorShot, DirectorTask, ShotFields, ShotPatch, ShotVersion, DirectorEditState, DirectorAudioTrack,
} from "@/lib/directorTypes";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";
import { detectMimeType } from "@/utils/media/priceReference";
import { listMediaModels } from "@/utils/media/generation";
import { getMediaProviderApiKey } from "@/utils/media/provider";
import { directorGenerationContext } from "@/lib/directorReview";
import { generateShotMedia, generateCanvasMedia, validateCanvasGeneration, queryArkTask, composeProject, validateGeneration, validateAudio, readVideoDuration } from "@/utils/director/media";
import { assertProductionCanvasScope, assertProductionReady, assertProductionTarget, dialogueSchema, hasApprovedSample, invalidateProductionReviews, productionSchema, sameProductionShotContent } from "./productionState";

const processOwner = randomUUID();
const projectQueues = new Map<string, Promise<void>>();
async function withProject<T>(path: string, action: () => Promise<T>) {
  const previous = projectQueues.get(path) ?? Promise.resolve();
  let releaseQueue = () => {};
  const queued = new Promise<void>(resolve => { releaseQueue = resolve; });
  projectQueues.set(path, queued);
  await previous;
  try { return await action(); }
  finally { releaseQueue(); if (projectQueues.get(path) === queued) projectQueues.delete(path); }
}
const assetSchema = z.strictObject({
  path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), createdAt: z.iso.datetime(),
  providerId: z.string().optional(), modelId: z.string().optional(), inputHash: z.string().optional(),
  sourceNodeId: z.string().min(1).max(120).optional(), sourceTaskId: z.uuid().optional(),
});
const referenceSchema = z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().startsWith("image/") });
export const shotFieldsSchema = z.strictObject({
  title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(12000),
  camera: z.string().trim().min(1).max(2000), duration: z.number().finite().min(1).max(30), subtitle: z.string().max(300),
  trimStart: z.number().finite().min(0).max(3600).optional(),
  subtitleStart: z.number().finite().min(0).max(30).optional(), subtitleEnd: z.number().finite().positive().max(30).optional(),
  sceneId: z.uuid().optional(), characterIds: z.array(z.uuid()).max(12).optional(),
  startState: z.string().max(2000).optional(), endState: z.string().max(2000).optional(), dialogues: z.array(dialogueSchema).max(30).optional(),
});
export const patchSchema = shotFieldsSchema.partial().refine(value => Object.keys(value).length > 0, "镜头修改不能为空");
const modelSchema = z.strictObject({ providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/), modelId: z.string().trim().min(1).max(256), resolution: z.string().max(64).optional(), size: z.string().max(64).optional() });
export const modelsSchema = z.strictObject({ image: modelSchema.optional(), video: modelSchema.optional() });
export const createInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120), brief: z.string().trim().min(1).max(12000), style: z.string().trim().min(1).max(1000),
  shots: z.array(shotFieldsSchema).max(24), models: modelsSchema.optional(), referenceImage: referenceSchema.optional(),
  ratio: z.enum(["9:16", "16:9", "1:1"]).optional(), production: productionSchema.optional(),
  creationKind: z.enum(["canvas", "edit"]).optional(),
});
export const generationInputSchema = z.strictObject({
  requestId: z.uuid(), nodeId: z.string().trim().min(1).max(120), kind: z.enum(["image", "video"]), prompt: z.string().trim().min(1).max(12000),
  reference: z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().startsWith("image/").max(128), createdAt: z.iso.datetime().optional() }).optional(),
  model: modelSchema, ratio: z.enum(["9:16", "16:9", "1:1"]), duration: z.union([z.literal(5), z.literal(10)]).optional(),
  scope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("shot"), shotId: z.uuid(), versionId: z.uuid() }),
    z.strictObject({ kind: z.literal("character"), characterId: z.uuid(), revision: z.number().int().positive() }),
    z.strictObject({ kind: z.literal("scene"), sceneId: z.uuid(), scriptVersionId: z.uuid() }),
  ]).optional(),
});
export const planInputSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(12000), expectedRevision: z.number().int().positive(),
  changes: z.array(z.strictObject({ shotId: z.uuid(), patch: patchSchema })).min(1).max(24)
    .refine(value => new Set(value.map(item => item.shotId)).size === value.length, "同一镜头只能修改一次"),
});
const versionSchema = shotFieldsSchema.extend({ id: z.uuid(), number: z.number().int().positive(), createdAt: z.iso.datetime(), reason: z.string(), candidateStage: z.enum(["image", "video"]).optional(), keyframe: assetSchema.optional(), clip: assetSchema.optional() });
const taskSchema = z.strictObject({
  id: z.uuid(), owner: z.uuid(), stage: z.enum(["image", "video", "export"]), shotId: z.uuid().optional(), versionId: z.uuid().optional(),
  status: z.enum(["queued", "running", "succeeded", "failed", "interrupted", "verificationRequired", "cancelled"]), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  cancelRequested: z.boolean().optional(), verificationNote: z.string().max(2000).optional(),
  error: z.string().optional(), output: assetSchema.optional(),
  exportMode: z.enum(["video", "storyboard"]).optional(),
  nodeId: z.string().min(1).max(120).optional(), requestId: z.uuid().optional(), inputHash: z.string().optional(), generation: generationInputSchema.optional(),
  generationContextKey: z.string().max(2000).optional(),
  providerId: z.string().optional(), modelId: z.string().optional(), providerTaskId: z.string().min(1).max(256).optional(), providerEndpoint: z.string().max(2048).optional(),
  submissionState: z.enum(["prepared", "submitting", "submitted"]).optional(),
  upstreamTerminalFailure: z.boolean().optional(),
});
const planSchema = z.strictObject({
  id: z.uuid(), instruction: z.string(), baseRevision: z.number().int().positive(), createdAt: z.iso.datetime(), status: z.enum(["pending", "applied", "discarded"]),
  changes: z.array(z.strictObject({ shotId: z.uuid(), baseVersionId: z.uuid(), patch: patchSchema })).min(1).max(24)
    .refine(value => new Set(value.map(change => change.shotId)).size === value.length, "修改计划镜头重复"),
  effects: z.array(z.strictObject({ shotId: z.uuid(), regenerate: z.array(z.enum(["image", "video"])), reuse: z.array(z.enum(["image", "video"])) })),
});
const shotSchema = z.strictObject({ id: z.uuid(), order: z.number().int().min(1).max(24), locked: z.boolean(), currentVersionId: z.uuid(), versions: z.array(versionSchema).min(1).max(200) });
const musicSchema = z.strictObject({ asset: assetSchema, volume: z.number().finite().min(0).max(1) });
const exportSettingsSchema = z.strictObject({ resolution: z.enum(["720p", "1080p"]) });
const audioTrackSchema = z.strictObject({ id: z.uuid(), label: z.string().trim().min(1).max(120), kind: z.enum(["dialogue", "sfx"]), asset: assetSchema, shotId: z.uuid().optional(), characterId: z.uuid().optional(), start: z.number().finite().min(0).max(3600), trimStart: z.number().finite().min(0).max(3600), duration: z.number().finite().positive().max(3600), sourceDuration: z.number().finite().positive().optional(), volume: z.number().finite().min(0).max(1), muted: z.boolean().optional() });
const editStateSchema = z.strictObject({ shots: z.array(z.strictObject({ id: z.uuid(), order: z.number().int().min(1).max(24), locked: z.boolean(), currentVersionId: z.uuid() })).max(24), ratio: z.enum(["9:16", "16:9", "1:1"]), music: musicSchema.optional(), audioTracks: z.array(audioTrackSchema).max(100).optional(), exportSettings: exportSettingsSchema.optional(), storyboard: productionSchema.shape.storyboard });
const historyEntrySchema = z.strictObject({ id: z.uuid(), label: z.string().max(120), createdAt: z.iso.datetime(), before: editStateSchema, after: editStateSchema });
const projectSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.uuid(), revision: z.number().int().positive(), title: z.string(), brief: z.string(), style: z.string(), ratio: z.enum(["9:16", "16:9", "1:1"]),
  originalAudio: z.boolean().optional(), production: productionSchema.optional(), creationKind: z.enum(["canvas", "edit"]).optional(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), models: modelsSchema, referenceImage: referenceSchema.optional(),
  music: musicSchema.optional(), audioTracks: z.array(audioTrackSchema).max(100).optional(), exportSettings: exportSettingsSchema.optional(),
  shots: z.array(shotSchema).max(24), retiredShots: z.array(shotSchema).max(200).optional(),
  history: z.strictObject({ past: z.array(historyEntrySchema).max(30), future: z.array(historyEntrySchema).max(30) }).optional(),
  plans: z.array(planSchema).max(500), tasks: z.array(taskSchema).max(2000),
  exports: z.array(z.strictObject({ id: z.uuid(), asset: assetSchema, createdAt: z.iso.datetime(), shotVersions: z.array(z.strictObject({ shotId: z.uuid(), versionId: z.uuid() })).min(1).max(24), mode: z.enum(["video", "storyboard"]).optional(), musicPath: z.string().optional(), musicVolume: z.number().finite().min(0).max(1).optional(), originalAudio: z.boolean().optional(), ratio: z.enum(["9:16", "16:9", "1:1"]).optional(), audioSignature: z.string().optional(), resolution: z.enum(["720p", "1080p"]).optional() })).max(200),
});

function invalid(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function now() { return new Date().toISOString(); }
function isActive(task: DirectorTask) { return task.status === "queued" || task.status === "running"; }
export function currentVersion(shot: DirectorShot) {
  const version = shot.versions.find(item => item.id === shot.currentVersionId);
  if (!version) invalid("镜头的当前版本不存在，请检查项目文件", 409);
  return version;
}
function findShot(project: DirectorProject, shotId: string) {
  const shot = project.shots.find(item => item.id === shotId);
  if (!shot) invalid("镜头不存在", 404);
  return shot;
}
function checkEditable(project: DirectorProject, shot: DirectorShot) {
  if (shot.locked) invalid(`镜头 ${shot.order} 已锁定，请先解锁`, 409);
  if (project.tasks.some(task => isActive(task) && (task.stage === "export" || task.shotId === shot.id))) invalid(`镜头 ${shot.order} 正在执行任务，请稍后修改`, 409);
}
function checkRevision(project: DirectorProject, expectedRevision: number) {
  if (project.revision !== expectedRevision) invalid("项目已更新，请刷新后重试。原内容未被覆盖。", 409);
}
function validateTiming(fields: ShotFields) {
  const start = fields.subtitleStart ?? 0;
  const end = fields.subtitleEnd ?? fields.duration;
  if (start >= end || end > fields.duration) invalid("字幕时间须满足 0 ≤ 入点 < 出点 ≤ 镜头时长，请同时调整字幕时间");
}
async function projectPath(cwd: string) { return (await resolveWorkspacePath(cwd, "directorProject.json")).path; }
async function loadProject(path: string): Promise<DirectorProject | null> {
  const info = await stat(path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
  if (!info) return null;
  if (!info.isFile() || info.size > 10000000) invalid("导演项目文件无效或超过 10 MB", 409);
  let content: unknown;
  try { content = JSON.parse((await readFile(path)).toString("utf8")); }
  catch { invalid("导演项目 JSON 无效，原文件未修改", 409); }
  const value = projectSchema.safeParse(content);
  if (!value.success) invalid("导演项目格式无效，原文件未修改", 409);
  const project = value.data;
  if (project.production) {
    const workflow = project.production;
    const script = workflow.scriptVersions.find(item => item.id === workflow.currentScriptVersionId);
    if (!script || new Set(workflow.characters.map(item => item.id)).size !== workflow.characters.length || new Set(workflow.scriptVersions.map(item => item.id)).size !== workflow.scriptVersions.length) invalid("剧本或角色标识无效，原文件未修改", 409);
    if (new Set(script.scenes.map(scene => scene.id)).size !== script.scenes.length || script.scenes.some(scene => scene.dialogues.some(line => !workflow.characters.some(character => character.id === line.speakerId)))) invalid("当前剧本的场景或对白归属无效，原文件未修改", 409);
  }
  if ((!project.shots.length && !project.production && !project.creationKind) || new Set(project.shots.map(shot => shot.id)).size !== project.shots.length || project.shots.some((shot, index) => !project.shots.some(item => item.order === index + 1))) invalid("镜头标识或顺序无效", 409);
  const allShots = [...project.shots, ...(project.retiredShots ?? [])];
  if (new Set(allShots.map(shot => shot.id)).size !== allShots.length) invalid("镜头与移除历史的标识重复，原文件未修改", 409);
  allShots.forEach(shot => {
    if (new Set(shot.versions.map(version => version.id)).size !== shot.versions.length) invalid("镜头版本标识重复", 409);
    currentVersion(shot);
    shot.versions.forEach(validateTiming);
  });
  return project;
}
async function saveProject(path: string, project: DirectorProject, exclusive = false) {
  project.updatedAt = now();
  projectSchema.parse(project);
  const content = `${JSON.stringify(project, null, 2)}\n`;
  if (Buffer.byteLength(content) > 10000000) invalid("导演项目记录已超过 10 MB，原文件未被覆盖", 409);
  await writeAtomic(path, content, { exclusive });
}
function recoverTasks(project: DirectorProject) {
  let changed = false;
  for (const task of project.tasks) if (isActive(task) && task.owner !== processOwner) {
    task.status = task.stage !== "export" && task.status === "running" && (task.stage === "video" || task.submissionState === "submitting" || task.submissionState === "submitted") ? "verificationRequired" : "interrupted";
    task.error = "服务已重启，任务已中断。请检查供应商任务结果后手动重试，系统不会自动再次提交。";
    task.updatedAt = now();
    changed = true;
  }
  return changed;
}
export async function readProject(cwd: string): Promise<DirectorProject | null> {
  const path = await projectPath(cwd);
  return withProject(path, async () => {
    const release = lockWorkspaceFiles([path]);
    try {
      const project = await loadProject(path);
      if (project && recoverTasks(project)) { project.revision++; await saveProject(path, project); }
      return project;
    } finally { release(); }
  });
}
function editState(project: DirectorProject): DirectorEditState {
  return structuredClone({ shots: project.shots.map(({ id, order, locked, currentVersionId }) => ({ id, order, locked, currentVersionId })), ratio: project.ratio, ...(project.music ? { music: project.music } : {}), ...(project.audioTracks ? { audioTracks: project.audioTracks } : {}), ...(project.exportSettings ? { exportSettings: project.exportSettings } : {}), ...(project.production?.storyboard ? { storyboard: project.production.storyboard } : {}) });
}
export async function mutate(cwd: string, expectedRevision: number | undefined, update: (project: DirectorProject) => void | false | Promise<void | false>, historyLabel?: string) {
  const path = await projectPath(cwd);
  return withProject(path, async () => {
    const release = lockWorkspaceFiles([path]);
    try {
      const project = await loadProject(path);
      if (!project) invalid("请先创建导演项目", 404);
      const recovered = recoverTasks(project);
      if (expectedRevision !== undefined) checkRevision(project, expectedRevision);
      const before = historyLabel ? editState(project) : undefined;
      const changed = await update(project);
      if (changed === false && !recovered) return project;
      if (before) {
        const after = editState(project);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          project.history ??= { past: [], future: [] };
          project.history.past.push({ id: randomUUID(), label: historyLabel!, createdAt: now(), before, after });
          project.history.past = project.history.past.slice(-30);
          project.history.future = [];
        }
      }
      project.revision++;
      await saveProject(path, project);
      return project;
    } finally { release(); }
  });
}

function restoreEditState(project: DirectorProject, state: DirectorEditState) {
  const old = editState(project);
  const affected = new Set([...old.shots, ...state.shots].filter(item => {
    const other = (old.shots.includes(item) ? state.shots : old.shots).find(shot => shot.id === item.id);
    return !other || item.currentVersionId !== other.currentVersionId || item.order !== other.order;
  }).map(item => item.id));
  if (project.shots.some(shot => shot.locked && !state.shots.some(item => item.id === shot.id && item.currentVersionId === shot.currentVersionId))) invalid("撤销或重做会修改已锁定镜头，请先解锁", 409);
  if (project.tasks.some(task => isActive(task) && (task.stage === "export" || task.shotId && affected.has(task.shotId)))) invalid("相关镜头仍在执行任务，请等待结束后撤销或重做", 409);
  const all = new Map([...(project.retiredShots ?? []), ...project.shots].map(shot => [shot.id, shot]));
  const restored = state.shots.map(item => {
    const shot = all.get(item.id);
    if (!shot?.versions.some(version => version.id === item.currentVersionId)) invalid("历史版本素材缺失，未修改当前项目", 409);
    return { ...shot, ...item, locked: shot.locked };
  });
  project.shots = restored;
  project.retiredShots = [...all.values()].filter(shot => !restored.some(item => item.id === shot.id));
  project.ratio = state.ratio;
  for (const key of ["music", "audioTracks", "exportSettings"] as const) {
    if (state[key] === undefined) delete project[key];
    else Object.assign(project, { [key]: structuredClone(state[key]) });
  }
  if (project.production) {
    if (state.storyboard) project.production.storyboard = structuredClone(state.storyboard);
    else delete project.production.storyboard;
    project.production.shotCount = Math.max(1, project.shots.length);
    invalidateProductionReviews(project, project.shots.map(shot => shot.id), "编辑历史已恢复，请复查当前成片");
  }
}
export async function undoProject(cwd: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    const entry = project.history?.past.at(-1);
    if (!entry) invalid("没有可撤销的编辑", 409);
    restoreEditState(project, entry.before);
    project.history!.past.pop(); project.history!.future.push(entry);
  });
}
export async function redoProject(cwd: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    const entry = project.history?.future.at(-1);
    if (!entry) invalid("没有可重做的编辑", 409);
    restoreEditState(project, entry.after);
    project.history!.future.pop(); project.history!.past.push(entry);
  });
}
export async function createProject(cwd: string, input: DirectorCreateInput) {
  const parsed = createInputSchema.parse(input);
  if (!parsed.shots.length && !parsed.production && !parsed.creationKind) invalid("请至少创建一个镜头");
  let defaultModels: DirectorModels = {};
  if (!parsed.models) {
    const available = (await listMediaModels()).filter(model => Boolean(getMediaProviderApiKey(model.providerId)));
    const videos = available.filter(model => model.type === "video");
    const selected = videos.find(model => model.modelId === "doubao-seedance-1-0-pro-fast-251015") ?? videos[0];
    if (selected) {
      const resolutions = selected.durationResolutionMap?.flatMap(item => item.resolution) ?? [];
      const resolution = resolutions.find(value => value === "720p") ?? resolutions[0];
      defaultModels = { video: { providerId: selected.providerId, modelId: selected.modelId, ...(resolution ? { resolution } : {}) } };
    }
    const image = available.find(model => model.type === "image" && model.providerId === "openAi" && model.modelId === "gpt-image-2");
    if (image) defaultModels.image = { providerId: image.providerId, modelId: image.modelId, size: "1K" };
  }
  parsed.shots.forEach(validateTiming);
  let referenceBytes: Buffer | undefined;
  let referenceMime = "";
  if (parsed.referenceImage) {
    const reference = await resolveWorkspacePath(cwd, parsed.referenceImage.path);
    const info = await stat(reference.path);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("产品参考图无效或超过 100 MB");
    referenceBytes = await readFile(reference.path);
    referenceMime = detectMimeType(referenceBytes, "");
    if (!referenceBytes.length || referenceBytes.length > 100 * 1024 * 1024 || !referenceMime.startsWith("image/")) invalid("产品参考图无效或超过 100 MB");
    try { await new Bun.Image(referenceBytes).metadata(); }
    catch { invalid("产品参考图不是有效图片"); }
  }
  const path = await projectPath(cwd);
  return withProject(path, async () => {
    const release = lockWorkspaceFiles([path]);
    try {
      if (await loadProject(path)) invalid("当前工作区已有导演项目，请使用修改计划保留已有镜头", 409);
      const time = now();
      const project: DirectorProject = {
        schemaVersion: 1, id: randomUUID(), revision: 1, title: parsed.title, brief: parsed.brief, style: parsed.style, ratio: parsed.ratio ?? "9:16",
        ...(parsed.production ? { production: parsed.production } : {}),
        ...(parsed.creationKind ? { creationKind: parsed.creationKind } : {}),
        ...(parsed.creationKind === "edit" ? { originalAudio: true } : {}),
        createdAt: time, updatedAt: time, models: parsed.models ?? defaultModels,
        shots: parsed.shots.map((fields, index) => {
          const version: ShotVersion = { ...fields, id: randomUUID(), number: 1, createdAt: time, reason: "初始分镜" };
          return { id: randomUUID(), order: index + 1, locked: false, currentVersionId: version.id, versions: [version] };
        }), plans: [], tasks: [], exports: [],
      };
      if (referenceBytes) {
        const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" } as Record<string, string>)[referenceMime];
        if (!extension) invalid("首版参考图支持 PNG/JPEG/WebP/GIF/AVIF");
        const referencePath = `assets/director/${project.id}/reference/${randomUUID()}.${extension}`;
        const target = await resolveWorkspacePath(cwd, referencePath, true);
        await mkdir(dirname(target.path), { recursive: true });
        await writeAtomic(target.path, referenceBytes, { exclusive: true });
        project.referenceImage = { path: referencePath, mimeType: referenceMime };
      }
      await saveProject(path, project, true);
      return project;
    } finally { release(); }
  });
}
function changedPatch(version: ShotVersion, patch: ShotPatch): ShotPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(version[key as keyof ShotFields]) !== JSON.stringify(value)));
}
function effects(shotId: string, patch: ShotPatch, version: ShotVersion) {
  const visual = ["description", "camera", "sceneId", "characterIds", "startState", "endState"].some(key => patch[key as keyof ShotPatch] !== undefined);
  const video = visual || (!version.clip && patch.duration !== undefined);
  return { shotId, regenerate: [...(visual ? ["image" as const] : []), ...(video ? ["video" as const] : [])], reuse: [...(!visual && version.keyframe ? ["image" as const] : []), ...(!video && version.clip ? ["video" as const] : [])] };
}
async function validateClipTiming(cwd: string, shotId: string, version: ShotVersion, patch: ShotPatch) {
  const next = { ...version, ...patch };
  validateTiming(next);
  if (!version.clip || patch.duration === undefined && patch.trimStart === undefined || effects(shotId, patch, version).regenerate.includes("video")) return;
  const duration = await readVideoDuration(cwd, version.clip.path);
  if ((next.trimStart ?? 0) + next.duration > duration + 0.05) invalid("片段裁剪范围超过源视频时长，原内容未被覆盖", 422);
}
function saveShotVersion(project: DirectorProject, shot: DirectorShot, patch: ShotPatch, reason: string) {
  if (shot.versions.length >= 200) invalid("镜头版本已达首版上限", 409);
  const old = currentVersion(shot);
  const impact = effects(shot.id, patch, old);
  const version: ShotVersion = { ...old, ...patch, id: randomUUID(), number: shot.versions.length + 1, reason, createdAt: now() };
  validateTiming(version);
  if (impact.regenerate.includes("image")) delete version.keyframe;
  if (impact.regenerate.includes("video")) delete version.clip;
  shot.versions.push(version);
  shot.currentVersionId = version.id;
  // 字幕与剪辑参数保留已确认的画面分镜，成片审片仍须针对新版本重新完成。
  if (!impact.regenerate.includes("image")) {
    const binding = project.production?.storyboard?.shotVersions.find(item => item.shotId === shot.id && item.versionId === old.id);
    if (binding) binding.versionId = version.id;
  }
  if (["description", "camera", "duration", "startState", "endState"].some(key => patch[key as keyof ShotPatch] !== undefined)) {
    invalidateProductionReviews(project, project.shots.filter(item => Math.abs(item.order - shot.order) === 1).map(item => item.id), `相邻镜头 ${shot.order} 已修改，请复查衔接`);
  }
}
export async function editShot(cwd: string, shotId: string, patch: ShotPatch, expectedRevision: number) {
  const parsed = patchSchema.parse(patch);
  return mutate(cwd, expectedRevision, async project => {
    const shot = findShot(project, shotId);
    checkEditable(project, shot);
    const changed = changedPatch(currentVersion(shot), parsed);
    if (!Object.keys(changed).length) invalid(`镜头 ${shot.order} 没有实际变化`);
    await validateClipTiming(cwd, shot.id, currentVersion(shot), changed);
    saveShotVersion(project, shot, changed, "手动编辑镜头");
  }, "编辑镜头");
}
export async function createPlan(cwd: string, input: DirectorPlanInput) {
  const parsed = planInputSchema.parse(input);
  return mutate(cwd, parsed.expectedRevision, async project => {
    const changes = await Promise.all(parsed.changes.map(async change => {
      const shot = findShot(project, change.shotId);
      checkEditable(project, shot);
      const version = currentVersion(shot);
      const patch = changedPatch(version, change.patch);
      if (!Object.keys(patch).length) invalid(`镜头 ${shot.order} 没有实际变化`);
      await validateClipTiming(cwd, shot.id, version, patch);
      return { shotId: shot.id, baseVersionId: version.id, patch };
    }));
    if (project.plans.length >= 500) invalid("修改计划已达首版上限，请创建新项目", 409);
    project.plans.push({ id: randomUUID(), instruction: parsed.instruction, baseRevision: project.revision + 1, createdAt: now(), status: "pending", changes, effects: changes.map(change => effects(change.shotId, change.patch, currentVersion(findShot(project, change.shotId)))) });
  });
}
export async function applyPlan(cwd: string, planId: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, async project => {
    const plan = project.plans.find(item => item.id === planId);
    if (!plan) invalid("修改计划不存在", 404);
    if (plan.status !== "pending") invalid(plan.status === "discarded" ? "此修改计划已放弃，请重新制定计划" : "此修改计划已应用，请勿重复提交", 409);
    for (const change of plan.changes) {
      const shot = findShot(project, change.shotId);
      checkEditable(project, shot);
      if (shot.currentVersionId !== change.baseVersionId) invalid(`镜头 ${shot.order} 的版本已改变，请重新制定计划`, 409);
      if (shot.versions.length >= 200) invalid("镜头版本已达首版上限", 409);
      await validateClipTiming(cwd, shot.id, currentVersion(shot), change.patch);
    }
    for (const change of plan.changes) {
      const shot = findShot(project, change.shotId);
      saveShotVersion(project, shot, change.patch, plan.instruction);
    }
    plan.status = "applied";
  }, "应用修改计划");
}
export async function discardPlan(cwd: string, planId: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    const plan = project.plans.find(item => item.id === planId);
    if (!plan) invalid("修改计划不存在", 404);
    if (plan.status !== "pending") invalid(plan.status === "discarded" ? "此修改计划已放弃" : "此修改计划已应用，无法放弃", 409);
    plan.status = "discarded";
  });
}
export async function lockShot(cwd: string, shotId: string, locked: boolean, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    const shot = findShot(project, shotId);
    if (project.tasks.some(task => isActive(task) && task.shotId === shotId)) invalid("请等待当前镜头任务完成后锁定", 409);
    shot.locked = locked;
  });
}
export async function selectVersion(cwd: string, shotId: string, versionId: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    const shot = findShot(project, shotId);
    checkEditable(project, shot);
    const target = shot.versions.find(version => version.id === versionId);
    if (!target) invalid("指定版本不存在", 404);
    const previous = currentVersion(shot);
    if (target.candidateStage === "video" && !target.clip || target.candidateStage === "image" && !target.keyframe) invalid("候选对应的素材尚未就绪，请生成完成后再采用", 422);
    if ((previous.keyframe || previous.clip) && !target.keyframe && !target.clip) invalid("此候选尚无素材，请生成或导入后再替换当前镜头", 422);
    const binding = project.production?.storyboard?.shotVersions.find(item => item.shotId === shot.id && item.versionId === previous.id);
    if (binding && sameProductionShotContent(previous, target)) binding.versionId = target.id;
    shot.currentVersionId = versionId;
    delete target.candidateStage;
  }, "采用镜头版本");
}
export async function configureModels(cwd: string, models: DirectorModels, expectedRevision: number) {
  const parsed = modelsSchema.parse(models);
  return mutate(cwd, expectedRevision, project => {
    if (project.tasks.some(isActive)) invalid("任务执行期间不能切换模型", 409);
    project.models = parsed;
  });
}
export async function setRatio(cwd: string, ratio: DirectorProject["ratio"], expectedRevision: number) {
  z.enum(["9:16", "16:9", "1:1"]).parse(ratio);
  return mutate(cwd, expectedRevision, project => {
    if (project.tasks.some(isActive)) invalid("请等待当前任务结束后调整画幅", 409);
    if (project.ratio === ratio) return false;
    project.ratio = ratio;
    invalidateProductionReviews(project, project.shots.map(shot => shot.id), "成片画幅已变化，请复查构图与字幕布局");
  }, "修改成片画幅");
}
export async function reorderShots(cwd: string, shotIds: string[], expectedRevision: number) {
  z.array(z.uuid()).min(1).max(24).parse(shotIds);
  return mutate(cwd, expectedRevision, project => {
    if (project.tasks.some(task => isActive(task) && task.stage === "export")) invalid("请等待当前合成完成后调整镜头顺序", 409);
    if (new Set(shotIds).size !== project.shots.length || shotIds.some(id => !project.shots.some(shot => shot.id === id))) invalid("镜头顺序必须包含全部镜头，且不能重复");
    project.shots = shotIds.map((id, index) => ({ ...findShot(project, id), order: index + 1 }));
    invalidateProductionReviews(project, shotIds, "镜头顺序已变化，请复查衔接与整片节奏");
  }, "调整镜头顺序");
}
export async function setMusic(cwd: string, music: { path: string; mimeType: string; volume: number } | null, expectedRevision: number) {
  const parsed = z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), volume: z.number().finite().min(0).max(1) }).nullable().parse(music);
  return mutate(cwd, expectedRevision, async project => {
    if (project.tasks.some(task => isActive(task) && task.stage === "export")) invalid("请等待当前合成完成后修改配乐", 409);
    if (!parsed) { delete project.music; invalidateProductionReviews(project, project.shots.map(shot => shot.id), "配乐已变化，请重新检查声画"); return; }
    if (project.music?.asset.path === parsed.path) { project.music.volume = parsed.volume; invalidateProductionReviews(project, project.shots.map(shot => shot.id), "配乐音量已变化，请重新检查声画"); return; }
    const source = await resolveWorkspacePath(cwd, parsed.path);
    const info = await stat(source.path);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("配乐须为不超过 100 MB 的音频文件");
    const bytes = await readFile(source.path);
    const detectedMime = detectMimeType(bytes, "");
    // MP4/WebM 的容器头无法区分音视频，复制后再以真实音轨确认；未知文件头不能靠调用方 MIME 放行。
    const actualMime = detectedMime === "video/mp4" ? "audio/mp4" : detectedMime === "video/webm" ? "audio/webm" : detectedMime;
    const extension = ({ "audio/mpeg": "mp3", "audio/wav": "wav", "audio/flac": "flac", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/aac": "aac", "audio/mp4": "m4a", "audio/webm": "webm" } as Record<string, string>)[actualMime];
    if (!bytes.length || bytes.length > 100 * 1024 * 1024 || !extension) invalid("配乐仅支持 MP3、WAV、FLAC、OGG、AAC、M4A 或 WebM 音频");
    const path = `assets/director/${project.id}/music/${randomUUID()}.${extension}`;
    const destination = await resolveWorkspacePath(cwd, path, true);
    await mkdir(dirname(destination.path), { recursive: true });
    await writeAtomic(destination.path, bytes, { exclusive: true });
    try { await validateAudio(cwd, path); }
    catch (cause) { await rm(destination.path, { force: true }); throw cause; }
    project.music = { asset: { path, mimeType: actualMime, createdAt: now() }, volume: parsed.volume };
    invalidateProductionReviews(project, project.shots.map(shot => shot.id), "配乐已变化，请重新检查声画");
  }, "修改背景音乐");
}
export const audioTrackInputSchema = z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), label: z.string().trim().min(1).max(120), kind: z.enum(["dialogue", "sfx"]), shotId: z.uuid().optional(), characterId: z.uuid().optional(), start: z.number().finite().min(0).max(3600).optional(), trimStart: z.number().finite().min(0).max(3600).optional(), duration: z.number().finite().positive().max(3600).optional(), volume: z.number().finite().min(0).max(1).optional() });
export const audioTrackPatchSchema = z.strictObject({ label: z.string().trim().min(1).max(120).optional(), start: z.number().finite().min(0).max(3600).optional(), trimStart: z.number().finite().min(0).max(3600).optional(), duration: z.number().finite().positive().max(3600).optional(), volume: z.number().finite().min(0).max(1).optional(), muted: z.boolean().optional() }).refine(value => Object.keys(value).length > 0, "音轨修改不能为空");
function checkAudioEdit(project: DirectorProject) {
  if (project.tasks.some(task => isActive(task) && task.stage === "export")) invalid("请等待导出结束后编辑声音", 409);
}
function validateAudioTrack(project: DirectorProject, track: DirectorAudioTrack) {
  if (track.sourceDuration !== undefined && track.trimStart + track.duration > track.sourceDuration + 0.05) invalid("音轨裁剪范围超过源音频时长", 422);
  if (track.shotId && track.start >= currentVersion(findShot(project, track.shotId)).duration) invalid("绑定音轨的开始时间须在该镜头内", 422);
  const totalDuration = project.shots.reduce((sum, shot) => sum + currentVersion(shot).duration, 0);
  if (!track.shotId && totalDuration > 0 && track.start >= totalDuration) invalid("音轨开始时间须在成片范围内", 422);
}
export async function addAudioTrack(cwd: string, input: z.infer<typeof audioTrackInputSchema>, expectedRevision: number) {
  const parsed = audioTrackInputSchema.parse(input);
  const source = await resolveWorkspacePath(cwd, parsed.path);
  const info = await stat(source.path);
  if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("声音须为不超过 100 MB 的音频文件");
  const bytes = await readFile(source.path);
  const detected = detectMimeType(bytes, "");
  const mimeType = detected === "video/mp4" ? "audio/mp4" : detected === "video/webm" ? "audio/webm" : detected;
  const extension = ({ "audio/mpeg": "mp3", "audio/wav": "wav", "audio/flac": "flac", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/aac": "aac", "audio/mp4": "m4a", "audio/webm": "webm" } as Record<string, string>)[mimeType];
  if (!bytes.length || bytes.length > 100 * 1024 * 1024 || !extension) invalid("声音仅支持不超过 100 MB 的 MP3、WAV、FLAC、OGG、AAC、M4A 或 WebM 音频");
  const sourceDuration = await validateAudio(cwd, parsed.path);
  let copiedPath: string | undefined;
  try {
    return await mutate(cwd, expectedRevision, async project => {
      checkAudioEdit(project);
      if ((project.audioTracks?.length ?? 0) >= 100) invalid("音轨已达 100 条上限", 409);
      if (parsed.shotId) findShot(project, parsed.shotId);
      if (parsed.characterId && !project.production?.characters.some(character => character.id === parsed.characterId)) invalid("所选配音角色不存在", 422);
      const trimStart = parsed.trimStart ?? 0;
      const duration = parsed.duration ?? sourceDuration - trimStart;
      if (duration <= 0) invalid("音轨裁剪范围无效", 422);
      const path = `assets/director/${project.id}/audio/${randomUUID()}.${extension}`;
      const track: DirectorAudioTrack = { id: randomUUID(), label: parsed.label, kind: parsed.kind, asset: { path, mimeType, createdAt: now() }, ...(parsed.shotId ? { shotId: parsed.shotId } : {}), ...(parsed.characterId ? { characterId: parsed.characterId } : {}), start: parsed.start ?? 0, trimStart, duration, sourceDuration, volume: parsed.volume ?? 1 };
      validateAudioTrack(project, track);
      const destination = await resolveWorkspacePath(cwd, path, true);
      await mkdir(dirname(destination.path), { recursive: true });
      await writeAtomic(destination.path, bytes, { exclusive: true }); copiedPath = destination.path;
      track.sourceDuration = await validateAudio(cwd, path);
      if (parsed.duration === undefined) track.duration = track.sourceDuration - trimStart;
      validateAudioTrack(project, track);
      project.audioTracks ??= []; project.audioTracks.push(track);
      invalidateProductionReviews(project, parsed.shotId ? [parsed.shotId] : project.shots.map(shot => shot.id), "声音轨道已新增，请复查声画与对白");
    }, "添加声音轨道");
  } catch (cause) { if (copiedPath) await rm(copiedPath, { force: true }); throw cause; }
}
export async function updateAudioTrack(cwd: string, trackId: string, patch: z.infer<typeof audioTrackPatchSchema>, expectedRevision: number) {
  const parsed = audioTrackPatchSchema.parse(patch);
  return mutate(cwd, expectedRevision, async project => {
    checkAudioEdit(project);
    const track = project.audioTracks?.find(item => item.id === trackId);
    if (!track) invalid("音轨不存在", 404);
    track.sourceDuration ??= await validateAudio(cwd, track.asset.path);
    const next = { ...track, ...parsed };
    validateAudioTrack(project, next);
    Object.assign(track, next);
    invalidateProductionReviews(project, track.shotId ? [track.shotId] : project.shots.map(shot => shot.id), "声音轨道已修改，请复查声画与对白");
  }, "编辑声音轨道");
}
export async function removeAudioTrack(cwd: string, trackId: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    checkAudioEdit(project);
    const track = project.audioTracks?.find(item => item.id === trackId);
    if (!track) invalid("音轨不存在", 404);
    project.audioTracks = project.audioTracks!.filter(item => item.id !== trackId);
    invalidateProductionReviews(project, track.shotId ? [track.shotId] : project.shots.map(shot => shot.id), "声音轨道已移除，请复查声画与对白");
  }, "移除声音轨道");
}
export async function setExportSettings(cwd: string, settings: DirectorProject["exportSettings"], expectedRevision: number) {
  const parsed = exportSettingsSchema.parse(settings);
  return mutate(cwd, expectedRevision, project => { checkAudioEdit(project); project.exportSettings = parsed; }, "修改导出规格");
}
async function updateTask(cwd: string, taskId: string, update: (project: DirectorProject, task: DirectorTask) => void | false) {
  return mutate(cwd, undefined, project => {
    const task = project.tasks.find(item => item.id === taskId);
    if (!task) invalid("任务记录不存在", 404);
    if (update(project, task) === false) return false;
    task.updatedAt = now();
  });
}
const taskControllers = new Map<string, AbortController>();
async function runTask(cwd: string, taskId: string) {
  const controller = new AbortController();
  taskControllers.set(`${cwd}:${taskId}`, controller);
  try {
    let started = false;
    const project = await updateTask(cwd, taskId, (current, task) => {
      if (task.status !== "queued" || task.cancelRequested) return false;
      started = true;
      task.status = "running";
      if (task.stage !== "export") {
        const model = task.generation?.model ?? current.models[task.stage];
        task.providerId = model?.providerId;
        task.modelId = model?.modelId;
        task.submissionState = "prepared";
      }
    });
    if (!started) return;
    const task = project.tasks.find(item => item.id === taskId)!;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(task.stage === "image" ? 180000 : 600000)]);
    const lifecycle = {
      onSubmitting: async () => { await updateTask(cwd, taskId, (_current, record) => { if (record.cancelRequested) invalid("任务已停止等待", 409); record.submissionState = "submitting"; }); },
      onTaskSubmitted: async (providerTaskId: string, providerEndpoint: string) => { await updateTask(cwd, taskId, (_current, record) => { record.providerTaskId = providerTaskId; record.providerEndpoint = providerEndpoint; record.submissionState = "submitted"; }); },
      onTerminalFailure: async () => { await updateTask(cwd, taskId, (_current, record) => { record.upstreamTerminalFailure = true; }); },
    };
    let asset: DirectorAsset;
    if (task.stage !== "export" && !(task.stage === "video" && task.providerId === "volcArk")) await lifecycle.onSubmitting();
    if (task.stage === "export") asset = await composeProject(cwd, project, signal, task.exportMode);
    else if (task.nodeId && !(project.production && task.generation?.scope?.kind === "shot")) asset = await generateCanvasMedia(cwd, project, task, signal, lifecycle);
    else {
      const shot = findShot(project, task.shotId!);
      const version = shot.versions.find(item => item.id === task.versionId)!;
      if (!version) invalid("任务对应的镜头版本不存在", 409);
      asset = await generateShotMedia(cwd, project, shot, version, task.stage, signal, lifecycle);
    }
    await updateTask(cwd, taskId, (latest, record) => {
      asset = { ...asset, ...(record.nodeId ? { sourceNodeId: record.nodeId } : {}), sourceTaskId: record.id, ...(record.inputHash ? { inputHash: record.inputHash } : {}) };
      record.status = "succeeded";
      record.output = asset;
      if (record.cancelRequested) {
        record.status = "cancelled";
        record.error = "任务停止等待后收到结果，已保留在任务记录；未采用到镜头或成片。";
        return;
      }
      if (record.stage === "export") {
        latest.exports.push({ id: randomUUID(), asset, createdAt: now(), mode: record.exportMode ?? "video", ratio: project.ratio, originalAudio: project.originalAudio ?? false, audioSignature: JSON.stringify(project.audioTracks ?? []), resolution: project.exportSettings?.resolution ?? "720p", ...(project.music ? { musicPath: project.music.asset.path, musicVolume: project.music.volume } : {}), shotVersions: [...project.shots].sort((left, right) => left.order - right.order).map(shot => ({ shotId: shot.id, versionId: shot.currentVersionId })) });
      } else if (!record.nodeId) {
        const shot = findShot(latest, record.shotId!);
        const version = shot.versions.find(item => item.id === record.versionId)!;
        if (record.stage === "image") version.keyframe = asset;
        else version.clip = asset;
      }
    });
  } catch (cause) {
    await updateTask(cwd, taskId, (_project, task) => {
      if (task.status === "cancelled" || task.cancelRequested && task.status === "verificationRequired") return false;
      task.error = cause instanceof Error ? cause.message.slice(0, 4000) : "任务失败";
      const explicitFailure = /HTTP 4\d\d|视频任务 \S+ (?:生成失败|已取消|已过期)|请先|请选择|不支持|未声明|不存在|超过所选模型支持范围|参考图必须|参考素材须/.test(task.error);
      if (task.stage === "video" && task.providerTaskId) task.status = task.upstreamTerminalFailure ? "failed" : "verificationRequired";
      else task.status = /上游任务可能仍|提交结果尚未确认|查询或读取结果失败|不要直接重试/.test(task.error) || task.stage !== "export" && task.submissionState === "submitting" && !explicitFailure ? "verificationRequired" : "failed";
    })
      .catch(failure => console.error("导演任务状态保存失败", failure));
  } finally { taskControllers.delete(`${cwd}:${taskId}`); }
}
async function runQueue(cwd: string, taskIds: string[]) {
  // ACT: 首版单项目串行生成，先关键帧后视频；失败时跳过依赖视频，成功镜头无需重跑。
  for (const taskId of taskIds) {
    const project = await readProject(cwd);
    const task = project?.tasks.find(item => item.id === taskId);
    if (!task || task.status !== "queued") continue;
    if (task.stage === "video" && !task.nodeId) {
      const shot = findShot(project!, task.shotId!);
      const version = shot.versions.find(item => item.id === task.versionId)!;
      if (!version.keyframe) {
        await updateTask(cwd, taskId, (_project, record) => { record.status = "failed"; record.error = "当前镜头关键帧未就绪，请先生成或导入关键帧"; });
        continue;
      }
    }
    await runTask(cwd, taskId);
  }
}
function newTask(stage: DirectorTask["stage"], shot?: DirectorShot): DirectorTask {
  const time = now();
  return { id: randomUUID(), owner: processOwner, stage, ...(shot ? { shotId: shot.id, versionId: shot.currentVersionId } : {}), status: "queued", createdAt: time, updatedAt: time };
}
export async function startCanvasGeneration(cwd: string, input: DirectorGenerationInput, expectedRevision: number) {
  const parsed = generationInputSchema.parse(input);
  const normalized: DirectorGenerationInput = { ...parsed, ...(parsed.reference ? { reference: { path: parsed.reference.path, mimeType: parsed.reference.mimeType } } : {}) };
  const reference = normalized.reference ? await readAttachedMedia(cwd, "image", normalized.reference.path) : undefined;
  if (reference) normalized.reference!.mimeType = reference.actualMime;
  const hash = createHash("sha256").update(JSON.stringify(normalized));
  if (reference) hash.update(reference.bytes);
  const inputHash = hash.digest("hex");
  const snapshot = await readProject(cwd);
  if (!snapshot) invalid("请先创建项目", 404);
  const previous = snapshot.tasks.find(task => task.requestId === normalized.requestId);
  if (previous) {
    if (previous.inputHash !== inputHash) invalid("同一次生成的输入已变化，请重新确认后提交", 409);
    return snapshot;
  }
  checkRevision(snapshot, expectedRevision);
  assertProductionCanvasScope(snapshot, normalized);
  await validateCanvasGeneration(snapshot, normalized);
  if (snapshot.production && normalized.scope?.kind === "shot") {
    const scope = normalized.scope;
    const shot = findShot(snapshot, scope.shotId);
    await validateGeneration({ ...snapshot, shots: [{ ...shot, currentVersionId: scope.versionId }] }, normalized.kind, true);
  }
  let taskId = "";
  const project = await mutate(cwd, undefined, async current => {
    const repeated = current.tasks.find(task => task.requestId === normalized.requestId);
    if (repeated) {
      if (repeated.inputHash !== inputHash) invalid("同一次生成的输入已变化，请重新确认后提交", 409);
      return false;
    }
    checkRevision(current, expectedRevision);
    assertProductionCanvasScope(current, normalized);
    if (current.tasks.some(isActive)) invalid("项目已有生成或导出任务，请等待完成后生成", 409);
    if (current.tasks.some(task => task.nodeId === normalized.nodeId && task.status === "verificationRequired")) invalid("此节点的上游结果尚待核对，请先查询原任务，避免重复提交", 409);
    if (current.tasks.length >= 2000) invalid("任务记录已达首版上限", 409);
    const task = newTask(normalized.kind);
    if (current.production) task.generationContextKey = directorGenerationContext(current);
    if (current.production && normalized.scope?.kind === "shot") {
      task.shotId = normalized.scope.shotId;
      task.versionId = normalized.scope.versionId;
      if (current.tasks.some(record => record.shotId === task.shotId && record.status === "verificationRequired")) invalid("此镜头的上游结果尚待核对，请先查询原任务，避免重复提交", 409);
    }
    task.nodeId = normalized.nodeId;
    task.requestId = normalized.requestId;
    task.inputHash = inputHash;
    task.generation = structuredClone(normalized);
    task.providerId = normalized.model.providerId;
    task.modelId = normalized.model.modelId;
    task.submissionState = "prepared";
    if (reference) {
      const path = `assets/director/${current.id}/canvas/${task.id}/reference${reference.extension}`;
      const destination = await resolveWorkspacePath(cwd, path, true);
      await mkdir(dirname(destination.path), { recursive: true });
      await writeAtomic(destination.path, reference.bytes, { exclusive: true });
      task.generation.reference = { path, mimeType: reference.actualMime };
    }
    current.tasks.push(task);
    taskId = task.id;
  });
  if (taskId) void runQueue(cwd, [taskId]).catch(cause => console.error("画布生成队列停止", cause));
  return project;
}

const taskQueries = new Set<string>();
export async function cancelTask(cwd: string, taskId: string, expectedRevision: number) {
  // ACT: 取消仅修改锁内核实的任务状态，不覆盖项目编辑；后台进度推进的全局 revision 不应阻止取消。
  const project = await mutate(cwd, undefined, current => {
    const task = current.tasks.find(item => item.id === taskId);
    if (!task) invalid("任务不存在", 404);
    if (!isActive(task)) invalid("此任务已结束，无需取消", 409);
    task.cancelRequested = true;
    if (task.status === "queued" || task.stage === "export" || task.submissionState === "prepared") {
      task.status = "cancelled"; task.error = task.stage === "export" ? "本地导出已取消" : "本地任务已取消，未继续提交生成";
    } else {
      task.status = "verificationRequired"; task.error = "已停止本地等待；上游可能仍在生成并计费，请查询原任务或到供应商控制台核对。";
    }
    task.updatedAt = now();
  });
  taskControllers.get(`${cwd}:${taskId}`)?.abort();
  return project;
}
export async function resolveTask(cwd: string, taskId: string, resolution: "notSubmitted" | "failed" | "abandoned", note: string, expectedRevision: number) {
  const parsedNote = z.string().trim().min(1).max(2000).parse(note);
  return mutate(cwd, expectedRevision, project => {
    const task = project.tasks.find(item => item.id === taskId);
    if (!task || task.status !== "verificationRequired") invalid("只有待核对任务可以人工处理", 409);
    if (resolution === "notSubmitted" && task.providerTaskId) invalid("此任务已有上游 ID，请查询原任务，不能标记为未提交", 409);
    task.verificationNote = parsedNote;
    task.status = resolution === "abandoned" ? "cancelled" : "failed";
    task.upstreamTerminalFailure = resolution === "failed";
    if (resolution === "abandoned") task.cancelRequested = true;
    task.error = resolution === "abandoned" ? "用户已放弃本地跟踪；此操作不会取消上游任务或退回费用。" : `用户人工核对：${parsedNote}`;
    task.updatedAt = now();
  });
}
export async function refreshTask(cwd: string, taskId: string, expectedRevision: number) {
  const key = `${cwd}:${taskId}`;
  if (taskQueries.has(key)) invalid("正在查询此任务，请稍候", 409);
  taskQueries.add(key);
  try {
    const project = await readProject(cwd);
    if (!project) invalid("项目不存在", 404);
    checkRevision(project, expectedRevision);
    const task = project.tasks.find(item => item.id === taskId);
    if (!task) invalid("任务不存在", 404);
    if (task.status === "succeeded" || task.cancelRequested && task.output) return project;
    if (isActive(task)) invalid("此任务仍在执行，系统正在等待结果", 409);
    if (task.stage !== "video" || !task.providerTaskId) invalid("未保存可查询的上游视频任务 ID，请到供应商控制台核对并导入结果");
    const result = await queryArkTask(cwd, project, task, AbortSignal.timeout(60000));
    return updateTask(cwd, taskId, (current, record) => {
      if (record.status === "succeeded") return false;
      if (result.status === "succeeded") {
        record.status = "succeeded";
        record.output = { ...result.asset, sourceTaskId: record.id, ...(record.nodeId ? { sourceNodeId: record.nodeId } : {}), ...(record.inputHash ? { inputHash: record.inputHash } : {}) };
        delete record.error;
        if (record.cancelRequested) {
          record.status = "cancelled";
          record.error = "任务停止等待后查到结果，已保留在任务记录；未采用到镜头或成片。";
          return;
        }
        if (record.shotId && !record.nodeId) {
          const shot = [...current.shots, ...(current.retiredShots ?? [])].find(item => item.id === record.shotId);
          const version = shot?.versions.find(item => item.id === record.versionId);
          // 待核对期间可能已手动导入素材或锁定；恢复查询只补空缺，结果始终保留在任务记录。
          if (version && !version.clip && !shot?.locked) version.clip = record.output;
        }
      } else {
        record.status = result.status === "failed" ? "failed" : "verificationRequired";
        if (result.status === "failed") record.upstreamTerminalFailure = true;
        record.error = result.message.slice(0, 4000);
      }
    });
  } finally { taskQueries.delete(key); }
}

export async function startGeneration(cwd: string, shotIds: string[] | undefined, stage: "image" | "video" | "all", expectedRevision: number, versionId?: string) {
  const snapshot = await readProject(cwd);
  if (!snapshot) invalid("请先创建导演项目", 404);
  checkRevision(snapshot, expectedRevision);
  assertProductionReady(snapshot);
  if (snapshot.tasks.some(isActive)) invalid("项目已有生成任务，请等待完成后重试", 409);
  if (versionId && shotIds?.length !== 1) invalid("指定候选版本时仅可选择一个镜头");
  const selectedSnapshot = { ...snapshot, shots: (shotIds ? shotIds.map(id => findShot(snapshot, id)) : snapshot.shots.filter(shot => !shot.locked)).map(shot => ({ ...shot, currentVersionId: versionId ?? shot.currentVersionId })) };
  if (!selectedSnapshot.shots.length) invalid("没有可生成的镜头，请先解锁目标镜头");
  if (new Set(selectedSnapshot.shots.map(shot => shot.id)).size !== selectedSnapshot.shots.length) invalid("镜头不能重复");
  selectedSnapshot.shots.forEach(shot => checkEditable(snapshot, shot));
  selectedSnapshot.shots.forEach(shot => assertProductionTarget(snapshot, findShot(snapshot, shot.id), shot.currentVersionId));
  for (const shot of selectedSnapshot.shots) if (snapshot.tasks.some(task => task.shotId === shot.id && task.status === "verificationRequired")) invalid(`镜头 ${shot.order} 的上游结果尚待核对，请到供应商控制台确认并导入已有结果，避免重复提交`, 409);
  if (snapshot.production) {
    if (selectedSnapshot.shots.length > 1 && !hasApprovedSample(snapshot)) invalid("请先生成一个镜头小样并通过人工审片，再批量生成", 422);
  }
  try { await validateGeneration(selectedSnapshot, stage); }
  catch (cause) { throw Object.assign(cause instanceof Error ? cause : new Error("生成配置无效"), { status: 422 }); }
  const taskIds: string[] = [];
  const project = await mutate(cwd, expectedRevision, current => {
    assertProductionReady(current);
    if (current.tasks.some(isActive)) invalid("项目已有生成任务，请等待完成后重试", 409);
    const selected = shotIds ? shotIds.map(id => findShot(current, id)) : current.shots.filter(shot => !shot.locked);
    if (!selected.length) invalid("没有可生成的镜头，请先解锁目标镜头");
    if (new Set(selected.map(shot => shot.id)).size !== selected.length) invalid("镜头不能重复");
    if (current.production) {
      if (selected.length > 1 && !hasApprovedSample(current)) invalid("请先审核通过单镜小样，再选择批量范围", 422);
    }
    for (const shot of selected) {
      checkEditable(current, shot);
      const version = assertProductionTarget(current, shot, versionId ?? shot.currentVersionId);
      if (current.tasks.some(task => task.shotId === shot.id && task.status === "verificationRequired")) invalid(`镜头 ${shot.order} 的上游结果尚待核对，请先查询原任务`, 409);
      if ((stage === "image" || stage === "all") && !version.keyframe) {
        if (!current.models.image) invalid("请先选择并配置图片模型");
        const task = newTask("image", shot); task.versionId = version.id; if (current.production) task.generationContextKey = directorGenerationContext(current); current.tasks.push(task); taskIds.push(task.id);
      }
      if ((stage === "video" || stage === "all") && !version.clip) {
        if (!current.models.video) invalid("请先选择并配置视频模型");
        if (stage === "video" && !version.keyframe) invalid(`镜头 ${shot.order} 缺少关键帧，请先生成或导入图片`);
        const task = newTask("video", shot); task.versionId = version.id; if (current.production) task.generationContextKey = directorGenerationContext(current); current.tasks.push(task); taskIds.push(task.id);
      }
    }
    if (!taskIds.length) invalid("所选镜头已有结果，修改分镜后可生成新版本");
    if (current.tasks.length > 2000) invalid("任务记录已达首版上限", 409);
  });
  void runQueue(cwd, taskIds).catch(async cause => {
    console.error("导演任务队列停止", cause);
    for (const taskId of taskIds) await updateTask(cwd, taskId, (_project, task) => {
      if (!isActive(task)) return false;
      task.status = "failed";
      task.error = "任务队列已停止，请检查任务记录后手动重试";
    }).catch(failure => console.error("导演任务状态保存失败", failure));
  });
  return project;
}
export async function exportMovie(cwd: string, expectedRevision: number, mode: "video" | "storyboard" = "video") {
  z.enum(["video", "storyboard"]).parse(mode);
  let taskId = "";
  const project = await mutate(cwd, expectedRevision, current => {
    if (current.tasks.some(isActive)) invalid("请等待生成任务完成后导出", 409);
    if (current.tasks.some(task => task.status === "verificationRequired")) invalid("存在上游结果待核对的任务，请查询或人工处理后再导出", 409);
    if (!current.shots.length) invalid("请先完成分镜策划", 422);
    if (mode === "video") assertProductionReady(current, true);
    if (current.shots.some(shot => mode === "storyboard" ? !currentVersion(shot).keyframe : !currentVersion(shot).clip)) invalid(mode === "storyboard" ? "全部镜头均需有关键帧才能导出分镜预览" : "全部镜头均需有视频才能导出成片");
    if (current.exports.length >= 200 || current.tasks.length >= 2000) invalid("导出记录已达首版上限", 409);
    const task = newTask("export"); task.exportMode = mode; current.tasks.push(task); taskId = task.id;
  });
  void runTask(cwd, taskId);
  return project;
}
async function readAttachedMedia(cwd: string, kind: "image" | "video", path: string) {
  const source = await resolveWorkspacePath(cwd, path);
  const info = await stat(source.path);
  if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("导入媒体须为不超过 100 MB 的文件");
  const bytes = await readFile(source.path);
  const actualMime = detectMimeType(bytes, "");
  if (!bytes.length || bytes.length > 100 * 1024 * 1024 || !actualMime.startsWith(`${kind}/`)) invalid("导入媒体的实际类型不匹配或超过 100 MB");
  if (kind === "image") {
    try { await new Bun.Image(bytes).metadata(); }
    catch { invalid("导入文件不是有效图片"); }
  }
  const extension = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" } as Record<string, string>)[actualMime];
  if (!extension) invalid("首版仅支持 PNG/JPEG/WebP 图片和 MP4/WebM/MOV 视频");
  return { bytes, actualMime, extension };
}
export async function attachMedia(cwd: string, shotId: string, kind: "image" | "video", path: string, mimeType: string, expectedRevision: number) {
  const { bytes, actualMime, extension } = await readAttachedMedia(cwd, kind, path);
  const sourceDuration = kind === "video" ? await readVideoDuration(cwd, path) : undefined;
  return mutate(cwd, expectedRevision, async project => {
    const shot = findShot(project, shotId);
    checkEditable(project, shot);
    let version = currentVersion(shot);
    if (sourceDuration !== undefined && (version.trimStart ?? 0) + version.duration > sourceDuration + 0.05) invalid("导入视频不足以覆盖镜头入出点，请先调整裁剪范围", 422);
    const previousVersionId = version.id;
    if (kind === "image" ? version.keyframe || version.clip : version.clip) {
      if (shot.versions.length >= 200) invalid("镜头版本已达首版上限", 409);
      version = { ...version, id: randomUUID(), number: shot.versions.length + 1, reason: `导入${kind === "image" ? "关键帧" : "视频"}`, createdAt: now() };
      if (kind === "image") { delete version.keyframe; delete version.clip; }
      shot.versions.push(version); shot.currentVersionId = version.id;
      const binding = project.production?.storyboard?.shotVersions.find(item => item.shotId === shot.id && item.versionId === previousVersionId);
      if (binding) binding.versionId = version.id;
    }
    const relativePath = `assets/director/${project.id}/${shot.id}/${version.id}/${randomUUID()}${extension}`;
    const destination = await resolveWorkspacePath(cwd, relativePath, true);
    await mkdir(dirname(destination.path), { recursive: true });
    await writeAtomic(destination.path, bytes, { exclusive: true });
    const asset: DirectorAsset = { path: relativePath, mimeType: actualMime, createdAt: now() };
    if (kind === "image") version.keyframe = asset;
    else version.clip = asset;
  }, "导入镜头素材");
}

export const mediaShotSchema = z.strictObject({ title: z.string().trim().min(1).max(120), kind: z.enum(["image", "video"]), path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), duration: z.number().finite().min(1).max(30).optional(), sourceNodeId: z.string().min(1).max(120).optional(), sourceTaskId: z.uuid().optional(), sourceInputHash: z.string().max(2048).optional(), targetShotId: z.uuid().optional(), allowDuplicate: z.boolean().optional(), afterShotId: z.uuid().optional(), sceneId: z.uuid().optional(), characterIds: z.array(z.uuid()).max(12).optional() });

export async function addMediaShot(cwd: string, input: z.infer<typeof mediaShotSchema>, expectedRevision: number) {
  const parsed = mediaShotSchema.parse(input);
  const media = await readAttachedMedia(cwd, parsed.kind, parsed.path);
  const sourceDuration = parsed.kind === "video" ? await readVideoDuration(cwd, parsed.path) : undefined;
  if (sourceDuration !== undefined && parsed.duration !== undefined && parsed.duration > sourceDuration + 0.05) invalid("镜头时长不能超过所导入视频的实际时长");
  const duration = parsed.duration ?? (sourceDuration === undefined ? 5 : Math.min(30, sourceDuration));
  let createdPath: string | undefined;
  try {
    return await mutate(cwd, expectedRevision, async project => {
      if (project.tasks.some(task => isActive(task) && task.stage === "export")) invalid("请等待当前导出结束后加入镜头", 409);
      const sourceTask = parsed.sourceTaskId ? project.tasks.find(task => task.id === parsed.sourceTaskId) : undefined;
      if (parsed.sourceTaskId && (!sourceTask || sourceTask.status !== "succeeded" || sourceTask.output?.path !== parsed.path || sourceTask.nodeId !== parsed.sourceNodeId || parsed.sourceInputHash && sourceTask.inputHash !== parsed.sourceInputHash)) invalid("生成来源与所选素材不匹配，请刷新后重试", 409);
      if (!parsed.targetShotId && !parsed.allowDuplicate && project.shots.some(shot => shot.versions.some(version => {
        const asset = parsed.kind === "video" ? version.clip : version.keyframe;
        return parsed.sourceTaskId ? asset?.sourceTaskId === parsed.sourceTaskId : !!parsed.sourceNodeId && !!parsed.sourceInputHash && asset?.sourceNodeId === parsed.sourceNodeId && asset.inputHash === parsed.sourceInputHash;
      }))) return false;
      const targetShot = parsed.targetShotId ? findShot(project, parsed.targetShotId) : undefined;
      if (targetShot) checkEditable(project, targetShot);
      if (!targetShot && project.shots.length >= 24) invalid("项目镜头已达 24 镜上限", 409);
      if (project.production && !targetShot) {
        const script = project.production.scriptVersions.find(item => item.id === project.production!.currentScriptVersionId);
        if (!script?.confirmedAt || !parsed.sceneId || !script.scenes.some(scene => scene.id === parsed.sceneId) || !parsed.characterIds || parsed.characterIds.some(id => !project.production!.characters.some(character => character.id === id))) invalid("漫剧补镜须绑定已确认剧本中的场景和出场角色", 422);
      }
      if (parsed.afterShotId) findShot(project, parsed.afterShotId);
      if (targetShot && sourceDuration !== undefined && (currentVersion(targetShot).trimStart ?? 0) + currentVersion(targetShot).duration > sourceDuration + 0.05) invalid("新版素材不足以覆盖当前片段的入出点，请先调整裁剪范围", 409);
      if (targetShot && sourceTask && (parsed.kind === "video" ? currentVersion(targetShot).clip : currentVersion(targetShot).keyframe)?.sourceTaskId === sourceTask.id) return false;
      const time = now();
      const origin = { ...(sourceTask?.output ?? {}), ...(parsed.sourceNodeId ? { sourceNodeId: parsed.sourceNodeId } : {}), ...(parsed.sourceTaskId ? { sourceTaskId: parsed.sourceTaskId } : {}), ...(sourceTask?.inputHash ? { inputHash: sourceTask.inputHash } : parsed.sourceInputHash ? { inputHash: parsed.sourceInputHash } : {}) };
      if (targetShot) {
        const old = currentVersion(targetShot);
        if (targetShot.versions.length >= 200) invalid("镜头版本已达首版上限", 409);
        const version: ShotVersion = { ...old, id: randomUUID(), number: targetShot.versions.length + 1, createdAt: time, reason: "替换镜头素材" };
        const path = `assets/director/${project.id}/${targetShot.id}/${version.id}/${randomUUID()}${media.extension}`;
        const destination = await resolveWorkspacePath(cwd, path, true);
        await mkdir(dirname(destination.path), { recursive: true });
        await writeAtomic(destination.path, media.bytes, { exclusive: true }); createdPath = destination.path;
        const asset: DirectorAsset = { ...origin, path, mimeType: media.actualMime, createdAt: time };
        if (parsed.kind === "video") version.clip = asset;
        else { version.keyframe = asset; delete version.clip; }
        targetShot.versions.push(version); targetShot.currentVersionId = version.id;
        const binding = project.production?.storyboard?.shotVersions.find(item => item.shotId === targetShot.id && item.versionId === old.id);
        if (binding) binding.versionId = version.id;
        invalidateProductionReviews(project, project.shots.filter(shot => Math.abs(shot.order - targetShot.order) <= 1).map(shot => shot.id), "镜头素材已替换，请复查画面与衔接");
        return;
      }
      const shotId = randomUUID();
      const versionId = randomUUID();
      const path = `assets/director/${project.id}/${shotId}/${versionId}/${randomUUID()}${media.extension}`;
      const target = await resolveWorkspacePath(cwd, path, true);
      await mkdir(dirname(target.path), { recursive: true });
      await writeAtomic(target.path, media.bytes, { exclusive: true });
      createdPath = target.path;
      const asset: DirectorAsset = { ...origin, path, mimeType: media.actualMime, createdAt: time };
      const version: ShotVersion = { id: versionId, number: 1, createdAt: time, reason: "素材加入成片", title: parsed.title, description: parsed.title, camera: "沿用素材画面", duration, subtitle: "", ...(parsed.sceneId ? { sceneId: parsed.sceneId } : {}), ...(parsed.characterIds ? { characterIds: parsed.characterIds } : {}), ...(parsed.kind === "video" ? { clip: asset } : { keyframe: asset }) };
      const index = parsed.afterShotId ? project.shots.findIndex(shot => shot.id === parsed.afterShotId) + 1 : project.shots.length;
      project.shots.splice(index, 0, { id: shotId, order: index + 1, locked: false, currentVersionId: versionId, versions: [version] });
      project.shots.forEach((shot, order) => { shot.order = order + 1; });
      if (project.production) { project.production.shotCount = project.shots.length; delete project.production.storyboard; invalidateProductionReviews(project, project.shots.filter(shot => Math.abs(shot.order - index - 1) <= 1).map(shot => shot.id), "已插入补镜，请确认分镜并复查衔接"); }
    }, parsed.targetShotId ? "替换镜头素材" : "素材加入成片");
  } catch (cause) {
    if (createdPath) await rm(createdPath, { force: true }).catch(cleanupFailure => console.warn("新增镜头素材清理失败", cleanupFailure));
    throw cause;
  }
}

export async function splitShot(cwd: string, shotId: string, offset: number, expectedRevision: number) {
  z.number().finite().min(1).max(29).parse(offset);
  return mutate(cwd, expectedRevision, project => {
    if (project.tasks.some(task => isActive(task) && task.stage === "export")) invalid("请等待当前导出结束后拆分镜头", 409);
    if (project.shots.length >= 24) invalid("项目镜头已达 24 镜上限", 409);
    const shot = findShot(project, shotId);
    checkEditable(project, shot);
    const old = currentVersion(shot);
    if (offset > old.duration - 1) invalid("拆分后左右镜头都至少保留 1 秒");
    const subtitleStart = old.subtitleStart ?? 0;
    const subtitleEnd = old.subtitleEnd ?? old.duration;
    const subtitleFields = (start: number, duration: number) => {
      const from = Math.max(0, subtitleStart - start);
      const to = Math.min(duration, subtitleEnd - start);
      return to > from ? { subtitle: old.subtitle, subtitleStart: from, subtitleEnd: to } : { subtitle: "", subtitleStart: 0, subtitleEnd: duration };
    };
    const remaining = old.duration - offset;
    const rightShotId = randomUUID();
    const right: ShotVersion = {
      ...old, ...subtitleFields(offset, remaining), id: randomUUID(), number: 1, createdAt: now(), reason: "拆分镜头 · 后半段",
      title: `${old.title.slice(0, 110)} · 后半段`, duration: remaining, trimStart: (old.trimStart ?? 0) + offset,
    };
    validateTiming(right);
    versionSchema.parse(right);
    saveShotVersion(project, shot, { duration: offset, ...subtitleFields(0, offset) }, "拆分镜头 · 前半段");
    const index = project.shots.findIndex(item => item.id === shotId);
    project.shots.splice(index + 1, 0, { id: rightShotId, order: index + 2, locked: false, currentVersionId: right.id, versions: [right] });
    if (project.audioTracks) {
      project.audioTracks = project.audioTracks.flatMap(track => {
        if (track.shotId !== shotId) return [track];
        if (track.start >= offset) return [{ ...track, shotId: rightShotId, start: track.start - offset }];
        if (track.start + track.duration <= offset) return [track];
        const leftDuration = offset - track.start;
        return [{ ...track, duration: leftDuration }, { ...track, id: randomUUID(), shotId: rightShotId, start: 0, trimStart: track.trimStart + leftDuration, duration: track.duration - leftDuration }];
      });
      if (project.audioTracks.length > 100) invalid("拆分后的声音轨道超过 100 条上限", 409);
    }
    project.shots.forEach((item, itemIndex) => { item.order = itemIndex + 1; });
    if (project.production) { project.production.shotCount = project.shots.length; delete project.production.storyboard; invalidateProductionReviews(project, project.shots.filter(item => Math.abs(item.order - shot.order) <= 2).map(item => item.id), "镜头已拆分，请确认分镜并复查衔接"); }
  }, "拆分镜头");
}

export async function deleteShot(cwd: string, shotId: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    const shot = findShot(project, shotId); checkEditable(project, shot);
    if (project.production && project.shots.length <= 1) invalid("漫剧至少保留一个镜头", 422);
    if ((project.retiredShots?.length ?? 0) >= 200) invalid("已移除镜头历史已达上限，请建立新项目", 409);
    project.retiredShots ??= []; project.retiredShots.push(shot);
    project.shots = project.shots.filter(item => item.id !== shotId);
    project.shots.forEach((item, index) => { item.order = index + 1; });
    if (project.audioTracks) project.audioTracks = project.audioTracks.filter(track => track.shotId !== shotId);
    if (project.production) { project.production.shotCount = project.shots.length; delete project.production.storyboard; invalidateProductionReviews(project, project.shots.map(item => item.id), "镜头已移除，请重新确认分镜与衔接"); }
  }, "移除镜头");
}

export const canvasInputsSchema = z.strictObject({
  text: z.string().trim().min(1).max(8000).optional(),
  asset: z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), kind: z.enum(["image", "video"]) }).optional(),
}).refine(input => input.text !== undefined || input.asset !== undefined, "请连接非空文本或已导入的素材");

export async function applyCanvasInputs(cwd: string, shotId: string, input: z.infer<typeof canvasInputsSchema>, expectedRevision: number) {
  const parsed = canvasInputsSchema.parse(input);
  const media = parsed.asset ? await readAttachedMedia(cwd, parsed.asset.kind, parsed.asset.path) : undefined;
  const sourceDuration = parsed.asset?.kind === "video" ? await readVideoDuration(cwd, parsed.asset.path) : undefined;
  let createdPath: string | undefined;
  try {
    return await mutate(cwd, expectedRevision, async project => {
      const shot = findShot(project, shotId);
      checkEditable(project, shot);
      const previous = currentVersion(shot);
      if (sourceDuration !== undefined && (previous.trimStart ?? 0) + previous.duration > sourceDuration + 0.05) invalid("画布视频不足以覆盖镜头入出点，请先调整裁剪范围", 422);
      const patch = parsed.text === undefined ? {} : changedPatch(previous, { description: parsed.text });
      let mediaChanged = !!media;
      const currentAsset = parsed.asset?.kind === "image" ? previous.keyframe : previous.clip;
      if (media && parsed.asset && currentAsset) {
        try {
          const currentMedia = await readAttachedMedia(cwd, parsed.asset.kind, currentAsset.path);
          mediaChanged = currentMedia.actualMime !== media.actualMime || !currentMedia.bytes.equals(media.bytes);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        }
      }
      if (!Object.keys(patch).length && !mediaChanged) return false;

      saveShotVersion(project, shot, patch, "应用画布连接输入");
      const version = currentVersion(shot);
      if (media && parsed.asset) {
        if (parsed.asset.kind === "image") { delete version.keyframe; delete version.clip; }
        const path = `assets/director/${project.id}/${shot.id}/${version.id}/${randomUUID()}${media.extension}`;
        const destination = await resolveWorkspacePath(cwd, path, true);
        await mkdir(dirname(destination.path), { recursive: true });
        await writeAtomic(destination.path, media.bytes, { exclusive: true });
        createdPath = destination.path;
        const asset: DirectorAsset = { path, mimeType: media.actualMime, createdAt: now() };
        if (parsed.asset.kind === "image") version.keyframe = asset;
        else version.clip = asset;
        // ACT: 仅替换媒体时沿用已确认剧情绑定；改画面描述仍需重新确认分镜。
        if (!Object.keys(patch).length) {
          const binding = project.production?.storyboard?.shotVersions.find(item => item.shotId === shot.id && item.versionId === previous.id);
          if (binding) binding.versionId = version.id;
        }
      }
    }, "应用画布输入");
  } catch (cause) {
    if (createdPath) await rm(createdPath, { force: true }).catch(cleanupFailure => console.warn("画布输入素材清理失败", cleanupFailure));
    throw cause;
  }
}
