import { dirname, join } from "node:path";
import { readFile, readdir, realpath, stat } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const metadataSchema = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(120), updatedAt: z.iso.datetime() });

export default Router().get("/", async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("请在本机创作页面查看项目"), { status: 403 });
  const root = await realpath(join(dirname(u.conf.path), "workspaces")).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT" || cause.code === "ENOTDIR") return null;
    throw cause;
  });
  const projects: { directory: string; name: string; lastOpenedAt: number }[] = [];
  if (root) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const directory = await realpath(join(root, entry.name));
        if (dirname(directory) !== root || !u.workspaceFile.isWithin(root, directory)) continue;
        const file = await u.workspaceFile.resolveWorkspacePath(directory, "directorProject.json");
        const info = await stat(file.path);
        if (!info.isFile() || info.size > 10000000) continue;
        const metadata = metadataSchema.safeParse(JSON.parse(await readFile(file.path, "utf8")));
        if (!metadata.success) continue;
        projects.push({ directory, name: metadata.data.title, lastOpenedAt: Date.parse(metadata.data.updatedAt) });
      } catch { /* 缺失、损坏或越界的项目不影响其他项目列表，也不尝试修复或恢复任务。 */ }
    }
  }
  res.set("Cache-Control", "no-store").json(success(projects.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)));
});
