<template>
  <div class="mediaPreview" :class="{ compact }">
    <video v-if="url && mimeType.startsWith('video/')" :src="url" controls playsinline preload="metadata" :aria-label="label" />
    <img v-else-if="url" :src="url" :alt="label" />
    <div v-else class="mediaPlaceholder" role="status">
      <icon-photo v-if="!mimeType.startsWith('video/')" :size="22" aria-hidden="true" />
      <icon-movie v-else :size="22" aria-hidden="true" />
      <span>{{ error || (path ? '正在读取素材…' : label) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { IconMovie, IconPhoto } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";

const props = withDefaults(defineProps<{ directory: string; path?: string; mimeType?: string; label: string; compact?: boolean }>(), { mimeType: "image/png", compact: false });
const url = ref("");
const error = ref("");
watch(() => [props.directory, props.path, props.mimeType] as const, async ([directory, path, mimeType], _old, onCleanup) => {
  url.value = "";
  error.value = "";
  if (!directory || !path) return;
  let cancelled = false;
  const media = useWorkspaceFiles(directory).acquireUrl(path, mimeType);
  onCleanup(() => { cancelled = true; media.release(); });
  try {
    const source = await media.url;
    if (!cancelled) url.value = source;
  } catch (cause) {
    if (!cancelled) error.value = cause instanceof Error ? cause.message : "素材读取失败";
  }
}, { immediate: true });
</script>

<style scoped lang="scss">
.mediaPreview {
  display: flex;
  width: 100%;
  aspect-ratio: 16 / 10;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 10px;
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-secondary);
  &.compact { aspect-ratio: 1; }
  video, img { width: 100%; height: 100%; object-fit: contain; }
  .mediaPlaceholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    font-size: 12px;
    text-align: center;
  }
}
</style>
