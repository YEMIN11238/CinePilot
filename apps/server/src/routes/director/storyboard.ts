import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { draftStoryboard, planningInputSchema } from "@/utils/director/planning";

const schema = planningInputSchema.extend({
  title: z.string().trim().min(1).max(120),
  brief: z.string().trim().min(1).max(12000),
  style: z.string().trim().min(1).max(1000),
  referenceImage: z.strictObject({ path: z.string().min(1).max(2048), mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i) }).optional(),
});

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  const input = schema.parse(req.body);
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  if (await u.director.readProject(cwd)) throw Object.assign(new Error("当前项目已有分镜，请使用修改计划保留已有镜头与版本"), { status: 409 });
  const shots = await draftStoryboard(input);
  res.json(success(await u.director.createProject(cwd, { title: input.title, brief: input.brief, style: input.style, referenceImage: input.referenceImage, shots })));
});
