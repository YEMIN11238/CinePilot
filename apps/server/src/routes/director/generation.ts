import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { generationInputSchema } from "@/utils/director";
import u from "@/utils";

const schema = generationInputSchema.extend({ directory: z.string().min(1).max(4096), expectedRevision: z.number().int().positive() });

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  const { directory, expectedRevision, ...input } = schema.parse(req.body);
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  res.set("Cache-Control", "no-store").json(success(await u.director.startCanvasGeneration(cwd, input, expectedRevision)));
});
