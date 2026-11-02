<template>
  <section class="templateLibrary" aria-label="模板库">
    <div class="libraryHeading">
      <div><h2>模板库</h2><p>从一个画面出发，把灵感变成你的故事。</p></div>
      <button class="viewAll" type="button" :disabled="busy" @click="openLibrary">查看全部<icon-arrow-right :size="15" /></button>
    </div>
    <div class="templateGrid">
      <button v-for="item in creativeTemplates" :key="item.id" type="button" class="templateCard" :disabled="busy" :aria-label="`查看${item.title}模板`" @click="openTemplate(item)">
        <span class="templateCover"><img :src="item.cover" :alt="`${item.title}风格示意`" loading="lazy" decoding="async" /><span class="coverAction">查看模板<icon-arrow-up-right :size="16" /></span></span>
        <strong>{{ item.title }}</strong><span class="cardMeta">{{ item.category }}<span>·</span>{{ outputLabel(item) }}</span>
      </button>
    </div>
    <el-dialog v-model="dialogVisible" :title="selectedTemplate ? selectedTemplate.title : '模板库'" :width="selectedTemplate ? 'min(960px, calc(100vw - 32px))' : 'min(1120px, calc(100vw - 32px))'" top="6vh" appendToBody :closeOnClickModal="!busy" :closeOnPressEscape="!busy" :showClose="!busy" class="templateLibraryDialog" @opened="focusDialogContent" @close="emit('clearError')" @closed="resetDialog">
      <div v-if="!selectedTemplate" class="libraryBrowse">
        <p class="browseIntro">选一个起点，提示词、画幅和画布节点都可以继续修改。</p>
        <div ref="categoryFilters" class="categoryFilters" aria-label="模板分类">
          <button v-for="category in categories" :key="category" type="button" :class="{ active: activeCategory === category }" :disabled="busy" :aria-pressed="activeCategory === category" @click="activeCategory = category">{{ category }}</button>
        </div>
        <div class="templateGrid">
          <button v-for="item in filteredTemplates" :key="item.id" type="button" class="templateCard" :disabled="busy" :aria-label="`查看${item.title}模板`" @click="openTemplate(item, true)">
            <span class="templateCover"><img :src="item.cover" :alt="`${item.title}风格示意`" loading="lazy" decoding="async" /><span class="coverAction">查看模板<icon-arrow-up-right :size="16" /></span></span>
            <strong>{{ item.title }}</strong><span class="cardMeta">{{ item.category }}<span>·</span>{{ outputLabel(item) }}</span>
          </button>
        </div>
      </div>
      <div v-else class="templateDetail">
        <button v-if="fromLibrary" class="backToLibrary" type="button" :disabled="busy" @click="backToLibrary"><icon-arrow-left :size="15" />返回模板库</button>
        <div class="detailLayout">
          <figure class="detailArtwork"><img :src="selectedTemplate.cover" :alt="`${selectedTemplate.title}的 AI 风格示意图`" /><figcaption><icon-photo :size="14" />AI 风格示意封面，非模板实测成片</figcaption></figure>
          <div class="detailContent">
            <div class="detailTags"><span>{{ selectedTemplate.category }}</span><span>{{ selectedTemplate.ratio }}</span><span>{{ outputLabel(selectedTemplate) }}</span></div>
            <h3 ref="detailHeading" tabindex="-1">{{ selectedTemplate.title }}</h3>
            <p class="detailDescription">{{ selectedTemplate.description }}</p>
            <div class="workflowSection"><h4><icon-topology-star-3 :size="16" />带入画布的流程</h4><ol><li v-for="(step, index) in selectedTemplate.steps" :key="step"><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ step }}</li></ol></div>
            <div class="editableSection"><h4>你可以修改</h4><div><span v-for="field in selectedTemplate.editableFields" :key="field">{{ field }}</span></div></div>
            <div class="customizationSection">
              <div class="customizationHeading"><h4>本次创作</h4><button v-if="idea.trim()" type="button" :disabled="busy" @click="appendIdea">带入首页想法<icon-arrow-down :size="13" /></button></div>
              <label for="templateProjectTitle">项目名称<input id="templateProjectTitle" v-model="draftTitle" type="text" maxlength="120" :disabled="busy" @input="clearCustomizationError" /></label>
              <label for="templatePicturePrompt">{{ selectedTemplate.outputKind === 'video' ? '本次首帧描述' : '本次图片描述' }}<textarea id="templatePicturePrompt" v-model="draftPrompt" rows="6" maxlength="6000" :disabled="busy" @input="clearCustomizationError" /><small>{{ draftPrompt.length }} / 6000</small></label>
              <label v-if="selectedTemplate.outputKind === 'video'" for="templateMotionPrompt">视频动作<textarea id="templateMotionPrompt" v-model="draftMotionPrompt" rows="4" maxlength="6000" :disabled="busy" @input="clearCustomizationError" /></label>
              <p v-if="customizationError" class="customizationError" role="alert">{{ customizationError }}</p>
            </div>
            <details class="promptDetails"><summary>查看预设提示词<icon-chevron-down :size="14" /></summary><div class="promptText"><strong>{{ selectedTemplate.outputKind === 'video' ? '首帧画面' : '图片描述' }}</strong><p>{{ selectedTemplate.prompt }}</p><template v-if="selectedTemplate.motionPrompt"><strong>视频动作</strong><p>{{ selectedTemplate.motionPrompt }}</p></template></div></details>
            <div class="detailAction">
              <p class="creationNote">创建独立项目，保留原有作品。进入画布后确认提示词与模型，再生成素材。</p>
              <p v-if="error" class="creationError" role="alert"><icon-alert-circle :size="16" />{{ error }}</p>
              <button class="useTemplate" type="button" :disabled="busy" @click="useSelectedTemplate"><icon-loader-2 v-if="creatingId === selectedTemplate.id" :size="17" class="loadingIcon" /><icon-sparkles v-else :size="17" />{{ creatingId === selectedTemplate.id ? '正在创建项目…' : '使用模板' }}<icon-arrow-right v-if="creatingId !== selectedTemplate.id" :size="17" /></button>
              <span class="generationNote">创建模板不调用模型；图片、视频生成按所选 API 计费。</span>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { IconAlertCircle, IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUpRight, IconChevronDown, IconLoader2, IconPhoto, IconSparkles, IconTopologyStar3 } from "@tabler/icons-vue";
