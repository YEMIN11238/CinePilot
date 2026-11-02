<template>
  <el-dialog v-model="visible" title="确认创作简报" width="min(820px, calc(100vw - 28px))" top="5vh" appendToBody :closeOnClickModal="!busy" :closeOnPressEscape="!busy" :showClose="!busy" class="briefConfirmationDialog" @opened="focusHeading" @close="emit('clearError')">
    <template #header="{ titleId }">
      <div class="briefHeader"><span class="reviewStage"><icon-sparkles :size="14" />AI 整理 · 尚未确认</span><h2 :id="titleId" ref="heading" tabindex="-1">确认创作简报</h2><p>检查故事、人物和必须保留的内容。确认后，再起草剧本与分镜方案。</p></div>
    </template>
    <form v-if="draft" :id="formId" class="briefForm" :aria-busy="busy" novalidate @submit.prevent="confirmBrief">
      <div class="briefSpecs" aria-label="创作参数"><span>{{ style }}</span><span>{{ ratio }}</span><span>{{ duration }} 秒</span><small>返回首页可修改</small></div>
      <div v-if="referenceName" class="referenceNote"><icon-photo :size="17" /><div><strong>{{ referenceName }}</strong><span>用于后续画面参考，本次文字整理不识别图片内容。</span></div></div>
      <div class="briefField">
        <label :for="`${formId}Title`">项目名称</label>
        <input :id="`${formId}Title`" ref="titleInput" v-model="form.title" maxlength="120" :disabled="busy" :aria-invalid="Boolean(errors.title)" :aria-describedby="errors.title ? `${formId}TitleError` : undefined" @input="clearRequestError" />
        <p v-if="errors.title" :id="`${formId}TitleError`" class="fieldError">{{ errors.title }}</p>
      </div>
      <div class="briefField">
        <label :for="`${formId}Brief`">故事与创作目标<span>AI 整理，供你修改</span></label>
        <textarea :id="`${formId}Brief`" ref="briefInput" v-model="form.brief" rows="3" maxlength="10000" :disabled="busy" :aria-invalid="Boolean(errors.brief)" :aria-describedby="errors.brief ? `${formId}BriefError` : undefined" @input="clearRequestError" />
        <p v-if="errors.brief" :id="`${formId}BriefError`" class="fieldError">{{ errors.brief }}</p>
      </div>
      <div class="briefColumns">
        <div class="briefField">
          <label :for="`${formId}Characters`">角色设定<span>需要确认</span></label>
          <p v-if="draft.characters.question" :id="`${formId}CharactersQuestion`" class="followupQuestion"><icon-help-circle :size="15" />{{ draft.characters.question }}</p>
          <textarea :id="`${formId}Characters`" ref="charactersInput" v-model="form.characterConstraints" rows="4" maxlength="6000" placeholder="填写出场人物、关系与固定设定；没有人物请写“无人出镜”。" :disabled="busy" :aria-invalid="Boolean(errors.characters)" :aria-describedby="[draft.characters.question ? `${formId}CharactersQuestion` : '', errors.characters ? `${formId}CharactersError` : ''].filter(Boolean).join(' ') || undefined" @input="clearSuggestionError('characters')" />
          <p v-if="errors.characters" :id="`${formId}CharactersError`" class="fieldError">{{ errors.characters }}</p>
          <details v-if="draft.characters.suggestion" class="aiSuggestion"><summary>查看 AI 建议<icon-chevron-down :size="13" /></summary><p>{{ draft.characters.suggestion }}</p><button type="button" :disabled="busy" @click="adoptSuggestion('characters')"><icon-plus :size="13" />采用建议</button></details>
        </div>
        <div class="briefField">
          <label :for="`${formId}Invariants`">必须保留项<span>需要确认</span></label>
          <p v-if="draft.invariants.question && !noSpecialRequirements" :id="`${formId}InvariantsQuestion`" class="followupQuestion"><icon-help-circle :size="15" />{{ draft.invariants.question }}</p>
          <textarea :id="`${formId}Invariants`" ref="invariantsInput" v-model="form.invariants" rows="4" maxlength="4000" placeholder="哪些剧情、台词或设定不能改？" :disabled="busy || noSpecialRequirements" :aria-invalid="Boolean(errors.invariants)" :aria-describedby="[draft.invariants.question && !noSpecialRequirements ? `${formId}InvariantsQuestion` : '', errors.invariants ? `${formId}InvariantsError` : ''].filter(Boolean).join(' ') || undefined" @input="clearSuggestionError('invariants')" />
          <label class="noRequirements"><input v-model="noSpecialRequirements" type="checkbox" :disabled="busy" @change="clearSuggestionError('invariants')" /><span>无特殊要求，允许 AI 起草后由我确认</span></label>
          <p v-if="errors.invariants" :id="`${formId}InvariantsError`" class="fieldError">{{ errors.invariants }}</p>
          <details v-if="draft.invariants.suggestion && !noSpecialRequirements" class="aiSuggestion"><summary>查看 AI 建议<icon-chevron-down :size="13" /></summary><p>{{ draft.invariants.suggestion }}</p><button type="button" :disabled="busy" @click="adoptSuggestion('invariants')"><icon-plus :size="13" />采用建议</button></details>
        </div>
      </div>
      <p v-if="error" ref="requestError" class="requestError" role="alert"><icon-alert-circle :size="17" /><span>{{ error }}</span></p>
    </form>
    <template #footer>
      <div class="briefFooter"><span>{{ busy ? '正在起草，请稍候…' : '此步仅生成文字策划，图片和视频另行确认。' }}</span><div><button class="backButton" type="button" :disabled="busy" @click="editIdea"><icon-arrow-left :size="15" />返回修改</button><button class="confirmButton" type="submit" :form="formId" :disabled="busy || !draft"><icon-loader-2 v-if="busy" :size="16" class="loadingIcon" /><icon-check v-else :size="16" />{{ busy ? '正在生成策划…' : '确认并生成策划' }}</button></div></div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId, watch } from "vue";
