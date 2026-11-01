<template>
  <div class="studioThumbnail" :class="{ empty: !url }">
    <img v-if="url && !mimeType.startsWith('video/')" :src="url" :alt="label" draggable="false" />
    <video v-else-if="url" :src="url" muted playsinline preload="metadata" :aria-label="label" />
    <div v-else class="emptyMedia"><icon-photo :size="24" /><span>{{ error || label }}</span></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { IconPhoto } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
const props = withDefaults(defineProps<{ directory: string; path?: string; mimeType?: string; label: string }>(), { mimeType: "image/png" });
const url = ref("");
const error = ref("");
watch(() => [props.directory, props.path, props.mimeType] as const, async ([directory, path, mimeType], _previous, cleanup) => {
  url.value = "";
  error.value = "";
  if (!directory || !path) return;
  let active = true;
  const source = useWorkspaceFiles(directory).acquireUrl(path, mimeType);
  cleanup(() => { active = false; source.release(); });
  try { const value = await source.url; if (active) url.value = value; }
  catch { if (active) error.value = "素材暂时无法读取"; }
}, { immediate: true });
</script>

<style scoped lang="scss">
.studioThumbnail {
  width: 100%; height: 100%; overflow: hidden; background: #292927;
  img, video { width: 100%; height: 100%; object-fit: contain; display: block; }
  &.empty { background: #e9efeb; color: #708b79; }
  .emptyMedia { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 100%; padding: 14px; box-sizing: border-box; text-align: center; font-size: 11px; }
}
</style>
