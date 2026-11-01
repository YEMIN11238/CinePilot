import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DirectorProject } from "@/lib/directorTypes";
import * as director from "@/utils/director";

const expectedRevision = z.number().int().positive();
const shotId = z.uuid();
const safeActions = ["read", "plan", "apply", "selectVersion", "reorder", "split", "delete", "undo", "redo", "music", "addMediaShot", "refreshTask", "updateAudioTrack", "removeAudioTrack"] as const;
const allActions = [...safeActions, "create", "generate", "export"] as const;
const musicSchema = z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), volume: z.number().finite().min(0).max(1) }).nullable();
const parameters = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("read") }),
  director.createInputSchema.extend({ action: z.literal("create") }),
  director.planInputSchema.extend({ action: z.literal("plan") }),
  z.strictObject({ action: z.literal("apply"), planId: z.uuid(), expectedRevision }),
  z.strictObject({ action: z.literal("selectVersion"), shotId, versionId: z.uuid(), expectedRevision }),
  z.strictObject({ action: z.literal("generate"), shotIds: z.array(shotId).min(1).max(24), stage: z.enum(["image", "video", "all"]), versionId: z.uuid().optional(), expectedRevision }),
  z.strictObject({ action: z.literal("export"), mode: z.enum(["video", "storyboard"]).optional(), expectedRevision }),
  z.strictObject({ action: z.literal("reorder"), shotIds: z.array(shotId).min(1).max(24), expectedRevision }),
  z.strictObject({ action: z.literal("split"), shotId, offset: z.number().finite().min(1).max(29), expectedRevision }),
  z.strictObject({ action: z.literal("delete"), shotId, expectedRevision }),
  z.strictObject({ action: z.literal("undo"), expectedRevision }),
  z.strictObject({ action: z.literal("redo"), expectedRevision }),
  z.strictObject({ action: z.literal("music"), music: musicSchema, expectedRevision }),
  director.mediaShotSchema.extend({ action: z.literal("addMediaShot"), expectedRevision }),
  z.strictObject({ action: z.literal("refreshTask"), taskId: z.uuid(), expectedRevision }),
  z.strictObject({ action: z.literal("updateAudioTrack"), trackId: z.uuid(), patch: director.audioTrackPatchSchema, expectedRevision }),
  z.strictObject({ action: z.literal("removeAudioTrack"), trackId: z.uuid(), expectedRevision }),
]);
// ACT: 模型接口要求顶层 object，动作必填字段仍由 parameters 在执行时严格校验。
const toolParameters = z.strictObject({
  action: z.enum(allActions), expectedRevision: expectedRevision.optional(),
  title: z.string().optional(), brief: z.string().optional(), style: z.string().optional(),
  shots: z.array(director.shotFieldsSchema).optional(),
  instruction: z.string().optional(), changes: z.array(z.strictObject({ shotId, patch: director.patchSchema })).optional(),
  planId: z.uuid().optional(), shotId: shotId.optional(), versionId: z.uuid().optional(),
  shotIds: z.array(shotId).optional(), stage: z.enum(["image", "video", "all"]).optional(),
  mode: z.enum(["video", "storyboard"]).optional(), offset: z.number().optional(), music: musicSchema.optional(),
  taskId: z.uuid().optional(), kind: z.enum(["image", "video"]).optional(), path: z.string().optional(), mimeType: z.string().optional(), duration: z.number().optional(),
  sourceNodeId: z.string().optional(), sourceTaskId: z.uuid().optional(), sourceInputHash: z.string().optional(),
  allowDuplicate: z.boolean().optional(),
  targetShotId: z.uuid().optional(), afterShotId: z.uuid().optional(), sceneId: z.uuid().optional(), characterIds: z.array(z.uuid()).optional(),
  trackId: z.uuid().optional(), patch: director.audioTrackPatchSchema.optional(),
});
function projectSummary(project: DirectorProject | null) {
  if (!project) return null;
  const { history, retiredShots, ...data } = project;
  return {
    ...data,
    shots: project.shots.map(shot => ({
      ...shot, versions: [director.currentVersion(shot)],
      versionHistory: shot.versions.map(version => ({ id: version.id, number: version.number, reason: version.reason, hasImage: Boolean(version.keyframe), hasVideo: Boolean(version.clip) })),
    })),
    plans: project.plans.slice(-5), tasks: project.tasks.slice(-30), exports: project.exports.slice(-3),
    history: { canUndo: Boolean(history?.past.length), canRedo: Boolean(history?.future.length) },
  };
}
export function createDirectorTool(cwd: string, confirmMedia = false): ToolDefinition {
  return {
    name: "director", label: "镜头与剪辑",
    description: "读取当前项目，规划并执行字幕、裁剪、排序、拆分、删除、素材替换、配乐和撤销重做。先 read 获取实际 revision、镜头 ID、素材和锁定状态，再使用当前 revision 操作。plan 只提案，apply 才保存。不能解锁镜头、直接写项目文件或覆盖素材。" + (confirmMedia ? "图片/视频生成与导出由用户点击界面确认，工具不提供收费生成或导出。" : "生成异步执行，须读取真实任务结果才能声称完成。"),
    promptSnippet: "对话与手动编辑共用镜头版本和历史，按最小范围修改并说明结果。",
    promptGuidelines: [
      "已有项目时只使用 director 和画布工具维护项目，不创建另一份分镜或直接写 directorProject.json。先 read 读取真实镜头 ID、revision 和锁定状态；不猜 ID，不修改无关镜头，不解锁。",
      "用户只要求方案时停在 plan；明确要求改字幕、裁剪等执行操作时，可先 plan 再 apply，并说明复用的视频。画面描述或运镜变化会使画面失效，先说明需要重做；不得暗中提交收费任务。",
      "字幕、duration、trimStart、subtitleStart、subtitleEnd 通过 plan/apply 保存。字幕时间在镜头区间内，缩短时同步调整出点。reorder 必须提交全部真实镜头 ID；split 的 offset 是相对当前片段的秒数。",
      "addMediaShot 的 path 只能来自当前项目真实素材或任务结果。替换现有镜头必须传 targetShotId；用户明确要求同素材另加一镜才传 allowDuplicate:true，默认防重复加入。生成素材附带真实 sourceNodeId/sourceTaskId，漫剧新增镜头须传实际 sceneId 和 characterIds。",
      "music 使用当前项目真实音频路径，volume 是 0 至 1；music=null 移除配乐。没有素材时请用户上传或配置，不编造路径，不默认生成音乐。",
      "音轨先从 read 的 audioTracks 查真实 trackId。updateAudioTrack 调整声音名称、start、trimStart、duration、volume、muted；start 是绑定镜头内的偏移，未绑定时是全片时间。volume=0.25表示25%。removeAudioTrack移除声音，可撤销。没有已导入的对白不能宣称已配音。",
      "删除只移出成片，素材和历史保留。undo/redo 恢复编辑，不撤销已发生的模型调用和费用。收到版本冲突时重新 read 检查差异，不能盲目覆盖或重复执行。",
      "只有任务 status=succeeded 且有真实 output 才能说生成成功。待核对任务只可 refreshTask 查询已有远端任务，不自动重试收费生成。回复用镜头序号和名称，不向用户堆叠 UUID。",
    ],
    parameters: z.toJSONSchema(confirmMedia ? toolParameters.extend({ action: z.enum(safeActions) }) : toolParameters, { io: "input", target: "draft-07" }),
    executionMode: "sequential",
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      const input = parameters.parse(params);
      if (confirmMedia && !(safeActions as readonly string[]).includes(input.action)) throw new Error("请在工作台确认生成或导出，当前助手可以直接执行普通编辑。");
      let result: DirectorProject | null;
      switch (input.action) {
        case "read": result = await director.readProject(cwd); break;
        case "create": { const { action, ...fields } = input; result = await director.createProject(cwd, fields); break; }
        case "plan": result = await director.createPlan(cwd, { instruction: input.instruction, expectedRevision: input.expectedRevision, changes: input.changes }); break;
        case "apply": result = await director.applyPlan(cwd, input.planId, input.expectedRevision); break;
        case "selectVersion": result = await director.selectVersion(cwd, input.shotId, input.versionId, input.expectedRevision); break;
        case "generate": result = await director.startGeneration(cwd, input.shotIds, input.stage, input.expectedRevision, input.versionId); break;
        case "export": result = await director.exportMovie(cwd, input.expectedRevision, input.mode); break;
        case "reorder": result = await director.reorderShots(cwd, input.shotIds, input.expectedRevision); break;
        case "split": result = await director.splitShot(cwd, input.shotId, input.offset, input.expectedRevision); break;
        case "delete": result = await director.deleteShot(cwd, input.shotId, input.expectedRevision); break;
        case "undo": result = await director.undoProject(cwd, input.expectedRevision); break;
        case "redo": result = await director.redoProject(cwd, input.expectedRevision); break;
        case "music": result = await director.setMusic(cwd, input.music, input.expectedRevision); break;
        case "addMediaShot": { const { action, expectedRevision: revision, ...fields } = input; result = await director.addMediaShot(cwd, fields, revision); break; }
        case "refreshTask": result = await director.refreshTask(cwd, input.taskId, input.expectedRevision); break;
        case "updateAudioTrack": result = await director.updateAudioTrack(cwd, input.trackId, input.patch, input.expectedRevision); break;
        case "removeAudioTrack": result = await director.removeAudioTrack(cwd, input.trackId, input.expectedRevision); break;
      }
      const summary = projectSummary(result);
      return { content: [{ type: "text", text: JSON.stringify(summary) }], details: summary };
    },
  };
}
