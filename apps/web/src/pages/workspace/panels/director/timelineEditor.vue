<template>
  <section class="timelineEditor" :style="{ height: `${Math.min(430, 228 + audioRows.length * 29)}px` }" tabindex="0" aria-label="短片时间轴" @keydown="onKeydown">
    <header><div><icon-timeline :size="15" /><strong>时间轴</strong><span>{{ total.toFixed(1) }} 秒</span></div><div><button type="button" :disabled="busy" @click="emit('import')"><icon-plus :size="14" />添加素材</button><button type="button" :disabled="!selectedEntry || entryBusy(selectedEntry)" @click="selectedEntry && editSubtitle(selectedEntry)"><icon-typography :size="14" />字幕</button><button type="button" :disabled="!canSplit" title="在播放头位置拆分，左右至少保留 1 秒；继承角色与场景" @click="splitSelected"><icon-cut :size="14" />拆分</button><button type="button" :disabled="!selectedEntry || entryBusy(selectedEntry)" @click="selectedEntry && emit('replace', selectedEntry.shot.id)"><icon-replace :size="14" />替换</button><button type="button" :disabled="!selectedEntry || entryBusy(selectedEntry)" @click="selectedEntry && emit('remove', selectedEntry.shot.id)"><icon-trash :size="14" />删除</button><button type="button" :disabled="!canUndo || busy" :title="undoLabel ? `撤销：${undoLabel}` : '没有可撤销的操作'" @click="emit('undo')"><icon-arrow-back-up :size="14" />撤销</button><button type="button" :disabled="!canRedo || busy" :title="redoLabel ? `重做：${redoLabel}` : '没有可重做的操作'" @click="emit('redo')"><icon-arrow-forward-up :size="14" />重做</button><button type="button" @click="emit('music')"><icon-music :size="14" />声音</button><button type="button" :disabled="!entries.length" @click="emit('play')"><icon-player-play :size="14" />播放</button></div></header>
    <div class="trackWorkspace" :style="{ height: `${Math.min(349, 147 + audioRows.length * 29)}px` }"><aside><span>时间</span><span><icon-movie :size="13" />视频</span><span><icon-typography :size="13" />字幕</span><span v-for="row in audioRows" :key="row.track.id" :title="row.track.label"><icon-music :size="13" />{{ row.track.kind === 'dialogue' ? '对白' : '音效' }}</span><span><icon-music :size="13" />配乐</span></aside><div class="trackScroll"><div ref="trackRoot" class="trackInner" :style="{ width: `${width}px` }">
      <div class="timeRuler" aria-label="时间轴定位" @pointerdown="seekAt"><span v-for="tick in ticks" :key="tick" :style="{ left: `${tick / timeScale * 100}%` }">{{ tick.toFixed(0) }}s</span></div>
      <div class="videoTrack"><button v-for="entry in entries" :key="entry.shot.id" type="button" :style="clipStyle(entry)" :class="{ selected: selectedId === entry.shot.id, trimming: trim?.shotId === entry.shot.id }" :draggable="!entryBusy(entry) && !trim" @click="selectEntry(entry)" @dblclick="emit('inspect', entry.shot.id)" @dragstart="draggedId = entry.shot.id" @dragend="draggedId = ''" @dragover.prevent @drop.prevent="dropAt(entry.shot.id)"><span v-if="!entryBusy(entry)" class="trimHandle leftHandle" role="slider" tabindex="0" aria-label="调整片段入点" :aria-valuenow="entry.version.trimStart || 0" @pointerdown.stop.prevent="startTrim($event, entry, 'left')" @keydown="trimKeydown($event, entry, 'left')" /><studioThumbnail :directory="directory" :path="entry.version.keyframe?.path || entry.version.clip?.path" :mimeType="entry.version.keyframe?.mimeType || entry.version.clip?.mimeType" label="" /><span class="clipLabel"><b>{{ String(entry.shot.order).padStart(2, '0') }}</b>{{ entry.version.title }}</span><small>{{ (trim?.shotId === entry.shot.id ? trim.duration : entry.version.duration).toFixed(1) }}s<icon-lock v-if="entry.shot.locked" :size="10" /></small><span v-if="!entryBusy(entry)" class="trimHandle rightHandle" role="slider" tabindex="0" aria-label="调整片段出点" :aria-valuenow="entry.version.duration" @pointerdown.stop.prevent="startTrim($event, entry, 'right')" @keydown="trimKeydown($event, entry, 'right')" /></button></div>
      <div class="subtitleTrack"><button v-for="entry in entries.filter(entry => entry.version.subtitle)" :key="entry.shot.id" type="button" :style="subtitleStyle(entry)" @click="editSubtitle(entry)">{{ entry.version.subtitle }}</button></div>
      <div v-for="row in audioRows" :key="row.track.id" class="audioTimelineTrack"><button type="button" :class="{ muted: row.track.muted, soundEffect: row.track.kind === 'sfx' }" :style="{ left: `${row.start / timeScale * 100}%`, width: `${row.duration / timeScale * 100}%` }" :aria-label="`编辑${row.track.kind === 'dialogue' ? '对白' : '音效'} ${row.track.label}`" @click="emit('music')"><icon-music :size="11" />{{ row.track.label }}<span>{{ row.track.muted ? '静音' : `${Math.round(row.track.volume * 100)}%` }}</span></button></div>
      <div class="musicTrack"><button type="button" :class="{ emptyMusic: !project.music }" @click="emit('music')"><icon-music :size="12" />{{ project.music ? '背景音乐' : '添加背景音乐' }}<span v-if="project.music">{{ Math.round(project.music.volume * 100) }}%</span></button></div>
      <div class="playhead" :style="{ left: `${Math.min(playhead, total) / timeScale * 100}%` }"><i /></div>
    </div></div></div>
    <footer><span>{{ selectedEntry ? `镜头 ${selectedEntry.shot.order} · 入点 ${(selectedEntry.version.trimStart || 0).toFixed(1)}s` : '选择片段 · 拖动边缘裁剪 · 拖动片段排序' }}</span><form v-if="subtitleEditing && selectedEntry" @submit.prevent="saveSubtitle"><input v-model="subtitleDraft" aria-label="编辑选中镜头字幕" maxlength="300" :disabled="busy || selectedEntry.shot.locked" /><button type="submit" :disabled="busy || selectedEntry.shot.locked">保存字幕</button><button type="button" aria-label="关闭字幕编辑" @click="subtitleEditing = false">×</button></form><label>缩放<input v-model.number="zoom" type="range" min="20" max="80" aria-label="时间轴缩放" /></label></footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { IconArrowBackUp, IconArrowForwardUp, IconReplace, IconTrash, IconCut, IconLock, IconMovie, IconMusic, IconPlayerPlay, IconPlus, IconTimeline, IconTypography } from "@tabler/icons-vue";
