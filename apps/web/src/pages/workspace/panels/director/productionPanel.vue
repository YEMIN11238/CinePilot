<template>
  <section class="productionPanel" aria-label="漫剧制作流程">
    <header class="productionHeading"><div><span class="eyebrow">PRODUCTION DESK</span><h2>先确认故事，再制作镜头</h2><p>剧本、角色与审片记录都跟随项目保存。</p></div><span v-if="workflow" class="episodeLabel">第 {{ workflow.episode }} 集 · {{ project.shots.length }} 镜</span></header>
    <nav class="productionTabs" aria-label="制作阶段"><button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: activeTab === tab.id }" :aria-pressed="activeTab === tab.id" @click="activeTab = tab.id"><span>{{ tab.number }}</span>{{ tab.label }}</button></nav>
    <p v-if="error" class="panelMessage errorMessage" role="alert">{{ error }}<button type="button" @click="error = ''" aria-label="关闭错误">×</button></p>
    <p v-if="notice" class="panelMessage" role="status">{{ notice }}</p>
    <div v-if="!workflow" class="legacyNotice"><h3>这个项目保留原有短片流程</h3><p>新建漫剧项目后，可以在这里管理剧本确认、角色档案与审片交付。当前素材和版本仍可在分镜画布中编辑。</p></div>
    <div v-else class="productionBody">
      <section v-if="activeTab === 'script'" class="scriptStage">
        <p v-if="scriptConflict" class="panelMessage errorMessage">剧本已有新版本，当前未保存内容仍保留。<button type="button" @click="resetScript">载入当前版本</button></p>
        <div class="sectionHeading"><div><h3>剧本 <span v-if="script">V{{ script.number }}</span></h3><p>{{ script?.confirmedAt ? '当前版本已确认。继续修改会保存为新版本，已有素材保留并等待复查。' : '确认场景、人物行动与对白归属后，再进入分镜。' }}</p></div><span class="stateBadge" :class="{ confirmed: script?.confirmedAt }">{{ script?.confirmedAt ? '已确认' : '待审阅' }}</span></div>
        <fieldset :disabled="blocked" class="editorFields">
          <label>一句话故事<el-input v-model="scriptDraft.logline" type="textarea" :rows="2" maxlength="2000" placeholder="本集主角想完成什么，遇到什么阻碍？" /></label>
          <article v-for="(scene, index) in scriptDraft.scenes" :key="scene.id" class="sceneCard">
            <div class="sceneHeading"><span>场景 {{ String(index + 1).padStart(2, '0') }}</span><button type="button" class="textButton" :disabled="scriptDraft.scenes.length < 2" @click="scriptDraft.scenes.splice(index, 1)">移除场景</button></div>
            <div class="fieldRow"><label>场景名称<el-input v-model="scene.title" maxlength="120" /></label><label>地点与时间<el-input v-model="scene.location" maxlength="500" /></label></div>
            <div class="sceneReferenceEditor"><studioThumbnail v-if="sceneReferenceDrafts[scene.id]" :directory="directory" :path="sceneReferenceDrafts[scene.id]!.path" :mimeType="sceneReferenceDrafts[scene.id]!.mimeType" :label="`${scene.title}场景参考图`" /><div><strong>场景视觉参考</strong><p>{{ sceneUsage(scene.id) }}</p><button class="secondaryButton" type="button" :disabled="blocked || scriptDirty || !script?.scenes.some(item => item.id === scene.id)" @click="chooseSceneReference(scene.id)">{{ sceneReferenceDrafts[scene.id] ? '替换参考图' : '上传参考图' }}</button><p v-if="scriptDirty" class="hintText">先保存当前剧本，再绑定场景参考图。</p><template v-if="sceneReferenceDrafts[scene.id]"><label class="rightsField">素材来源<select v-model="sceneReferenceDrafts[scene.id]!.rights" :aria-label="`${scene.title}参考图来源`"><option value="unverified">待核验</option><option value="owned">自行创作／拥有权利</option><option value="licensed">已取得使用授权</option></select></label><button class="primaryButton" type="button" :disabled="blocked || !sceneReferenceDirty(scene.id)" @click="saveSceneReference(scene.id)">保存场景参考</button><button class="textButton" type="button" :disabled="blocked" @click="saveSceneReference(scene.id, true)">移除参考图</button></template></div></div>
            <label>人物行动<el-input v-model="scene.action" type="textarea" :rows="3" maxlength="6000" /></label>
            <div v-for="(line, lineIndex) in scene.dialogues" :key="lineIndex" class="dialogueRow"><select v-model="line.speakerId" aria-label="对白说话人"><option value="" disabled>选择说话人</option><option v-for="character in workflow.characters" :key="character.id" :value="character.id">{{ character.name }}</option></select><el-input v-model="line.text" maxlength="1000" placeholder="对白内容" /><button type="button" class="removeButton" aria-label="删除此句对白" @click="scene.dialogues.splice(lineIndex, 1)">×</button></div>
            <button type="button" class="textButton" @click="scene.dialogues.push({ speakerId: workflow.characters[0]?.id || '', text: '' })">＋ 添加对白</button>
          </article>
          <button type="button" class="secondaryButton" :disabled="scriptDraft.scenes.length >= 24" @click="addScene">＋ 添加场景</button>
        </fieldset>
        <div class="stageActions"><button class="primaryButton" type="button" :disabled="blocked || !scriptDirty || scriptConflict" @click="saveScript">{{ pending === 'saveScript' ? '正在保存…' : '保存为新版本' }}</button><button class="secondaryButton" type="button" :disabled="blocked || scriptDirty || scriptConflict || !!script?.confirmedAt" @click="confirmScript">确认剧本 V{{ script?.number }}</button><button v-if="scriptDirty" class="textButton" type="button" :disabled="blocked" @click="resetScript">撤销未保存修改</button><span v-if="scriptDirty">有未保存修改</span></div>
        <details v-if="workflow.scriptVersions.length > 1" class="historyDetails"><summary>剧本版本记录 · {{ workflow.scriptVersions.length }}</summary><div v-for="version in [...workflow.scriptVersions].reverse()" :key="version.id"><strong>V{{ version.number }} · {{ version.confirmedAt ? '已确认' : '草稿' }}</strong><p>{{ version.logline }}</p><small>{{ formatTime(version.createdAt) }} · {{ version.scenes.length }} 个场景</small></div></details>
      </section>

      <section v-else-if="activeTab === 'characters'" class="characterStage">
        <div class="sectionHeading"><div><h3>角色档案</h3><p>固定外貌与服装分别维护。修改档案后，需要重新确认角色及相关分镜。</p></div><span class="stateBadge" :class="{ confirmed: charactersConfirmed }">{{ confirmedCharacterCount }}/{{ workflow.characters.length }} 已确认</span></div>
        <div class="characterLayout"><aside class="characterList"><button v-for="character in workflow.characters" :key="character.id" :class="{ active: character.id === characterId }" type="button" @click="selectCharacter(character.id)"><span class="characterInitial">{{ character.name.slice(0, 1) }}</span><span><strong>{{ character.name }}</strong><small>V{{ character.revision }} · {{ character.confirmedAt ? '已确认' : '待确认' }}</small></span></button></aside>
          <fieldset class="characterEditor editorFields" :disabled="blocked">
            <div class="referenceEditor"><studioThumbnail v-if="characterDraft.referenceImage" :directory="directory" :path="characterDraft.referenceImage.path" :mimeType="characterDraft.referenceImage.mimeType" label="角色参考图" /><div v-else class="referenceEmpty">角色参考图</div><div><h4>{{ characterDraft.name || '角色档案' }}</h4><button class="secondaryButton" type="button" @click="referenceInput?.click()">{{ characterDraft.referenceImage ? '更换参考图' : '上传参考图' }}</button><button v-if="characterDraft.referenceImage" class="textButton" type="button" @click="delete characterDraft.referenceImage">移除参考图</button><p>媒体生成需要角色参考图及明确的来源授权。</p><label v-if="characterDraft.referenceImage" class="rightsField">素材来源<select v-model="characterDraft.referenceImage.rights"><option value="unverified">待核验</option><option value="owned">自行创作／拥有权利</option><option value="licensed">已取得使用授权</option></select></label></div></div>
            <div class="fieldRow"><label>角色名称<el-input v-model="characterDraft.name" maxlength="80" /></label><label>固定外貌<el-input v-model="characterDraft.appearance" type="textarea" :rows="2" maxlength="2000" /></label></div>
            <div class="fieldRow"><label>服装设定<el-input v-model="characterDraft.costume" type="textarea" :rows="2" maxlength="2000" /></label><label>道具<el-input v-model="characterDraft.props" type="textarea" :rows="2" maxlength="1000" /></label></div>
            <p class="referenceUsage">{{ characterUsage(characterDraft.id) }}</p>
            <label>声线设定（对白音频在声音轨导入）<el-input v-model="characterDraft.voice" maxlength="1000" placeholder="如声线、语速、口音，仅记录设定" /></label><label>人物目标与动机<el-input v-model="characterDraft.goal" type="textarea" :rows="2" maxlength="2000" /></label><label>人物已知事实<el-input v-model="characterDraft.knownFacts" type="textarea" :rows="3" maxlength="3000" /></label>
            <button class="primaryButton" type="button" :disabled="!characterDirty" @click="saveCharacter">{{ pending === 'saveCharacter' ? '正在保存…' : '保存角色修改' }}</button>
          </fieldset>
        </div>
        <input ref="referenceInput" class="fileInput" type="file" accept="image/*" @change="uploadReference" />
        <div class="stageActions"><button class="primaryButton" type="button" :disabled="blocked || characterDirty || charactersConfirmed || !script?.confirmedAt" @click="confirmCharacters">确认全部角色</button><button v-if="characterDirty" class="textButton" type="button" :disabled="blocked" @click="selectCharacter(characterId)">撤销当前角色修改</button><span v-if="characterDirty">请先保存当前角色修改</span><span v-else-if="!script?.confirmedAt">请先确认当前剧本版本</span></div>
      </section>

      <section v-else class="reviewStage">
        <div class="sectionHeading"><div><h3>分镜确认与审片交付</h3><p>先做单镜小样，通过人工审片后再扩大生成范围。</p></div><button class="secondaryButton" type="button" @click="emit('configure')">模型配置</button></div>
        <div class="workflowCard"><div><h4>分镜制作</h4><p>{{ storyboardMessage }}</p></div><div class="inlineActions"><button class="secondaryButton" type="button" :disabled="blocked || !planningReady || !!project.shots.length" @click="createStoryboard">{{ pending === 'storyboard' ? '正在生成分镜…' : '从已确认内容生成分镜' }}</button><button class="primaryButton" type="button" :disabled="blocked || !planningReady || !project.shots.length || boardCurrent" @click="confirmStoryboard">确认当前分镜</button></div></div>
        <details class="bindingDetails"><summary>逐镜检查剧情绑定与首尾状态 <span>{{ project.shots.length }} 镜</span></summary><div class="bindingList"><button v-for="shot in project.shots" :key="shot.id" type="button" :class="{ active: shot.id === bindingShotId }" @click="selectBinding(shot.id)">{{ String(shot.order).padStart(2, '0') }} {{ shotVersion(shot).title }}</button></div><fieldset v-if="bindingShot" class="bindingEditor editorFields" :disabled="blocked || bindingShot.locked"><div class="fieldRow"><label>所属场景<select v-model="bindingDraft.sceneId"><option value="" disabled>选择场景</option><option v-for="scene in script?.scenes || []" :key="scene.id" :value="scene.id">{{ scene.title }}</option></select></label><div class="characterChoices"><span>出场角色</span><label v-for="character in workflow.characters" :key="character.id"><input v-model="bindingDraft.characterIds" type="checkbox" :value="character.id" />{{ character.name }}</label></div></div><div class="fieldRow"><label>镜头开始状态<el-input v-model="bindingDraft.startState" type="textarea" :rows="2" maxlength="3000" /></label><label>镜头结束状态<el-input v-model="bindingDraft.endState" type="textarea" :rows="2" maxlength="3000" /></label></div><div v-for="(line, index) in bindingDraft.dialogues" :key="index" class="dialogueRow"><select v-model="line.speakerId" aria-label="镜头对白说话人"><option value="" disabled>选择说话人</option><option v-for="character in workflow.characters" :key="character.id" :value="character.id">{{ character.name }}</option></select><el-input v-model="line.text" maxlength="1000" /><button class="removeButton" type="button" aria-label="删除镜头对白" @click="bindingDraft.dialogues.splice(index, 1)">×</button></div><div class="inlineActions"><button type="button" class="textButton" @click="bindingDraft.dialogues.push({ speakerId: bindingDraft.characterIds[0] || '', text: '' })">＋ 添加镜头对白</button><button type="button" class="primaryButton" :disabled="!bindingDirty" @click="saveBinding">保存镜头绑定新版本</button><button v-if="bindingDirty" class="textButton" type="button" @click="selectBinding(bindingShotId)">重新载入当前绑定</button></div><p>绑定或首尾状态改变后，需要复查当前镜头。旧版本及素材仍保留。</p></fieldset><p v-if="bindingShot?.locked" class="hintText">该镜头已锁定，请在镜头属性中解锁后编辑。</p></details>
        <div v-if="project.shots.length" class="reviewLayout"><aside class="reviewShotList"><button v-for="shot in project.shots" :key="shot.id" type="button" :class="{ active: shot.id === reviewShotId }" @click="selectReviewShot(shot.id)"><span>{{ String(shot.order).padStart(2, '0') }}</span><div><strong>{{ shotVersion(shot).title }}</strong><small>{{ reviewStatus(shot) }}</small></div></button></aside><div v-if="reviewShot && reviewVersion" class="reviewEditor"><div class="reviewMedia"><mediaPreview :directory="directory" :path="reviewVersion.clip?.path || reviewVersion.keyframe?.path" :mimeType="reviewVersion.clip?.mimeType || reviewVersion.keyframe?.mimeType" label="此版本尚无素材，可先生成单镜小样" /></div><div class="candidateHeading"><label>查看候选<select v-model="reviewVersionId"><option v-for="version in [...reviewShot.versions].reverse()" :key="version.id" :value="version.id">V{{ version.number }} · {{ version.reason }}{{ version.id === reviewShot.currentVersionId ? ' · 已用于成片' : ' · 候选未采用' }}</option></select></label><button v-if="reviewVersion.id !== reviewShot.currentVersionId" class="secondaryButton" type="button" :disabled="blocked || !!adoptionIssue" :title="adoptionIssue" @click="useCandidate">采用为成片镜头</button><button class="textButton" type="button" @click="emit('selectShot', reviewShot.id)">查看镜头详情 ↗</button></div><p class="candidateState" :class="{ adopted: reviewingAdopted }">{{ reviewingAdopted ? `V${reviewVersion.number} 已用于成片` : `正在查看候选 V${reviewVersion.number} · 成片仍使用 V${shotVersion(reviewShot).number}` }}</p><p v-if="!reviewingAdopted && adoptionIssue" class="hintText">{{ adoptionIssue }}</p><div class="sampleActions"><button class="primaryButton" type="button" :disabled="blocked || !!sampleIssue" :title="sampleIssue" @click="emit('generate', [reviewShot.id], sampleStage, reviewVersion.id)">生成此版本小样</button><select v-model="sampleStage" aria-label="小样生成阶段"><option value="video">视频</option><option value="image">关键帧</option><option value="all">关键帧与视频</option></select><button class="secondaryButton" type="button" :disabled="blocked || reviewShot.locked || !shotVersion(reviewShot).keyframe" :title="!shotVersion(reviewShot).keyframe ? '请先为成片中的此镜头生成或导入关键帧' : '创建候选不会改变成片'" @click="newCandidate('video')">新增视频候选</button><button class="textButton" type="button" :disabled="blocked || reviewShot.locked" @click="newCandidate('image')">重做关键帧候选</button></div><p v-if="sampleIssue" class="hintText">{{ sampleIssue }}</p><p class="hintText">新增候选和生成结果都不会自动替换成片。比较后点击「采用为成片镜头」，再完成分镜确认与人工审片。</p><fieldset class="reviewChecks" :disabled="blocked || !reviewingAdopted"><legend>成片版本人工审片</legend><p v-if="!reviewingAdopted" class="hintText">先采用此候选，再为成片版本记录审片结果。</p><p v-if="latestReview(reviewShot.id, reviewVersion.id)?.decision === 'stale'" class="hintText">待复查原因 · {{ latestReview(reviewShot.id, reviewVersion.id)?.note }}</p><label v-for="check in checkLabels" :key="check.key"><input v-model="reviewChecks[check.key]" type="checkbox" />{{ check.label }}</label><el-input v-model="reviewNote" type="textarea" :rows="2" maxlength="3000" placeholder="记录通过依据或需要返工的具体问题" /><div class="inlineActions"><button class="primaryButton" type="button" :disabled="!reviewVersion.clip || !allChecks || reviewVersion.id !== reviewShot.currentVersionId" @click="submitReview('approved')">记录审片通过</button><button class="secondaryButton" type="button" :disabled="!reviewVersion.clip || !reviewNote.trim() || reviewVersion.id !== reviewShot.currentVersionId" @click="submitReview('rejected')">退回修改</button></div></fieldset></div></div>
        <div class="workflowCard batchCard"><div><h4>批量范围</h4><p>{{ approvedSample ? '已有当前版本小样通过审片，可选择需要制作的镜头。' : '先完成一个视频小样并通过人工审片，再批量生成。' }}</p></div><div class="batchChoices"><label v-for="shot in project.shots" :key="shot.id"><input v-model="batchShotIds" type="checkbox" :value="shot.id" :disabled="blocked || shot.locked" />镜头 {{ shot.order }}</label></div><button class="primaryButton" type="button" :disabled="blocked || !!batchIssue" :title="batchIssue" @click="emit('generate', batchShotIds, sampleStage)">生成所选 {{ batchShotIds.length }} 镜</button><p v-if="batchIssue" class="hintText">{{ batchIssue }}</p></div>
        <div class="deliveryCard"><div><h4>交付检查</h4><p>每个当前镜头都需要视频与通过记录。资产清单保留来源、版本和使用记录。</p></div><label class="audioChoice"><input type="checkbox" :checked="Boolean(project.originalAudio)" :disabled="blocked" @change="saveAudio" />成片保留原视频声音</label><ul v-if="deliveryIssues.length" class="issueList"><li v-for="(issue, index) in deliveryIssues" :key="index">{{ issue }}</li></ul><p v-else class="readyText">当前镜头素材和人工审片记录齐备，可预览并导出。</p><div class="inlineActions"><button class="secondaryButton" type="button" :disabled="blocked || !project.shots.length" @click="emit('preview')">预览短片</button><button class="primaryButton" type="button" :disabled="blocked" @click="downloadManifest">{{ pending === 'manifest' ? '正在保存…' : '下载资产清单' }}</button></div></div>
      </section>
    </div>
    <input ref="sceneReferenceInput" class="fileInput" type="file" accept="image/*" @change="uploadSceneReference" />
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import type { DirectorProject, DirectorShot, ProductionCharacter, ProductionReview, ProductionScene, ProductionReference, ShotVersion } from "@toonflow/server/directorTypes";
import { directorGenerationContext, directorReviewContext } from "@toonflow/server/directorReview";
import saveFile from "@/lib/saveFile";
import { directorError, directorRequest, uploadDirectorFile } from "./api";
import mediaPreview from "./mediaPreview.vue";
import studioThumbnail from "./studioThumbnail.vue";

