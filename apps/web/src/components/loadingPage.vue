<template>
  <teleport to="body">
    <div v-if="visible" class="loadingPage" role="status" aria-live="polite" aria-label="正在加载工作区">
      <div class="loadingStatus"><span class="loadingIndicator" aria-hidden="true" /><span>正在加载工作区</span></div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { watch } from "vue";

const props = defineProps<{ active: boolean }>();
const visible = defineModel<boolean>("visible", { default: false });
const drawn = defineModel<boolean>("drawn", { default: false });
watch(() => props.active, active => {
  visible.value = active;
  // ACT: 兼容旧项目入口的加载就绪握手，不再等待 Logo 绘制或最小展示时长。
  drawn.value = active;
}, { immediate: true, flush: "sync" });
</script>

<style lang="scss" scoped>
.loadingPage {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: var(--el-bg-color);
  color: var(--el-text-color-secondary);

  .loadingStatus { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .loadingIndicator {
    width: 16px;
    height: 16px;
    border: 2px solid var(--el-border-color);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: loadingSpin 0.8s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .loadingIndicator { animation: none; }
  }
}

@keyframes loadingSpin { to { transform: rotate(360deg); } }
</style>