import type { DirectorProject, DirectorShot, ShotPatch, ShotVersion } from "@toonflow/server/directorTypes";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import studioThumbnail from "./studioThumbnail.vue";

type TimelineEntry = { shot: DirectorShot; version: ShotVersion; start: number };
const props = defineProps<{ project: DirectorProject; directory: string; selectedId: string; playhead: number; busy: boolean; canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string }>();
const emit = defineEmits<{ select: [id: string]; inspect: [id: string]; seek: [time: number]; play: []; patch: [input: { shotId: string; baseVersionId: string; patch: ShotPatch }]; reorder: [ids: string[]]; split: [input: { shotId: string; offset: number }]; import: []; music: []; undo: []; redo: []; remove: [shotId: string]; replace: [shotId: string] }>();
const trackRoot = ref<HTMLElement>();
const zoom = ref(35);
const draggedId = ref("");
const subtitleEditing = ref(false);
const subtitleDraft = ref("");
const subtitleBaseVersion = ref("");
const sourceDuration = ref(0);
const trim = ref<{ shotId: string; side: "left" | "right"; startX: number; baseDuration: number; baseTrim: number; duration: number; trimStart: number; version: ShotVersion }>();
const entries = computed(() => { let start = 0; return props.project.shots.map(shot => { const version = shot.versions.find(version => version.id === shot.currentVersionId)!; const entry = { shot, version, start }; start += version.duration; return entry; }); });
const total = computed(() => entries.value.reduce((sum, entry) => sum + entry.version.duration, 0));
const timeScale = computed(() => Math.max(1, total.value));
const width = computed(() => Math.max(740, total.value * zoom.value));
const ticks = computed(() => Array.from({ length: Math.floor(total.value / 5) + 1 }, (_, index) => index * 5));
const selectedEntry = computed(() => entries.value.find(entry => entry.shot.id === props.selectedId));
const audioRows = computed(() => (props.project.audioTracks || []).map(track => { const entry = track.shotId ? entries.value.find(entry => entry.shot.id === track.shotId) : undefined; const start = (entry?.start || 0) + track.start; return { track, start, duration: Math.max(0, Math.min(track.duration, total.value - start, entry ? entry.version.duration - track.start : Infinity)) }; }).filter(row => row.duration > 0));
const canSplit = computed(() => { const entry = selectedEntry.value; return !!entry && !entryBusy(entry) && props.project.shots.length < 24 && props.playhead - entry.start >= 1 && entry.start + entry.version.duration - props.playhead >= 1; });
function entryBusy(entry: TimelineEntry) { return props.busy || entry.shot.locked || props.project.tasks.some(task => task.shotId === entry.shot.id && task.versionId === entry.version.id && ["queued", "running"].includes(task.status)); }
function onKeydown(event: KeyboardEvent) {
  if (props.busy) return;
  if ((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) { if (props.canRedo) emit("redo"); } else if (props.canUndo) emit("undo"); }
  else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); if (props.canRedo) emit("redo"); }
  else if (["Delete", "Backspace"].includes(event.key) && selectedEntry.value && !entryBusy(selectedEntry.value)) { event.preventDefault(); emit("remove", selectedEntry.value.shot.id); }
}
function clipStyle(entry: TimelineEntry) { return { width: `${entry.version.duration / timeScale.value * 100}%` }; }
function subtitleStyle(entry: TimelineEntry) { const begin = entry.version.subtitleStart || 0; const end = entry.version.subtitleEnd ?? entry.version.duration; return { left: `${(entry.start + begin) / timeScale.value * 100}%`, width: `${(end - begin) / timeScale.value * 100}%` }; }
function selectEntry(entry: TimelineEntry) { emit("select", entry.shot.id); emit("seek", entry.start); }
function seekAt(event: PointerEvent) { const rect = trackRoot.value!.getBoundingClientRect(); emit("seek", Math.max(0, Math.min(total.value, (event.clientX - rect.left) / rect.width * total.value))); }
function dropAt(id: string) { if (!draggedId.value || draggedId.value === id || props.busy || entries.value.some(entry => [id, draggedId.value].includes(entry.shot.id) && entryBusy(entry))) return; const ids = entries.value.map(entry => entry.shot.id); const index = ids.indexOf(draggedId.value); ids.splice(index, 1); ids.splice(ids.indexOf(id), 0, draggedId.value); draggedId.value = ""; emit("reorder", ids); }
function splitSelected() { if (canSplit.value && selectedEntry.value) emit("split", { shotId: selectedEntry.value.shot.id, offset: Number((props.playhead - selectedEntry.value.start).toFixed(2)) }); }
function editSubtitle(entry: TimelineEntry) { selectEntry(entry); subtitleDraft.value = entry.version.subtitle; subtitleBaseVersion.value = entry.version.id; subtitleEditing.value = true; }
function saveSubtitle() { const entry = selectedEntry.value; if (!entry || entryBusy(entry)) return; if (subtitleDraft.value !== entry.version.subtitle) emit("patch", { shotId: entry.shot.id, baseVersionId: subtitleBaseVersion.value, patch: { subtitle: subtitleDraft.value } }); else subtitleEditing.value = false; }
function startTrim(event: PointerEvent, entry: TimelineEntry, side: "left" | "right") { if (entryBusy(entry)) return; emit("select", entry.shot.id); trim.value = { shotId: entry.shot.id, side, startX: event.clientX, baseDuration: entry.version.duration, baseTrim: entry.version.trimStart || 0, duration: entry.version.duration, trimStart: entry.version.trimStart || 0, version: entry.version }; window.addEventListener("pointermove", moveTrim); window.addEventListener("pointerup", finishTrim, { once: true }); }
function changeTrim(delta: number) {
  const current = trim.value;
  if (!current) return;
  if (current.side === "left") { const amount = Math.max(-current.baseTrim, current.baseDuration - 30, Math.min(current.baseDuration - 1, delta)); current.trimStart = Number((current.baseTrim + amount).toFixed(2)); current.duration = Number((current.baseDuration - amount).toFixed(2)); }
  else { const limit = sourceDuration.value > 0 ? Math.min(30, sourceDuration.value - current.baseTrim) : current.baseDuration; current.duration = Number(Math.max(1, Math.min(limit, current.baseDuration + delta)).toFixed(2)); }
}
function moveTrim(event: PointerEvent) { if (trim.value) changeTrim((event.clientX - trim.value.startX) / zoom.value * (total.value * zoom.value / width.value)); }
function finishTrim() {
  window.removeEventListener("pointermove", moveTrim);
  const current = trim.value;
  trim.value = undefined;
  if (!current || props.busy || current.duration === current.baseDuration && current.trimStart === current.baseTrim) return;
  const offset = current.trimStart - current.baseTrim;
  const subtitleStart = Math.max(0, Math.min(current.duration - .01, (current.version.subtitleStart || 0) - offset));
  const subtitleEnd = Math.max(subtitleStart + .01, Math.min(current.duration, (current.version.subtitleEnd ?? current.baseDuration) - offset));
  emit("patch", { shotId: current.shotId, baseVersionId: current.version.id, patch: { duration: current.duration, trimStart: current.trimStart, subtitleStart, subtitleEnd } });
}
function trimKeydown(event: KeyboardEvent, entry: TimelineEntry, side: "left" | "right") { if (!["ArrowLeft", "ArrowRight"].includes(event.key) || entryBusy(entry)) return; event.preventDefault(); trim.value = { shotId: entry.shot.id, side, startX: 0, baseDuration: entry.version.duration, baseTrim: entry.version.trimStart || 0, duration: entry.version.duration, trimStart: entry.version.trimStart || 0, version: entry.version }; changeTrim(event.key === "ArrowLeft" ? -.1 : .1); finishTrim(); }
watch(() => selectedEntry.value?.shot.id, () => { if (subtitleEditing.value && subtitleBaseVersion.value !== selectedEntry.value?.version.id) subtitleEditing.value = false; if (!subtitleEditing.value) subtitleDraft.value = selectedEntry.value?.version.subtitle || ""; });
watch(() => selectedEntry.value?.version.id, () => { if (subtitleEditing.value && selectedEntry.value?.version.subtitle === subtitleDraft.value) subtitleEditing.value = false; });
watch(() => [props.directory, selectedEntry.value?.version.clip?.path] as const, ([directory, path], _old, cleanup) => {
  sourceDuration.value = 0;
  if (!path) return;
  let disposed = false;
  const media = useWorkspaceFiles(directory).acquireUrl(path, "video/mp4");
  const video = document.createElement("video");
  video.preload = "metadata";
  video.onloadedmetadata = () => { if (!disposed && Number.isFinite(video.duration)) sourceDuration.value = video.duration; };
  void media.url.then(url => { if (!disposed) video.src = url; }).catch(() => {});
  cleanup(() => { disposed = true; video.removeAttribute("src"); video.load(); media.release(); });
}, { immediate: true });
onScopeDispose(() => { window.removeEventListener("pointermove", moveTrim); window.removeEventListener("pointerup", finishTrim); });
</script>

