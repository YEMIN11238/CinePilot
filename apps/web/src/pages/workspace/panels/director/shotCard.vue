<template>
  <article class="shotCard" :class="{ locked: shot.locked, selected, affected }" :aria-label="`镜头 ${shot.order}：${version.title}`" @click="$emit('select', shot.id)">
    <header class="shotHeader">
      <span class="shotNumber">{{ String(shot.order).padStart(2, '0') }}</span><strong>{{ version.title }}</strong>
      <button class="lockButton nodrag" type="button" :disabled="busy" :title="busy ? '正在处理，请稍候' : shot.locked ? '解锁后可编辑或更换素材' : '锁定镜头，防止被修改'" :aria-label="`${shot.locked ? '解锁' : '锁定'}镜头${shot.order}`" :aria-pressed="shot.locked" @click.stop="$emit('lock', shot)"><icon-lock v-if="shot.locked" :size="16" /><icon-lock-open v-else :size="16" /></button>
    </header>
    <div class="previewArea nodrag">
      <studioThumbnail :directory="directory" :path="previewKind === 'video' ? version.clip?.path : version.keyframe?.path" :mimeType="previewKind === 'video' ? version.clip?.mimeType || 'video/mp4' : version.keyframe?.mimeType || 'image/png'" :label="previewKind === 'video' ? '视频待生成 / 可导入' : '关键帧待生成 / 可导入'" />
      <div class="previewTabs" role="group" aria-label="预览素材类型"><button type="button" :aria-pressed="previewKind === 'image'" @click.stop="previewKind = 'image'">关键帧</button><button type="button" :aria-pressed="previewKind === 'video'" @click.stop="previewKind = 'video'">视频</button></div>
      <span class="durationBadge">{{ version.duration }}s</span><span class="assetOrigin" v-if="displayAsset">{{ displayAsset.providerId ? 'AI 生成素材' : '已导入素材' }}</span>
      <button v-if="displayAsset" class="openPreview" type="button" aria-label="预览此镜头" @click.stop="$emit('preview', shot.id)"><icon-player-play-filled :size="17" /></button>
    </div>
    <div class="shotBody"><p class="description">{{ version.description }}</p><div class="shotMeta"><span><icon-video :size="12" />{{ version.camera || '固定机位' }}</span><button class="versionButton nodrag" type="button" @click.stop="$emit('versions', shot)">V{{ version.number }} <icon-chevron-down :size="11" /></button></div></div>
    <footer class="shotFooter nodrag">
      <span v-if="task && ['queued', 'running'].includes(task.status)" class="statusText running"><icon-loader-2 :size="12" class="spinner" />{{ task.stage === 'image' ? '关键帧' : '视频' }}{{ task.status === 'queued' ? '排队' : '生成中' }}</span>
      <span v-else-if="task && ['failed', 'interrupted'].includes(task.status)" class="statusText failed">{{ task.status === 'interrupted' ? '任务中断' : '生成失败' }}</span>
      <span v-else class="statusText" :class="{ ready: version.clip }"><span class="statusDot" />{{ version.clip ? '可用于成片' : version.keyframe ? '关键帧已就绪' : '等待素材' }}</span>
      <div class="cardActions"><span :title="actionDisabledReason || '编辑镜头'"><button type="button" :disabled="busy || shot.locked" aria-label="编辑镜头" @click.stop="$emit('edit', shot)"><icon-pencil :size="16" /></button></span><span :title="actionDisabledReason || '导入或生成镜头素材'"><el-dropdown trigger="click" :disabled="busy || shot.locked" @command="chooseAction"><button type="button" :disabled="busy || shot.locked" aria-label="镜头素材操作" @click.stop><icon-dots :size="18" /></button><template #dropdown><el-dropdown-menu><el-dropdown-item command="image">导入关键帧</el-dropdown-item><el-dropdown-item command="video">导入视频</el-dropdown-item><el-dropdown-item command="generateImage" :disabled="!!imageDisabledReason" divided><span class="generationOption">生成关键帧<small v-if="imageDisabledReason">{{ imageDisabledReason }}</small></span></el-dropdown-item><el-dropdown-item command="generateVideo" :disabled="!!videoDisabledReason"><span class="generationOption">生成视频<small v-if="videoDisabledReason">{{ videoDisabledReason }}</small></span></el-dropdown-item></el-dropdown-menu></template></el-dropdown></span></div>
      <input ref="fileInput" type="file" class="fileInput" :accept="importKind === 'image' ? 'image/*' : 'video/*'" @change="importFile" />
    </footer>
    <p v-if="shot.locked" class="lockedHint"><icon-lock :size="12" />已锁定 · 解锁后可编辑或更换素材</p>
    <div v-if="affected" class="affectedLabel"><icon-sparkles :size="11" />计划将修改此镜头</div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconChevronDown, IconDots, IconLoader2, IconLock, IconLockOpen, IconPencil, IconPlayerPlayFilled, IconSparkles, IconVideo } from "@tabler/icons-vue";
