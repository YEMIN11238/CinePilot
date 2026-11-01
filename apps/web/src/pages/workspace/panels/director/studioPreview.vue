<template>
  <section ref="previewRoot" class="studioPreview" tabindex="0" aria-label="短片预览" @pointerdown="focusPreviewSurface" @keydown="previewKeydown">
    <div class="previewHeading">
      <span><icon-player-play :size="14" /> 成片预览</span>
      <small>{{ previewMode }}</small>
    </div>
    <div class="previewStage">
      <canvas ref="canvas" tabindex="0" :width="previewSize.width" :height="previewSize.height" :style="{ aspectRatio: `${previewSize.width} / ${previewSize.height}` }" aria-label="当前短片画面" />
      <div v-if="loading" class="previewOverlay" role="status"><icon-loader-2 class="previewSpinner" :size="22" /><span>正在准备镜头…</span></div>
      <span v-else-if="!sequence.length" class="storyboardBadge">暂无镜头 · 请先添加分镜</span>
      <span v-else-if="activeTrimIssue" class="storyboardBadge">裁剪入点无效 · 无法导出</span>
      <span v-else-if="activeEntry?.kind !== 'video'" class="storyboardBadge">分镜预览 · {{ activeEntry?.kind === 'image' ? '静态关键帧' : '等待素材' }}</span>
      <span v-if="activeShot" class="shotBadge">镜头 {{ String(activeShot.order).padStart(2, '0') }}</span>
    </div>
    <div class="previewTransport">
      <button class="playButton" type="button" :disabled="loading || !totalDuration" :aria-label="playing ? '暂停预览' : '播放预览'" @click="togglePlayback">
        <icon-player-pause v-if="playing" :size="18" /><icon-player-play v-else :size="18" />
      </button>
      <span class="timecode">{{ formatTime(currentTime) }} <span>/ {{ formatTime(totalDuration) }}</span></span>
      <button class="soundButton" type="button" :disabled="!hasPreviewAudio" :aria-label="muted ? '开启预览声音' : '静音预览声音'" @click="muted = !muted">
        <icon-volume-off v-if="muted || !hasPreviewAudio" :size="17" /><icon-volume v-else :size="17" />
      </button>
    </div>
    <input class="previewSeek" type="range" min="0" :max="totalDuration" step="0.01" :value="currentTime" :disabled="loading || !totalDuration" aria-label="短片预览进度" @input="seek(Number(($event.target as HTMLInputElement).value))" />
    <div class="previewFootnote"><span>{{ activeShot?.version.title || '短片预览' }}</span><span>{{ project.ratio }} · {{ audioPolicy }}</span></div>
    <details v-if="notices.length" class="previewNotices">
      <summary><icon-info-circle :size="13" /> {{ notices.length }} 条预览提示</summary>
      <p v-for="notice in notices" :key="notice">{{ notice }}</p>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { IconInfoCircle, IconLoader2, IconPlayerPause, IconPlayerPlay, IconVolume, IconVolumeOff } from "@tabler/icons-vue";
import type { MP4Clip } from "@webav/av-cliper";
import type { DirectorAsset, DirectorProject } from "@toonflow/server/directorTypes";
import useWorkspaceFiles from "@/lib/workspaceFiles";

type PreviewEntry = {
  shotId: string;
  kind: "video" | "image" | "missing";
  decoder?: MP4Clip;
  frame?: VideoFrame;
  image?: HTMLImageElement;
  video?: HTMLVideoElement;
  duration?: number;
  sourceUrl?: string;
  notice?: string;
};

