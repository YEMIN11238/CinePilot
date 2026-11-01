<template>
  <div class="studioCanvas" aria-label="可拖拽分镜画布">
    <vue-flow :id="flowId" v-model:nodes="nodes" :edges="edges" :minZoom="0.3" :maxZoom="1.6" :nodesDraggable="layoutReady" :nodesConnectable="false" :deleteKeyCode="null" :selectionKeyCode="null" :multiSelectionKeyCode="null" :zoomOnDoubleClick="false" :panOnDrag="true" :selectNodesOnDrag="false" :fitViewOnInit="false" @nodesInitialized="initializeView" @nodeClick="event => $emit('select', event.node.id)" @nodeDragStop="savePositions">
      <background :gap="20" :size="1.25" patternColor="#ffffff55" />
      <template #node-shot="{ data }">
        <handle type="target" :position="Position.Left" />
        <shotCard :directory="directory" :shot="data.shot" :task="latestTask(data.shot.id)" :busy="busy" :selected="selectedId === data.shot.id" :affected="affectedIds.includes(data.shot.id)" :imageReady="imageReady" :videoReady="videoReady" @select="$emit('select', $event)" @lock="$emit('lock', $event)" @edit="$emit('edit', $event)" @versions="$emit('versions', $event)" @preview="$emit('preview', $event)" @generate="(shot, stage) => $emit('generate', shot, stage)" @attach="(shot, kind, file) => $emit('attach', shot, kind, file)" />
        <handle type="source" :position="Position.Right" />
      </template>
    </vue-flow>
    <div class="canvasLegend"><span class="legendDot" />创作画布<span>拖动标题移动镜头 · 拖动空白平移 · 滚轮缩放</span></div>
    <div class="canvasControls" aria-label="画布视图控制"><button type="button" title="缩小" aria-label="缩小画布" @click="flow.zoomOut()"><icon-minus :size="15" /></button><span>{{ Math.round(flow.viewport.value.zoom * 100) }}%</span><button type="button" title="放大" aria-label="放大画布" @click="flow.zoomIn()"><icon-plus :size="15" /></button><i /><button type="button" title="查看全部镜头" aria-label="查看全部镜头" @click="fit"><icon-maximize :size="15" /></button><button type="button" title="重新排列镜头位置" aria-label="重新排列镜头位置" :disabled="!layoutReady" @click="resetPositions"><icon-layout-grid :size="15" /></button></div>
    <p v-if="positionError || layoutLoading" class="positionError" role="status">{{ positionError || '正在读取画布布局…' }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { isAxiosError } from "axios";
import { VueFlow, Handle, Position, useVueFlow, type Node } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { IconLayoutGrid, IconMaximize, IconMinus, IconPlus } from "@tabler/icons-vue";
import type { DirectorProject, DirectorShot } from "@toonflow/server/directorTypes";
import useWorkspaceFiles, { type TextSnapshot } from "@/lib/workspaceFiles";
import shotCard from "./shotCard.vue";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
const props = defineProps<{ directory: string; project: DirectorProject; selectedId: string; affectedIds: string[]; busy: boolean; imageReady: boolean; videoReady: boolean }>();
defineEmits<{ select: [id: string]; lock: [shot: DirectorShot]; edit: [shot: DirectorShot]; versions: [shot: DirectorShot]; preview: [id: string]; generate: [shot: DirectorShot, stage: "image" | "video"]; attach: [shot: DirectorShot, kind: "image" | "video", file: File] }>();
const flowId = `directorCanvas${crypto.randomUUID()}`;
const flow = useVueFlow(flowId);
const nodes = ref<Node<{ shot: DirectorShot }>[]>([]);
const positionError = ref("");
const layoutReady = ref(false);
const layoutLoading = ref(false);
const layoutPath = "directorCanvasLayout.json";
type CanvasPositions = Record<string, { x: number; y: number }>;
type LayoutContext = { directory: string; files: ReturnType<typeof useWorkspaceFiles>; snapshot?: TextSnapshot; blocked: boolean; queue: Promise<void> };
let layoutContext: LayoutContext | undefined;
let layoutGeneration = 0;
let viewInitialized = false;
let viewInitializing = false;
const edges = computed(() => props.project.shots.slice(1).map((shot, index) => ({ id: `sequence${shot.id}`, source: props.project.shots[index]!.id, target: shot.id, type: "smoothstep", animated: false, selectable: false, style: { stroke: "#acc5b3", strokeWidth: 1.5 }, label: "", deletable: false })));
function validatePositions(value: unknown): CanvasPositions {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 2000) throw new Error("画布布局格式无效，文件未被覆盖。请恢复有效布局文件后重新打开项目。");
  const ids = new Set(props.project.shots.map(shot => shot.id));
  const positions: CanvasPositions = Object.create(null);
  for (const [id, point] of Object.entries(value)) {
    if (!ids.has(id)) continue;
    if (!point || typeof point !== "object" || typeof point.x !== "number" || !Number.isFinite(point.x) || Math.abs(point.x) > 1_000_000 || typeof point.y !== "number" || !Number.isFinite(point.y) || Math.abs(point.y) > 1_000_000) throw new Error("画布位置数据无效，文件未被覆盖。请恢复有效布局文件后重新打开项目。");
    positions[id] = { x: point.x, y: point.y };
  }
  return positions;
}
function storedPositions(directory: string): CanvasPositions {
  try {
    return validatePositions(JSON.parse(localStorage.getItem(`frameflowCanvas:${directory}`) || "{}"));
  } catch { return {}; }
}
function savePositions() {
  const context = layoutContext;
  if (!layoutReady.value || !context || context.directory !== props.directory || context.blocked) return;
  const positions = Object.fromEntries(nodes.value.map(node => [node.id, { x: node.position.x, y: node.position.y }]));
  const text = `${JSON.stringify({ frameflowDirectorCanvas: 1, positions }, null, 2)}\n`;
  context.queue = context.queue.then(async () => {
    if (context.blocked || !context.snapshot) return;
    try {
      const revision = await context.files.writeTextSnapshot(layoutPath, text, context.snapshot);
      context.snapshot = { ...context.snapshot, text, revision };
      if (layoutContext === context) positionError.value = "";
    } catch (cause) {
      const conflict = isAxiosError(cause) && cause.response?.status === 409;
      if (conflict) context.blocked = true;
      if (layoutContext === context) positionError.value = conflict ? "其他窗口已修改画布布局，本次移动未保存。请重新打开项目后再调整，镜头内容不受影响。" : "画布位置未能保存，请检查连接后再次拖动。镜头内容不受影响。";
    }
  });
}
function latestTask(id: string) { const shot = props.project.shots.find(item => item.id === id); return props.project.tasks.findLast(task => task.shotId === id && task.versionId === shot?.currentVersionId); }
function fit() { void flow.fitView({ padding: 0.14, maxZoom: 1, duration: 220 }); }
function initializeView() {
  if (!layoutReady.value || viewInitialized || !nodes.value.length || flow.getNodes.value.some(node => !node.dimensions.width)) return;
  viewInitialized = true;
  viewInitializing = true;
  const generation = layoutGeneration;
  // 初始只展示前两个镜头，保持正文可读；查看全部仍允许缩小到完整画布。
  void flow.fitView({ nodes: nodes.value.slice(0, 2).map(node => node.id), padding: 0.18, minZoom: 0.95, maxZoom: 1, duration: 0 }).then(() => {
    if (generation !== layoutGeneration) return;
    viewInitializing = false;
    revealSelectedShot();
  });
}
function revealSelectedShot() {
  if (!layoutReady.value || !viewInitialized || viewInitializing || !props.selectedId) return;
  const node = flow.findNode(props.selectedId);
  const { width, height } = flow.dimensions.value;
  if (!node?.dimensions.width || !width || !height) return;
  const { x, y, zoom } = flow.viewport.value;
  const left = node.computedPosition.x * zoom + x;
  const top = node.computedPosition.y * zoom + y;
  const right = left + node.dimensions.width * zoom;
  const bottom = top + node.dimensions.height * zoom;
  if (left >= 16 && right <= width - 16 && top >= 16 && bottom <= height - 16) return;
  void flow.setCenter(node.computedPosition.x + node.dimensions.width / 2, node.computedPosition.y + node.dimensions.height / 2, { zoom, duration: 180 });
}
async function resetPositions() { if (!layoutReady.value) return; nodes.value = nodes.value.map((node, index) => ({ ...node, position: { x: index * 314, y: 65 } })); savePositions(); await nextTick(); viewInitialized = false; initializeView(); }
function refreshNodes(saved?: CanvasPositions) {
  nodes.value = props.project.shots.map((shot, index) => {
    const existing = nodes.value.find(node => node.id === shot.id);
    return { ...existing, id: shot.id, type: "shot", position: saved?.[shot.id] || existing?.position || { x: index * 314, y: 65 }, data: { shot }, dragHandle: ".shotHeader", selectable: false, deletable: false };
  });
}
watch(() => props.directory, async (directory, _previous, onCleanup) => {
  const generation = ++layoutGeneration;
  const aborter = new AbortController();
  onCleanup(() => aborter.abort());
  const context: LayoutContext = { directory, files: useWorkspaceFiles(directory), blocked: false, queue: Promise.resolve() };
  layoutContext = context;
  layoutReady.value = false;
  layoutLoading.value = true;
  positionError.value = "";
  viewInitialized = false;
  viewInitializing = false;
  nodes.value = [];
  refreshNodes();
  try {
    let snapshot: TextSnapshot;
    try { snapshot = await context.files.readTextSnapshot(layoutPath, { maxBytes: 256 * 1024, signal: aborter.signal }); }
    catch (cause) {
      if (!isAxiosError(cause) || cause.response?.status !== 404 || aborter.signal.aborted) throw cause;
      const positions = storedPositions(directory);
      // 只允许首次创建，另一个窗口先创建时重新读取，绝不以旧浏览器缓存覆盖项目文件。
      try { await context.files.writeJson(layoutPath, { frameflowDirectorCanvas: 1, positions }, true); }
      catch (createCause) { if (!isAxiosError(createCause) || createCause.response?.status !== 409) throw createCause; }
      snapshot = await context.files.readTextSnapshot(layoutPath, { maxBytes: 256 * 1024, signal: aborter.signal });
    }
    if (generation !== layoutGeneration || aborter.signal.aborted) return;
    let document;
    try { document = JSON.parse(snapshot.text); }
    catch { throw new Error("画布布局文件无法解析，文件未被覆盖。请恢复有效布局文件后重新打开项目。"); }
    if (!document || typeof document !== "object" || Array.isArray(document) || document.frameflowDirectorCanvas !== 1) throw new Error("画布布局格式无效，文件未被覆盖。请恢复有效布局文件后重新打开项目。");
    const positions = validatePositions(document.positions);
    context.snapshot = snapshot;
    refreshNodes(positions);
    layoutReady.value = true;
    await nextTick();
    if (generation === layoutGeneration) initializeView();
  } catch (cause) {
    if (generation === layoutGeneration && !aborter.signal.aborted) positionError.value = cause instanceof Error && !isAxiosError(cause) ? cause.message : "无法读取画布布局，暂时不能移动镜头。请检查连接后重新打开项目。";
  } finally { if (generation === layoutGeneration) layoutLoading.value = false; }
}, { immediate: true });
watch(() => props.project.shots, () => {
  refreshNodes();
}, { immediate: true });
watch(() => props.selectedId, revealSelectedShot, { flush: "post" });
onBeforeUnmount(() => { layoutGeneration++; layoutContext = undefined; });
defineExpose({ fit });
</script>

