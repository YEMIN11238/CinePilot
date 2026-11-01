import type { DirectorGenerationInput } from "@toonflow/server/directorTypes";
import { isAxiosError } from "axios";
import useWorkspaceFiles, { type TextSnapshot } from "@/lib/workspaceFiles";

export type CreativeKind = "text" | "image" | "video";
export type CreativeGeneration = {
  model?: { providerId: string; modelId: string; resolution?: string; size?: string };
  ratio: "16:9" | "9:16" | "1:1";
  duration: 5 | 10;
  referencePath?: string;
  scope?: DirectorGenerationInput["scope"];
  requestId?: string;
  inputSignature?: string;
  lastOutputTaskId?: string;
};
export type CreativeNode = {
  id: string;
  kind: CreativeKind;
  title: string;
  text: string;
  asset?: { path: string; mimeType: string };
  generation?: CreativeGeneration;
  position: { x: number; y: number };
};
export type CreativeEdge = { id: string; source: string; target: string };
export type CreativeGraph = {
  cinePilotCreativeGraph: 1;
  nodes: CreativeNode[];
  edges: CreativeEdge[];
  positions: Record<string, { x: number; y: number }>;
  appliedInputs: Record<string, string>;
};

const graphPath = "directorCreativeGraph.json";
const maxBytes = 1024 * 1024;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/;
const shotIdPattern = /^shot:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function emptyCreativeGraph(): CreativeGraph {
  return { cinePilotCreativeGraph: 1, nodes: [], edges: [], positions: {}, appliedInputs: {} };
}

function invalidGraph(): never {
  throw new Error("创作画布文件格式无效，磁盘内容未被覆盖。请恢复有效文件后重新打开项目。");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidGraph();
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value) || ["constructor", "prototype", "__proto__"].includes(value)) return invalidGraph();
  return value;
}

function coordinates(value: unknown): { x: number; y: number } {
  const point = record(value);
  if (typeof point.x !== "number" || !Number.isFinite(point.x) || Math.abs(point.x) > 1000000 || typeof point.y !== "number" || !Number.isFinite(point.y) || Math.abs(point.y) > 1000000) return invalidGraph();
  return { x: point.x, y: point.y };
}

function validateGraph(value: unknown): CreativeGraph {
  const input = record(value);
  if (input.cinePilotCreativeGraph !== 1 || !Array.isArray(input.nodes) || input.nodes.length > 150 || !Array.isArray(input.edges) || input.edges.length > 400) return invalidGraph();
  const nodeIds = new Set<string>();
  const nodes = input.nodes.map(value => {
    const node = record(value);
    const id = identifier(node.id);
    if (id.startsWith("shot:") || nodeIds.has(id) || !["text", "image", "video"].includes(String(node.kind)) || typeof node.title !== "string" || node.title.length > 120 || typeof node.text !== "string" || node.text.length > 6000) return invalidGraph();
    nodeIds.add(id);
    const result: CreativeNode = { id, kind: node.kind as CreativeKind, title: node.title, text: node.text, position: coordinates(node.position) };
    if (node.generation !== undefined) {
      const settings = record(node.generation);
      if (node.kind === "text" || !["16:9", "9:16", "1:1"].includes(String(settings.ratio)) || ![5, 10].includes(Number(settings.duration))) return invalidGraph();
      result.generation = { ratio: settings.ratio as CreativeGeneration["ratio"], duration: settings.duration as 5 | 10 };
      if (settings.model !== undefined) {
        const model = record(settings.model);
        if (typeof model.providerId !== "string" || !model.providerId || model.providerId.length > 160 || typeof model.modelId !== "string" || !model.modelId || model.modelId.length > 200) return invalidGraph();
        result.generation.model = { providerId: model.providerId, modelId: model.modelId };
        for (const key of ["resolution", "size"] as const) if (model[key] !== undefined) { if (typeof model[key] !== "string" || model[key].length > 100) return invalidGraph(); result.generation.model[key] = model[key]; }
      }
      if (settings.scope !== undefined) {
        const scope = record(settings.scope);
        if (scope.kind === "shot") result.generation.scope = { kind: "shot", shotId: identifier(scope.shotId), versionId: identifier(scope.versionId) };
        else if (scope.kind === "character" && Number.isInteger(scope.revision) && Number(scope.revision) > 0) result.generation.scope = { kind: "character", characterId: identifier(scope.characterId), revision: Number(scope.revision) };
        else if (scope.kind === "scene") result.generation.scope = { kind: "scene", sceneId: identifier(scope.sceneId), scriptVersionId: identifier(scope.scriptVersionId) };
        else return invalidGraph();
      }
      for (const [key, limit] of [["referencePath", 2048], ["requestId", 160], ["inputSignature", 40000], ["lastOutputTaskId", 160]] as const) {
        if (settings[key] !== undefined) { if (typeof settings[key] !== "string" || settings[key].length > limit) return invalidGraph(); result.generation[key] = settings[key]; }
      }
    }
    if (node.asset !== undefined) {
      const asset = record(node.asset);
      if (node.kind === "text" || typeof asset.path !== "string" || !asset.path || asset.path.length > 2048 || /[\0:]/.test(asset.path) || /^[\\/]/.test(asset.path) || asset.path.split(/[\\/]/).some(part => part === "." || part === ".." || !part) || typeof asset.mimeType !== "string" || !new RegExp(`^${node.kind}/[a-zA-Z0-9.+_-]{1,100}$`).test(asset.mimeType)) return invalidGraph();
      result.asset = { path: asset.path, mimeType: asset.mimeType };
    }
    return result;
  });
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  const edges = input.edges.map(value => {
    const edge = record(value);
    const id = identifier(edge.id);
    const source = identifier(edge.source);
    const target = identifier(edge.target);
    const pair = JSON.stringify([source, target]);
    if (edgeIds.has(id) || pairs.has(pair) || source === target || ![source, target].every(endpoint => nodeIds.has(endpoint) || shotIdPattern.test(endpoint))) return invalidGraph();
    edgeIds.add(id);
    pairs.add(pair);
    return { id, source, target };
  });
  const rawPositions = record(input.positions);
  const rawInputs = record(input.appliedInputs);
  if (Object.keys(rawPositions).length > 2000 || Object.keys(rawInputs).length > 2000) return invalidGraph();
  const positions: CreativeGraph["positions"] = Object.create(null);
  const appliedInputs: CreativeGraph["appliedInputs"] = Object.create(null);
  for (const [id, point] of Object.entries(rawPositions)) positions[identifier(id)] = coordinates(point);
  for (const [id, signature] of Object.entries(rawInputs)) {
    if (typeof signature !== "string" || signature.length > 100000) return invalidGraph();
    appliedInputs[identifier(id)] = signature;
  }
  return { cinePilotCreativeGraph: 1, nodes, edges, positions, appliedInputs };
}