const props = withDefaults(defineProps<{ directory: string; project: DirectorProject; autoplay?: boolean; initialShotId?: string }>(), { autoplay: false, initialShotId: "" });
const emit = defineEmits<{ selectShot: [id: string]; timeUpdate: [time: number] }>();
const previewRoot = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const currentTime = ref(0);
const playing = ref(false);
const loading = ref(false);
const muted = ref(false);
const entries = shallowRef<PreviewEntry[]>([]);
const audioEntries = shallowRef<{ trackId: string; source: HTMLAudioElement; starting: boolean; failed: boolean; notice?: string }[]>([]);
const musicNotice = ref("");
let music: HTMLAudioElement | undefined;
let animation = 0;
let clockStart = 0;
let clockOffset = 0;
let renderPending = false;
let renderRequested = false;
let disposed = false;
let generation = 0;
const previewInteracted = ref(false);
const controlSelector = "input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable='false']), [role='button'], [role='slider'], [role='combobox']";
const previewSize = computed(() => {
  const shortEdge = props.project.exportSettings?.resolution === "1080p" ? 1080 : 720;
  const longEdge = shortEdge === 1080 ? 1920 : 1280;
  return props.project.ratio === "16:9" ? { width: longEdge, height: shortEdge } : props.project.ratio === "1:1" ? { width: shortEdge, height: shortEdge } : { width: shortEdge, height: longEdge };
});
const originalAudio = computed(() => props.project.originalAudio === true);
const hasPreviewAudio = computed(() => !!props.project.music || originalAudio.value && entries.value.some(entry => entry.kind === "video") || (props.project.audioTracks ?? []).some(track => !track.muted && track.volume > 0));
const audioPolicy = computed(() => `${originalAudio.value ? "保留素材原声" : "素材原声关闭"}${props.project.music ? " · 混入配乐" : ""}${props.project.audioTracks?.length ? ` · ${props.project.audioTracks.length} 条对白/音效` : ""}`);

const sequence = computed(() => {
  let offset = 0;
  return [...props.project.shots].sort((first, second) => first.order - second.order).flatMap(shot => {
    const version = shot.versions.find(item => item.id === shot.currentVersionId);
    if (!version) return [];
    const start = offset;
    offset += version.duration;
    return [{ id: shot.id, order: shot.order, version, start, end: offset }];
  });
});
const totalDuration = computed(() => sequence.value.at(-1)?.end ?? 0);
const activeShot = computed(() => sequence.value.find(shot => currentTime.value >= shot.start && currentTime.value < shot.end) ?? sequence.value.at(-1));
const activeEntry = computed(() => entries.value.find(entry => entry.shotId === activeShot.value?.id));
const trimIssues = computed(() => sequence.value.flatMap(shot => {
  const entry = entries.value.find(item => item.shotId === shot.id);
  const start = shot.version.trimStart ?? 0;
  if (entry?.kind !== "video" || !entry.duration || start < entry.duration) return [];
  return [{ shotId: shot.id, start, duration: entry.duration, message: `镜头 ${shot.order}：裁剪入点 ${start.toFixed(2)} 秒达到或超过素材时长（${entry.duration.toFixed(2)} 秒），请调小入点后再导出。` }];
}));
const activeTrimIssue = computed(() => trimIssues.value.find(issue => issue.shotId === activeShot.value?.id));
const previewMode = computed(() => {
  if (loading.value) return "准备中";
  if (!sequence.value.length) return "暂无镜头";
  if (trimIssues.value.length) return "裁剪设置待修正";
  const videoEntries = entries.value.filter(entry => entry.kind === "video");
  if (!videoEntries.length) return "分镜预览";
  return videoEntries.every(entry => entry.decoder) ? "实时视频预览" : "兼容模式预览";
});
const notices = computed(() => [...trimIssues.value.map(issue => issue.message), ...entries.value.flatMap(entry => entry.notice ? [entry.notice] : []), ...audioEntries.value.flatMap(entry => entry.notice ? [entry.notice] : []), ...(musicNotice.value ? [musicNotice.value] : [])]);

function formatTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}.${Math.floor(value % 1 * 10)}`;
}

function stopMedia() {
  music?.pause();
  for (const entry of audioEntries.value) entry.source.pause();
  for (const entry of entries.value) entry.video?.pause();
}

function pause() {
  playing.value = false;
  cancelAnimationFrame(animation);
  stopMedia();
}

function syncMusic(force = false) {
  if (!music) return;
  music.volume = Math.max(0, Math.min(1, props.project.music?.volume ?? 0.25));
  music.muted = muted.value;
  if (Number.isFinite(music.duration) && music.duration > 0) {
    const target = currentTime.value % music.duration;
    if (force || Math.abs(music.currentTime - target) > 0.2) music.currentTime = target;
  }
}

function syncAudioTracks(force = false) {
  for (const entry of audioEntries.value) {
    const track = props.project.audioTracks?.find(item => item.id === entry.trackId);
    const shot = track?.shotId ? sequence.value.find(item => item.id === track.shotId) : undefined;
    if (!track || track.shotId && !shot || track.muted || !track.volume) { entry.source.pause(); continue; }
    const local = currentTime.value - (shot?.start ?? 0) - track.start;
    const source = entry.source;
    if (source.readyState < 2 || entry.failed) { source.pause(); continue; }
    source.volume = Math.max(0, Math.min(1, track.volume));
    source.muted = muted.value;
    if (local < 0 || local >= track.duration || currentTime.value >= totalDuration.value) { source.pause(); continue; }
    const sourceDuration = Number.isFinite(source.duration) ? source.duration : track.sourceDuration ?? track.trimStart + track.duration;
    const target = Math.min(track.trimStart + local, Math.max(0, sourceDuration - 0.025));
    if (force || Math.abs(source.currentTime - target) > 0.12) {
      try { source.currentTime = target; }
      catch {
        source.pause();
        entry.failed = true;
        entry.notice = `声音“${track.label}”无法定位到指定时间，请改用 WAV 或 MP3 音频。`;
        audioEntries.value = [...audioEntries.value];
        continue;
      }
    }
    if (!playing.value) { source.pause(); continue; }
    if (!source.paused || entry.starting || entry.failed) continue;
    entry.starting = true;
    const token = generation;
    void source.play().then(() => {
      if (disposed || token !== generation || !playing.value) source.pause();
    }).catch(cause => {
      if (!disposed && token === generation && cause?.name !== "AbortError") {
        entry.failed = true;
        entry.notice = `声音“${track.label}”未能播放，请检查格式或再次点击播放。`;
        audioEntries.value = [...audioEntries.value];
      }
    }).finally(() => { entry.starting = false; });
  }
}

function play() {
  if (disposed || playing.value || document.hidden || loading.value || !totalDuration.value) return;
  if (currentTime.value >= totalDuration.value) currentTime.value = 0;
  clockOffset = currentTime.value;
  clockStart = performance.now();
  playing.value = true;
  syncMusic(true);
  for (const entry of audioEntries.value) if (entry.source.readyState >= 2) { entry.failed = false; entry.notice = undefined; }
  syncAudioTracks(true);
  if (music) {
    const source = music;
    const token = generation;
    void source.play().then(() => {
      if (disposed || token !== generation || !playing.value) source.pause();
      else musicNotice.value = "";
    }).catch(cause => {
      if (!disposed && token === generation && playing.value && cause?.name !== "AbortError") musicNotice.value = "配乐未能播放，请检查音频格式或再次点击播放。";
    });
  }
  const advance = () => {
    if (!playing.value) return;
    currentTime.value = Math.min(totalDuration.value, clockOffset + (performance.now() - clockStart) / 1000);
    syncAudioTracks();
    requestRender();
    if (currentTime.value >= totalDuration.value) { pause(); return; }
    animation = requestAnimationFrame(advance);
  };
  animation = requestAnimationFrame(advance);
}

function togglePlayback() {
  if (playing.value) pause();
  else play();
}

function seek(time: number) {
  currentTime.value = Math.max(0, Math.min(totalDuration.value, time));
  if (currentTime.value >= totalDuration.value) pause();
  clockOffset = currentTime.value;
  clockStart = performance.now();
  syncMusic(true);
  syncAudioTracks(true);
  requestRender();
}

function seekToShot(id: string) {
  const shot = sequence.value.find(item => item.id === id);
  if (shot) seek(shot.start);
}

function drawContained(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number) {
  if (!width || !height) return;
  const frame = previewSize.value;
  const scale = Math.min(frame.width / width, frame.height / height);
  context.drawImage(source, (frame.width - width * scale) / 2, (frame.height - height * scale) / 2, width * scale, height * scale);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const char of text.replaceAll("\r", "")) {
    if (char === "\n" || context.measureText(line + char).width > maxWidth) {
      lines.push(line);
      line = "";
      if (char === "\n") continue;
    }
    if (char.charCodeAt(0) >= 32) line += char;
  }
  if (line) lines.push(line);
  return lines;
}

function drawSubtitle(context: CanvasRenderingContext2D, subtitle: string) {
  const frame = previewSize.value;
  const scale = Math.min(frame.width, frame.height) / 720;
  context.font = `${32 * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  const lines = wrapText(context, subtitle, frame.width - 80 * scale);
  if (!lines.length) return;
  const width = Math.max(...lines.map(line => context.measureText(line).width));
  const height = lines.length * 40 * scale;
  const bottom = Math.round(frame.height * 0.078125);
  context.fillStyle = "rgba(0,0,0,.45)";
  context.fillRect((frame.width - width) / 2 - 12 * scale, frame.height - height - bottom - 12 * scale, width + 24 * scale, height + 24 * scale);
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "top";
  lines.forEach((line, index) => context.fillText(line, frame.width / 2, frame.height - height - bottom + index * 40 * scale));
}