<style scoped lang="scss">
.studioCanvas {
  position: relative; width: 100%; height: 100%; min-height: 240px; background: #242529;
  :deep(.vue-flow__node) { border-radius: 14px; }
  :deep(.vue-flow__handle) { width: 5px; height: 5px; border: 1.5px solid #b3ccba; background: #f5f9f4; pointer-events: none; }
  :deep(.vue-flow__edge-path) { stroke-dasharray: 4 5; }
  .canvasLegend { display: flex; align-items: center; gap: 7px; position: absolute; left: 20px; top: 17px; color: #d1d7d3; font-size: 11px; pointer-events: none; .legendDot { width: 5px; height: 5px; border-radius: 50%; background: #99b7a2; } > span:last-child { margin-left: 7px; color: #aab3ad; font-size: 10px; } }
  .canvasControls { display: flex; align-items: center; gap: 4px; position: absolute; left: 50%; bottom: 15px; transform: translateX(-50%); background: #fffffff2; border: 1px solid #dce7de; border-radius: 20px; padding: 5px 8px; box-shadow: 0 3px 12px #25452d08; button { display: flex; align-items: center; justify-content: center; width: 27px; height: 26px; border: 0; background: none; border-radius: 50%; color: #8ba994; cursor: pointer; &:hover { background: #eef5ee; } &:focus-visible { outline: 2px solid #8bb99a; outline-offset: 2px; } } > span { min-width: 33px; text-align: center; font: 10px ui-monospace, monospace; color: #8fae99; } i { width: 1px; height: 14px; background: #e0e9e2; margin: 0 3px; } }
  .positionError { position: absolute; bottom: 57px; left: 20px; right: 20px; color: #d2b995; font-size: 11px; }
}
</style>