import { creativeTemplates, type CreativeTemplate, type CreativeTemplateOverrides } from "@toonflow/server/directorTemplates";

const props = withDefaults(defineProps<{ busy?: boolean; creatingId?: string; error?: string; idea?: string }>(), { busy: false, creatingId: "", error: "", idea: "" });
const emit = defineEmits<{ useTemplate: [templateId: string, overrides: CreativeTemplateOverrides]; clearError: [] }>();
const dialogVisible = ref(false);
const selectedTemplate = ref<CreativeTemplate>();
const fromLibrary = ref(false);
const activeCategory = ref("全部");
const detailHeading = ref<HTMLElement>();
const categoryFilters = ref<HTMLElement>();
const draftTitle = ref("");
const draftPrompt = ref("");
const draftMotionPrompt = ref("");
const customizationError = ref("");
const categories = ["全部", ...new Set(creativeTemplates.map(item => item.category))];
const filteredTemplates = computed(() => activeCategory.value === "全部" ? creativeTemplates : creativeTemplates.filter(item => item.category === activeCategory.value));

function outputLabel(item: CreativeTemplate) {
  return item.outputKind === "video" ? `${item.duration} 秒单镜头` : "图片创作";
}

function openLibrary() {
  if (props.busy) return;
  emit("clearError");
  selectedTemplate.value = undefined;
  activeCategory.value = "全部";
  fromLibrary.value = true;
  dialogVisible.value = true;
}