const props = defineProps<{ project: DirectorProject; directory: string; aiSelection: string; busy: boolean }>();
const emit = defineEmits<{ updated: [project: DirectorProject]; selectShot: [id: string]; generate: [shotIds: string[], stage: "image" | "video" | "all", versionId?: string]; preview: []; configure: []; busyChange: [busy: boolean] }>();
const tabs = [{ id: "script", number: "01", label: "剧本" }, { id: "characters", number: "02", label: "角色" }, { id: "review", number: "03", label: "分镜与审片" }] as const;
const activeTab = ref<(typeof tabs)[number]["id"]>("script");
const pending = ref("");
const error = ref("");
const notice = ref("");
const lifetime = new AbortController();
const workflow = computed(() => props.project.production);
const script = computed(() => workflow.value?.scriptVersions.find(version => version.id === workflow.value?.currentScriptVersionId));
const blocked = computed(() => props.busy || !!pending.value);
const scriptDraft = reactive<{ logline: string; scenes: ProductionScene[] }>({ logline: "", scenes: [] });
const savedScriptDraft = ref("");
const scriptDirty = computed(() => JSON.stringify(scriptDraft) !== savedScriptDraft.value);
const scriptConflict = ref(false);
const scriptSourceId = ref("");
const characterId = ref("");
type CharacterDraft = Omit<ProductionCharacter, "revision" | "confirmedAt"> & { voice?: string };
const characterDraft = reactive<CharacterDraft>({ id: "", name: "", appearance: "", costume: "", props: "", goal: "", knownFacts: "" });
const savedCharacterDraft = ref(JSON.stringify(characterDraft));
const characterBaseRevision = ref(0);
const characterDirty = computed(() => JSON.stringify(characterDraft) !== savedCharacterDraft.value);
const referenceInput = ref<HTMLInputElement>();
const sceneReferenceInput = ref<HTMLInputElement>();
const sceneReferenceId = ref("");
const sceneReferenceDrafts = reactive<Record<string, ProductionReference>>({});
const sceneReferenceSaved = reactive<Record<string, string>>({});
function sceneReferenceDirty(sceneId: string) { return JSON.stringify(sceneReferenceDrafts[sceneId] || null) !== (sceneReferenceSaved[sceneId] || "null"); }
function sceneUsage(sceneId: string) { const orders = props.project.shots.filter(shot => shotVersion(shot).sceneId === sceneId).map(shot => shot.order); return orders.length ? `已用于第 ${orders.join("、")} 镜` : "尚未被镜头引用"; }
function characterUsage(id: string) { const orders = props.project.shots.filter(shot => shotVersion(shot).characterIds?.includes(id)).map(shot => shot.order); return orders.length ? `角色已用于第 ${orders.join("、")} 镜` : "角色尚未被镜头引用"; }
function chooseSceneReference(sceneId: string) { sceneReferenceId.value = sceneId; sceneReferenceInput.value?.click(); }
async function uploadSceneReference(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = "";
  if (!file || blocked.value) return;
  const target = props.directory; const id = sceneReferenceId.value;
  pending.value = "uploadSceneReference"; error.value = "";
  try {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    const asset = await uploadDirectorFile(target, file);
    if (target === props.directory) { sceneReferenceDrafts[id] = { ...asset, rights: "unverified" }; notice.value = "场景参考图已上传，请选择来源并保存。"; }
  } catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pending.value = ""; }
}
async function saveSceneReference(sceneId: string, remove = false) {
  const referenceImage = remove ? null : sceneReferenceDrafts[sceneId];
  if (!remove && !referenceImage) return;
  if (await requestProject("sceneReference", { sceneId, referenceImage })) {
    if (remove) delete sceneReferenceDrafts[sceneId];
    sceneReferenceSaved[sceneId] = JSON.stringify(referenceImage || null);
    notice.value = remove ? "场景参考已移除，原素材文件保留。" : "场景参考已保存；相关镜头需要复查。";
  }
}
const confirmedCharacterCount = computed(() => workflow.value?.characters.filter(character => character.confirmedAt).length || 0);
const charactersConfirmed = computed(() => !!workflow.value?.characters.length && confirmedCharacterCount.value === workflow.value.characters.length);
const planningReady = computed(() => !!script.value?.confirmedAt && charactersConfirmed.value);
const boardCurrent = computed(() => {
  const board = workflow.value?.storyboard;
  return !!board && planningReady.value && board.scriptVersionId === script.value?.id && workflow.value!.characters.every(character => board.characterRevisions.some(item => item.id === character.id && item.revision === character.revision)) && props.project.shots.every(shot => board.shotVersions.some(item => item.shotId === shot.id && item.versionId === shot.currentVersionId));
});
const storyboardMessage = computed(() => !script.value?.confirmedAt ? "请先确认当前剧本。" : !charactersConfirmed.value ? "请先确认角色档案。" : boardCurrent.value ? "当前剧本、角色与镜头版本已确认。" : props.project.shots.length ? "已有分镜请使用逐镜检查与编辑，前序内容变化后需要重新确认。" : "剧本和角色已确认，可以开始生成分镜。");
const bindingShotId = ref("");
const bindingShot = computed(() => props.project.shots.find(shot => shot.id === bindingShotId.value));
const bindingDraft = reactive({ sceneId: "", characterIds: [] as string[], startState: "", endState: "", dialogues: [] as { speakerId: string; text: string }[] });
const savedBindingDraft = ref("");
const bindingDirty = computed(() => JSON.stringify(bindingDraft) !== savedBindingDraft.value);
const bindingBaseVersionId = ref("");
const reviewShotId = ref("");
const reviewShot = computed(() => props.project.shots.find(shot => shot.id === reviewShotId.value));
const reviewVersionId = ref("");
const reviewVersion = computed(() => reviewShot.value?.versions.find(version => version.id === reviewVersionId.value));
const reviewingAdopted = computed(() => !!reviewVersion.value && reviewVersion.value.id === reviewShot.value?.currentVersionId);
const adoptionIssue = computed(() => {
  const version = reviewVersion.value;
  if (!version) return "请选择候选";
  if (reviewShot.value?.locked) return "镜头已锁定，请先解锁";
  if (version.candidateStage === "video" && !version.clip) return "此候选尚无视频结果，请先生成。显示的关键帧仅作参考，成片仍保留旧版本";
  if (version.candidateStage === "image" && !version.keyframe) return "此候选尚无图片结果，请先生成；成片仍保留旧版本";
  return !version.clip && !version.keyframe ? "请先为此候选生成或导入素材" : "";
});
const reviewNote = ref("");
const reviewChecks = reactive<ProductionReview["checks"]>({ visual: false, continuity: false, audio: false, subtitles: false, rights: false });
const checkLabels: { key: keyof ProductionReview["checks"]; label: string }[] = [{ key: "visual", label: "画面可用" }, { key: "continuity", label: "角色与剧情连续" }, { key: "audio", label: "声音已检查" }, { key: "subtitles", label: "字幕已检查" }, { key: "rights", label: "来源与授权已核验" }];
const allChecks = computed(() => Object.values(reviewChecks).every(Boolean));
const sampleStage = ref<"image" | "video" | "all">("video");
const batchShotIds = ref<string[]>([]);
const approvedSample = computed(() => props.project.shots.some(shot => {
  const review = latestReview(shot.id, shot.currentVersionId);
  return !!shotVersion(shot).clip && review?.decision === "approved" && review.generationContextKey === directorGenerationContext(props.project);
}));
const sampleIssue = computed(() => reviewShot.value && reviewVersion.value ? generationIssue([reviewShot.value], reviewVersion.value) : "请选择一个镜头和候选版本");
const batchIssue = computed(() => !approvedSample.value ? "当前模型与画幅配置尚无已批准小样，请完成或重新记录小样审片" : !batchShotIds.value.length ? "请选择批量生成范围" : generationIssue(props.project.shots.filter(shot => batchShotIds.value.includes(shot.id))));
const deliveryIssues = computed(() => {
  const issues: string[] = [];
  if (!boardCurrent.value) issues.push("当前分镜尚未确认，或前序内容变化后待复查");
  for (const shot of props.project.shots) {
    if (!shotVersion(shot).clip) issues.push(`镜头 ${shot.order} 缺少视频素材`);
    if (latestReview(shot.id, shot.currentVersionId)?.decision !== "approved") issues.push(`镜头 ${shot.order} 当前版本未通过人工审片`);
  }
  if (!props.project.shots.length) issues.push("尚未生成分镜");
  const failed = props.project.tasks.filter(task => task.status === "failed" || task.status === "interrupted" || task.status === "verificationRequired");
  for (const task of failed.slice(-3)) issues.push(`${task.stage === "export" ? "导出" : "素材"}任务${task.status === "failed" ? "失败" : task.status === "verificationRequired" ? "上游待核对" : "中断"}：${task.error || "请在执行记录查看详情"}`);
  return issues;
});

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function shotVersion(shot: DirectorShot): ShotVersion { return shot.versions.find(version => version.id === shot.currentVersionId)!; }
function latestReview(shotId: string, versionId: string) { const review = [...(workflow.value?.reviews || [])].reverse().find(item => item.shotId === shotId && item.versionId === versionId); return review?.decision === "approved" && review.contextKey !== directorReviewContext(props.project, shotId) ? { ...review, decision: "stale" as const, note: "制作配置或关联内容已变化，请重新审片" } : review; }
function reviewStatus(shot: DirectorShot) {
  const review = latestReview(shot.id, shot.currentVersionId);
  return review?.decision === "approved" ? "审片通过" : review?.decision === "rejected" ? "退回修改" : shotVersion(shot).clip ? "视频待审片" : shotVersion(shot).keyframe ? "关键帧已就绪" : "待制作";
}
function formatTime(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function resetScript() {
  scriptDraft.logline = script.value?.logline || "";
  scriptDraft.scenes = copy(script.value?.scenes || []);
  savedScriptDraft.value = JSON.stringify(scriptDraft);
  scriptSourceId.value = script.value?.id || "";
  scriptConflict.value = false;
}
function selectCharacter(id: string) {
  if (characterDirty.value && characterId.value !== id) { error.value = "当前角色有未保存修改，请先保存后再切换。"; return; }
  characterId.value = id;
  const character = workflow.value?.characters.find(item => item.id === id);
  if (!character) return;
  const { revision, confirmedAt, ...fields } = character;
  characterBaseRevision.value = revision;
  delete characterDraft.referenceImage;
  delete characterDraft.voice;
  Object.assign(characterDraft, copy(fields));
  savedCharacterDraft.value = JSON.stringify(characterDraft);
}
function selectBinding(id: string) {
  if (bindingDirty.value && bindingShotId.value !== id) { error.value = "当前镜头绑定有未保存修改，请先保存后再切换。"; return; }
  bindingShotId.value = id;
  const shot = props.project.shots.find(item => item.id === id);
  if (!shot) return;
  const version = shotVersion(shot);
  bindingBaseVersionId.value = version.id;
  Object.assign(bindingDraft, { sceneId: version.sceneId || "", characterIds: copy(version.characterIds || []), startState: version.startState || "", endState: version.endState || "", dialogues: copy(version.dialogues || []) });
  savedBindingDraft.value = JSON.stringify(bindingDraft);
}
function selectReviewShot(id: string) { reviewShotId.value = id; reviewVersionId.value = props.project.shots.find(shot => shot.id === id)?.currentVersionId || ""; }
function generationIssue(shots: DirectorShot[], selectedVersion?: ShotVersion) {
  if (!boardCurrent.value) return "请先确认剧本、角色与当前分镜版本";
  const targets = shots.map(shot => ({ shot, version: selectedVersion || shotVersion(shot) }));
  const imageNeeded = (sampleStage.value === "image" || sampleStage.value === "all") && targets.some(({ version }) => !version.keyframe);
  const videoNeeded = (sampleStage.value === "video" || sampleStage.value === "all") && targets.some(({ version }) => !version.clip);
  if (!imageNeeded && !videoNeeded) return "所选版本已有素材。如需重做，请先新增候选";
  if (imageNeeded && !props.project.models.image) return "尚未选择图片模型，请先配置或导入关键帧";
  if (videoNeeded && !props.project.models.video) return "尚未选择视频模型";
  for (const { shot, version } of targets) {
    if (shot.locked) return `镜头 ${shot.order} 已锁定`;
    if (props.project.tasks.some(task => task.shotId === shot.id && task.status === "verificationRequired")) return `镜头 ${shot.order} 有上游任务待核对，请先在任务列表处理`;
    if (props.project.tasks.some(task => task.shotId === shot.id && task.versionId === version.id && (task.status === "queued" || task.status === "running"))) return "此候选正在制作，请等待结果";
    if (sampleStage.value === "video" && !version.clip && !version.keyframe) return `镜头 ${shot.order} 的此候选缺少关键帧，请先生成或导入`;
    for (const id of version.characterIds || []) {
      const character = workflow.value?.characters.find(item => item.id === id);
      if (!character?.referenceImage || character.referenceImage.rights === "unverified") return `角色「${character?.name || id}」缺少参考图或来源授权待核验`;
    }
    const sceneReference = workflow.value?.sceneReferences?.find(item => item.sceneId === version.sceneId)?.referenceImage;
    if (sceneReference?.rights === "unverified") return `镜头 ${shot.order} 的场景参考图来源授权待核验`;
  }
  return "";
}
async function requestProject(action: string, fields: Record<string, unknown> = {}, path = "/production") {
  if (blocked.value) return null;
  const directory = props.directory;
  const projectId = props.project.id;
  pending.value = action; error.value = ""; notice.value = "";
  try {
    const result = await directorRequest<DirectorProject>(path, directory, { action, expectedRevision: props.project.revision, ...fields }, lifetime.signal);
    if (directory !== props.directory || projectId !== props.project.id) return null;
    emit("updated", result);
    return result;
  } catch (cause) { if (!lifetime.signal.aborted && directory === props.directory) error.value = directorError(cause); return null; }
  finally { pending.value = ""; }
}
function addScene() { scriptDraft.scenes.push({ id: crypto.randomUUID(), title: "", location: "", action: "", dialogues: [] }); }
async function saveScript() {
  if (scriptSourceId.value !== script.value?.id) { error.value = "剧本已有新版本，请载入当前版本后再修改。"; return; }
  if (!scriptDraft.logline.trim() || !scriptDraft.scenes.length || scriptDraft.scenes.some(scene => !scene.title.trim() || !scene.location.trim() || !scene.action.trim() || scene.dialogues.some(line => !line.speakerId || !line.text.trim()))) { error.value = "请补齐故事、场景名称、地点、人物行动及每句对白的说话人和内容。"; return; }
  if (await requestProject("saveScript", copy(scriptDraft))) { savedScriptDraft.value = JSON.stringify(scriptDraft); notice.value = "已保存新的剧本版本。请确认后复查角色与分镜，旧素材仍保留。"; }
}
async function confirmScript() {
  if (await requestProject("confirmScript")) {
    notice.value = "当前剧本已确认，请检查角色设定。";
    activeTab.value = "characters";
  }
}
async function saveCharacter() {
  if (workflow.value?.characters.find(character => character.id === characterId.value)?.revision !== characterBaseRevision.value) { error.value = "角色档案已有新版本，请撤销当前修改并载入后再编辑。"; return; }
  if ([characterDraft.name, characterDraft.appearance, characterDraft.costume, characterDraft.goal, characterDraft.knownFacts].some(value => !value.trim())) { error.value = "请补齐角色名称、固定外貌、服装、人物目标和已知事实。"; return; }
  const result = await requestProject("saveCharacter", { character: copy(characterDraft) });
  if (result) { characterBaseRevision.value = result.production?.characters.find(character => character.id === characterId.value)?.revision || characterBaseRevision.value; savedCharacterDraft.value = JSON.stringify(characterDraft); notice.value = "角色修改已保存。请重新确认角色，并复查受影响镜头。"; }
}
async function confirmCharacters() {
  if (await requestProject("confirmCharacters")) {
    notice.value = "全部角色已确认，可以继续生成分镜。";
    activeTab.value = "review";
  }
}
async function uploadReference(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = "";
  if (!file || blocked.value) return;
  const directory = props.directory; const id = characterId.value;
  pending.value = "uploadReference"; error.value = "";
  try {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    const reference = await uploadDirectorFile(directory, file);
    if (directory === props.directory && id === characterId.value) { characterDraft.referenceImage = { ...reference, rights: "unverified" }; notice.value = "参考图已上传，请选择来源授权并保存角色。"; }
  } catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pending.value = ""; }
}
async function createStoryboard() {
  let model: { providerId?: string; modelId?: string } = {};
  if (props.aiSelection) {
    try {
      const value = props.aiSelection.startsWith("[") ? JSON.parse(props.aiSelection) : props.aiSelection.split("\u0000");
      if (!Array.isArray(value) || value.length !== 2 || value.some(item => typeof item !== "string" || !item)) throw new Error("策划模型配置无效，请重新选择模型");
      model = { providerId: value[0], modelId: value[1] };
    } catch (cause) { error.value = directorError(cause); return; }
  }
  if (await requestProject("storyboard", model)) { notice.value = "分镜已保存，请逐镜审阅并确认后再制作小样。"; }
}
async function confirmStoryboard() {
  if (await requestProject("confirmStoryboard")) {
    notice.value = "当前分镜版本已确认，可开始单镜小样。";
    activeTab.value = "review";
  }
}
async function saveBinding() {
  const shot = bindingShot.value;
  if (!shot) return;
  if (shot.currentVersionId !== bindingBaseVersionId.value) { error.value = "镜头已有新版本，请重新选择此镜头后编辑。"; return; }
  if (!bindingDraft.sceneId || !bindingDraft.startState.trim() || !bindingDraft.endState.trim() || bindingDraft.dialogues.some(line => !line.speakerId || !line.text.trim())) { error.value = "请补齐场景、首尾状态及对白归属。"; return; }
  const result = await requestProject("edit", { shotId: shot.id, patch: copy(bindingDraft) }, "/action");
  if (result) { savedBindingDraft.value = JSON.stringify(bindingDraft); bindingBaseVersionId.value = result.shots.find(item => item.id === shot.id)!.currentVersionId; notice.value = "镜头绑定已保存为新版本，请重新确认分镜。"; }
}
async function newCandidate(stage: "image" | "video") {
  const shot = reviewShot.value;
  if (!shot) return;
  const previousIds = new Set(shot.versions.map(version => version.id));
  const result = await requestProject("candidate", { shotId: shot.id, stage });
  const candidate = result?.shots.find(item => item.id === shot.id)?.versions.find(version => !previousIds.has(version.id));
  if (!candidate) return;
  reviewShotId.value = shot.id;
  reviewVersionId.value = candidate.id;
  sampleStage.value = stage;
  notice.value = `已创建候选 V${candidate.number}，成片仍使用 V${shotVersion(shot).number}。生成并检查结果后，再决定是否采用。`;
}
async function useCandidate() {
  const shot = reviewShot.value;
  const version = reviewVersion.value;
  if (!shot || !version || adoptionIssue.value || blocked.value || reviewingAdopted.value) return;
  const projectId = props.project.id;
  const revision = props.project.revision;
  try {
    await ElMessageBox.confirm(`将镜头 ${shot.order} 的成片版本从 V${shotVersion(shot).number} 换为 V${version.number}。旧版本仍保留，需要重新确认分镜并审片。${version.clip ? "" : "此候选仅有关键帧，采用后需补生成视频才能交付。"}`, "采用此候选", { confirmButtonText: "采用并替换", cancelButtonText: "继续比较", type: "warning" });
  } catch { return; }
  if (props.project.id !== projectId || props.project.revision !== revision) { error.value = "项目已更新，请重新查看候选后再采用。"; return; }
  if (await requestProject("selectVersion", { shotId: shot.id, versionId: version.id }, "/action")) notice.value = `镜头 ${shot.order} 已采用 V${version.number}，旧版本保留。请重新确认分镜并审片。`;
}
async function submitReview(decision: "approved" | "rejected") {
  if (!reviewShot.value || !reviewVersion.value) return;
  if (await requestProject("review", { shotId: reviewShot.value.id, versionId: reviewVersion.value.id, decision, note: reviewNote.value.trim(), checks: copy(reviewChecks) })) notice.value = decision === "approved" ? "人工审片结果已保存。" : "已记录退回原因，可创建新候选继续修改。";
}
async function saveAudio(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!await requestProject("audio", { originalAudio: input.checked })) input.checked = Boolean(props.project.originalAudio);
}
async function downloadManifest() {
  if (blocked.value) return;
  const directory = props.directory; const projectId = props.project.id;
  pending.value = "manifest"; error.value = ""; notice.value = "";
  try {
    const manifest = await directorRequest<Record<string, unknown>>("/production", directory, { action: "manifest", expectedRevision: props.project.revision }, lifetime.signal);
    if (!manifest || manifest.projectId !== projectId) throw new Error("资产清单返回了无效的项目标识");
    if (directory !== props.directory) return;
    const name = props.project.title.replace(/[\\/:*?"<>|]/g, "_");
    const saved = await saveFile(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }), `${name}资产清单.json`);
    notice.value = saved ? "资产清单已保存。" : "已取消保存资产清单。";
  } catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pending.value = ""; }
}
watch(() => props.project.id, () => { resetScript(); savedCharacterDraft.value = JSON.stringify(characterDraft); if (workflow.value?.characters[0]) selectCharacter(workflow.value.characters[0].id); savedBindingDraft.value = JSON.stringify(bindingDraft); bindingShotId.value = ""; reviewShotId.value = ""; }, { immediate: true });
watch(() => workflow.value?.currentScriptVersionId, () => {
  const nextDraft = { logline: script.value?.logline || "", scenes: script.value?.scenes || [] };
  if (scriptSourceId.value && scriptDirty.value && JSON.stringify(nextDraft) !== JSON.stringify(scriptDraft)) { scriptConflict.value = true; return; }
  resetScript();
}, { immediate: true });
watch(() => `${props.project.id}:${workflow.value?.characters.map(character => `${character.id}:${character.revision}`).join(",") || ""}`, () => { const id = workflow.value?.characters.some(character => character.id === characterId.value) ? characterId.value : workflow.value?.characters[0]?.id; if (id && !characterDirty.value) selectCharacter(id); }, { immediate: true });
watch(() => props.project.shots.map(shot => `${shot.id}:${shot.currentVersionId}`).join(","), () => {
  if (!props.project.shots.some(shot => shot.id === reviewShotId.value)) selectReviewShot(props.project.shots[0]?.id || "");
  else if (!reviewShot.value?.versions.some(version => version.id === reviewVersionId.value)) reviewVersionId.value = reviewShot.value?.currentVersionId || "";
  if (!props.project.shots.some(shot => shot.id === bindingShotId.value)) { savedBindingDraft.value = JSON.stringify(bindingDraft); selectBinding(props.project.shots[0]?.id || ""); }
  else if (!bindingDirty.value) selectBinding(bindingShotId.value);
  batchShotIds.value = batchShotIds.value.filter(id => props.project.shots.some(shot => shot.id === id && !shot.locked));
}, { immediate: true });
watch(() => `${reviewShotId.value}:${reviewVersionId.value}:${workflow.value?.reviews.length || 0}`, () => { const review = latestReview(reviewShotId.value, reviewVersionId.value); Object.assign(reviewChecks, review?.checks || { visual: false, continuity: false, audio: false, subtitles: false, rights: false }); reviewNote.value = review?.decision === "stale" ? "" : review?.note || ""; }, { immediate: true });
watch(() => JSON.stringify(workflow.value?.sceneReferences || []), () => {
  for (const entry of workflow.value?.sceneReferences || []) {
    const dirty = sceneReferenceDirty(entry.sceneId);
    if (!dirty) sceneReferenceDrafts[entry.sceneId] = copy(entry.referenceImage);
    sceneReferenceSaved[entry.sceneId] = JSON.stringify(entry.referenceImage);
  }
}, { immediate: true });
watch(pending, value => emit("busyChange", Boolean(value)), { flush: "sync" });
defineExpose({ hasUnsavedChanges: () => scriptDirty.value || characterDirty.value || bindingDirty.value || Object.keys(sceneReferenceDrafts).some(sceneReferenceDirty), openStage(stage: "script" | "characters" | "review", shotId?: string) { activeTab.value = stage; if (shotId) selectReviewShot(shotId); } });
onScopeDispose(() => { lifetime.abort(); emit("busyChange", false); });
</script>

