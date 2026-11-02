import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { CreativeBriefDraft, CreativeBriefInput } from "@/lib/directorBrief";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { draftCreativeBrief } from "@/utils/director/brief";

const schema = z.strictObject({
  requestId: z.uuid(),
  brief: z.string().trim().min(1).max(10000),
  style: z.string().trim().min(1).max(1000),
  ratio: z.enum(["16:9", "9:16", "1:1"]),
  targetDuration: z.union([z.literal(20), z.literal(30), z.literal(60)]),
  providerId: z.string().trim().min(1).max(200).optional(),
  modelId: z.string().trim().min(1).max(200).optional(),
  hasReference: z.boolean().optional(),
});
type BriefRequest = { signature: string; controller: AbortController; clients: number; expiresAt: number; promise: Promise<CreativeBriefDraft> };
const requests = new Map<string, BriefRequest>();
const cacheDuration = 5 * 60 * 1000;
const cacheLimit = 64;

function pendingBrief(requestId: string, input: Omit<CreativeBriefInput, "requestId">) {
  const signature = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const now = Date.now();
  for (const [id, entry] of requests) if (entry.expiresAt > 0 && entry.expiresAt <= now) requests.delete(id);
  const existing = requests.get(requestId);
  if (existing) {
    if (existing.signature !== signature) throw Object.assign(new Error("同一次简报整理的内容已变化，请重新提交"), { status: 409 });
    return existing;
  }
  // ACT: 本地单用户缓存最多 64 条，仅保留结果 5 分钟；不驱逐仍在调用模型的请求。
  if (requests.size >= cacheLimit) {
    const completed = [...requests.entries()].find(([, entry]) => entry.expiresAt > 0);
    if (completed) requests.delete(completed[0]);
    else throw Object.assign(new Error("正在整理的简报过多，请等待已有请求完成"), { status: 429 });
  }
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(120000);
  const promise = draftCreativeBrief(input, AbortSignal.any([controller.signal, deadline]))
    .then(result => { entry.expiresAt = Date.now() + cacheDuration; return result; })
    .catch(cause => {
      if (requests.get(requestId) === entry) requests.delete(requestId);
      if (deadline.aborted && !controller.signal.aborted) throw Object.assign(new Error("整理简报超时，请重试或手动补充。尚未创建项目。"), { status: 504 });
      throw cause;
    });
  const entry: BriefRequest = { signature, controller, clients: 0, expiresAt: 0, promise };
  requests.set(requestId, entry);
  return entry;
}

export default Router().post("/", validateFields(schema.shape), async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("请在本机创作页面整理简报"), { status: 403 });
  const { requestId, ...input } = schema.parse(req.body);
  if (Boolean(input.providerId) !== Boolean(input.modelId)) throw Object.assign(new Error("请同时选择模型供应商和模型"), { status: 400 });
  const entry = pendingBrief(requestId, input);
  entry.clients += 1;
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    entry.clients -= 1;
    if (!entry.clients && !entry.expiresAt) {
      if (requests.get(requestId) === entry) requests.delete(requestId);
      entry.controller.abort();
    }
  };
  const onClose = () => { if (!res.writableEnded) detach(); };
  res.on("close", onClose);
  try {
    const result = await entry.promise;
    if (!res.destroyed) res.set("Cache-Control", "no-store").json(success(result));
  } finally {
    res.off("close", onClose);
    detach();
  }
});
