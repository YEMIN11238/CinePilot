import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, rm, stat } from "@toonflow/file";
import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { productionDemoInput } from "@/utils/director/productionDemo";

let opening: Promise<string> | undefined;
export default Router().post("/", async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("演示项目请在本机打开"), { status: 403 });
  if (!opening) opening = (async () => {
    const root = join(dirname(u.conf.path), "workspaces");
    await mkdir(root, { recursive: true });
    const destination = await u.workspaceFile.resolveWorkspacePath(root, "comicDemo", true);
    const exists = await stat(destination.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
    if (exists) {
      const cwd = await u.workspace.resolveWorkspace(req, destination.path);
      if (await u.director.readProject(cwd)) return cwd;
      throw Object.assign(new Error("漫剧演示目录已有文件，请先从本地项目打开检查"), { status: 409 });
    }
    const temporary = await u.workspaceFile.resolveWorkspacePath(root, `comicDemoDraft${randomUUID().replaceAll("-", "")}`, true);
    await mkdir(temporary.path);
    const cwd = await u.workspace.resolveWorkspace(req, temporary.path);
    try {
      await u.director.createProject(cwd, productionDemoInput());
      await u.workspaceFile.renameWorkspaceFile(cwd, destination.path);
      return await u.workspace.resolveWorkspace(req, destination.path);
    } catch (cause) { await rm(temporary.path, { recursive: true, force: true }); throw cause; }
  })().finally(() => { opening = undefined; });
  res.set("Cache-Control", "no-store").json(success({ directory: await opening }));
});
