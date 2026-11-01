<template>
  <component v-if="renderer" :is="renderer" :tool="tool" :directory="directory" :toolSessionId="toolSessionId" @copy="emit('copy', $event)" />
  <el-text v-if="rendererError" type="danger">工具界面加载失败，请停止后重试：{{ rendererError }}</el-text>
  <chat-reasoning v-model:collapsed="collapsed" class="messageReasoning toolCall" expandIconPlacement="left">
    <template #expandIcon><component :is="collapsed ? IconChevronRight : IconChevronDown" :size="14" aria-hidden="true" /></template>
    <template #header>
      <span class="toolHeader" :data-status="tool.status">
        <icon-tool :size="14" />
        <span class="toolName">{{ toolLabel }}</span>
        <span class="toolState">{{ tool.name === 'subAgent' && tool.status === 'success' ? '调用已返回' : toolStatusLabels[tool.status] }}</span>
      </span>
    </template>
    <div v-if="!collapsed" class="toolDetails">
      <template v-for="(data, index) in [args, result]" :key="index">
        <template v-if="data">
          <span class="toolLabel">
            {{ index === 0 ? "参数" : "结果" }}
            <el-button v-if="!data.markdown" text size="small" :icon="IconCopy" :aria-label="index === 0 ? '复制工具参数' : '复制工具结果'" @click="emit('copy', data.content)" />
          </span>
          <messageMarkdown v-if="data.markdown" class="toolData" :class="{ toolError: index === 1 && tool.status === 'error' }" :content="data.markdown" :directory="directory" :codeOptions="toolCodeOptions" />
          <pre v-else class="toolData toolPlain" :class="{ toolError: index === 1 && tool.status === 'error' }" tabindex="0" :aria-label="index === 0 ? '工具参数' : '工具结果'">{{ data.content }}</pre>
        </template>
      </template>
    </div>
  </chat-reasoning>
  <p v-if="directorSummary" class="directorSummary" role="status">{{ directorSummary }}</p>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, ref, shallowRef, watch, type Component } from "vue";
import { loadToolComponent } from "@toonflow/tools-scaffold/client";
import { IconChevronDown, IconChevronRight, IconCopy, IconTool } from "@tabler/icons-vue";
import chatReasoning from "@tdesign-vue-next/chat/es/chat-reasoning";
import type { AgentToolCall } from "@toonflow/server/agent/types";
import messageMarkdown from "@/components/messageMarkdown.vue";
import { canvasOperations } from "@toonflow/tool-canvas/runtime";

const { tool, directory, toolSessionId } = defineProps<{ tool: AgentToolCall; directory?: string; toolSessionId?: string }>();
const emit = defineEmits<{ copy: [content: string] }>();
const renderer = shallowRef<Component>();
const rendererError = ref("");
watch(() => [tool.name, tool.question?.callId] as const, async ([name], _previous, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  renderer.value = undefined;
  rendererError.value = "";
  if (name === "subAgent" || name === "director") return;
  try {
    const component = await loadToolComponent(name);
    if (active) {
      renderer.value = component;
      if (!component && tool.status === "running" && tool.question?.callId) rendererError.value = "该工具未提供可用的交互组件";
    }
  } catch (error) {
    if (active) rendererError.value = error instanceof Error ? error.message : String(error);
  }
}, { immediate: true });
onErrorCaptured(error => {
  if (!renderer.value) return;
  renderer.value = undefined;
  rendererError.value = error.message;
  return false;
});
const collapsed = defineModel<boolean>("collapsed", { default: true });
const toolStatusLabels = { running: "调用中…", success: "已完成", error: "调用失败", interrupted: "已中断" };
const toolCodeOptions = { maxHeight: 240, lineNumbers: false };
const args = computed(() => formatToolData(tool.args));
const result = computed(() => formatToolData(tool.result));
const directorActionLabels: Record<string, string> = { read: "读取项目与镜头", plan: "准备镜头修改", apply: "应用镜头修改", selectVersion: "切换镜头版本", reorder: "调整镜头顺序", split: "拆分镜头", delete: "移出成片", undo: "撤销编辑", redo: "重做编辑", music: "调整背景音乐", addMediaShot: "放置镜头素材", refreshTask: "查询原生成任务", updateAudioTrack: "调整对白与音效", removeAudioTrack: "移除声音", generate: "提交镜头生成", export: "合成短片", create: "创建项目" };
const toolLabel = computed(() => tool.name === "director" ? directorActionLabels[String(tool.args?.action)] || "镜头与剪辑" : canvasOperations.find(operation => operation.name === tool.name)?.label || (renderer.value ? "操作工具" : tool.name || "工具调用"));
const directorSummary = computed(() => {
  if (tool.name !== "director" || tool.status !== "success") return "";
  try {
    const project = JSON.parse(tool.result || "null");
    if (!project) return "当前工作区尚未创建镜头项目。";
    if (!Array.isArray(project.shots)) return "";
    const action = String(tool.args?.action);
    if (action === "read") return `已读取 ${project.shots.length} 个镜头。`;
    if (action === "plan") return "修改计划已准备；尚未应用或提交媒体生成。";
    if (action === "delete") return "镜头已移出成片，素材和历史保留，可撤销。";
    if (action === "apply") return "镜头新版本已保存；未额外提交图片或视频生成。";
    if (action === "refreshTask") return "已查询原任务；结果以任务面板状态为准。";
    if (["generate", "export"].includes(action)) return "任务已提交，完成状态请查看任务面板。";
    return `${directorActionLabels[action] || "项目修改"}已保存。`;
  } catch { return ""; }
});

function formatToolData(value: unknown) {
  if (value === undefined) return;
  try {
    const content = JSON.stringify(typeof value === "string" ? JSON.parse(value) : value, null, 2) ?? "";
    // ACT: 超过 16K 字符只渲染完整文本，限制高亮与 token DOM 开销；更大数据量可改为虚拟行。
    return { content, markdown: content.length <= 16_384 ? `~~~json\n${content}\n~~~` : undefined };
  } catch {
    return { content: String(value), markdown: undefined };
  }
}
</script>

<style scoped lang="scss">
.directorSummary { margin: 3px 0 10px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
.toolCall {
  min-width: 0;
  :deep(.t-collapse-panel__icon) { color: var(--el-text-color-secondary); }

  .toolHeader {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--el-text-color-secondary);

    .toolName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolState {
      flex-shrink: 0;
      font-size: 12px;
    }

    &[data-status="error"] .toolState { color: var(--el-color-danger); }
  }

  .toolDetails {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 12px;

    .toolLabel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--el-text-color-secondary);
    }

    .toolData {
      margin: 0 0 6px;
      font-size: 12px;
      line-height: 1.5;

      :deep([data-stream-markdown="code-block"]) {
        margin: 0;
        border-radius: var(--ui-radius);
      }

      :deep([data-stream-markdown="code-block-content"]) {
        overscroll-behavior: contain;
        pre {
          white-space: pre;
          overflow-wrap: normal;
        }
      }

      &.toolError :deep([data-stream-markdown="code-block"]) { border-color: var(--el-color-danger-light-5); }

      &.toolPlain {
        min-width: 0;
        max-width: 100%;
        max-height: 240px;
        padding: 12px;
        overflow: auto;
        overscroll-behavior: contain;
        white-space: pre;
        overflow-wrap: normal;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        color: var(--el-text-color-primary);
        background: var(--el-fill-color-light);
        border: 1px solid var(--el-border-color-lighter);
        border-radius: var(--ui-radius);

        &.toolError { border-color: var(--el-color-danger-light-5); }
      }
    }
  }
}
</style>
