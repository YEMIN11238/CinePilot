import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import type { AgentMention } from "@toonflow/server/agent/types";
import type { DirectorProject } from "@toonflow/server/directorTypes";
import { createCanvasMention, mentionNodeOutputs, mentionRecord, queryMentionNodes, type MentionCanvasNode, type MentionCanvasSource, type MentionQuery } from "@toonflow/server/agent/mentionSources";

type CreativeMentionSource = MentionCanvasSource & {
  getMention(nodeId: string, outputId?: string, signal?: AbortSignal): Promise<AgentMention>;
  selectedMention(signal?: AbortSignal): Promise<AgentMention>;
};

export function createCreativeMentions(
  getContext: () => CanvasContext | undefined | Promise<CanvasContext | undefined>,
  getProject: () => Pick<DirectorProject, "id" | "title" | "revision"> | null | undefined,
): CreativeMentionSource {
  const cachedNodes = new Map<string, MentionCanvasNode>();
  let cachedCanvasId = "";

  function currentCanvasId() {
    const project = getProject();
    return project ? `creative:${project.id}` : "";
  }

  function guard(canvasId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!canvasId || canvasId !== currentCanvasId()) throw new Error("项目已切换，请重新选择当前画布的素材");
    if (cachedCanvasId !== canvasId) { cachedNodes.clear(); cachedCanvasId = canvasId; }
  }

  async function contextFor(canvasId = currentCanvasId(), signal?: AbortSignal) {
    guard(canvasId, signal);
    const context = await getContext();
    guard(canvasId, signal);
    if (!context || context.id !== canvasId) throw new Error("创作画布尚未就绪，请打开画布后重试");
    return context;
  }

  function asMentionNode(value: unknown): MentionCanvasNode {
    if (!mentionRecord(value) || typeof value.id !== "string") throw new Error("画布节点读取失败，请重新选择");
    const data = mentionRecord(value.data) ? value.data : {};
    const asset = mentionRecord(value.outputs) ? value.outputs : {};
    const assetTruncated = Array.isArray(value.truncated) && value.truncated.some(item => mentionRecord(item) && Array.isArray(item.path) && item.path[0] === "outputs");
    const output = !assetTruncated && typeof asset.path === "string" && asset.path && typeof asset.mimeType === "string" && /^(image|video)\//.test(asset.mimeType)
      ? { id: "output", name: asset.mimeType.startsWith("video/") ? "视频" : "图片", dataType: asset.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE", value: { url: asset.path, mimeType: asset.mimeType } }
      : typeof data.prompt === "string" && data.prompt.trim()
        ? { id: "prompt", name: "创作描述", dataType: "STRING", value: data.prompt } : undefined;
    const label = typeof value.label === "string" ? value.label : value.id;
    return {
      id: value.id, type: typeof value.type === "string" ? value.type : undefined, label,
      data: { label, outputs: output ? { [output.id]: { dataType: output.dataType, value: output.value } } : {}, handles: output ? [{ id: output.id, type: "source", label: output.name, dataType: output.dataType }] : [] },
    };
  }

  async function readNodes(context: CanvasContext, nodeIds: string[], textLimit: number, signal?: AbortSignal) {
    const nodes: MentionCanvasNode[] = [];
    for (let offset = 0; offset < nodeIds.length; offset += 20) {
      const ids = nodeIds.slice(offset, offset + 20);
      let cursor: string | undefined;
      do {
        const result = await context.call({ name: "getCanvasNodes", args: { canvasId: context.id, nodeIds: ids, fields: ["label", "type", "data", "outputs"], dataKeys: ["prompt"], textLimit, ...(cursor ? { cursor } : {}) } }, signal);
        guard(context.id, signal);
        if (!mentionRecord(result) || !Array.isArray(result.nodes)) throw new Error("画布节点读取失败，请重新选择");
        for (const value of result.nodes) {
          const node = asMentionNode(value);
          nodes.push(node); cachedNodes.set(node.id, node);
        }
        cursor = result.hasMore && typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      } while (cursor);
    }
    return nodes;
  }

  async function getMention(nodeId: string, outputId?: string, signal?: AbortSignal) {
    const context = await contextFor(undefined, signal);
    const [node] = await readNodes(context, [nodeId], 4000, signal);
    if (!node) throw new Error("节点已不存在，请重新选择");
    const outputs = mentionNodeOutputs(node);
    const output = outputId ? outputs.find(item => item.id === outputId && item.available) : outputs.find(item => item.available);
    if (!output) throw new Error("这个节点尚无可引用的图片、视频或文字，请先填写内容或完成生成");
    if (output.dataType === "STRING") {
      let text = "";
      let offset = 0;
      let more = true;
      while (more) {
        const result = await context.call({ name: "getCanvasNodes", args: { canvasId: context.id, nodeIds: [nodeId], path: ["data", "prompt"], textOffset: offset, textLimit: 4000 } }, signal);
        guard(context.id, signal);
        const part = mentionRecord(result) && Array.isArray(result.nodes) ? result.nodes[0] : undefined;
        if (!mentionRecord(part) || typeof part.value !== "string") throw new Error("节点文字已变化，请重新选择");
        text += part.value;
        if (text.length > 100000) throw new Error("文字引用最多支持 100000 个字符，请精简后重试");
        const truncated = Array.isArray(part.truncated) ? part.truncated.find(item => mentionRecord(item) && item.reason === "text" && typeof item.nextOffset === "number") : undefined;
        more = !!truncated;
        if (mentionRecord(truncated)) {
          const next = truncated.nextOffset;
          if (typeof next !== "number" || next <= offset) throw new Error("节点文字读取中断，请重新选择");
          offset = next;
        }
      }
      const data = node.data as { outputs: Record<string, { dataType: string; value: unknown }> };
      data.outputs[output.id]!.value = text;
    }
    const mention = await createCanvasMention(node, context.id, output.id, async () => { throw new Error("当前节点没有可引用的文本文件"); });
    guard(context.id, signal);
    const project = getProject()!;
    return { ...mention, source: { kind: "canvas" as const, canvasId: context.id, canvasName: project.title.slice(0, 255), nodeId: node.id, nodeName: typeof node.label === "string" ? node.label.slice(0, 255) : node.id, outputId: output.id, outputName: output.name } };
  }

  return {
    currentCanvasId,
    async canvases(signal) {
      signal?.throwIfAborted();
      const project = getProject();
      return project ? [{ id: `creative:${project.id}`, name: project.title }] : [];
    },
    async nodes(canvasId: string, options: MentionQuery) {
      const context = await contextFor(canvasId, options.signal);
      const result = await context.call({ name: "findCanvasNodes", args: { canvasId, query: options.query, cursor: options.cursor, limit: Math.min(50, Math.max(1, options.limit ?? 20)) } }, options.signal);
      guard(canvasId, options.signal);
      if (!mentionRecord(result) || !Array.isArray(result.nodes)) throw new Error("读取创作节点失败，请重试");
      const ids = result.nodes.filter(mentionRecord).map(item => item.id).filter((id): id is string => typeof id === "string");
      const nodes = await readNodes(context, ids, 4000, options.signal);
      const page = await queryMentionNodes(nodes, `${canvasId}:${getProject()!.revision}`, { limit: 50, signal: options.signal });
      return { items: page.items, ...(result.hasMore && typeof result.nextCursor === "string" ? { nextCursor: result.nextCursor } : {}) };
    },
    outputs(canvasId, nodeId) {
      guard(canvasId);
      const node = cachedNodes.get(nodeId);
      return node ? mentionNodeOutputs(node) : [];
    },
    selectCanvas(canvasId, nodeId, outputId) {
      guard(canvasId);
      return getMention(nodeId, outputId);
    },
    getMention,
    async selectedMention(signal) {
      const context = await contextFor(undefined, signal);
      const result = await context.call({ name: "findCanvasNodes", args: { canvasId: context.id, selectedOnly: true, limit: 2 } }, signal);
      guard(context.id, signal);
      const nodes = mentionRecord(result) && Array.isArray(result.nodes) ? result.nodes.filter(mentionRecord) : [];
      if (nodes.length !== 1 || typeof nodes[0]?.id !== "string") throw new Error("请先在画布中选中一个有内容的节点");
      return getMention(nodes[0].id, undefined, signal);
    },
  };
}
