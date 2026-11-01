<template>
  <section class="audioPanel" aria-label="对白与音效">
    <div class="audioHeading"><h3>对白与音效</h3><p>导入录音或已有配音，按镜头放置并与画面一起预览、导出。</p></div>
    <div class="audioImport">
      <label>声音类型<select v-model="importKind" :disabled="busy" aria-label="导入声音类型"><option value="dialogue">对白</option><option value="sfx">音效</option></select></label>
      <label>绑定镜头<select v-model="importShotId" :disabled="busy" aria-label="声音绑定镜头"><option value="">全片时间</option><option v-for="shot in orderedShots" :key="shot.id" :value="shot.id">{{ shot.order }} · {{ shotTitle(shot.id) }}</option></select></label>
      <label v-if="importKind === 'dialogue' && characters.length">说话角色<select v-model="importCharacterId" :disabled="busy" aria-label="声音说话角色"><option value="">未指定角色</option><option v-for="character in characters" :key="character.id" :value="character.id">{{ character.name }}</option></select></label>
      <button type="button" :disabled="busy || !project.shots.length" @click="fileInput?.click()"><icon-upload :size="15" /> 导入{{ importKind === 'dialogue' ? '对白' : '音效' }}</button>
      <small>{{ importShotId ? '从所选镜头开始放置，镜头排序后会跟随移动。' : '按全片绝对时间放置，不随镜头排序移动。' }}</small>
      <input ref="fileInput" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.aac,.m4a,.webm" class="audioFileInput" @change="importFile" />
    </div>
    <p v-if="!project.audioTracks?.length" class="audioEmpty">尚未添加对白或音效。背景音乐在配乐设置中管理。</p>
    <form v-for="track in project.audioTracks ?? []" :key="track.id" class="audioTrack" @submit.prevent="saveTrack(track.id)">
      <template v-if="drafts[track.id]">
        <header><span>{{ track.kind === 'dialogue' ? '对白' : '音效' }}</span><strong>{{ track.label }}</strong><button type="button" :disabled="busy" :aria-label="`${track.muted ? '取消静音' : '静音'}${track.label}`" @click="emit('update', track.id, { muted: !track.muted })"><icon-volume-off v-if="track.muted" :size="15" /><icon-volume v-else :size="15" /></button><button type="button" :disabled="busy" :aria-label="`移除声音${track.label}`" @click="emit('remove', track.id)"><icon-trash :size="15" /></button></header>
        <p class="audioBinding">{{ track.shotId ? `镜头 ${orderedShots.find(shot => shot.id === track.shotId)?.order ?? '已移除'}` : '全片时间' }}{{ track.characterId ? ` · ${characters.find(character => character.id === track.characterId)?.name ?? '角色已移除'}` : '' }}</p>
        <label>名称<input v-model="drafts[track.id]!.label" maxlength="120" :disabled="busy" :aria-label="`声音名称${track.label}`" /></label>
        <div class="audioGrid">
          <label>{{ track.shotId ? '镜头内起点' : '全片起点' }}（秒）<input v-model.number="drafts[track.id]!.start" type="number" min="0" step="any" required :disabled="busy" :aria-label="`声音起点${track.label}`" /></label>
          <label>素材入点（秒）<input v-model.number="drafts[track.id]!.trimStart" type="number" min="0" step="any" required :disabled="busy" :aria-label="`声音入点${track.label}`" /></label>
          <label>使用时长（秒）<input v-model.number="drafts[track.id]!.duration" type="number" min="0.05" step="any" required :disabled="busy" :aria-label="`声音时长${track.label}`" /></label>
          <label>音量（%）<input v-model.number="drafts[track.id]!.volume" type="number" min="0" max="100" step="1" required :disabled="busy" :aria-label="`声音音量${track.label}`" /></label>
        </div>
        <p v-if="rangeError(track.id, track.sourceDuration)" class="audioError" role="status">{{ rangeError(track.id, track.sourceDuration) }}</p>
        <footer><small v-if="track.sourceDuration">素材 {{ track.sourceDuration.toFixed(2) }} 秒</small><button type="submit" :disabled="busy || !!rangeError(track.id, track.sourceDuration)">保存声音设置</button></footer>
      </template>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { IconTrash, IconUpload, IconVolume, IconVolumeOff } from "@tabler/icons-vue";
import type { DirectorAudioTrack, DirectorProject } from "@toonflow/server/directorTypes";