<style scoped lang="scss">
.sceneReferenceEditor { display: flex; align-items: flex-start; gap: 14px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 9px; background: var(--el-fill-color-light); > :deep(.studioThumbnail) { width: 120px; height: 100px; flex-shrink: 0; } > div { flex: 1; min-width: 0; } p { margin: 5px 0 8px; font-size: 11px; opacity: .7; } button { margin: 0 5px 5px 0; } .rightsField { margin: 9px 0; max-width: 320px; } }
.referenceUsage { color: #458266; font-size: 12px; margin: 0; }
.candidateState { padding: 9px 11px; margin-bottom: 12px !important; border-radius: 7px; background: #fff6e6; color: #89622b; line-height: 1.7; &.adopted { background: #edf7f0; color: #087c52; } }
.productionPanel {
  --el-color-primary: #087c52; --el-color-primary-light-9: #edf7f0; --el-input-focus-border-color: #087c52;
  flex: 1; min-height: 0; overflow: auto; padding: 25px 28px 32px; background: #fff; color: #253b2d; font-size: 12px;
  * { box-sizing: border-box; } button, select { font: inherit; } button { cursor: pointer; &:disabled { opacity: .45; cursor: not-allowed; } } button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #2b956a; outline-offset: 3px; }
  h2,h3,h4,p { margin: 0; } h2 { font-size: 23px; font-weight: 600; letter-spacing: -.6px; } h3 { font-size: 17px; font-weight: 600; } h4 { font-size: 13px; font-weight: 600; }
  .productionHeading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 23px; .eyebrow { display: block; color: #809486; font-size: 9px; letter-spacing: 2px; margin-bottom: 7px; } p { color: #7f9084; margin-top: 8px; line-height: 1.7; } .episodeLabel { white-space: nowrap; color: #74847a; border: 1px solid #e1e9e3; border-radius: 20px; padding: 8px 12px; } }
  .productionTabs { display: flex; gap: 7px; border-bottom: 1px solid #e1e9e3; padding-bottom: 14px; margin-bottom: 23px; button { display: flex; align-items: center; gap: 9px; padding: 10px 16px; border: 0; background: #f4f7f4; border-radius: 9px; color: #7b8d81; span { font-size: 10px; opacity: .7; } &.active { color: #087c52; background: #eaf4ec; font-weight: 600; } } }
  .panelMessage { display: flex; align-items: center; gap: 10px; background: #edf7f0; border: 1px solid #dcecdf; padding: 11px 13px; margin: 0 0 14px; border-radius: 9px; color: #467455; line-height: 1.7; button { margin-left: auto; background: none; border: 0; font-size: 17px; color: inherit; } &.errorMessage { background: #fff2ee; border-color: #f1d6c8; color: #a05b41; } }
  .sectionHeading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; h3 span { font-weight: 400; color: #889b8e; margin-left: 5px; font-size: 12px; } p { color: #829187; line-height: 1.8; margin-top: 7px; max-width: 670px; } }
  .stateBadge { flex-shrink: 0; padding: 6px 9px; background: #f2f4f1; color: #8c998f; border-radius: 6px; font-size: 10px; &.confirmed { background: #e7f4eb; color: #087c52; } }
  .editorFields { display: flex; flex-direction: column; gap: 15px; border: 0; margin: 0; padding: 0; min-width: 0; > label, .fieldRow > label { display: flex; flex-direction: column; gap: 7px; color: #647a6b; font-size: 11px; } }
  .fieldRow { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; min-width: 0; > * { min-width: 0; } }
  select { background: #fff; border: 1px solid #dce5df; border-radius: 7px; padding: 8px 9px; color: #4c6656; min-width: 0; }
  .sceneCard { display: flex; flex-direction: column; gap: 13px; padding: 17px; border: 1px solid #e1e9e3; background: #fcfdfb; border-radius: 14px; > label { display: flex; flex-direction: column; gap: 7px; color: #647a6b; font-size: 11px; } .sceneHeading { display: flex; align-items: center; justify-content: space-between; color: #466b53; font-weight: 600; font-size: 11px; } }
  .dialogueRow { display: flex; gap: 8px; align-items: center; select { width: 125px; flex-shrink: 0; } .el-input { flex: 1; min-width: 0; } .removeButton { width: 24px; border: 0; background: none; color: #9aa89e; font-size: 19px; } }
  .primaryButton, .secondaryButton { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid transparent; padding: 10px 14px; border-radius: 8px; font-size: 11px; white-space: nowrap; }
  .primaryButton { color: #fff; background: #087c52; }.secondaryButton { color: #54715e; border-color: #dce5df; background: #fff; }.textButton { border: 0; background: none; padding: 4px 0; font-size: 11px; color: #438464; text-align: left; }
  .stageActions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 20px; > span { color: #9b8b67; font-size: 11px; } }
  .inlineActions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .historyDetails, .bindingDetails { border: 1px solid #e1e9e3; border-radius: 12px; padding: 14px; margin-top: 18px; summary { cursor: pointer; font-size: 12px; color: #667e6d; span { color: #9ca99f; margin-left: 8px; } } }
  .historyDetails > div { padding: 12px 0; border-bottom: 1px solid #ecf0eb; p { margin: 8px 0; color: #728879; line-height: 1.7; } small { color: #a2aea5; } }
  .characterLayout { display: grid; grid-template-columns: 165px minmax(0,1fr); gap: 23px; }.characterList { display: flex; flex-direction: column; gap: 7px; button { display: flex; align-items: center; gap: 9px; border: 1px solid transparent; background: #f5f7f3; border-radius: 10px; padding: 11px; text-align: left; color: #708375; &.active { background: #eaf5ed; border-color: #cce5d4; color: #087c52; } .characterInitial { width: 31px; height: 31px; border-radius: 50%; display: grid; place-items: center; background: #e1ece2; } strong { display: block; font-size: 12px; font-weight: 500; } small { display: block; font-size: 9px; color: #8a9c90; margin-top: 5px; } } }
  .referenceEditor { display: flex; align-items: center; gap: 16px; padding: 14px; border-radius: 12px; background: #f5f8f3; > :first-child { width: 96px; height: 114px; flex-shrink: 0; border-radius: 8px; overflow: hidden; } h4 { margin-bottom: 10px; } p { margin-top: 9px; color: #90a091; line-height: 1.7; font-size: 10px; } .referenceEmpty { display: grid; place-items: center; color: #a1b0a3; border: 1px dashed #d1dfd1; background: #edf2e9; font-size: 10px; }.rightsField { display: flex; align-items: center; gap: 8px; color: #6c8473; margin-top: 9px; font-size: 10px; select { font-size: 10px; padding: 6px; } } }
  .fileInput { display: none; }.workflowCard, .deliveryCard { border: 1px solid #e1e9e3; background: #f6f9f4; border-radius: 14px; padding: 17px; p { color: #7e9384; line-height: 1.8; margin-top: 6px; font-size: 11px; } }.workflowCard { display: flex; flex-direction: column; align-items: flex-start; gap: 13px; }.bindingList { display: flex; flex-wrap: wrap; gap: 6px; margin: 15px 0; button { border: 1px solid #e0e9e1; background: #fff; color: #728978; border-radius: 7px; padding: 7px 9px; font-size: 10px; &.active { color: #087c52; border-color: #badcc7; background: #edf7f0; } } }.bindingEditor { padding: 15px; border-radius: 10px; background: #f8faf6; p { color: #93a194; font-size: 10px; line-height: 1.8; } }.characterChoices { display: flex; gap: 8px; flex-wrap: wrap; align-content: flex-start; color: #647a6b; font-size: 11px; > span { width: 100%; margin-bottom: 1px; } label { display: flex; align-items: center; gap: 4px; } }
  input[type="checkbox"] { accent-color: #087c52; width: 13px; height: 13px; }.hintText { color: #91a093; line-height: 1.8; margin-top: 8px; font-size: 10px; }
  .reviewLayout { display: grid; grid-template-columns: 165px minmax(0,1fr); gap: 20px; margin: 21px 0; }.reviewShotList { display: flex; flex-direction: column; gap: 6px; button { display: flex; align-items: flex-start; gap: 9px; border: 1px solid transparent; border-radius: 9px; background: #f6f8f4; color: #76917e; padding: 11px; text-align: left; &.active { border-color: #c9e3d0; background: #eaf5ec; color: #087c52; } > span { padding-top: 2px; font-size: 10px; } strong { display: block; font-weight: 500; font-size: 11px; line-height: 1.6; } small { display: block; font-size: 9px; color: #91a194; margin-top: 5px; } } }.reviewEditor { min-width: 0; }.reviewMedia { height: 240px; border-radius: 12px; overflow: hidden; background: #16281e; :deep(.mediaPreview) { width: 100%; height: 100%; } :deep(video),:deep(img) { object-fit: contain; } }.candidateHeading { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; margin: 12px 0; label { display: flex; gap: 8px; align-items: center; color: #83978a; font-size: 10px; select { max-width: 240px; font-size: 10px; } } > .textButton { margin-left: auto; } }.sampleActions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; select { font-size: 10px; } }.reviewChecks { display: flex; flex-wrap: wrap; gap: 12px; border: 1px solid #e1e9e3; border-radius: 12px; padding: 14px; margin-top: 17px; legend { font-size: 11px; color: #799180; padding: 0 5px; } label { display: flex; align-items: center; gap: 5px; color: #718977; font-size: 10px; } .el-textarea { width: 100%; } .inlineActions { width: 100%; } }.batchCard { margin: 18px 0; .batchChoices { display: flex; flex-wrap: wrap; gap: 9px 14px; label { display: flex; align-items: center; gap: 4px; color: #73907b; font-size: 10px; } } }.deliveryCard { background: #fff; .audioChoice { display: flex; align-items: center; gap: 7px; margin: 15px 0; color: #6d8876; font-size: 11px; }.issueList { margin: 14px 0; padding-left: 18px; color: #9d805d; font-size: 10px; line-height: 2; }.readyText { color: #087c52; margin: 14px 0; } }.legacyNotice { padding: 25px; border: 1px solid #e1e9e3; border-radius: 15px; background: #f6f9f4; h3 { margin-bottom: 10px; } p { color: #819386; line-height: 1.9; } }
}
@media (max-width: 1100px) { .productionPanel { padding: 22px 19px; .characterLayout, .reviewLayout { grid-template-columns: 135px minmax(0,1fr); gap: 14px; }.referenceEditor { gap: 12px; > :first-child { width: 75px; height: 95px; } }.productionHeading h2 { font-size: 20px; }.fieldRow { gap: 10px; } } }
@media (max-width: 780px) { .productionPanel { .productionHeading .episodeLabel { display: none; }.characterLayout, .reviewLayout { grid-template-columns: 1fr; }.characterList, .reviewShotList { flex-direction: row; overflow: auto; }.characterList button, .reviewShotList button { min-width: 140px; }.fieldRow { grid-template-columns: 1fr; }.productionTabs button { padding: 9px 12px; } } }
</style>