import { IconAlertCircle, IconArrowLeft, IconCheck, IconChevronDown, IconHelpCircle, IconLoader2, IconPhoto, IconPlus, IconSparkles } from "@tabler/icons-vue";
import type { CreativeBriefDraft } from "@toonflow/server/directorBrief";

const props = withDefaults(defineProps<{ modelValue: boolean; draft: CreativeBriefDraft | null; busy: boolean; error: string; style: string; ratio: string; duration: number; referenceName?: string }>(), { referenceName: "" });
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  confirm: [value: { title: string; brief: string; characterConstraints: string; invariants: string }];
  editIdea: [];
  clearError: [];
}>();
const formId = useId();
const heading = ref<HTMLElement>();
const titleInput = ref<HTMLInputElement>();
const briefInput = ref<HTMLTextAreaElement>();
const charactersInput = ref<HTMLTextAreaElement>();
const invariantsInput = ref<HTMLTextAreaElement>();
const requestError = ref<HTMLElement>();
const form = reactive({ title: "", brief: "", characterConstraints: "", invariants: "" });
const attempted = ref(false);
const noSpecialRequirements = ref(false);
const suggestionErrors = reactive({ characters: "", invariants: "" });
const visible = computed({ get: () => props.modelValue, set: value => { if (!props.busy) emit("update:modelValue", value); } });
const errors = computed(() => ({
  title: attempted.value && !form.title.trim() ? "请填写项目名称。" : "",
  brief: attempted.value && !form.brief.trim() ? "请补充故事或创作目标。" : "",
  characters: suggestionErrors.characters || (attempted.value && !form.characterConstraints.trim() ? "请补充角色设定；没有人物请明确写“无人出镜”。" : ""),
  invariants: noSpecialRequirements.value ? "" : suggestionErrors.invariants || (attempted.value && !form.invariants.trim() ? "请填写必须保留项，或勾选无特殊要求。" : ""),
}));

watch(() => props.draft, draft => {
  if (!draft) return;
  form.title = draft.title;
  form.brief = draft.summary;
  form.characterConstraints = draft.characters.extracted;
  form.invariants = draft.invariants.extracted;
  noSpecialRequirements.value = false;
  attempted.value = false;
  suggestionErrors.characters = "";
  suggestionErrors.invariants = "";
}, { immediate: true });

watch(() => props.error, async error => {
  if (!error || !props.modelValue) return;
  await nextTick();
  requestError.value?.scrollIntoView({ block: "nearest" });
});

