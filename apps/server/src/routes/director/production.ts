import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { characterSchema, productionReferenceSchema, reviewChecksSchema, sceneSchema } from "@/utils/director/productionState";
import { confirmCharacters, confirmScript, confirmStoryboard, deliveryManifest, draftProduction, draftProductionStoryboard, forkCandidate, productionDraftSchema, reviewShot, saveCharacter, saveSceneReference, saveScript, setOriginalAudio } from "@/utils/director/production";

const common = { directory: z.string().min(1).max(4096), expectedRevision: z.number().int().positive() };
const actions = ["draft", "saveScript", "confirmScript", "saveCharacter", "sceneReference", "confirmCharacters", "storyboard", "confirmStoryboard", "review", "candidate", "audio", "manifest"] as const;
const schema = z.discriminatedUnion("action", [
  productionDraftSchema.extend({ directory: common.directory, action: z.literal("draft") }),
  z.strictObject({ ...common, action: z.literal("saveScript"), logline: z.string().trim().min(1).max(2000), scenes: z.array(sceneSchema).min(1).max(24) }),
  z.strictObject({ ...common, action: z.literal("confirmScript") }),
  z.strictObject({ ...common, action: z.literal("saveCharacter"), character: characterSchema.omit({ revision: true, confirmedAt: true }) }),
  z.strictObject({ ...common, action: z.literal("sceneReference"), sceneId: z.uuid(), referenceImage: productionReferenceSchema.nullable() }),
  z.strictObject({ ...common, action: z.literal("confirmCharacters") }),
  z.strictObject({ ...common, action: z.literal("storyboard"), providerId: z.string().min(1).max(200).optional(), modelId: z.string().min(1).max(200).optional() }),
  z.strictObject({ ...common, action: z.literal("confirmStoryboard") }),
  z.strictObject({ ...common, action: z.literal("review"), shotId: z.uuid(), versionId: z.uuid(), decision: z.enum(["approved", "rejected"]), note: z.string().max(3000), checks: reviewChecksSchema }),
  z.strictObject({ ...common, action: z.literal("candidate"), shotId: z.uuid(), stage: z.enum(["image", "video"]) }),
  z.strictObject({ ...common, action: z.literal("audio"), originalAudio: z.boolean() }),
  z.strictObject({ ...common, action: z.literal("manifest") }),
]);

export default Router().post("/", validateFields({ directory: common.directory, action: z.enum(actions) }), async (req, res) => {
  const input = schema.parse(req.body);
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  let result;
  switch (input.action) {
    case "draft": { const { directory, action, ...fields } = input; result = await draftProduction(cwd, fields); break; }
    case "saveScript": result = await saveScript(cwd, input.expectedRevision, input.logline, input.scenes); break;
    case "confirmScript": result = await confirmScript(cwd, input.expectedRevision); break;
    case "saveCharacter": result = await saveCharacter(cwd, input.expectedRevision, input.character); break;
    case "sceneReference": result = await saveSceneReference(cwd, input.expectedRevision, input.sceneId, input.referenceImage); break;
    case "confirmCharacters": result = await confirmCharacters(cwd, input.expectedRevision); break;
    case "storyboard": result = await draftProductionStoryboard(cwd, input.expectedRevision, input); break;
    case "confirmStoryboard": result = await confirmStoryboard(cwd, input.expectedRevision); break;
    case "review": result = await reviewShot(cwd, input.expectedRevision, input); break;
    case "candidate": result = await forkCandidate(cwd, input.expectedRevision, input.shotId, input.stage); break;
    case "audio": result = await setOriginalAudio(cwd, input.expectedRevision, input.originalAudio); break;
    case "manifest": {
      const project = await u.director.readProject(cwd);
      if (!project) throw Object.assign(new Error("项目不存在"), { status: 404 });
      if (project.revision !== input.expectedRevision) throw Object.assign(new Error("项目已更新，请刷新后生成交付清单"), { status: 409 });
      result = await deliveryManifest(cwd, project); break;
    }
  }
  res.set("Cache-Control", "no-store").json(success(result));
});