import type { DirectorShot, DirectorTask } from "@toonflow/server/directorTypes";
import studioThumbnail from "./studioThumbnail.vue";
const props = defineProps<{ directory: string; shot: DirectorShot; task?: DirectorTask; busy: boolean; selected: boolean; affected?: boolean; imageReady: boolean; videoReady: boolean }>();
const emit = defineEmits<{ select: [id: string]; lock: [shot: DirectorShot]; edit: [shot: DirectorShot]; versions: [shot: DirectorShot]; preview: [id: string]; generate: [shot: DirectorShot, stage: "image" | "video"]; attach: [shot: DirectorShot, kind: "image" | "video", file: File] }>();
const version = computed(() => props.shot.versions.find(item => item.id === props.shot.currentVersionId) ?? props.shot.versions[0]!);
const previewKind = ref<"image" | "video">("image");
const displayAsset = computed(() => previewKind.value === "video" ? version.value.clip : version.value.keyframe);
const fileInput = ref<HTMLInputElement>();
const importKind = ref<"image" | "video">("image");
const actionDisabledReason = computed(() => props.shot.locked ? "此镜头已锁定，请先点击右上角解锁" : props.busy ? "正在处理，请稍候" : "");
const imageDisabledReason = computed(() => version.value.keyframe ? "已有关键帧" : !props.imageReady ? "请先配置图片模型" : "");
const videoDisabledReason = computed(() => version.value.clip ? "已有视频" : !version.value.keyframe ? "请先导入或生成关键帧" : !props.videoReady ? "请先配置视频模型" : "");
watch([() => version.value.clip?.path, () => version.value.keyframe?.path], ([clip, keyframe]) => { previewKind.value = keyframe ? "image" : clip ? "video" : "image"; }, { immediate: true });
function chooseAction(action: string) {
  if (props.busy || props.shot.locked || (action === "generateImage" && imageDisabledReason.value) || (action === "generateVideo" && videoDisabledReason.value)) return;
  if (action === "generateImage" || action === "generateVideo") { emit("generate", props.shot, action === "generateImage" ? "image" : "video"); return; }
  if (action !== "image" && action !== "video") return;
  importKind.value = action;
  if (fileInput.value) { fileInput.value.accept = `${action}/*`; fileInput.value.click(); }
}
function importFile(event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ""; if (file && !props.busy && !props.shot.locked) emit("attach", props.shot, importKind.value, file); }
</script>

<style scoped lang="scss">
.shotCard {
  position: relative; width: 268px; color: #34543e; background: #fff; border: 1px solid #d7e2da; border-radius: 14px; box-shadow: 0 5px 18px #253d2d08; box-sizing: border-box;
  &.selected { border-color: #4e956b; box-shadow: 0 0 0 2px #4e956b16, 0 7px 22px #253d2d0a; }
  &.affected { border-color: #79a87c; }
  button:focus-visible { outline: 2px solid #72b38d; outline-offset: 3px; }
  .shotHeader { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 12px; cursor: grab; .shotNumber { font: 11px ui-monospace, monospace; color: #91ac9a; } strong { flex: 1; min-width: 0; font-size: 13px; font-weight: 550; color: #4d6e57; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .lockButton { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; padding: 0; border: 0; border-radius: 8px; color: #a4b8ab; background: transparent; cursor: pointer; &[aria-pressed="true"] { color: #578b67; background: #edf4ee; } &:disabled { opacity: .45; cursor: default; } } }
  .previewArea { position: relative; height: 176px; margin: 0 8px; overflow: hidden; border-radius: 9px; .previewTabs { position: absolute; top: 8px; left: 8px; padding: 2px; display: flex; background: #1d3026b8; border: 1px solid #ffffff20; border-radius: 6px; button { min-height: 29px; border: 0; background: transparent; padding: 3px 8px; font-size: 11px; color: #ffffffb0; cursor: pointer; &[aria-pressed="true"] { background: #fffffff0; color: #4b6e57; border-radius: 4px; } } } .durationBadge { position: absolute; right: 8px; top: 9px; font: 10px ui-monospace, monospace; color: #fff; background: #1d3026b0; border-radius: 5px; padding: 4px 5px; } .assetOrigin { position: absolute; left: 8px; bottom: 8px; font-size: 10px; color: #fff; background: #1d3026b0; padding: 3px 5px; border-radius: 4px; } .openPreview { position: absolute; right: 8px; bottom: 8px; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; color: #3f7351; background: #ffffffed; border: 0; cursor: pointer; } }
  .shotBody { padding: 12px 13px 10px; .description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; height: 44px; margin: 0 0 10px; font-size: 12px; line-height: 22px; color: #829a8a; } .shotMeta { display: flex; gap: 6px; align-items: center; > span { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a1b4a7; font-size: 11px; svg { flex-shrink: 0; } } .versionButton { display: flex; align-items: center; gap: 3px; min-width: 42px; min-height: 28px; justify-content: center; color: #7fa28a; background: #eef5ef; border: 0; border-radius: 6px; font-size: 11px; padding: 3px 6px; cursor: pointer; } } }
  .shotFooter { display: flex; align-items: center; justify-content: space-between; height: 43px; padding: 0 10px; border-top: 1px solid #e8eee9; .statusText { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #a6b8ac; .statusDot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; } &.ready { color: #79a286; } &.running { color: #3c9860; } &.failed { color: #b48d64; } } .cardActions { display: flex; gap: 4px; > span { display: flex; } button { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: none; color: #8ca897; cursor: pointer; &:hover:not(:disabled) { background: #edf4ef; } &:disabled { opacity: .4; cursor: default; } } } .fileInput { display: none; } }
  .lockedHint { display: flex; align-items: center; justify-content: center; gap: 5px; margin: 0; padding: 7px 6px; border-top: 1px solid #e7eee9; color: #9cb4a5; font-size: 10px; }
  .affectedLabel { position: absolute; left: 0; top: -27px; display: flex; align-items: center; gap: 5px; background: #5c9269; color: #fff; padding: 4px 7px; border-radius: 5px; font-size: 10px; }
}
.generationOption { display: flex; flex-direction: column; gap: 2px; padding: 3px 0; small { font-size: 11px; } }
.spinner { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
