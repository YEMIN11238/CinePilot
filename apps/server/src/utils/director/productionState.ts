import { z } from "zod";
import type { DirectorGenerationInput, DirectorProject, DirectorShot, ProductionScript, ShotVersion } from "@/lib/directorTypes";
import { directorGenerationContext, directorReviewContext } from "@/lib/directorReview";

// Adapted from ViMax's MIT character/shot contracts: stable identities, separate
// static appearance and wardrobe, first/last-frame state. See apps/web/public/openSource.txt.
export const dialogueSchema = z.strictObject({ speakerId: z.uuid(), text: z.string().trim().min(1).max(1000) });
export const productionReferenceSchema = z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().startsWith("image/"), rights: z.enum(["owned", "licensed", "unverified"]) });
export const sceneSchema = z.strictObject({ id: z.uuid(), title: z.string().trim().min(1).max(120), location: z.string().trim().min(1).max(500), action: z.string().trim().min(1).max(6000), dialogues: z.array(dialogueSchema).max(50) });
export const characterSchema = z.strictObject({
  id: z.uuid(), name: z.string().trim().min(1).max(80), appearance: z.string().trim().min(1).max(2000),
  costume: z.string().trim().min(1).max(2000), props: z.string().max(1000), goal: z.string().trim().min(1).max(2000), knownFacts: z.string().trim().min(1).max(3000),
  voice: z.string().max(1000).optional(),
  revision: z.number().int().positive(), confirmedAt: z.iso.datetime().optional(),
  referenceImage: productionReferenceSchema.optional(),
});
export const reviewChecksSchema = z.strictObject({ visual: z.boolean(), continuity: z.boolean(), audio: z.boolean(), subtitles: z.boolean(), rights: z.boolean() });
const versionReferenceSchema = z.strictObject({ shotId: z.uuid(), versionId: z.uuid() });
export const productionSchema = z.strictObject({
  episode: z.number().int().min(1).max(999), targetDuration: z.number().int().min(5).max(600), shotCount: z.number().int().min(1).max(24),
  characterConstraints: z.string().trim().min(1).max(6000), invariants: z.string().trim().min(1).max(4000),
  currentScriptVersionId: z.uuid(),
  scriptVersions: z.array(z.strictObject({ id: z.uuid(), number: z.number().int().positive(), logline: z.string().trim().min(1).max(2000), scenes: z.array(sceneSchema).min(1).max(24), createdAt: z.iso.datetime(), confirmedAt: z.iso.datetime().optional() })).min(1).max(100),
  characters: z.array(characterSchema).max(12),
  characterHistory: z.array(characterSchema).max(1000).optional(),
  sceneReferences: z.array(z.strictObject({ sceneId: z.uuid(), revision: z.number().int().positive(), referenceImage: productionReferenceSchema })).max(24).optional(),
  storyboard: z.strictObject({ scriptVersionId: z.uuid(), characterRevisions: z.array(z.strictObject({ id: z.uuid(), revision: z.number().int().positive() })).max(12), shotVersions: z.array(versionReferenceSchema).min(1).max(24), confirmedAt: z.iso.datetime() }).optional(),
  reviews: z.array(z.strictObject({ id: z.uuid(), shotId: z.uuid(), versionId: z.uuid(), decision: z.enum(["approved", "rejected", "stale"]), source: z.enum(["user", "dependency"]).optional(), contextKey: z.string().max(20000).optional(), generationContextKey: z.string().max(2000).optional(), note: z.string().max(3000), createdAt: z.iso.datetime(), checks: reviewChecksSchema })).max(2000),
});

export function invalidateProductionReviews(project: DirectorProject, shotIds: string[], note: string) {
  const workflow = project.production;
  if (!workflow) return;
  const shots = project.shots.filter(shot => shotIds.includes(shot.id));
  if (workflow.reviews.length + shots.length > 2000) throw Object.assign(new Error("审片记录已达首版上限"), { status: 409 });
  for (const shot of shots) workflow.reviews.push({ id: crypto.randomUUID(), shotId: shot.id, versionId: shot.currentVersionId, decision: "stale", source: "dependency", note, createdAt: new Date().toISOString(), checks: { visual: false, continuity: false, audio: false, subtitles: false, rights: false } });
}