type AudioPatch = Partial<Pick<DirectorAudioTrack, "label" | "start" | "trimStart" | "duration" | "volume" | "muted">>;
type AudioDraft = { label: string; start: number; trimStart: number; duration: number; volume: number };
const props = defineProps<{ project: DirectorProject; directory: string; busy: boolean; selectedShotId?: string }>();
const emit = defineEmits<{ import: [kind: "dialogue" | "sfx", file: File, shotId?: string, characterId?: string]; update: [trackId: string, patch: AudioPatch]; remove: [trackId: string] }>();
const fileInput = ref<HTMLInputElement>();
const importKind = ref<"dialogue" | "sfx">("dialogue");
const importShotId = ref(props.selectedShotId ?? "");
const importCharacterId = ref("");
const drafts = reactive<Record<string, AudioDraft>>({});
const orderedShots = computed(() => [...props.project.shots].sort((left, right) => left.order - right.order));
const characters = computed(() => props.project.production?.characters ?? []);
watch(() => props.selectedShotId, id => { importShotId.value = id ?? ""; });
watch(() => JSON.stringify(props.project.audioTracks), () => {
  const tracks = props.project.audioTracks ?? [];
  for (const id of Object.keys(drafts)) if (!tracks.some(track => track.id === id)) delete drafts[id];
  for (const track of tracks) drafts[track.id] = { label: track.label, start: track.start, trimStart: track.trimStart, duration: track.duration, volume: Math.round(track.volume * 100) };
}, { immediate: true });

function shotTitle(id: string) {
  const shot = props.project.shots.find(item => item.id === id);
  return shot?.versions.find(version => version.id === shot.currentVersionId)?.title ?? "未命名镜头";
}

function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) emit("import", importKind.value, file, importShotId.value || undefined, importKind.value === "dialogue" ? importCharacterId.value || undefined : undefined);
}

function rangeError(id: string, sourceDuration?: number) {
  const draft = drafts[id];
  if (!draft) return "";
  if (![draft.start, draft.trimStart, draft.duration, draft.volume].every(Number.isFinite) || draft.start < 0 || draft.trimStart < 0 || draft.duration <= 0 || draft.volume < 0 || draft.volume > 100) return "请填写有效的时间与音量。";
  if (!draft.label.trim()) return "声音名称不能为空。";
  if (sourceDuration && draft.trimStart + draft.duration > sourceDuration + 0.05) return "素材入点与使用时长超出音频长度。";
  return "";
}

function saveTrack(id: string) {
  const draft = drafts[id];
  const track = props.project.audioTracks?.find(item => item.id === id);
  if (!draft || !track || rangeError(id, track.sourceDuration)) return;
  emit("update", id, { ...draft, label: draft.label.trim(), volume: draft.volume / 100 });
}
</script>

<style scoped lang="scss">
.audioPanel { padding: 20px; color: #e5e8ed; font-size: 12px;
  .audioHeading { h3 { margin: 0 0 9px; font-size: 15px; font-weight: 550; } p { color: #8f969f; line-height: 1.8; margin: 0 0 20px; } }
  label { display: flex; flex-direction: column; gap: 7px; color: #a8afb8; font-size: 11px; }
  input, select { width: 100%; min-width: 0; box-sizing: border-box; color: #e5e8ed; background: #1b1e24; border: 1px solid #383d47; border-radius: 7px; padding: 8px; font-size: 12px; &:focus-visible { outline: 2px solid #72d797; outline-offset: 2px; } }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid #3b5144; border-radius: 7px; background: #203c2b; color: #9de8b7; padding: 9px 11px; cursor: pointer; font-size: 11px; &:disabled { cursor: default; opacity: .4; } &:focus-visible { outline: 2px solid #72d797; outline-offset: 2px; } }
  .audioImport { display: grid; gap: 12px; margin-bottom: 20px; small { color: #8f969f; line-height: 1.8; } .audioFileInput { display: none; } }
  .audioEmpty { color: #8f969f; line-height: 1.8; padding: 15px 0; border-top: 1px solid #30343c; }
  .audioTrack { padding: 16px 0; border-top: 1px solid #30343c; display: grid; gap: 13px;
    header { display: flex; align-items: center; gap: 8px; span { color: #87b99b; font-size: 10px; } strong { flex: 1; font-size: 12px; font-weight: 500; overflow-wrap: anywhere; } button { padding: 5px; background: transparent; border: 0; color: #99a2af; } }
    .audioBinding { color: #8f969f; margin: -5px 0 0; font-size: 11px; }
    .audioGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
    .audioError { color: #e2b281; line-height: 1.7; margin: 0; }
    footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; small { margin-right: auto; color: #8f969f; font-size: 10px; } }
  }
}
</style>