function parseGraph(text: string): CreativeGraph {
  try { return validateGraph(JSON.parse(text)); }
  catch { return invalidGraph(); }
}

async function legacyPositions(files: ReturnType<typeof useWorkspaceFiles>, signal?: AbortSignal) {
  const positions: CreativeGraph["positions"] = {};
  try {
    const document = record(await files.readJson("directorCanvasLayout.json", signal));
    if (document.frameflowDirectorCanvas !== 1) return positions;
    for (const [id, point] of Object.entries(record(document.positions))) {
      const key = `shot:${id}`;
      if (shotIdPattern.test(key)) positions[key] = coordinates(point);
    }
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // ACT: 旧布局只作为首次创建的位置提示；读取失败不修改或修复旧文件。
  }
  return positions;
}

export async function readCreativeGraph(directory: string, signal?: AbortSignal) {
  const files = useWorkspaceFiles(directory);
  let snapshot: TextSnapshot;
  try { snapshot = await files.readTextSnapshot(graphPath, { maxBytes, signal }); }
  catch (cause) {
    if (!isAxiosError(cause) || cause.response?.status !== 404 || signal?.aborted) throw cause;
    const graph = emptyCreativeGraph();
    graph.positions = await legacyPositions(files, signal);
    signal?.throwIfAborted();
    try { await files.writeJson(graphPath, graph, true); }
    catch (createCause) { if (!isAxiosError(createCause) || createCause.response?.status !== 409) throw createCause; }
    snapshot = await files.readTextSnapshot(graphPath, { maxBytes, signal });
  }
  signal?.throwIfAborted();
  const graph = parseGraph(snapshot.text);
  let queue = Promise.resolve();
  let blocked = "";
  function save(value: CreativeGraph): Promise<void> {
    if (blocked) return Promise.reject(new Error(blocked));
    let text: string;
    try {
      text = `${JSON.stringify(validateGraph(value), null, 2)}\n`;
      if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("画布内容超过 1 MB，请减少节点文字或拆分项目。磁盘内容未被覆盖。");
    } catch (cause) {
      blocked = cause instanceof Error ? cause.message : "画布内容无效，未能保存。";
      return Promise.reject(new Error(blocked));
    }
    const writing = queue.then(async () => {
      if (blocked) throw new Error(blocked);
      try {
        const revision = await files.writeTextSnapshot(graphPath, text, snapshot);
        snapshot = { ...snapshot, text, revision };
      } catch (cause) {
        blocked = isAxiosError(cause) && cause.response?.status === 409
          ? "其他窗口已修改创作画布，本次修改未覆盖磁盘内容。请重新打开项目后再编辑。"
          : "创作画布保存失败，已暂停后续写入以保护已有内容。请检查连接并重新打开项目。";
        throw new Error(blocked);
      }
    });
    queue = writing.catch(() => {});
    return writing;
  }
  return { graph, save };
}
