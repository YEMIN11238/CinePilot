import { Router } from "express";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeAtomic } from "@toonflow/file";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

let opening: Promise<string> | undefined;

export default Router().post("/", async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("演示项目请在本机打开"), { status: 403 });
  if (!opening) {
    opening = (async () => {
      const root = resolve(dirname(u.conf.path), "workspaces");
      await mkdir(root, { recursive: true });
      const destination = await u.workspaceFile.resolveWorkspacePath(root, "frameflowDemo");
      const exists = await lstat(destination.path).catch((cause: NodeJS.ErrnoException) => { if (cause.code === "ENOENT") return null; throw cause; });
      if (exists) {
        const existing = await u.workspace.resolveWorkspace(req, destination.path);
        if (await u.director.readProject(existing)) return existing;
        throw Object.assign(new Error("演示目录已存在但没有有效项目，请改名保留后再打开演示"), { status: 409 });
      }
      // 先完整创建再公开为演示目录，中途失败不会留下可打开的半成品。
      const draft = await u.workspaceFile.resolveWorkspacePath(root, `frameflowDemoDraft${randomUUID().replaceAll("-", "")}`);
      await mkdir(draft.path);
      const cwd = await u.workspace.resolveWorkspace(req, draft.path);
      const names = ["morning", "pour", "steam", "finish"];
      const assets = await u.workspaceFile.resolveWorkspacePath(cwd, "assets/studioDemo", true);
      await mkdir(assets.path, { recursive: true });
      for (const name of names) {
        const bytes = await readFile(resolve(req.app.locals.webRoot, "studioDemo", `${name}.png`));
        const target = await u.workspaceFile.resolveWorkspacePath(cwd, `assets/studioDemo/${name}.png`);
        await writeAtomic(target.path, bytes, { exclusive: true });
      }
      const musicBytes = await readFile(resolve(req.app.locals.webRoot, "studioDemo", "ambient.wav"));
      const musicTarget = await u.workspaceFile.resolveWorkspacePath(cwd, "assets/studioDemo/ambient.wav");
      await writeAtomic(musicTarget.path, musicBytes, { exclusive: true });
      let project = await u.director.createProject(cwd, {
        title: "清晨第一杯 · 演示项目",
        brief: "一条 20 秒的咖啡产品短片。四张图片为预置 AI 演示素材，用于体验画布、局部改稿、时间轴和静态分镜预演；不是应用调用视频模型的生成结果。",
        style: "琥珀色晨光 / 胡桃木 / 白瓷杯 / 电影胶片质感",
        referenceImage: { path: "assets/studioDemo/finish.png", mimeType: "image/png" },
        shots: [
          { title: "晨光入室", description: "清晨阳光穿过窗户，落在木质吧台、白瓷咖啡杯与手冲器具上。", camera: "中景，固定机位", duration: 5, subtitle: "让清晨，慢一点" },
          { title: "一滴醇香", description: "琥珀色咖啡液从滤杯滴入白瓷杯，微距捕捉液滴与涟漪。", camera: "微距特写，固定机位", duration: 5, subtitle: "每一滴，都有回响" },
          { title: "香气浮起", description: "贴近白瓷杯口，细腻热气在侧逆光中缓缓升起。", camera: "杯口特写，浅景深", duration: 5, subtitle: "让香气，慢慢发生" },
          { title: "此刻刚好", description: "一杯黑咖啡安静置于木质吧台，暖色晨光和咖啡豆衬托产品。", camera: "产品中近景，固定机位", duration: 5, subtitle: "把这一刻，留给自己" },
        ],
      });
      for (const [index, shot] of project.shots.entries()) {
        project = await u.director.attachMedia(cwd, shot.id, "image", `assets/studioDemo/${names[index]}.png`, "image/png", project.revision);
      }
      project = await u.director.setMusic(cwd, { path: "assets/studioDemo/ambient.wav", mimeType: "audio/wav", volume: 0.5 }, project.revision);
      for (const index of [0, 3]) {
        project = await u.director.lockShot(cwd, project.shots[index]!.id, true, project.revision);
      }
      await u.workspaceFile.renameWorkspaceFile(cwd, destination.path);
      return destination.path;
    })().finally(() => { opening = undefined; });
  }
  res.set("Cache-Control", "no-store").json(success({ directory: await opening }));
});