function focusHeading() { heading.value?.focus({ preventScroll: true }); }
function clearRequestError() { if (props.error) emit("clearError"); }
function clearSuggestionError(field: "characters" | "invariants") {
  suggestionErrors[field] = "";
  clearRequestError();
}

function adoptSuggestion(field: "characters" | "invariants") {
  if (props.busy || !props.draft) return;
  const value = props.draft[field].suggestion.trim();
  if (!value) return;
  const current = field === "characters" ? form.characterConstraints : form.invariants;
  const combined = current.includes(value) ? current : current.trim() ? `${current}${current.endsWith("\n") ? "" : "\n"}${value}` : value;
  const maxLength = field === "characters" ? 6000 : 4000;
  if (combined.length > maxLength) {
    suggestionErrors[field] = `追加建议后超过 ${maxLength} 字，原内容已保留。请精简后再采用。`;
    void nextTick(() => (field === "characters" ? charactersInput : invariantsInput).value?.focus());
    return;
  }
  if (field === "characters") form.characterConstraints = combined;
  else { form.invariants = combined; noSpecialRequirements.value = false; }
  clearSuggestionError(field);
  void nextTick(() => (field === "characters" ? charactersInput : invariantsInput).value?.focus());
}

function editIdea() {
  if (props.busy) return;
  emit("update:modelValue", false);
  emit("editIdea");
}

async function confirmBrief() {
  if (props.busy || !props.draft) return;
  attempted.value = true;
  const missing = errors.value.title ? titleInput : errors.value.brief ? briefInput : errors.value.characters ? charactersInput : errors.value.invariants ? invariantsInput : null;
  if (missing) { await nextTick(); missing.value?.focus(); return; }
  emit("confirm", {
    title: form.title.trim(),
    brief: form.brief.trim(),
    characterConstraints: form.characterConstraints.trim(),
    invariants: noSpecialRequirements.value ? "无特殊要求，允许 AI 起草后由用户确认。" : form.invariants.trim(),
  });
}
</script>

