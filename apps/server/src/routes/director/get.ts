import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { productionIssues } from "@/utils/director/productionState";

export default Router().get("/", validateFields({ directory: z.string().min(1).max(4096) }, "query"), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.query.directory as string);
  const [project, mediaModels] = await Promise.all([u.director.readProject(directory), u.mediaGeneration.listMediaModels()]);
  const configuredMediaProviders = [...new Set(mediaModels.map(model => model.providerId))].filter(id => !!u.mediaProvider.getMediaProviderApiKey(id));
  const readiness = { generation: project ? productionIssues(project) : [], delivery: project ? productionIssues(project, true) : [] };
  res.set("Cache-Control", "no-store").json(success({ project, mediaModels, aiModels: u.ai.listAiModels(), configuredMediaProviders, readiness }));
});
