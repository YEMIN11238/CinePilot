import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, realpath, rm, stat, writeAtomic } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import type { DirectorProject } from "@/lib/directorTypes";
import u from "@/utils";

const schema = z.strictObject({ requestId: z.uuid(), kind: z.enum(["canvas", "edit"]), title: z.string().trim().min(1).max(120) });
type CreatedProject = { directory: string; title: string; project: DirectorProject };
const creating = new Map<string, { signature: string; promise: Promise<CreatedProject> }>();

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("请在本机创作页面新建项目"), { status: 403 });
  const { requestId, ...input } = schema.parse(req.body);
  const signature = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = creating.get(requestId);
  if (previous && previous.signature !== signature) throw Object.assign(new Error("同一次创建的内容已变化，请重新发起新项目"), { status: 409 });
  if (!previous) {
    const promise = (async (): Promise<CreatedProject> => {
      const workspaceRoot = join(dirname(u.conf.path), "workspaces");
      await mkdir(workspaceRoot, { recursive: true });
      const root = await realpath(workspaceRoot);
      const name = `project${requestId.replaceAll("-", "")}`;
      const destination = await u.workspaceFile.resolveWorkspacePath(root, name);
      const existing = await stat(destination.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
      if (existing) {
        let inputHash: unknown;
        try { inputHash = JSON.parse(await readFile(join(destination.path, "directorCreate.json"), "utf8")).inputHash; }
        catch { /* 未识别的原项目保留，不能覆盖。 */ }
        if (inputHash !== signature) throw Object.assign(new Error("同一次创建的内容已变化，原项目已保留"), { status: 409 });
        const directory = await u.workspace.resolveWorkspace(req, destination.path);
        const project = await u.director.readProject(directory);
        if (!project) throw Object.assign(new Error("已有项目不完整，请先检查项目文件"), { status: 409 });
        return { directory, title: project.title, project };
      }
      const draftRoot = join(dirname(u.conf.path), "directorDrafts");
      await mkdir(draftRoot, { recursive: true });
      const temporary = await u.workspaceFile.resolveWorkspacePath(await realpath(draftRoot), name);
      try { await mkdir(temporary.path); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") throw Object.assign(new Error("上次创建被中断，请核对已有项目，或发起新项目"), { status: 409 });
        throw cause;
      }
      try {
        await writeAtomic(join(temporary.path, "directorCreate.json"), `${JSON.stringify({ inputHash: signature })}\n`, { exclusive: true });
        const project = await u.director.createProject(temporary.path, { title: input.title, brief: input.kind === "canvas" ? "自由画布创作" : "已有素材剪辑", style: "遵循导入素材与当前创作要求", shots: [], ratio: "16:9", creationKind: input.kind });
        await u.workspaceFile.renameWorkspaceFile(temporary.path, destination.path);
        const directory = await u.workspace.resolveWorkspace(req, destination.path);
        return { directory, title: project.title, project };
      } catch (cause) {
        await rm(temporary.path, { recursive: true, force: true }).catch(cleanupFailure => console.warn("空白项目目录清理失败", cleanupFailure));
        throw cause;
      }
    })().finally(() => { creating.delete(requestId); });
    creating.set(requestId, { signature, promise });
  }
  res.set("Cache-Control", "no-store").json(success(await creating.get(requestId)!.promise));
});
