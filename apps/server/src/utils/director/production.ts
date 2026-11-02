import { randomUUID } from "node:crypto";
import { readFile, stat } from "@toonflow/file";
import { z } from "zod";
import type { DirectorProject, ProductionCharacter, ProductionReference, ProductionScene, ProductionWorkflow, ShotFields } from "@/lib/directorTypes";
import { directorGenerationContext, directorReviewContext } from "@/lib/directorReview";
import { detectMimeType } from "@/utils/media/priceReference";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { createProject, currentVersion, mutate, readProject, shotFieldsSchema } from "./index";
import { requestJson } from "./planning";
import { assertProductionReady, characterSchema, invalidateProductionReviews, productionIssues, productionScript, sceneSchema } from "./productionState";

function invalid(message: string, status = 422): never { throw Object.assign(new Error(message), { status }); }
function workflowOf(project: DirectorProject) { return project.production ?? invalid("此项目为旧版短片项目，请新建漫剧项目"); }
function editable(project: DirectorProject) {
  if (project.tasks.some(task => task.status === "queued" || task.status === "running")) invalid("请等待当前任务完成再修改前序内容", 409);
}
function validateScenes(scenes: ProductionScene[], characters: ProductionCharacter[]) {
  if (new Set(scenes.map(scene => scene.id)).size !== scenes.length) invalid("场景标识不能重复");
  for (const scene of scenes) for (const dialogue of scene.dialogues) {
    if (!characters.some(character => character.id === dialogue.speakerId)) invalid(`场景「${scene.title}」的对白说话人不存在`);
  }
}
function validateShot(project: DirectorProject, fields: ShotFields) {
  const workflow = workflowOf(project);
  const script = productionScript(project) ?? invalid("当前剧本版本不存在");
  if (!script.scenes.some(scene => scene.id === fields.sceneId)) invalid(`镜头「${fields.title}」的场景已变化，请重新关联`);
  if (!fields.startState?.trim() || !fields.endState?.trim()) invalid(`请补齐镜头「${fields.title}」的起止状态`);
  if (!fields.characterIds || new Set(fields.characterIds).size !== fields.characterIds.length) invalid(`镜头「${fields.title}」的角色关联无效`);
  if (fields.characterIds.some(id => !workflow.characters.some(character => character.id === id))) invalid(`镜头「${fields.title}」引用了不存在的角色`);
  if (fields.dialogues?.some(dialogue => !fields.characterIds!.includes(dialogue.speakerId))) invalid(`镜头「${fields.title}」的对白说话人未关联到此镜头`);
}
export const productionDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120), brief: z.string().trim().min(1).max(12000), style: z.string().trim().min(1).max(1000),
  characterConstraints: z.string().trim().min(1).max(6000), invariants: z.string().trim().min(1).max(4000),
  episode: z.number().int().min(1).max(999).default(1), targetDuration: z.number().int().min(5).max(600).default(30), shotCount: z.number().int().min(1).max(24).default(6),
  ratio: z.enum(["9:16", "16:9", "1:1"]).default("16:9"), providerId: z.string().max(200).optional(), modelId: z.string().max(200).optional(),
});
const draftCharacterSchema = characterSchema.omit({ revision: true, confirmedAt: true, referenceImage: true }).extend({ id: z.string().min(1).max(80) });
const draftSceneSchema = sceneSchema.extend({ id: z.string().min(1).max(80), dialogues: z.array(z.strictObject({ speakerId: z.string().min(1).max(80), text: z.string().trim().min(1).max(1000) })).max(50) });
const scriptDraftSchema = z.strictObject({ logline: z.string().trim().min(1).max(2000), characters: z.array(draftCharacterSchema).max(12), scenes: z.array(draftSceneSchema).min(1).max(24) });

