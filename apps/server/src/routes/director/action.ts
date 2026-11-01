import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { audioTrackInputSchema, audioTrackPatchSchema, canvasInputsSchema, createInputSchema, mediaShotSchema, modelsSchema, patchSchema, planInputSchema } from "@/utils/director";

const common = { directory: z.string().min(1).max(4096), expectedRevision: z.number().int().positive() };
const schema = z.discriminatedUnion("action", [
  createInputSchema.extend({ directory: common.directory, action: z.literal("create") }),
  z.strictObject({ ...common, action: z.literal("lock"), shotId: z.uuid(), locked: z.boolean() }),
  z.strictObject({ ...common, action: z.literal("edit"), shotId: z.uuid(), patch: patchSchema }),
  z.strictObject({ ...common, action: z.literal("applyCanvasInputs"), shotId: z.uuid(), inputs: canvasInputsSchema }),
  planInputSchema.extend({ directory: common.directory, action: z.literal("plan") }),
  z.strictObject({ ...common, action: z.literal("apply"), planId: z.uuid() }),
  z.strictObject({ ...common, action: z.literal("discardPlan"), planId: z.uuid() }),
  z.strictObject({ ...common, action: z.literal("selectVersion"), shotId: z.uuid(), versionId: z.uuid() }),
  z.strictObject({ ...common, action: z.literal("configure"), models: modelsSchema }),
  z.strictObject({ ...common, action: z.literal("setRatio"), ratio: z.enum(["9:16", "16:9", "1:1"]) }),
  z.strictObject({ ...common, action: z.literal("generate"), shotIds: z.array(z.uuid()).min(1).max(24).optional(), stage: z.enum(["image", "video", "all"]), versionId: z.uuid().optional() }),
  z.strictObject({ ...common, action: z.literal("refreshTask"), taskId: z.uuid() }),
  z.strictObject({ ...common, action: z.literal("cancelTask"), taskId: z.uuid() }),
  z.strictObject({ ...common, action: z.literal("resolveTask"), taskId: z.uuid(), resolution: z.enum(["notSubmitted", "failed", "abandoned"]), note: z.string().trim().min(1).max(2000) }),
  z.strictObject({ ...common, action: z.literal("deleteShot"), shotId: z.uuid() }),
  z.strictObject({ ...common, action: z.literal("undo") }),
  z.strictObject({ ...common, action: z.literal("redo") }),
  mediaShotSchema.extend({ ...common, action: z.literal("addMediaShot") }),
  z.strictObject({ ...common, action: z.literal("splitShot"), shotId: z.uuid(), offset: z.number().finite().min(1).max(29) }),
  z.strictObject({ ...common, action: z.literal("export"), mode: z.enum(["video", "storyboard"]).optional() }),
  z.strictObject({ ...common, action: z.literal("reorder"), shotIds: z.array(z.uuid()).min(1).max(24) }),
  z.strictObject({ ...common, action: z.literal("music"), music: z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128), volume: z.number().finite().min(0).max(1) }).nullable() }),
  z.strictObject({ ...common, action: z.literal("attach"), shotId: z.uuid(), kind: z.enum(["image", "video"]), path: z.string().min(1).max(2048), mimeType: z.string().min(1).max(128) }),
  audioTrackInputSchema.extend({ ...common, action: z.literal("addAudioTrack") }),
  z.strictObject({ ...common, action: z.literal("updateAudioTrack"), trackId: z.uuid(), patch: audioTrackPatchSchema }),
  z.strictObject({ ...common, action: z.literal("removeAudioTrack"), trackId: z.uuid() }),
  z.strictObject({ ...common, action: z.literal("setExportSettings"), settings: z.strictObject({ resolution: z.enum(["720p", "1080p"]) }) }),
]);

export default Router().post("/", validateFields({ directory: common.directory, action: z.enum(["create", "lock", "edit", "applyCanvasInputs", "plan", "apply", "discardPlan", "selectVersion", "configure", "setRatio", "generate", "refreshTask", "cancelTask", "resolveTask", "deleteShot", "undo", "redo", "addMediaShot", "splitShot", "export", "attach", "reorder", "music", "addAudioTrack", "updateAudioTrack", "removeAudioTrack", "setExportSettings"]) }), async (req, res) => {
  const input = schema.parse(req.body);
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  const director = u.director;
  let project;
  switch (input.action) {
    case "create": {
      const { directory, action, ...fields } = input;
      project = await director.createProject(cwd, fields); break;
    }
    case "lock": project = await director.lockShot(cwd, input.shotId, input.locked, input.expectedRevision); break;
    case "edit": project = await director.editShot(cwd, input.shotId, input.patch, input.expectedRevision); break;
    case "applyCanvasInputs": project = await director.applyCanvasInputs(cwd, input.shotId, input.inputs, input.expectedRevision); break;
    case "plan": project = await director.createPlan(cwd, { instruction: input.instruction, changes: input.changes, expectedRevision: input.expectedRevision }); break;
    case "apply": project = await director.applyPlan(cwd, input.planId, input.expectedRevision); break;
    case "discardPlan": project = await director.discardPlan(cwd, input.planId, input.expectedRevision); break;
    case "selectVersion": project = await director.selectVersion(cwd, input.shotId, input.versionId, input.expectedRevision); break;
    case "configure": project = await director.configureModels(cwd, input.models, input.expectedRevision); break;
    case "setRatio": project = await director.setRatio(cwd, input.ratio, input.expectedRevision); break;
    case "generate": project = await director.startGeneration(cwd, input.shotIds, input.stage, input.expectedRevision, input.versionId); break;
    case "refreshTask": project = await director.refreshTask(cwd, input.taskId, input.expectedRevision); break;
    case "cancelTask": project = await director.cancelTask(cwd, input.taskId, input.expectedRevision); break;
    case "resolveTask": project = await director.resolveTask(cwd, input.taskId, input.resolution, input.note, input.expectedRevision); break;
    case "deleteShot": project = await director.deleteShot(cwd, input.shotId, input.expectedRevision); break;
    case "undo": project = await director.undoProject(cwd, input.expectedRevision); break;
    case "redo": project = await director.redoProject(cwd, input.expectedRevision); break;
    case "addMediaShot": {
      const { directory, action, expectedRevision, ...fields } = input;
      project = await director.addMediaShot(cwd, fields, expectedRevision); break;
    }
    case "splitShot": project = await director.splitShot(cwd, input.shotId, input.offset, input.expectedRevision); break;
    case "export": project = await director.exportMovie(cwd, input.expectedRevision, input.mode); break;
    case "reorder": project = await director.reorderShots(cwd, input.shotIds, input.expectedRevision); break;
    case "music": project = await director.setMusic(cwd, input.music, input.expectedRevision); break;
    case "attach": project = await director.attachMedia(cwd, input.shotId, input.kind, input.path, input.mimeType, input.expectedRevision); break;
    case "addAudioTrack": {
      const { directory, action, expectedRevision, ...fields } = input;
      project = await director.addAudioTrack(cwd, fields, expectedRevision); break;
    }
    case "updateAudioTrack": project = await director.updateAudioTrack(cwd, input.trackId, input.patch, input.expectedRevision); break;
    case "removeAudioTrack": project = await director.removeAudioTrack(cwd, input.trackId, input.expectedRevision); break;
    case "setExportSettings": project = await director.setExportSettings(cwd, input.settings, input.expectedRevision); break;
  }
  res.set("Cache-Control", "no-store").json(success(project));
});
