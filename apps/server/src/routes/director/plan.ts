import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { draftRevision, planningInputSchema } from "@/utils/director/planning";

const schema = planningInputSchema.extend({
  instruction: z.string().trim().min(1).max(6000),
  expectedRevision: z.number().int().nonnegative(),
});

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  const input = schema.parse(req.body);
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  const project = await u.director.readProject(cwd);
  if (!project) throw Object.assign(new Error("请先创建分镜"), { status: 404 });
  if (project.revision !== input.expectedRevision) throw Object.assign(new Error("项目已更新，请刷新后重新制定计划"), { status: 409 });
  const changes = await draftRevision(project, input.instruction, input);
  res.json(success(await u.director.createPlan(cwd, { instruction: input.instruction, expectedRevision: input.expectedRevision, changes })));
});
