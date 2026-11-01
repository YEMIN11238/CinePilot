import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, realpath, rm, stat, writeAtomic } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import type { DirectorProject } from "@/lib/directorTypes";
import u from "@/utils";
import { draftProduction, productionDraftSchema } from "@/utils/director/production";

const schema = productionDraftSchema.extend({
  requestId: z.uuid(),
  title: z.string().trim().max(120).optional(),
  style: z.string().trim().max(1000).optional(),
  characterConstraints: z.string({ error: "请填写角色设定；没有人物请明确说明" }).trim().min(1, "请填写角色设定；没有人物请明确说明").max(6000),
  invariants: z.string({ error: "请填写必须保留项，或明确说明无特殊要求" }).trim().min(1, "请填写必须保留项，或明确说明无特殊要求").max(4000),
});
type StartedProject = { directory: string; title: string; project: DirectorProject };
const opening = new Map<string, { signature: string; promise: Promise<StartedProject> }>();

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("请在本机创作页面新建项目"), { status: 403 });
  const parsed = schema.parse(req.body);
  const { requestId, ...fields } = parsed;
  const input = productionDraftSchema.parse({
    ...fields,
    title: fields.title || Array.from(fields.brief.split(/\r?\n/)[0]!).slice(0, 24).join(""),
    style: fields.style || "电影感漫剧，统一角色外观与画面风格",
  });
  const signature = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = opening.get(requestId);
  if (previous && previous.signature !== signature) throw Object.assign(new Error("同一次创建的内容已变化，请重新发起新项目"), { status: 409 });
  if (!previous) {
    const promise = (async (): Promise<StartedProject> => {
      const workspaceRoot = join(dirname(u.conf.path), "workspaces");
      await mkdir(workspaceRoot, { recursive: true });
      const root = await realpath(workspaceRoot);
      const name = `project${requestId.replaceAll("-", "")}`;
      const destination = await u.workspaceFile.resolveWorkspacePath(root, name);
      const existing = await stat(destination.path).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return null;
        throw cause;
      });
      if (existing) {
        const record = await readFile(join(destination.path, "directorStart.json"), "utf8").catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === "ENOENT" || cause.code === "ENOTDIR") return "";
          throw cause;
        });
        let inputHash: unknown;
        try { inputHash = JSON.parse(record).inputHash; } catch { /* 不是本入口创建的目录，保留原内容。 */ }
        if (inputHash !== signature) throw Object.assign(new Error("同一次创建的内容已变化，原项目已保留，请重新发起新项目"), { status: 409 });
        const directory = await u.workspace.resolveWorkspace(req, destination.path);
        const project = await u.director.readProject(directory);
        if (!project) throw Object.assign(new Error("上次创建结果不完整，请先检查已有项目后再重新创建"), { status: 409 });
        return { directory, title: project.title, project };
      }
      // ACT: 起草目录在可打开的工作区之外；成功后才发布，失败不删除用户已打开的项目。
      const draftRoot = join(dirname(u.conf.path), "directorDrafts");
      await mkdir(draftRoot, { recursive: true });
      const temporary = await u.workspaceFile.resolveWorkspacePath(await realpath(draftRoot), name);
      try { await mkdir(temporary.path); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") throw Object.assign(new Error("上次起草可能被中断，请先核对创建结果，或重新发起新项目"), { status: 409 });
        throw cause;
      }
      try {
        await writeAtomic(join(temporary.path, "directorStart.json"), `${JSON.stringify({ inputHash: signature })}\n`, { exclusive: true });
        const project = await draftProduction(temporary.path, input);
        await u.workspaceFile.renameWorkspaceFile(temporary.path, destination.path);
        const directory = await u.workspace.resolveWorkspace(req, destination.path);
        return { directory, title: project.title, project };
      } catch (cause) {
        await rm(temporary.path, { recursive: true, force: true }).catch(cleanupFailure => console.warn("创作起草目录清理失败", cleanupFailure));
        throw cause;
      }
    })().finally(() => { opening.delete(requestId); });
    opening.set(requestId, { signature, promise });
  }
  const result = await opening.get(requestId)!.promise;
  res.set("Cache-Control", "no-store").json(success(result));
});
