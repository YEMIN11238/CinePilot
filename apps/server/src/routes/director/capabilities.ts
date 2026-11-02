import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().get("/", async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("请在本机创作页面查看生成能力"), { status: 403 });
  const mediaModels = await u.mediaGeneration.listMediaModels();
  const configuredMediaProviders = [...new Set(mediaModels.map(model => model.providerId))].filter(id => !!u.mediaProvider.getMediaProviderApiKey(id));
  res.set("Cache-Control", "no-store").json(success({ mediaModels, configuredMediaProviders }));
});