export async function draftProduction(cwd: string, input: z.infer<typeof productionDraftSchema>, referenceImage?: DirectorProject["referenceImage"]) {
  if (await readProject(cwd)) invalid("当前目录已有项目，请选择新的创作文件夹", 409);
  if (input.targetDuration < input.shotCount || input.targetDuration > input.shotCount * 30) invalid("目标时长与镜头数不匹配，每镜需为1至30秒");
  const output = await requestJson(`为漫剧或短片创作任务起草可供编导审阅的剧本，不生成分镜或媒体。人物身份、已知事实、动机和对白说话人必须一致。把固定外貌appearance与服装costume分开，未知事实不要写成已知事实。严格遵守人物约束与不可变条件。无人出镜的产品或场景短片必须返回characters:[]及空dialogues，不得为满足格式编造人物。参考图仅供后续画面生成使用，你没有看到参考图，不得声称已经识图或验证人物外观。总时长约${input.targetDuration}秒，第${input.episode}集。\n任务资料：${JSON.stringify(input)}\n返回严格JSON：{"logline":"一句话剧情","characters":[{"id":"c1","name":"角色名","appearance":"稳定外貌","costume":"服装","props":"道具或无","goal":"当前行动动机","knownFacts":"角色在此集已知的事实"}],"scenes":[{"id":"s1","title":"场景名","location":"地点与时间","action":"可见动作及因果","dialogues":[{"speakerId":"c1","text":"对白"}]}]}。场景和角色用唯一短ID，dialogues的speakerId必须引用characters。`, input);
  const result = scriptDraftSchema.safeParse(output);
  if (!result.success) invalid("模型剧本未满足人物、场景与对白字段要求，目录未创建项目，请重试", 502);
  const identifiers = result.data.characters.map(character => character.id);
  if (new Set(identifiers).size !== identifiers.length) invalid("模型返回重复角色ID，项目未创建", 502);
  const characterIds = new Map(identifiers.map(id => [id, randomUUID()]));
  const characters = result.data.characters.map(character => ({ ...character, id: characterIds.get(character.id)!, revision: 1 }));
  const scenes = result.data.scenes.map(scene => ({ ...scene, id: randomUUID(), dialogues: scene.dialogues.map(dialogue => ({ ...dialogue, speakerId: characterIds.get(dialogue.speakerId) ?? invalid("模型对白引用了不存在的说话人，项目未创建", 502) })) }));
  validateScenes(scenes, characters);
  const id = randomUUID();
  const production: ProductionWorkflow = {
    episode: input.episode, targetDuration: input.targetDuration, shotCount: input.shotCount, characterConstraints: input.characterConstraints, invariants: input.invariants,
    currentScriptVersionId: id, scriptVersions: [{ id, number: 1, logline: result.data.logline, scenes, createdAt: new Date().toISOString() }], characters, reviews: [],
  };
  return createProject(cwd, { title: input.title, brief: input.brief, style: input.style, ratio: input.ratio, shots: [], production, ...(referenceImage ? { referenceImage } : {}) });
}
export async function saveScript(cwd: string, expectedRevision: number, logline: string, scenes: ProductionScene[]) {
  return mutate(cwd, expectedRevision, project => {
    editable(project);
    const workflow = workflowOf(project);
    if (workflow.scriptVersions.length >= 100) invalid("剧本版本已达首版上限");
    validateScenes(scenes, workflow.characters);
    const current = productionScript(project)!;
    if (JSON.stringify({ logline: current.logline, scenes: current.scenes }) === JSON.stringify({ logline, scenes })) invalid("剧本没有实际变化");
    const id = randomUUID();
    workflow.scriptVersions.push({ id, number: workflow.scriptVersions.length + 1, logline, scenes, createdAt: new Date().toISOString() });
    workflow.currentScriptVersionId = id;
    const changedSceneIds = new Set([...current.scenes, ...scenes].filter(scene => JSON.stringify(current.scenes.find(item => item.id === scene.id)) !== JSON.stringify(scenes.find(item => item.id === scene.id))).map(scene => scene.id));
    const affected = project.shots.filter(shot => changedSceneIds.has(currentVersion(shot).sceneId ?? ""));
    invalidateProductionReviews(project, affected.map(shot => shot.id), "关联场景或对白已变化，请复查本镜及剧情衔接；视频素材保留");
  });
}
export async function confirmScript(cwd: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    editable(project);
    const script = productionScript(project) ?? invalid("剧本不存在");
    validateScenes(script.scenes, workflowOf(project).characters);
    script.confirmedAt = new Date().toISOString();
  });
}
export async function saveCharacter(cwd: string, expectedRevision: number, input: Omit<ProductionCharacter, "revision" | "confirmedAt">) {
  return mutate(cwd, expectedRevision, async project => {
    editable(project);
    const workflow = workflowOf(project);
    const index = workflow.characters.findIndex(character => character.id === input.id);
    if (index < 0) invalid("角色不存在");
    const old = workflow.characters[index]!;
    let reference = input.referenceImage;
    if (reference) {
      const path = await resolveWorkspacePath(cwd, reference.path);
      const info = await stat(path.path);
      if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("角色参考图必须是小于100MB的项目文件");
      const bytes = await readFile(path.path);
      const mimeType = detectMimeType(bytes, "");
      if (!mimeType.startsWith("image/")) invalid("角色参考文件不是图片");
      try { await new Bun.Image(bytes).metadata(); } catch { invalid("角色参考图无法打开"); }
      reference = { ...reference, mimeType };
    }
    const { revision: oldRevision, confirmedAt: _confirmedAt, ...previous } = old;
    const next = { ...input, ...(reference ? { referenceImage: reference } : {}) };
    if (JSON.stringify(previous) === JSON.stringify(next)) invalid("角色没有实际变化");
    workflow.characterHistory ??= [];
    if (workflow.characterHistory.length >= 1000) invalid("角色历史已达首版上限");
    workflow.characterHistory.push(structuredClone(old));
    workflow.characters[index] = { ...next, revision: oldRevision + 1 };
    invalidateProductionReviews(project, project.shots.filter(shot => currentVersion(shot).characterIds?.includes(input.id)).map(shot => shot.id), `角色「${input.name}」设定已变化，请重新检查相关素材`);
  });
}
export async function confirmCharacters(cwd: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    editable(project);
    if (!productionScript(project)?.confirmedAt) invalid("请先确认当前剧本版本");
    const time = new Date().toISOString();
    for (const character of workflowOf(project).characters) character.confirmedAt = time;
  });
}
export async function saveSceneReference(cwd: string, expectedRevision: number, sceneId: string, referenceImage: ProductionReference | null) {
  return mutate(cwd, expectedRevision, async project => {
    editable(project);
    const workflow = workflowOf(project);
    if (!productionScript(project)?.scenes.some(scene => scene.id === sceneId)) invalid("场景不存在，请刷新当前剧本");
    let reference = referenceImage;
    if (reference) {
      const source = await resolveWorkspacePath(cwd, reference.path);
      const info = await stat(source.path);
      if (!info.isFile() || info.size > 100 * 1024 * 1024) invalid("场景参考图必须是不超过100MB的项目图片");
      const bytes = await readFile(source.path);
      const mimeType = detectMimeType(bytes, "");
      if (!mimeType.startsWith("image/")) invalid("场景参考文件不是图片");
      try { await new Bun.Image(bytes).metadata(); } catch { invalid("场景参考图无法打开"); }
      reference = { ...reference, mimeType };
    }
    const old = workflow.sceneReferences?.find(item => item.sceneId === sceneId);
    if (JSON.stringify(old?.referenceImage ?? null) === JSON.stringify(reference)) invalid("场景参考图没有实际变化");
    workflow.sceneReferences = (workflow.sceneReferences ?? []).filter(item => item.sceneId !== sceneId);
    if (reference) workflow.sceneReferences.push({ sceneId, revision: (old?.revision ?? 0) + 1, referenceImage: reference });
    invalidateProductionReviews(project, project.shots.filter(shot => currentVersion(shot).sceneId === sceneId).map(shot => shot.id), "场景视觉参考已变化，请复查关联镜头；已有素材保留，可选择重做");
  });
}
export async function draftProductionStoryboard(cwd: string, expectedRevision: number, model: { providerId?: string; modelId?: string }) {
  const project = await readProject(cwd) ?? invalid("项目不存在", 404);
  if (project.revision !== expectedRevision) invalid("项目已更新，请刷新后重新生成分镜", 409);
  editable(project);
  const workflow = workflowOf(project);
  const script = productionScript(project) ?? invalid("剧本不存在");
  if (!script.confirmedAt || workflow.characters.some(character => !character.confirmedAt)) invalid("请先确认当前剧本和角色，再生成分镜");
  if (project.shots.length) invalid("已有分镜会保留。请逐镜修改并重新确认，避免覆盖已有版本与素材", 409);
  const output = await requestJson(`根据已确认的漫剧剧本与角色，规划严格${workflow.shotCount}个可制作镜头，画幅${project.ratio}，总时长约${workflow.targetDuration}秒。每镜1至30秒，一个清楚动作，风格${project.style}。不得改变人物动机、已知事实、服装和对白归属。角色参考图会传给图片生成，你未看到图片，不声称已做视觉检查。\n不可变条件：${JSON.stringify(workflow.invariants)}\n剧本：${JSON.stringify(script)}\n角色：${JSON.stringify(workflow.characters.map(({ referenceImage, ...character }) => ({ ...character, hasReference: Boolean(referenceImage) })))}\n返回JSON {"shots":[{"title":"镜头名","sceneId":"实际场景UUID","characterIds":["实际角色UUID"],"description":"可见画面","camera":"景别与运镜","duration":5,"subtitle":"后期字幕或空字符串","startState":"首帧人物/物体状态","endState":"尾帧状态","dialogues":[{"speakerId":"镜头内角色UUID","text":"原剧本对白"}]}]}。相邻镜头动作与道具连续，空镜characterIds可为空数组，禁止编造ID。`, model);
  const parsed = z.strictObject({ shots: z.array(shotFieldsSchema.extend({ sceneId: z.uuid(), characterIds: z.array(z.uuid()).max(12), startState: z.string().trim().min(1).max(2000), endState: z.string().trim().min(1).max(2000) })).length(workflow.shotCount) }).safeParse(output);
  if (!parsed.success) invalid("模型分镜未满足数量、场景与起止状态契约，原剧本保留，请重试", 502);
  parsed.data.shots.forEach(shot => validateShot(project, shot));
  return mutate(cwd, expectedRevision, current => {
    editable(current);
    if (current.shots.length) invalid("项目已有分镜，未覆盖", 409);
    const time = new Date().toISOString();
    current.shots = parsed.data.shots.map((fields, index) => {
      const id = randomUUID();
      return { id: randomUUID(), order: index + 1, locked: false, currentVersionId: id, versions: [{ ...fields, id, number: 1, reason: "已确认剧本生成分镜", createdAt: time }] };
    });
  });
}
export async function confirmStoryboard(cwd: string, expectedRevision: number) {
  return mutate(cwd, expectedRevision, project => {
    editable(project);
    const workflow = workflowOf(project);
    const script = productionScript(project) ?? invalid("剧本不存在");
    if (!script.confirmedAt || workflow.characters.some(character => !character.confirmedAt)) invalid("请先确认当前剧本与角色");
    if (!project.shots.length) invalid("请先生成分镜");
    project.shots.forEach(shot => validateShot(project, currentVersion(shot)));
    const duration = project.shots.reduce((total, shot) => total + currentVersion(shot).duration, 0);
    if (Math.abs(duration - workflow.targetDuration) > 1) invalid(`当前分镜合计${duration}秒，目标为${workflow.targetDuration}秒，请调整镜头时长后确认`);
    workflow.storyboard = { scriptVersionId: script.id, characterRevisions: workflow.characters.map(character => ({ id: character.id, revision: character.revision })), shotVersions: project.shots.map(shot => ({ shotId: shot.id, versionId: shot.currentVersionId })), confirmedAt: new Date().toISOString() };
  });
}
export async function reviewShot(cwd: string, expectedRevision: number, input: { shotId: string; versionId: string; decision: "approved" | "rejected"; note: string; checks: { visual: boolean; continuity: boolean; audio: boolean; subtitles: boolean; rights: boolean } }) {
  return mutate(cwd, expectedRevision, async project => {
    editable(project);
    assertProductionReady(project);
    const workflow = workflowOf(project);
    const shot = project.shots.find(item => item.id === input.shotId) ?? invalid("镜头不存在");
    if (shot.currentVersionId !== input.versionId) invalid("审核版本已变化，请重新查看当前候选", 409);
    const version = currentVersion(shot);
    if (!version.clip) invalid("请先生成或导入此镜头的视频候选");
    const path = await resolveWorkspacePath(cwd, version.clip.path);
    if (!(await stat(path.path)).isFile()) invalid("此镜头视频文件缺失");
    if (input.decision === "approved" && !Object.values(input.checks).every(Boolean)) invalid("请逐项完成画面、连续性、声音、字幕与授权检查后再采用");
    if (input.decision === "rejected" && !input.note.trim()) invalid("请记录退回原因，便于局部修复");
    if (workflow.reviews.length >= 2000) invalid("审片记录已达首版上限");
    const generation = project.tasks.find(task => task.id === version.clip?.sourceTaskId && task.stage === "video");
    const generationContextKey = generation?.generationContextKey === directorGenerationContext(project) ? generation.generationContextKey : undefined;
    workflow.reviews.push({ ...input, source: "user", contextKey: directorReviewContext(project, shot.id), ...(generationContextKey ? { generationContextKey } : {}), id: randomUUID(), createdAt: new Date().toISOString() });
  });
}
export async function forkCandidate(cwd: string, expectedRevision: number, shotId: string, stage: "image" | "video") {
  return mutate(cwd, expectedRevision, project => {
    editable(project);
    const shot = project.shots.find(item => item.id === shotId) ?? invalid("镜头不存在");
    if (shot.locked) invalid("请先解锁镜头再创建候选");
    if (shot.versions.length >= 200) invalid("候选版本已达首版上限");
    const old = currentVersion(shot);
    if (stage === "video" && !old.keyframe) invalid("请先导入或生成关键帧");
    const next = { ...old, id: randomUUID(), number: shot.versions.length + 1, reason: stage === "image" ? "新关键帧候选" : "新视频候选", candidateStage: stage, createdAt: new Date().toISOString() };
    if (stage === "image") delete next.keyframe;
    delete next.clip;
    shot.versions.push(next);
  });
}
export async function setOriginalAudio(cwd: string, expectedRevision: number, originalAudio: boolean) {
  return mutate(cwd, expectedRevision, project => {
    editable(project);
    if (Boolean(project.originalAudio) === originalAudio) invalid("声音策略没有变化");
    project.originalAudio = originalAudio;
    // A changed soundtrack needs another explicit human review; keep old records.
    invalidateProductionReviews(project, project.shots.map(shot => shot.id), "声音策略已变化，请重新审片");
  });
}
export async function deliveryManifest(cwd: string, project: DirectorProject) {
  const issues = productionIssues(project, true);
  const assets = [];
  for (const shot of project.shots) {
    const version = currentVersion(shot);
    let available = false;
    if (version.clip) {
      const path = await resolveWorkspacePath(cwd, version.clip.path);
      const info = await stat(path.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
      available = Boolean(info?.isFile() && info.size);
      if (!available) issues.push({ message: `镜头 ${shot.order} 视频文件缺失`, shotId: shot.id });
    }
    assets.push({ shotId: shot.id, order: shot.order, versionId: version.id, title: version.title, duration: version.duration, trimStart: version.trimStart ?? 0, subtitle: version.subtitle, sceneId: version.sceneId, characterIds: version.characterIds, startState: version.startState, endState: version.endState, dialogues: version.dialogues, keyframe: version.keyframe, clip: version.clip, available });
  }
  const latestExport = project.exports.at(-1);
  const exportCurrent = Boolean(latestExport && latestExport.mode !== "storyboard" && latestExport.shotVersions.length === project.shots.length && [...project.shots].sort((left, right) => left.order - right.order).every((shot, index) => latestExport.shotVersions[index]?.shotId === shot.id && latestExport.shotVersions[index]?.versionId === shot.currentVersionId) && Boolean(latestExport.originalAudio) === Boolean(project.originalAudio) && latestExport.musicPath === project.music?.asset.path && latestExport.musicVolume === project.music?.volume && latestExport.ratio === project.ratio && (latestExport.audioSignature ?? "[]") === JSON.stringify(project.audioTracks ?? []) && (latestExport.resolution ?? "720p") === (project.exportSettings?.resolution ?? "720p"));
  const readyForExport = !issues.length;
  if (!exportCurrent) issues.push({ message: "尚未导出与当前内容和声音策略一致的成片" });
  else if (latestExport) {
    const source = await resolveWorkspacePath(cwd, latestExport.asset.path);
    const info = await stat(source.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
    if (!info?.isFile() || !info.size) issues.push({ message: "最近导出的成片文件缺失，请重新合成" });
  }
  return { projectId: project.id, title: project.title, revision: project.revision, createdAt: new Date().toISOString(), ratio: project.ratio, ready: !issues.length, readyForExport, issues, scriptVersionId: project.production?.currentScriptVersionId, characters: project.production?.characters, sceneReferences: project.production?.sceneReferences, assets, audio: { originalAudio: project.originalAudio ?? false, music: project.music ?? null, tracks: project.audioTracks ?? [] }, exportSettings: project.exportSettings, reviews: project.production?.reviews ?? [], latestExport, exportCurrent, usage: { generatedCalls: project.tasks.filter(task => task.stage !== "export").length, succeeded: project.tasks.filter(task => task.stage !== "export" && task.status === "succeeded").length, failed: project.tasks.filter(task => task.stage !== "export" && ["failed", "interrupted"].includes(task.status)).length, actualCost: null, costNote: "未接入供应商账单，调用次数不等于实付金额" } };
}