function drawMissing(context: CanvasRenderingContext2D, title: string, description: string, label = "分镜预览") {
  const frame = previewSize.value;
  const center = frame.width / 2;
  const labelY = frame.height * 0.28;
  const titleY = labelY + 64;
  const gradient = context.createLinearGradient(0, 0, frame.width, frame.height);
  gradient.addColorStop(0, "#1f1d2a");
  gradient.addColorStop(1, "#121110");
  context.fillStyle = gradient;
  context.fillRect(0, 0, frame.width, frame.height);
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillStyle = "#9cbfa9";
  context.font = '30px "PingFang SC", sans-serif';
  context.fillText(label, center, labelY);
  context.fillStyle = "#e8e5f5";
  context.font = '36px "PingFang SC", sans-serif';
  const titleLines = wrapText(context, title, frame.width - 130);
  titleLines.forEach((line, index) => context.fillText(line, center, titleY + index * 48));
  context.fillStyle = "#72937c";
  context.font = '26px "PingFang SC", sans-serif';
  wrapText(context, description, frame.width - 150).slice(0, 5).forEach((line, index) => context.fillText(line, center, titleY + 15 + titleLines.length * 48 + index * 38));
}

async function renderFrame() {
  const context = canvas.value?.getContext("2d");
  const shot = activeShot.value;
  const entry = activeEntry.value;
  if (!context) return;
  if (!shot) { drawMissing(context, "当前项目还没有镜头", "请先添加分镜，再预览或导出。", "暂无镜头"); return; }
  const trimIssue = activeTrimIssue.value;
  if (trimIssue) {
    entry?.video?.pause();
    drawMissing(context, shot.version.title, `当前入点 ${trimIssue.start.toFixed(2)} 秒，素材只有 ${trimIssue.duration.toFixed(2)} 秒。请在镜头属性中调小视频素材入点，再预览或导出。`, "裁剪入点无效 · 无法导出");
    return;
  }
  const token = generation;
  const localTime = Math.max(0, Math.min(shot.version.duration, currentTime.value - shot.start));
  const sourceTime = localTime + (shot.version.trimStart ?? 0);
  if (entry?.decoder) {
    try {
      const time = Math.min(sourceTime * 1e6, Math.max(0, entry.decoder.meta.duration - 50_000));
      const result = await entry.decoder.tick(time);
      if (token !== generation || disposed) { result.video?.close(); return; }
      if (result.video) { entry.frame?.close(); entry.frame = result.video; }
    } catch (cause) {
      if (token !== generation || disposed) return;
      entry.decoder.destroy();
      entry.decoder = undefined;
      entry.frame?.close();
      entry.frame = undefined;
      entry.notice = `镜头 ${shot.order}：WebAV 解码失败，已切换浏览器兼容预览。`;
      try { entry.video = await loadNativeVideo(entry.sourceUrl!, activeAbort.signal); entry.duration = entry.video.duration; }
      catch { entry.kind = entry.image ? "image" : "missing"; entry.notice = `镜头 ${shot.order}：视频格式无法预览，请导入 H.264 MP4。`; }
      if (token !== generation || disposed) { releaseVideo(entry.video); return; }
      entries.value = [...entries.value];
      if (activeTrimIssue.value) { requestRender(); return; }
    }
  }
  if (entry?.video) {
    const video = entry.video;
    video.muted = muted.value || !originalAudio.value;
    const target = Math.min(sourceTime, Math.max(0, video.duration - 0.05));
    if (Math.abs(video.currentTime - target) > (playing.value ? 0.2 : 0.015)) {
      video.currentTime = target;
      if (!playing.value) await waitForMedia(video, "seeked", activeAbort.signal).catch(() => {});
      if (token !== generation || disposed) return;
    }
    if (playing.value && sourceTime < video.duration - 0.05 && video.paused) void video.play().catch(cause => {
      if (disposed || token !== generation || activeEntry.value !== entry || !playing.value || cause?.name === "AbortError") return;
      entry.notice = `镜头 ${shot.order}：浏览器未能播放此视频，请再次点击播放或更换为 H.264 MP4。`;
      entries.value = [...entries.value];
      pause();
    });
    if (!playing.value || sourceTime >= video.duration - 0.05) video.pause();
  }
  context.fillStyle = "#080808";
  context.fillRect(0, 0, previewSize.value.width, previewSize.value.height);
  if (entry?.frame) drawContained(context, entry.frame, entry.frame.displayWidth, entry.frame.displayHeight);
  else if (entry?.video && entry.video.readyState >= 2) drawContained(context, entry.video, entry.video.videoWidth, entry.video.videoHeight);
  else if (entry?.image) drawContained(context, entry.image, entry.image.naturalWidth, entry.image.naturalHeight);
  else drawMissing(context, shot.version.title, shot.version.description);
  if (localTime >= (shot.version.subtitleStart ?? 0) && localTime < (shot.version.subtitleEnd ?? shot.version.duration)) drawSubtitle(context, shot.version.subtitle);
}