function openTemplate(item: CreativeTemplate, fromBrowse = false) {
  if (props.busy) return;
  emit("clearError");
  selectedTemplate.value = item;
  draftTitle.value = item.title;
  draftPrompt.value = item.prompt;
  draftMotionPrompt.value = item.motionPrompt || "保持首帧主体与风格，生成单一连续镜头。";
  customizationError.value = "";
  fromLibrary.value = fromBrowse;
  dialogVisible.value = true;
  if (fromBrowse) void nextTick(focusDialogContent);
}

function backToLibrary() {
  if (props.busy) return;
  emit("clearError");
  selectedTemplate.value = undefined;
  void nextTick(focusDialogContent);
}

function focusDialogContent() {
  const target = selectedTemplate.value ? detailHeading.value : categoryFilters.value?.querySelector<HTMLButtonElement>("button.active");
  target?.focus({ preventScroll: true });
}

function useSelectedTemplate() {
  const item = selectedTemplate.value;
  if (props.busy || !item) return;
  const title = draftTitle.value.trim();
  const prompt = draftPrompt.value.trim();
  const motionPrompt = draftMotionPrompt.value.trim();
  if (!title || title.length > 120) { customizationError.value = "项目名称需为 1 至 120 字。"; return; }
  if (!prompt || prompt.length > 6000) { customizationError.value = "图片或首帧描述需为 1 至 6000 字。"; return; }
  if (item.outputKind === "video" && (!motionPrompt || motionPrompt.length > 6000)) { customizationError.value = "视频动作需为 1 至 6000 字。"; return; }
  customizationError.value = "";
  emit("useTemplate", item.id, { title, prompt, ...(item.outputKind === "video" ? { motionPrompt } : {}) });
}

function clearCustomizationError() {
  customizationError.value = "";
  emit("clearError");
}

function appendIdea() {
  const idea = props.idea.trim();
  if (props.busy || !idea) return;
  if (draftPrompt.value.includes(idea)) { customizationError.value = "首页想法已在描述中，无需重复带入。"; return; }
  const next = [draftPrompt.value.trim(), `本次创作要求：\n${idea}`].filter(Boolean).join("\n\n");
  if (next.length > 6000) { customizationError.value = "带入后超过 6000 字，原描述已保留。请先精简内容。"; return; }
  draftPrompt.value = next;
  clearCustomizationError();
}

function resetDialog() {
  selectedTemplate.value = undefined;
  fromLibrary.value = false;
  customizationError.value = "";
}

function close() {
  dialogVisible.value = false;
}

function openTemplateById(id: string) {
  const item = creativeTemplates.find(template => template.id === id);
  if (item) openTemplate(item);
}

defineExpose({ close, openLibrary, openTemplateById });
</script>