export function productionScript(project: DirectorProject): ProductionScript | undefined {
  return project.production?.scriptVersions.find(version => version.id === project.production?.currentScriptVersionId);
}
export function productionIssues(project: DirectorProject, delivery = false): { message: string; shotId?: string }[] {
  const workflow = project.production;
  if (!workflow) return [];
  const issues: { message: string; shotId?: string }[] = [];
  const script = productionScript(project);
  if (!script?.confirmedAt) issues.push({ message: "请先审阅并确认当前剧本版本" });
  for (const character of workflow.characters) if (!character.confirmedAt) issues.push({ message: `角色「${character.name}」尚未确认` });
  const board = workflow.storyboard;
  if (!board || board.scriptVersionId !== script?.id) {
    issues.push({ message: "分镜尚未确认，或前序剧本／角色已变化，请复查分镜" });
  }
  for (const shot of project.shots) {
    const version = shot.versions.find(item => item.id === shot.currentVersionId)!;
    const changedCharacters = workflow.characters.filter(character => version.characterIds?.includes(character.id) && !board?.characterRevisions.some(item => item.id === character.id && item.revision === character.revision));
    if (changedCharacters.length) issues.push({ message: `镜头 ${shot.order} 的角色「${changedCharacters.map(character => character.name).join('、')}」已变化，请复查`, shotId: shot.id });
    if (!board?.shotVersions.some(item => item.shotId === shot.id && item.versionId === shot.currentVersionId)) issues.push({ message: `镜头 ${shot.order} 当前版本待确认`, shotId: shot.id });
    if (!delivery) continue;
    if (!version.clip) issues.push({ message: `镜头 ${shot.order} 缺少视频素材`, shotId: shot.id });
    const review = [...workflow.reviews].reverse().find(item => item.shotId === shot.id && item.versionId === shot.currentVersionId);
    if (!review || review.decision !== "approved" || review.contextKey !== directorReviewContext(project, shot.id)) issues.push({ message: `镜头 ${shot.order} 尚未通过当前依赖版本的人工审片`, shotId: shot.id });
  }
  if (!project.shots.length) issues.push({ message: "尚未生成分镜" });
  return issues;
}
export function assertProductionReady(project: DirectorProject, delivery = false) {
  const issue = productionIssues(project, delivery)[0];
  if (issue) throw Object.assign(new Error(issue.message), { status: 422 });
}
export function hasApprovedSample(project: DirectorProject) {
  return project.shots.some(shot => {
    const latest = [...(project.production?.reviews ?? [])].reverse().find(review => review.shotId === shot.id && review.versionId === shot.currentVersionId);
    return Boolean(shot.versions.find(item => item.id === shot.currentVersionId)?.clip && latest?.decision === "approved" && latest.contextKey === directorReviewContext(project, shot.id) && latest.generationContextKey === directorGenerationContext(project));
  });
}
export function validateProductionReferences(project: DirectorProject, shot: DirectorShot, versionId = shot.currentVersionId) {
  const workflow = project.production;
  if (!workflow) return;
  const version = shot.versions.find(item => item.id === versionId)!;
  if (!productionScript(project)?.scenes.some(scene => scene.id === version.sceneId)) throw Object.assign(new Error(`镜头 ${shot.order} 的场景不存在，请重新关联并确认分镜`), { status: 422 });
  const sceneReference = workflow.sceneReferences?.find(item => item.sceneId === version.sceneId);
  if (sceneReference?.referenceImage.rights === "unverified") throw Object.assign(new Error(`镜头 ${shot.order} 的场景参考图来源尚未确认`), { status: 422 });
  for (const id of version.characterIds ?? []) {
    const character = workflow.characters.find(item => item.id === id);
    if (!character) throw Object.assign(new Error(`镜头 ${shot.order} 引用了不存在的角色`), { status: 422 });
    if (!character.referenceImage || character.referenceImage.rights === "unverified") throw Object.assign(new Error(`请补齐角色「${character.name}」的参考图与授权状态`), { status: 422 });
  }
}