function requestRender() {
  renderRequested = true;
  if (renderPending || disposed) return;
  renderPending = true;
  void (async () => {
    try {
      while (renderRequested && !disposed) {
        renderRequested = false;
        await renderFrame();
      }
    } finally { renderPending = false; }
  })().catch(() => { if (!disposed) pause(); });
}

function waitForMedia(target: HTMLMediaElement | HTMLImageElement, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      target.removeEventListener(event, loaded);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      error ? reject(error) : resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error("无法读取此媒体格式"));
    const aborted = () => finish(new Error("已取消读取"));
    const timeout = setTimeout(() => finish(new Error("素材读取超时")), 20_000);
    target.addEventListener(event, loaded, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

function releaseVideo(video?: HTMLMediaElement) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function releaseDecoder(decoder?: MP4Clip) {
  if (!decoder) return;
  // WebAV 会在 ready 完成后创建解码器，等初始化结束再销毁，避免切换项目时泄漏。
  void decoder.ready.then(() => decoder.destroy(), () => decoder.destroy());
}

function waitForDecoder(decoder: MP4Clip, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", aborted);
      error ? reject(error) : resolve();
    };
    const aborted = () => finish(new Error("已取消读取"));
    const timeout = setTimeout(() => finish(new Error("视频解码准备超时")), 20_000);
    signal.addEventListener("abort", aborted, { once: true });
    void decoder.ready.then(() => finish(), finish);
    if (signal.aborted) aborted();
  });
}

async function loadNativeVideo(url: string, signal: AbortSignal) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const ready = waitForMedia(video, "loadeddata", signal);
  video.src = url;
  video.load();
  try { await ready; return video; }
  catch (cause) { releaseVideo(video); throw cause; }
}