<style scoped lang="scss">
.templateLibrary {
  max-width: 1000px;
  margin: 52px auto 0;
  padding-top: 35px;
  border-top: 1px solid #ffffff0c;

  .libraryHeading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 23px;

    h2 { margin: 0; color: #eef1f4; font-size: 19px; font-weight: 550; }
    p { margin: 8px 0 0; color: #7e8792; font-size: 11px; line-height: 1.7; }
    .viewAll { display: inline-flex; gap: 7px; align-items: center; flex-shrink: 0; border: 0; padding: 8px 0 8px 8px; background: none; color: #a7b0bb; font-size: 11px; cursor: pointer; &:hover:not(:disabled) { color: #edf2f5; } &:disabled { opacity: .5; cursor: default; } }
  }
}

.templateGrid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 28px 17px;

  .templateCard {
    min-width: 0;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 12px;
    color: #dce1e7;
    text-align: left;
    cursor: pointer;

    .templateCover {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 13px;
      background: #1c2026;
      isolation: isolate;

      img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .3s ease; }
      &::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent 48%, #0008); opacity: 0; transition: opacity .2s ease; pointer-events: none; }
      .coverAction { position: absolute; z-index: 1; inset: auto 12px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: white; font-size: 11px; font-weight: 500; opacity: 0; transform: translateY(4px); transition: opacity .2s ease, transform .2s ease; }
    }
    > strong { display: block; color: inherit; font-size: 13px; line-height: 1.5; font-weight: 550; margin-top: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cardMeta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: #78828e; font-size: 10px; line-height: 1.7; margin-top: 5px; > span { color: #515b66; } }
    &:hover:not(:disabled), &:focus-visible { color: #fff; .templateCover { img { transform: scale(1.045); } &::after, .coverAction { opacity: 1; } .coverAction { transform: none; } } }
    &:focus-visible { outline: 2px solid #00dc69; outline-offset: 6px; }
    &:disabled { cursor: default; opacity: .55; }
  }
}

.libraryBrowse {
  .browseIntro { margin: 0; color: #8f99a5; font-size: 12px; line-height: 1.8; }
  .categoryFilters { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 24px; > button { border: 1px solid #ffffff12; background: #20242a; border-radius: 8px; padding: 9px 14px; color: #aab3bf; font-size: 12px; cursor: pointer; &:hover { border-color: #ffffff35; color: #f1f3f6; } &.active { border-color: #00dc6940; color: #8af1b4; background: #00dc6912; } } }
}

.templateDetail {
  .backToLibrary { display: flex; gap: 7px; align-items: center; padding: 0; margin: 0 0 20px; border: 0; background: none; color: #9ca8b5; font-size: 12px; cursor: pointer; &:hover:not(:disabled) { color: #fff; } &:disabled { opacity: .5; cursor: default; } }
  .detailLayout {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    align-items: start;
    gap: 30px;

    .detailArtwork { margin: 0; min-width: 0; > img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 14px; background: #22262c; } > figcaption { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; color: #798490; font-size: 10px; line-height: 1.7; } }
    .detailContent {
      min-width: 0;
      .detailTags { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; > span { padding: 4px 7px; border-radius: 5px; background: #ffffff08; color: #99a6b4; font-size: 10px; &:first-child { color: #90e6b5; background: #00dc6910; } } }
      h3 { margin: 14px 0 12px; color: #f1f4f7; font-size: 24px; line-height: 1.4; font-weight: 550; letter-spacing: -.5px; }
      .detailDescription { margin: 0; color: #a8b2be; font-size: 12px; line-height: 1.9; }
      h4 { display: flex; align-items: center; gap: 7px; margin: 0 0 13px; color: #c8d0d9; font-size: 12px; font-weight: 500; > svg { color: #8ba795; } }
      .workflowSection { margin-top: 24px; ol { display: grid; gap: 11px; list-style: none; margin: 0; padding: 0; > li { display: flex; align-items: baseline; gap: 10px; color: #9ca9b7; font-size: 11px; line-height: 1.8; > span { color: #5b7b69; font-size: 10px; font-variant-numeric: tabular-nums; } } } }
      .editableSection { margin-top: 22px; > div { display: flex; flex-wrap: wrap; gap: 7px; > span { color: #97a5b4; border: 1px solid #ffffff13; border-radius: 5px; padding: 4px 7px; font-size: 10px; } } }
      .customizationSection { margin-top: 24px; padding-top: 20px; border-top: 1px solid #ffffff10;
        .customizationHeading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px;
          > h4 { margin: 0; }
          > button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #00dc6930; border-radius: 6px; padding: 6px 8px; background: #00dc690a; color: #96d8b0; font: inherit; font-size: 10px; cursor: pointer; &:hover:not(:disabled) { background: #00dc6918; } &:disabled { cursor: default; opacity: .5; } }
        }
        > label { display: block; margin-top: 13px; color: #aab8c5; font-size: 11px; line-height: 1.7;
          > input, > textarea { display: block; width: 100%; min-width: 0; box-sizing: border-box; margin-top: 7px; padding: 10px 11px; border: 1px solid #3a4650; border-radius: 7px; background: #10161b; color: #d9e2ea; font: inherit; font-size: 12px; line-height: 1.8; outline: none; &:focus { border-color: #719780; } &:focus-visible { outline: 2px solid #00dc69; outline-offset: 2px; } &:disabled { opacity: .6; } }
          > textarea { resize: vertical; min-height: 100px; max-height: 400px; }
          > small { display: block; margin-top: 5px; color: #74818e; font-size: 10px; text-align: right; font-variant-numeric: tabular-nums; }
        }
        .customizationError { margin: 11px 0 0; color: #efb597; font-size: 11px; line-height: 1.8; }
      }
      .promptDetails { border-top: 1px solid #ffffff0d; border-bottom: 1px solid #ffffff0d; margin-top: 22px; > summary { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 13px 0; color: #9ba8b5; font-size: 11px; cursor: pointer; list-style: none; &::-webkit-details-marker { display: none; } } &[open] > summary > svg { transform: rotate(180deg); } .promptText { max-height: 190px; overflow-y: auto; color: #8f9dab; font-size: 11px; line-height: 1.9; > strong { color: #b1bdc8; font-weight: 500; } > p { white-space: pre-wrap; margin: 5px 0 14px; } } }
      .detailAction { margin-top: 21px; .creationNote { color: #8c9aa8; font-size: 11px; line-height: 1.8; margin: 0 0 14px; } .creationError { display: flex; gap: 7px; align-items: start; padding: 10px; border: 1px solid #a35c3b55; border-radius: 7px; background: #a35c3b10; color: #efb597; font-size: 11px; line-height: 1.8; > svg { flex-shrink: 0; margin-top: 2px; } }
        .useTemplate { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; min-height: 43px; border: 0; border-radius: 9px; background: #00dc69; color: #0a2416; font-size: 13px; font-weight: 600; cursor: pointer; &:hover:not(:disabled) { background: #38e78b; } &:disabled { cursor: default; color: #719e86; background: #244b36; } }
        .generationNote { display: block; margin-top: 10px; color: #73818f; font-size: 10px; line-height: 1.8; text-align: center; }
      }
    }
  }
}

:global(.templateLibraryDialog) { --el-dialog-bg-color: #171b20; --el-text-color-primary: #e4e9ef; --el-text-color-regular: #a6b2bf; --el-color-primary: #00dc69; padding: 25px; border: 1px solid #353d46; border-radius: 18px; box-shadow: 0 30px 100px #0007; }
:global(.templateLibraryDialog .el-dialog__header) { padding-bottom: 22px; }
:global(.templateLibraryDialog .el-dialog__body) { max-height: calc(88vh - 95px); overflow-y: auto; }
.loadingIcon { animation: templateSpin 1s linear infinite; }
@keyframes templateSpin { to { transform: rotate(360deg); } }
@media (max-width: 1150px) { .templateGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 25px 16px; } }
@media (max-width: 750px) {
  .templateLibrary { margin-top: 34px; padding-top: 26px; .libraryHeading { margin-bottom: 18px; h2 { font-size: 17px; } p { font-size: 10px; max-width: 190px; } } }
  .templateGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 12px; .templateCard { > strong { font-size: 12px; margin-top: 9px; } .cardMeta { gap: 4px; font-size: 9px; } .templateCover { border-radius: 10px; } } }
  .templateDetail .detailLayout { grid-template-columns: 1fr; gap: 24px; .detailArtwork { width: 100%; max-width: 380px; margin: 0 auto; } .detailContent h3 { font-size: 22px; } }
  :global(.templateLibraryDialog) { padding: 18px; }
  .libraryBrowse .categoryFilters { gap: 6px; > button { font-size: 11px; padding: 8px 10px; } }
}
@media (prefers-reduced-motion: reduce) { .templateGrid .templateCard .templateCover { img, &::after, .coverAction { transition: none; } } .loadingIcon { animation: none; } }
</style>
