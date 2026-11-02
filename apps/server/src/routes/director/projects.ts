import { dirname, join } from "node:path";
import { readFile, readdir, realpath, stat } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const metadataSchema = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(120), updatedAt: z.iso.datetime() });
const previewAssetSchema = z.object({
  path: z.string().min(1).max(2048).refine(value => !/[\0:]/.test(value) && !/^[\\/]/.test(value) && !value.split(/[\\/]/).some(part => !part || part === "." || part === "..")),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]),
});
const stateSchema = z.object({
  production: z.object({ currentScriptVersionId: z.string(), scriptVersions: z.array(z.object({ id: z.string(), confirmedAt: z.string().optional() })), storyboard: z.object({ scriptVersionId: z.string() }).optional() }).optional(),
  shots: z.array(z.object({ id: z.string(), order: z.number(), currentVersionId: z.string(), versions: z.array(z.object({ id: z.string(), keyframe: previewAssetSchema.optional(), clip: z.unknown().optional() })) })).default([]),
  tasks: z.array(z.object({ status: z.string(), stage: z.string(), output: z.object({ path: z.string(), mimeType: z.string() }).optional() })).default([]),
  exports: z.array(z.unknown()).default([]),
});
type ProjectEntry = { directory: string; name: string; lastOpenedAt: number; previewAsset?: z.infer<typeof previewAssetSchema>; stage: "planning" | "generating" | "review" | "exported" | "draft"; statusLabel: string; nextAction: string };
function projectStatus(project: z.infer<typeof stateSchema>): Pick<ProjectEntry, "stage" | "statusLabel" | "nextAction"> {
  const active = project.tasks.findLast(task => ["queued", "running"].includes(task.status));
  if (active) return { stage: "generating", statusLabel: active.stage === "export" ? "正在导出" : "正在生成", nextAction: "查看进度" };
  if (project.tasks.some(task => task.status === "verificationRequired")) return { stage: "review", statusLabel: "任务待核对", nextAction: "核对任务" };
  const workflow = project.production;
  if (workflow) {
    const script = workflow.scriptVersions.find(script => script.id === workflow.currentScriptVersionId);
    if (!script?.confirmedAt) return { stage: "planning", statusLabel: "剧本待确认", nextAction: "审阅剧本" };
    if (!workflow.storyboard || workflow.storyboard.scriptVersionId !== script.id || !project.shots.length) return { stage: "planning", statusLabel: "分镜待确认", nextAction: "继续策划" };
  }
  // ACT: 此处只读取列表元数据，不恢复任务或判断导出与当前剪辑完全相同。
  if (project.exports.length) return { stage: "exported", statusLabel: "有导出记录", nextAction: "查看当前版本" };
  if (project.shots.length) {
    const complete = project.shots.every(shot => shot.versions.find(version => version.id === shot.currentVersionId)?.clip);
    return { stage: complete ? "review" : "draft", statusLabel: complete ? "待审片" : "镜头制作中", nextAction: complete ? "预览短片" : "继续制作" };
  }
  if (project.tasks.some(task => task.status === "succeeded" && task.output)) return { stage: "draft", statusLabel: "已有生成素材", nextAction: "继续创作" };
  return { stage: "draft", statusLabel: "创作草稿", nextAction: "继续创作" };
}
async function previewAsset(directory: string, project: z.infer<typeof stateSchema>) {
  const candidates = [...project.shots].sort((a, b) => a.order - b.order).flatMap(shot => {
    const asset = shot.versions.find(version => version.id === shot.currentVersionId)?.keyframe;
    return asset ? [asset] : [];
  });
  try {
    const graphFile = await u.workspaceFile.resolveWorkspacePath(directory, "directorCreativeGraph.json");
    const info = await stat(graphFile.path);
    if (info.isFile() && info.size <= 1024 * 1024) {
      const graph = z.object({ cinePilotCreativeGraph: z.literal(1), nodes: z.array(z.object({ kind: z.string(), asset: z.unknown().optional() })).max(150) }).safeParse(JSON.parse(await readFile(graphFile.path, "utf8")));
      const assets = graph.success ? graph.data.nodes.filter(node => node.kind === "image").flatMap(node => { const asset = previewAssetSchema.safeParse(node.asset); return asset.success ? [asset.data] : []; }) : [];
      const latestSelected = [...project.tasks].reverse().find(task => task.status === "succeeded" && task.stage === "image" && assets.some(asset => asset.path === task.output?.path));
      const selected = assets.find(asset => asset.path === latestSelected?.output?.path);
      candidates.push(...(selected ? [selected] : []), ...assets);
    }
  } catch { /* 无画布或损坏画布不影响项目入口，不用历史未选结果替代当前素材。 */ }
  for (const candidate of candidates) {
    try {
      const file = await u.workspaceFile.resolveWorkspacePath(directory, candidate.path);
      if ((await stat(file.path)).isFile()) return candidate;
    } catch { /* 素材丢失或越界时尝试其他当前素材。 */ }
  }
}

export default Router().get("/", async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("请在本机创作页面查看项目"), { status: 403 });
  const root = await realpath(join(dirname(u.conf.path), "workspaces")).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT" || cause.code === "ENOTDIR") return null;
    throw cause;
  });
  const projects: ProjectEntry[] = [];
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
        const document = JSON.parse(await readFile(file.path, "utf8"));
        const metadata = metadataSchema.safeParse(document);
        if (!metadata.success) continue;
        const state = stateSchema.safeParse(document);
        const details = state.success ? projectStatus(state.data) : { stage: "draft" as const, statusLabel: "项目待检查", nextAction: "打开项目" };
        const preview = state.success ? await previewAsset(directory, state.data) : undefined;
        projects.push({ directory, name: metadata.data.title, lastOpenedAt: Date.parse(metadata.data.updatedAt), ...details, ...(preview ? { previewAsset: preview } : {}) });
      } catch { /* 缺失、损坏或越界的项目不影响其他项目列表，也不尝试修复或恢复任务。 */ }
    }
  }
  res.set("Cache-Control", "no-store").json(success(projects.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)));
});