let activeAbort = new AbortController();
watch(() => JSON.stringify([props.directory, sequence.value.map(shot => [shot.id, shot.version.clip, shot.version.keyframe]), props.project.music?.asset, props.project.audioTracks?.map(track => [track.id, track.asset]), originalAudio.value]), async (_signature, _old, onCleanup) => {
  const token = ++generation;
  pause();
  activeAbort.abort();
  const aborter = new AbortController();
  activeAbort = aborter;
  const pending: PreviewEntry[] = [];
  const pendingAudio: typeof audioEntries.value = [];
  const leases: { release: () => void }[] = [];
  let localMusic: HTMLAudioElement | undefined;
  const snapshot = sequence.value;
  const musicAsset = props.project.music?.asset;
  const audioTracks = [...(props.project.audioTracks ?? [])];
  const files = useWorkspaceFiles(props.directory);
  loading.value = true;
  entries.value = [];
  audioEntries.value = [];
  music = undefined;
  musicNotice.value = "";
  onCleanup(() => {
    aborter.abort();
    releaseVideo(localMusic);
    for (const entry of pendingAudio) releaseVideo(entry.source);
    for (const entry of pending) {
      releaseDecoder(entry.decoder);
      entry.frame?.close();
      releaseVideo(entry.video);
      if (entry.image) entry.image.src = "";
    }
    leases.forEach(lease => lease.release());
  });
  async function assetUrl(asset: DirectorAsset) {
    const lease = files.acquireUrl(asset.path, asset.mimeType);
    leases.push(lease);
    const url = await lease.url;
    aborter.signal.throwIfAborted();
    return url;
  }
  const webavSupported = window.isSecureContext && "VideoDecoder" in window && typeof navigator.storage?.getDirectory === "function";
  await Promise.all(snapshot.map(async shot => {
    const entry: PreviewEntry = { shotId: shot.id, kind: "missing" };
    pending.push(entry);
    if (shot.version.clip) {
      try {
        entry.sourceUrl = await assetUrl(shot.version.clip);
        if (!originalAudio.value && webavSupported && /mp4|quicktime/.test(shot.version.clip.mimeType)) {
          try {
            const { MP4Clip } = await import("@webav/av-cliper");
            aborter.signal.throwIfAborted();
            const response = await fetch(entry.sourceUrl, { signal: aborter.signal });
            if (!response.body) throw new Error("视频读取为空");
            const decoder = new MP4Clip(response.body, { audio: false });
            entry.decoder = decoder;
            await waitForDecoder(decoder, aborter.signal);
            if (aborter.signal.aborted) { releaseDecoder(decoder); return; }
            if (!decoder.meta.width || !decoder.meta.duration) throw new Error("视频不含可解码画面");
            entry.duration = decoder.meta.duration / 1e6;
          } catch (cause) {
            releaseDecoder(entry.decoder);
            entry.decoder = undefined;
            if (aborter.signal.aborted) return;
            entry.notice = `镜头 ${shot.order}：WebAV 无法解码此素材，使用浏览器兼容预览。`;
          }
        } else if (!originalAudio.value) entry.notice = `镜头 ${shot.order}：${webavSupported ? "当前格式" : "当前浏览器"}使用原生兼容预览，推荐 Chrome / Edge 和 H.264 MP4。`;
        if (!entry.decoder) { entry.video = await loadNativeVideo(entry.sourceUrl, aborter.signal); entry.duration = entry.video.duration; }
        entry.kind = "video";
        return;
      } catch (cause) {
        if (aborter.signal.aborted) return;
        entry.notice = `镜头 ${shot.order}：视频无法读取或格式不支持${shot.version.keyframe ? "，改为静态关键帧" : "，请重新导入素材"}。`;
      }
    }
    if (shot.version.keyframe) {
      try {
        const url = await assetUrl(shot.version.keyframe);
        const image = new Image();
        entry.image = image;
        const ready = waitForMedia(image, "load", aborter.signal);
        image.src = url;
        await ready;
        entry.kind = "image";
      } catch {
        entry.image?.removeAttribute("src");
        entry.image = undefined;
        if (!aborter.signal.aborted) entry.notice = `镜头 ${shot.order}：关键帧无法读取，请重新导入素材。`;
      }
    }
  }));
  if (musicAsset && !aborter.signal.aborted) {
    try {
      const url = await assetUrl(musicAsset);
      localMusic = new Audio();
      localMusic.loop = true;
      localMusic.preload = "auto";
      const ready = waitForMedia(localMusic, "loadeddata", aborter.signal);
      localMusic.src = url;
      localMusic.load();
      await ready;
      if (token === generation) music = localMusic;
    } catch { if (!aborter.signal.aborted) musicNotice.value = "配乐无法读取，预览暂时无声；请重新选择音频文件。"; }
  }
  await Promise.all(audioTracks.map(async track => {
    const source = new Audio();
    pendingAudio.push({ trackId: track.id, source, starting: false, failed: false });
    try {
      const url = await assetUrl(track.asset);
      source.preload = "auto";
      const ready = waitForMedia(source, "loadeddata", aborter.signal);
      source.src = url;
      source.load();
      await ready;
    } catch {
      releaseVideo(source);
      const entry = pendingAudio.find(item => item.source === source);
      if (entry) { entry.failed = true; entry.notice = `声音“${track.label}”无法读取，请重新导入有效音频。`; }
    }
  }));
  if (aborter.signal.aborted || token !== generation) return;
  entries.value = pending;
  audioEntries.value = pendingAudio;
  loading.value = false;
  const initialShot = sequence.value.find(shot => shot.id === props.initialShotId);
  seek(initialShot?.start ?? Math.min(currentTime.value, totalDuration.value));
  if (props.autoplay) play();
  await nextTick();
  if (!disposed && token === generation) focus();
}, { immediate: true, flush: "post" });