function reject(message: string): never { throw Object.assign(new Error(message), { status: 422 }); }
function shotContent(version: ShotVersion) {
  return JSON.stringify([version.title, version.description, version.camera, version.duration, version.subtitle, version.trimStart ?? 0, version.subtitleStart ?? 0, version.subtitleEnd ?? null, version.sceneId ?? null, version.characterIds ?? [], version.startState ?? null, version.endState ?? null, version.dialogues ?? []]);
}
export function sameProductionShotContent(left: ShotVersion, right: ShotVersion) { return shotContent(left) === shotContent(right); }
export function assertProductionTarget(project: DirectorProject, shot: DirectorShot, versionId = shot.currentVersionId) {
  const version = shot.versions.find(item => item.id === versionId);
  if (!version) reject("目标镜头版本不存在");
  if (!project.production) return version;
  assertProductionReady(project);
  const approvedId = project.production.storyboard?.shotVersions.find(item => item.shotId === shot.id)?.versionId;
  const approved = shot.versions.find(item => item.id === approvedId);
  if (!approved || !sameProductionShotContent(version, approved)) reject(`镜头 ${shot.order} 的候选内容未确认，请先采用并确认分镜再生成`);
  validateProductionReferences(project, shot, versionId);
  return version;
}
export function assertProductionCanvasScope(project: DirectorProject, input: DirectorGenerationInput) {
  if (!project.production) return;
  const scope = input.scope;
  if (!scope) reject("漫剧生成节点必须关联镜头版本、角色或场景，确认后才能生成");
  const awaiting = project.tasks.some(task => {
    if (task.status !== "verificationRequired") return false;
    const previous = task.generation?.scope;
    if (scope.kind === "shot") return task.shotId === scope.shotId || previous?.kind === "shot" && previous.shotId === scope.shotId;
    if (scope.kind === "character") return previous?.kind === "character" && previous.characterId === scope.characterId;
    return previous?.kind === "scene" && previous.sceneId === scope.sceneId;
  });
  if (awaiting) reject("关联对象已有上游结果待核对的任务，请先查询或人工处理；复制节点不会解除提交保护");
  const script = productionScript(project);
  if (!script?.confirmedAt) reject("请先审阅并确认当前剧本版本");
  if (scope.kind === "shot") {
    const shot = project.shots.find(item => item.id === scope.shotId);
    if (!shot) reject("节点关联的镜头不存在");
    if (shot.locked) reject(`镜头 ${shot.order} 已锁定，请先解锁`);
    const version = assertProductionTarget(project, shot, scope.versionId);
    if (input.prompt.trim() !== version.description.trim()) reject("节点提示与已确认分镜不一致，请先将输入应用到镜头并确认分镜");
    const model = project.models[input.kind];
    if (!model || model.providerId !== input.model.providerId || model.modelId !== input.model.modelId || model.resolution !== input.model.resolution || model.size !== input.model.size || input.ratio !== project.ratio) reject("节点模型或画幅与项目配置不一致，请同步配置后再生成");
    if (input.kind === "video") {
      if (!version.keyframe || input.reference?.path !== version.keyframe.path) reject("请使用此镜头版本的关键帧生成视频，其他参考图需先明确采用到镜头");
      const requiredDuration = version.duration + (version.trimStart ?? 0);
      if (input.duration !== (requiredDuration <= 5 ? 5 : 10) || requiredDuration > 10) reject("节点生成时长与已确认镜头入出点不一致");
    } else if (input.reference) {
      const allowed = [...project.production.characters.filter(character => version.characterIds?.includes(character.id)).map(character => character.referenceImage?.path), project.production.sceneReferences?.find(scene => scene.sceneId === version.sceneId)?.referenceImage.path, project.referenceImage?.path];
      if (!allowed.includes(input.reference.path)) reject("节点参考图未包含在已确认角色、场景或项目参考中，请先明确绑定并确认来源");
    }
    return;
  }
  if (input.kind !== "image") reject("角色与场景资产仅支持生图；视频请关联已确认镜头");
  if (scope.kind === "character") {
    const character = project.production.characters.find(item => item.id === scope.characterId);
    if (!character || character.revision !== scope.revision || !character.confirmedAt) reject("节点关联的角色未确认或已更新，请重新选择当前角色版本");
    if (input.reference && (character.referenceImage?.path !== input.reference.path || character.referenceImage.rights === "unverified")) reject("角色参考图尚未绑定或来源未确认，请先在角色资料中确认");
  } else {
    if (scope.scriptVersionId !== script.id || !script.scenes.some(scene => scene.id === scope.sceneId)) reject("节点关联的场景剧本已变化，请重新选择当前场景");
    const reference = project.production.sceneReferences?.find(item => item.sceneId === scope.sceneId)?.referenceImage;
    if (input.reference && (reference?.path !== input.reference.path || reference.rights === "unverified")) reject("场景参考图尚未绑定或来源未确认，请先在场景资料中确认");
  }
}