<style scoped lang="scss">
.timelineEditor { height: 228px; flex-shrink: 0; background: #17181c; border-top: 1px solid #303136; color: #b2b5bd; font-size: 11px;
  button { font: inherit; cursor: pointer; &:disabled { opacity: .35; cursor: default; } }
  > header { height: 40px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2d2e33; > div { display: flex; align-items: center; gap: 10px; &:last-child { flex-wrap: wrap; gap: 5px; } } strong { color: #e5e6eb; font-weight: 500; } span { color: #858b94; } button { display: flex; align-items: center; gap: 4px; border: 0; padding: 5px; color: #c3c7cf; background: none; } }
  .trackWorkspace { display: flex; align-items: flex-start; height: 147px; overflow-y: auto; > aside { width: 60px; flex-shrink: 0; border-right: 1px solid #292b30; padding-left: 10px; > span { display: flex; align-items: center; gap: 4px; height: 29px; &:first-child { height: 25px; } &:nth-child(2) { height: 60px; } } } }
  .trackScroll { flex: 1; min-width: 0; overflow: auto; padding-right: 14px; }
  .trackInner { position: relative; min-width: 100%; }
  .timeRuler { position: relative; height: 25px; cursor: crosshair; border-bottom: 1px solid #303136; span { position: absolute; top: 5px; color: #737983; font: 9px ui-monospace, monospace; } }
  .videoTrack { height: 60px; display: flex; > button { position: relative; height: 56px; display: flex; align-items: center; gap: 7px; padding: 4px 7px; border: 1px solid #40434d; border-radius: 5px; background: #2b2d35; color: #c8cbd4; overflow: hidden; text-align: left; &.selected { border-color: #48d98c; background: #25382d; } &.trimming { box-shadow: inset 0 0 0 1px #4de293; } > :deep(.studioThumbnail) { width: 32px; height: 44px; flex-shrink: 0; } small { margin-left: auto; font: 9px ui-monospace, monospace; white-space: nowrap; } } }
  .clipLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; b { display: block; margin-bottom: 4px; font: 9px ui-monospace, monospace; opacity: .55; } }
  .trimHandle { position: absolute; top: 0; bottom: 0; width: 7px; z-index: 2; cursor: ew-resize; opacity: 0; background: #51df94; &:focus { opacity: 1; } &.leftHandle { left: 0; } &.rightHandle { right: 0; } }
  .videoTrack > button.selected .trimHandle, .videoTrack > button:hover .trimHandle { opacity: .7; }
  .subtitleTrack { position: relative; height: 29px; button { position: absolute; top: 2px; height: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid #555039; border-radius: 4px; background: #363223; color: #c8bf8b; padding: 2px 7px; } }
  .audioTimelineTrack { position: relative; height: 29px; button { position: absolute; top: 2px; height: 22px; display: flex; align-items: center; gap: 5px; overflow: hidden; white-space: nowrap; padding: 0 7px; border: 1px solid #53634a; border-radius: 4px; color: #bbcead; background: #2a3728; &.soundEffect { border-color: #61537c; color: #c6b6dd; background: #352c43; } &.muted { opacity: .4; } span { margin-left: auto; } } }
  .musicTrack { height: 29px; button { display: flex; align-items: center; gap: 6px; width: 100%; height: 22px; border-radius: 4px; border: 1px solid #374a5c; background: #24303d; color: #a2b8ce; padding: 0 8px; span { margin-left: auto; } &.emptyMusic { border-style: dashed; background: transparent; color: #777e8a; } } }
  .playhead { position: absolute; top: 18px; bottom: 0; width: 1px; z-index: 4; background: #e4e7ed; pointer-events: none; i { position: absolute; top: -4px; left: -4px; width: 9px; height: 9px; background: #e4e7ed; clip-path: polygon(0 0,100% 0,100% 60%,50% 100%,0 60%); } }
  > footer { display: flex; align-items: center; gap: 12px; height: 39px; padding: 0 14px; border-top: 1px solid #292b30; > span { color: #7e848d; flex: 1; } label { display: flex; align-items: center; gap: 8px; color: #868c96; } input[type="range"] { width: 75px; height: 3px; accent-color: #42de8a; } form { display: flex; gap: 5px; input { width: 180px; border: 1px solid #454952; background: #202227; color: #e6e8ef; padding: 4px 7px; border-radius: 5px; } button { border: 0; background: none; color: #75d99e; } } }
}
</style>
