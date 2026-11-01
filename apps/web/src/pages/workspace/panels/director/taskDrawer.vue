<template>
  <el-drawer v-model="visible" title="创作任务" size="420px" appendToBody class="studioTaskDrawer">
    <div class="taskSummary"><span>{{ tasks.filter(task => task.status === 'succeeded').length }} 项完成</span><span>{{ tasks.filter(task => ['queued', 'running'].includes(task.status)).length }} 项进行中</span></div>
    <p v-if="!tasks.length" class="emptyTasks">生成和导出后，可以在这里查看进度与结果。</p>
    <article v-for="task in tasks" :key="task.id" class="taskItem">
      <header><span class="statusDot" :class="task.status" /><strong>{{ taskTitle(task) }}</strong><small>{{ taskLabels[task.status] }}</small></header>
      <p v-if="task.generation?.prompt" class="taskPrompt">{{ task.generation.prompt }}</p>
      <p v-if="task.error" class="taskError">{{ task.error }}</p>
      <p v-if="task.status === 'verificationRequired'" class="taskHint">先查询原任务，核实结果后再决定下一步。查询不会重新提交生成。</p>
      <div class="taskActions">
        <el-button v-if="task.status === 'verificationRequired' && task.providerTaskId" size="small" :disabled="busy" @click="emit('refresh', task)">查询原任务</el-button>
        <el-button v-if="['queued', 'running'].includes(task.status)" text size="small" :disabled="busy" @click="emit('cancel', task)">{{ task.status === 'queued' ? '取消排队' : '停止本地等待' }}</el-button>
        <el-button v-if="task.status === 'verificationRequired'" text size="small" :disabled="busy" @click="resolveId = resolveId === task.id ? '' : task.id; resolveNote = ''">人工核对</el-button>
        <el-button v-if="task.nodeId || task.shotId" text size="small" @click="emit('locate', task)">定位{{ task.nodeId ? '节点' : '镜头' }}</el-button>
        <el-button v-if="canRetry(task) && ['failed', 'interrupted'].includes(task.status)" text size="small" :disabled="busy" @click="emit('retry', task)">重试</el-button>
        <el-button v-if="task.output && ['succeeded', 'cancelled'].includes(task.status)" text size="small" @click="selectedId = selectedId === task.id ? '' : task.id">{{ selectedId === task.id ? '收起预览' : '预览结果' }}</el-button>
        <el-button v-if="task.output && ['succeeded', 'cancelled'].includes(task.status)" text size="small" @click="emit('download', task)">下载</el-button>
      </div>
      <form v-if="resolveId === task.id && task.status === 'verificationRequired'" class="resolveForm" @submit.prevent="resolveTask(task)"><p>先在供应商控制台核对。此操作不取消远端任务；已生成素材与任务记录会保留。</p><label>核对结果<select v-model="resolveResult" aria-label="上游任务核对结果"><option value="notSubmitted">确认未提交，可重新生成</option><option value="failed">确认远端失败，可重新生成</option><option value="abandoned">停止本地跟踪，不再重试</option></select></label><textarea v-model="resolveNote" rows="2" maxlength="1000" placeholder="填写控制台核对结果或失败原因" aria-label="人工核对说明" /><button type="submit" :disabled="busy || !resolveNote.trim()">保存核对结果</button></form>
      <mediaPreview v-if="selectedId === task.id && task.output" :directory="directory" :path="task.output.path" :mimeType="task.output.mimeType" label="任务结果" />
      <details v-if="task.providerTaskId"><summary>任务详情</summary><code>{{ task.providerTaskId }}</code><small>{{ task.createdAt }}</small></details>
    </article>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { DirectorProject, DirectorTask } from "@toonflow/server/directorTypes";
import mediaPreview from "./mediaPreview.vue";

const props = defineProps<{ project: DirectorProject; directory: string; busy: boolean; nodeLabels?: Record<string, string>; canRetry(task: DirectorTask): boolean }>();
const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ refresh: [task: DirectorTask]; retry: [task: DirectorTask]; locate: [task: DirectorTask]; download: [task: DirectorTask]; cancel: [task: DirectorTask]; resolve: [input: { taskId: string; resolution: "notSubmitted" | "failed" | "abandoned"; note: string }] }>();
const selectedId = ref("");
const resolveId = ref("");
const resolveNote = ref("");
const resolveResult = ref<"notSubmitted" | "failed" | "abandoned">("notSubmitted");
function resolveTask(task: DirectorTask) { if (!resolveNote.value.trim()) return; emit("resolve", { taskId: task.id, resolution: resolveResult.value, note: resolveNote.value.trim() }); }
const tasks = computed(() => [...props.project.tasks].reverse());
const taskLabels = { queued: "排队中", running: "生成中", succeeded: "已完成", failed: "失败", interrupted: "已中断", verificationRequired: "待核对", cancelled: "已停止本地任务" };
function taskTitle(task: DirectorTask) {
  if (task.stage === "export") return task.exportMode === "storyboard" ? "分镜预览导出" : "视频合成导出";
  if (task.nodeId) return `画布${task.stage === "image" ? "图片" : "视频"} · ${props.nodeLabels?.[task.nodeId] || "生成素材"}`;
  return `镜头 ${props.project.shots.find(shot => shot.id === task.shotId)?.order ?? ""} · ${task.stage === "image" ? "关键帧" : "视频"}`;
}
</script>

<style scoped lang="scss">
.taskSummary { display: flex; justify-content: space-between; padding-bottom: 18px; color: #979ba3; font-size: 12px; }
.emptyTasks { padding-top: 45px; text-align: center; color: #989da5; font-size: 13px; }
.taskItem { padding: 18px 0; border-top: 1px solid #303237;
  header { display: flex; align-items: center; gap: 8px; strong { flex: 1; color: #eceef2; font-size: 13px; font-weight: 500; } small { color: #a4a9b0; font-size: 11px; } }
  .statusDot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: #81858f; &.succeeded { background: #27dc86; } &.running, &.queued { background: #62b8ff; } &.failed, &.interrupted, &.verificationRequired { background: #e6ad6c; } }
  p { margin: 10px 0; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
  .taskPrompt { color: #9da3ad; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .taskError { color: #e1ad8d; }
  .taskHint { color: #b9a789; }
  .taskActions { display: flex; flex-wrap: wrap; gap: 4px; .el-button { margin: 0; } }
  .resolveForm { display: grid; gap: 8px; padding: 10px; border: 1px solid #4a4234; border-radius: 8px; p { margin: 0; color: #b9a789; } label { display: grid; gap: 6px; } select, textarea { width: 100%; padding: 7px; border: 1px solid #454952; border-radius: 5px; background: #22242a; color: #dddfe5; font: inherit; } button { justify-self: end; border: 0; padding: 6px 10px; border-radius: 5px; background: #62d68f; color: #14251b; cursor: pointer; &:disabled { opacity: .4; } } }
  details { margin-top: 10px; color: #808792; font-size: 11px; summary { cursor: pointer; } code, small { display: block; margin-top: 7px; overflow-wrap: anywhere; } }
}
</style>