<style scoped lang="scss">
.briefHeader {
  .reviewStage { display: inline-flex; align-items: center; gap: 6px; color: #85cfa2; font-size: 11px; }
  h2 { margin: 12px 0 9px; color: #f0f3f4; font-size: 23px; line-height: 1.4; font-weight: 580; &:focus { outline: none; } }
  p { margin: 0; max-width: 610px; color: #939da7; font-size: 12px; line-height: 1.8; }
}
.briefForm {
  display: flex;
  flex-direction: column;
  gap: 20px;
  .briefSpecs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; > span { padding: 5px 9px; border: 1px solid #313a40; border-radius: 6px; color: #b9c6cd; background: #1e252a; font-size: 11px; } > small { color: #7e8991; font-size: 10px; margin-left: auto; } }
  .referenceNote { display: flex; gap: 9px; align-items: flex-start; border: 1px solid #343b42; border-radius: 9px; padding: 12px; background: #1a2025; > svg { flex-shrink: 0; color: #92a9a2; margin-top: 1px; } > div { min-width: 0; display: grid; gap: 5px; strong { color: #c5cdd4; font-size: 12px; font-weight: 500; overflow-wrap: anywhere; } span { color: #8e9aa4; font-size: 11px; line-height: 1.6; } } }
  .briefColumns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
  .briefField {
    min-width: 0;
    > label:not(.noRequirements) { display: flex; justify-content: space-between; align-items: baseline; gap: 9px; margin-bottom: 9px; color: #d3dbe1; font-size: 12px; font-weight: 500; > span { color: #77858f; font-size: 10px; font-weight: 400; } }
    > input, > textarea { display: block; width: 100%; box-sizing: border-box; border: 1px solid #3a424b; border-radius: 9px; outline: none; background: #111519; color: #dfe5e9; padding: 11px 12px; font: inherit; font-size: 12px; line-height: 1.8; transition: border-color .15s; &::placeholder { color: #65717b; } &:focus-visible { border-color: #00dc69; box-shadow: 0 0 0 2px #00dc6918; } &[aria-invalid="true"] { border-color: #ba7a51; } &:disabled { color: #6f7a83; background: #181c21; cursor: not-allowed; } }
    > textarea { resize: vertical; min-height: 100px; max-height: 300px; }
    .followupQuestion { display: flex; align-items: flex-start; gap: 6px; color: #c4b58e; font-size: 11px; line-height: 1.7; margin: -1px 0 9px; > svg { flex-shrink: 0; margin-top: 2px; } }
    .fieldError { color: #e5b18e; font-size: 11px; line-height: 1.6; margin: 7px 0 0; }
    .noRequirements { display: flex; gap: 7px; align-items: flex-start; margin-top: 10px; cursor: pointer; color: #9ca8b1; font-size: 11px; line-height: 1.7; > input { flex-shrink: 0; accent-color: #00dc69; width: 13px; height: 13px; margin: 3px 0 0; } }
    .aiSuggestion { margin-top: 10px; padding: 0 10px; border-radius: 8px; background: #1d2723; border: 1px solid #2d3c33; > summary { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 0; cursor: pointer; color: #92bba4; list-style: none; font-size: 11px; &::-webkit-details-marker { display: none; } &:focus-visible { outline: 2px solid #00dc69; outline-offset: 3px; } } &[open] > summary > svg { transform: rotate(180deg); } > p { white-space: pre-wrap; overflow-wrap: anywhere; color: #aabfb2; font-size: 11px; line-height: 1.9; margin: 0 0 9px; } > button { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #41664e; border-radius: 6px; padding: 5px 8px; margin-bottom: 10px; background: #243d2d; color: #afd4b9; font: inherit; font-size: 11px; cursor: pointer; &:hover:not(:disabled) { background: #2c4b37; } &:disabled { opacity: .5; cursor: not-allowed; } } }
  }
  .requestError { display: flex; align-items: flex-start; gap: 8px; margin: 0; border: 1px solid #71513e; border-radius: 9px; background: #2a221d; padding: 12px; color: #deb393; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; > svg { flex-shrink: 0; margin-top: 2px; } }
}
.briefFooter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  border-top: 1px solid #ffffff0d;
  padding-top: 18px;
  text-align: left;
  > span { color: #82909a; font-size: 10px; line-height: 1.7; }
  > div { display: flex; align-items: center; gap: 9px; margin-left: auto; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 39px; padding: 9px 14px; border: 1px solid transparent; border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer; &:disabled { opacity: .5; cursor: not-allowed; } &:focus-visible { outline: 2px solid #00dc69; outline-offset: 3px; } }
  .backButton { color: #b5c0c8; border-color: #3d464e; background: #20262c; &:hover:not(:disabled) { background: #29313a; } }
  .confirmButton { color: #082d17; background: #00dc69; font-weight: 550; &:hover:not(:disabled) { background: #25eb82; } }
}
:global(.briefConfirmationDialog) { --el-dialog-bg-color: #171b20; --el-text-color-primary: #e4e9ef; --el-text-color-regular: #a6b2bf; --el-color-primary: #00dc69; display: flex; flex-direction: column; max-height: 90vh; box-sizing: border-box; background: #171b20; padding: 26px; border: 1px solid #353d46; border-radius: 18px; box-shadow: 0 30px 100px #0008; }
:global(.briefConfirmationDialog .el-dialog__header) { flex-shrink: 0; padding-bottom: 22px; margin-right: 0; }
:global(.briefConfirmationDialog .el-dialog__body) { min-height: 0; max-height: calc(80vh - 200px); overflow-y: auto; padding: 1px 3px; }
:global(.briefConfirmationDialog .el-dialog__footer) { flex-shrink: 0; padding-top: 20px; }
.loadingIcon { animation: briefSpin 1s linear infinite; }
@keyframes briefSpin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .briefHeader { h2 { font-size: 21px; } p { font-size: 11px; } }
  .briefForm { gap: 17px; .briefColumns { grid-template-columns: 1fr; gap: 20px; } .briefSpecs > small { width: 100%; margin: 1px 0 0; } }
  .briefFooter { gap: 10px; > div { width: 100%; margin-left: 0; } .backButton { flex: 1; } .confirmButton { flex: 1.4; } }
  :global(.briefConfirmationDialog) { padding: 20px 17px; }
  :global(.briefConfirmationDialog .el-dialog__body) { max-height: calc(80vh - 220px); }
}
@media (prefers-reduced-motion: reduce) { .loadingIcon { animation: none; } }
</style>