watch(() => props.initialShotId, id => { if (!loading.value && id) seekToShot(id); }, { flush: "post" });
watch(() => props.autoplay, value => { if (value) play(); else pause(); }, { flush: "post" });
watch(() => [props.project.music?.volume, muted.value], () => { syncMusic(); syncAudioTracks(); requestRender(); });
watch(() => JSON.stringify(props.project.audioTracks), () => syncAudioTracks(true));
watch(previewSize, () => { pause(); void nextTick(requestRender); });
watch(() => JSON.stringify(sequence.value.map(shot => [shot.id, shot.order, shot.version.title, shot.version.description, shot.version.duration, shot.version.trimStart, shot.version.subtitle, shot.version.subtitleStart, shot.version.subtitleEnd])), () => {
  pause();
  seek(Math.min(currentTime.value, totalDuration.value));
});
watch(() => activeShot.value?.id, id => {
  for (const entry of entries.value) if (entry.shotId !== id) entry.video?.pause();
  if (id) emit("selectShot", id);
});
watch(canvas, requestRender);
function visibilityChanged() { if (document.hidden) pause(); }
function focus() {
  const root = previewRoot.value;
  if (disposed || previewInteracted.value || document.hidden || !root?.getClientRects().length) return;
  const focused = document.activeElement;
  const dialog = root.closest(".el-dialog, [role='dialog']");
  if (!focused || focused === document.body || focused === dialog || (focused.matches(".el-dialog__headerbtn") && dialog?.contains(focused))) root.focus({ preventScroll: true });
}
function focusPreviewSurface(event: PointerEvent) {
  previewInteracted.value = true;
  if (event.target instanceof Element && !event.target.closest(controlSelector)) previewRoot.value?.focus({ preventScroll: true });
}
function previewKeydown(event: KeyboardEvent) {
  previewInteracted.value = true;
  if (event.code !== "Space" || event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.hidden || !previewRoot.value?.getClientRects().length) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(controlSelector)) return;
  event.preventDefault();
  event.stopPropagation();
  togglePlayback();
}
document.addEventListener("visibilitychange", visibilityChanged);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  pause();
  activeAbort.abort();
  document.removeEventListener("visibilitychange", visibilityChanged);
});
watch(currentTime, value => emit("timeUpdate", value));
defineExpose({ seekToShot, seek, pause, focus, togglePlayback });
</script>

<style scoped lang="scss">
.studioPreview {
  min-width: 0; padding: 15px; border: 1px solid #303f35; border-radius: 14px; background: #1c2520; color: #e5ece7;
  &:focus-visible { outline: 2px solid #81bb93; outline-offset: 3px; }
  .previewHeading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 12px; span { display: flex; align-items: center; gap: 7px; color: #bdd1c3; } small { color: #789886; font-size: 11px; } }
  .previewStage { position: relative; display: flex; justify-content: center; align-items: center; min-height: 160px; overflow: hidden; border-radius: 9px; background: #111813;
    canvas { display: block; width: auto; height: auto; max-width: 100%; max-height: 430px; &:focus-visible { outline: 2px solid #81bb93; outline-offset: -2px; } }
    .previewOverlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; background: #142019de; color: #9fb9a9; font-size: 12px; }
    .previewSpinner { animation: previewRotate 1s linear infinite; }
    .storyboardBadge, .shotBadge { position: absolute; left: 9px; border: 1px solid #ffffff16; border-radius: 5px; background: #14241bdb; padding: 4px 6px; color: #9cb6a5; font-size: 10px; }
    .storyboardBadge { top: 9px; } .shotBadge { bottom: 9px; }
  }
  .previewTransport { display: flex; align-items: center; gap: 10px; margin-top: 12px;
    button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 50%; cursor: pointer; &:disabled { opacity: .4; cursor: default; } &:focus-visible { outline: 2px solid #81bb93; outline-offset: 3px; } }
    .playButton { color: #163b23; background: #a8d0b3; } .soundButton { margin-left: auto; background: transparent; color: #7fa18b; }
    .timecode { font: 11px ui-monospace, monospace; font-variant-numeric: tabular-nums; color: #b1c7b9; span { color: #60806b; } }
  }
  .previewSeek { display: block; width: 100%; height: 3px; margin: 14px 0; accent-color: #81bb93; cursor: pointer; }
  .previewFootnote { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; color: #6f8d7b; span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } span:last-child { white-space: nowrap; } }
  .previewNotices { margin-top: 12px; color: #7e9d89; font-size: 11px; line-height: 1.6; summary { display: flex; align-items: center; gap: 5px; cursor: pointer; } p { margin: 7px 0 0; } }
}
@keyframes previewRotate { to { transform: rotate(360deg); } }
</style>
