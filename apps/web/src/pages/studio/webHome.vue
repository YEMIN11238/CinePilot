<template>
  <main class="webHome" :aria-busy="busy">
    <aside class="studioSidebar" aria-label="创作导航">
      <a class="studioLogo" href="#/home" aria-label="CinePilot 创作首页"><img src="/cinePilotIcon.png" alt="" /><span>CinePilot<small>AI VIDEO STUDIO</small></span></a>
      <button class="newCreation" type="button" :disabled="busy" @click="newCreation"><icon-plus :size="18" /><span>新建创作</span></button>
      <nav class="sideNavigation"><button type="button" :class="{ active: activeSection === 'create' }" :disabled="busy" aria-label="创作工作室" @click="showCreation"><icon-sparkles :size="19" /><span>创作工作室</span></button><button type="button" :class="{ active: activeSection === 'projects' }" :disabled="busy" aria-label="我的项目" @click="showProjects"><icon-folders :size="19" /><span>我的项目</span><b>{{ workspace.projectList.length }}</b></button></nav>
      <div v-if="allProjects.length" class="sidebarRecent"><span>最近打开</span><button v-for="item in allProjects.slice(0, 3)" :key="item.directory" type="button" :disabled="busy" @click="openProject(item)"><icon-movie :size="14" /><span>{{ item.name }}</span></button></div>
      <div class="sidebarBottom"><button type="button" aria-label="模型设置" @click="settingsVisible = true"><icon-adjustments :size="18" /><span>模型设置</span><i :class="{ ready: availableModels.length }" /></button><button type="button" aria-label="关于 CinePilot" @click="creditsVisible = true"><icon-info-circle :size="18" /><span>关于 CinePilot</span></button><small>iQIYI 场景研究 · DEMO</small></div>
    </aside>
    <div ref="contentRoot" class="studioMain">
      <header class="topNavigation"><span class="workspaceLabel"><i />个人创作空间</span><div class="topActions"><span>本地保存</span><button type="button" aria-label="打开模型设置" @click="settingsVisible = true"><icon-settings :size="18" /></button></div></header>
      <div v-if="error" class="homeError" role="alert"><icon-alert-circle :size="18" /><span>{{ error }}</span><button type="button" aria-label="关闭错误提示" @click="error = ''"><icon-x :size="16" /></button></div>
      <section v-show="activeSection === 'create'" class="creationHero" aria-label="开始图片、视频或故事创作">
        <nav class="creationModes" aria-label="创作方式" role="tablist"><button v-for="item in modes" :key="item.id" type="button" role="tab" :aria-selected="mode === item.id" :class="{ active: mode === item.id }" :disabled="busy" @click="selectMode(item.id)"><component :is="item.icon" :size="16" />{{ item.label }}</button></nav>
        <div class="heroHeading"><h1>{{ modeDetails.heading }}</h1><p>{{ modeDetails.description }}</p></div>
        <form class="promptComposer" @submit.prevent="startCreation" @dragover.prevent @drop.prevent="dropReference" @paste="pasteReference">
          <template v-if="usesPrompt">
            <div class="composerAttachments">
              <el-dropdown trigger="click" :disabled="busy" @command="chooseAttachment">
                <button class="addAttachment" type="button" :disabled="busy" aria-label="添加素材" title="导入剧本或参考图"><icon-loader-2 v-if="readingReference" class="spinner" :size="22" /><icon-plus v-else :size="23" /></button>
                <template #dropdown><el-dropdown-menu class="attachmentMenu"><el-dropdown-item command="script"><icon-file-text :size="16" />导入剧本 TXT / MD</el-dropdown-item><el-dropdown-item command="reference"><icon-photo :size="16" />添加参考图 PNG / JPG / WebP</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
              <div v-if="referenceUpload" class="referenceAttachment"><img :src="referencePreview" alt="已添加的画面参考图" /><span><strong>{{ referenceUpload.name }}</strong><small>{{ resolvedIntent === 'story' ? '画面参考 · 策划阶段不识图' : '参考图片 · 随生成任务使用' }}</small></span><button type="button" :disabled="busy" aria-label="移除参考图" @click="removeReference"><icon-x :size="13" /></button></div>
              <div v-if="importedName" class="scriptAttachment"><icon-file-text :size="17" /><span>{{ importedName }}</span><button type="button" :disabled="busy" aria-label="关闭剧本来源提示" @click="importedName = ''"><icon-x :size="13" /></button></div>
            </div>
            <label class="screenReaderOnly" for="creationPrompt">描述创作想法</label>
            <textarea id="creationPrompt" ref="promptInput" v-model="prompt" :disabled="busy" :aria-invalid="Boolean(promptError)" :aria-describedby="promptError ? 'promptError' : undefined" :maxlength="mode === 'comic' ? 10000 : 6000" :placeholder="mode === 'comic' ? '描述你的故事、人物和想要的画面，也可以导入一份剧本…' : '生成一张橘猫的图片，或让一张图片动起来…'" @keydown.meta.enter.prevent="startCreation" @keydown.ctrl.enter.prevent="startCreation" />
            <p v-if="promptError" id="promptError" class="fieldError">{{ promptError }}</p>
          </template>
          <div v-else class="blankProjectContent"><span class="blankProjectIcon"><icon-layout-board v-if="mode === 'canvas'" :size="27" /><icon-timeline v-else :size="27" /></span><div><strong>{{ mode === 'canvas' ? '一张空白画布，留给你的创意' : '从你已有的素材开始' }}</strong><p>{{ mode === 'canvas' ? '进入后添加文字、参考图片和视频，连接节点继续创作。' : '进入工作台导入视频与图片，再编排镜头、字幕和配乐。' }}</p></div><label for="blankProjectTitle">项目名称<input id="blankProjectTitle" ref="titleInput" v-model="projectTitle" :disabled="busy" maxlength="120" :placeholder="mode === 'canvas' ? '新的画布项目' : '新的剪辑项目'" /></label></div>
          <div class="composerFooter">
            <div v-if="usesPrompt" class="composerTools"><label v-if="mode === 'create'" class="intentChoice"><select v-model="creativeIntent" :disabled="busy" aria-label="创作任务类型"><option value="auto">自动识别任务</option><option value="image">生成图片</option><option value="video">生成视频</option><option value="story">故事策划</option></select></label><button type="button" :disabled="busy" :aria-expanded="optionsVisible" @click="optionsVisible = !optionsVisible"><icon-palette :size="18" /><span>{{ style }}</span><icon-chevron-down :size="12" /></button><button type="button" :disabled="busy" :aria-expanded="optionsVisible" @click="optionsVisible = !optionsVisible"><icon-aspect-ratio :size="18" /><span>{{ ratio }}{{ resolvedIntent === 'story' ? ` · ${duration} 秒` : resolvedIntent === 'video' ? ` · ${mediaDuration} 秒` : '' }}</span><icon-chevron-down :size="12" /></button><button type="button" :disabled="busy" @click="library?.openLibrary()"><icon-layout-grid :size="18" /><span>模板</span></button></div>
            <span v-else class="blankProjectNote"><icon-check :size="14" />创建空项目，不调用生成模型</span>
            <button class="createButton" type="submit" :disabled="busy"><icon-loader-2 v-if="busy" :size="18" class="spinner" /><span>{{ busy ? pendingLabel : modeDetails.action }}</span><icon-arrow-up v-if="!busy" :size="20" /></button>
          </div>
          <div v-if="usesPrompt && optionsVisible" class="creationOptions"><label>画面风格<select v-model="style" :disabled="busy"><option v-for="value in styles" :key="value" :value="value">{{ value }}</option></select></label><label>画幅<select v-model="ratio" :disabled="busy"><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option></select></label><label v-if="resolvedIntent === 'story'">目标时长<select v-model.number="duration" :disabled="busy"><option :value="20">20 秒</option><option :value="30">30 秒</option><option :value="60">60 秒</option></select></label><label v-if="resolvedIntent === 'story' || resolvedIntent === 'chat'">策划模型<select v-model="selectedModel" :disabled="busy || !availableModels.length"><option v-if="!availableModels.length" value="">请先配置模型</option><option v-for="model in availableModels" :key="model.value" :value="model.value">{{ model.label }}</option></select></label></div>
        </form>
        <div class="composerHint" role="status"><span v-if="busy"><i class="loadingDot" />{{ pendingDescription }}</span><span v-else>{{ usesPrompt ? prompt.trim() ? `当前任务：${intentLabel}。${resolvedIntent === 'image' || resolvedIntent === 'video' ? '下一步核对模型与生成参数。' : resolvedIntent === 'story' ? '先确认简报，再生成剧本。' : '进入工作台继续讨论。'} ⌘ / Ctrl + Enter 开始。` : '支持图片、视频和故事策划；也可拖入或粘贴一张参考图。' : '图片、视频和每一次修改都会保存在这个项目中。' }}</span><button v-if="!busy && usesPrompt && ['story', 'chat'].includes(resolvedIntent) && !availableModels.length" type="button" @click="settingsVisible = true">连接策划模型<icon-arrow-right :size="12" /></button></div>
        <div v-if="usesPrompt" class="quickTemplates" aria-label="创作快捷入口">
          <button type="button" :disabled="busy" @click="useTemplate(templates[0])"><img src="/studioTemplates/rainyReunion.png" alt="" /><span>剧情漫剧</span><icon-arrow-up-right :size="14" /></button>
          <button type="button" :disabled="busy" @click="useTemplate(templates[1])"><img src="/studioTemplates/coffeeMoment.png" alt="" /><span>产品广告</span><icon-arrow-up-right :size="14" /></button>
          <button type="button" :disabled="busy" @click="library?.openTemplateById('characterPortrait')"><img src="/studioTemplates/characterPortrait.png" alt="" /><span>角色设计</span><icon-arrow-up-right :size="14" /></button>
          <button type="button" :disabled="busy" @click="selectMode('canvas')"><span class="canvasPreview"><icon-layout-board :size="21" /></span><span>自由画布</span><icon-arrow-up-right :size="14" /></button>
        </div>
      </section>
      <section class="projectsSection" aria-label="我的项目">
        <div class="sectionHeading"><div><h2>{{ activeSection === 'projects' ? '我的项目' : '最近项目' }}<span>{{ workspace.projectList.length }}</span></h2><p>{{ activeSection === 'projects' ? '继续你的故事，或打开已有项目。' : '接着上一次的灵感，继续往下做。' }}</p></div><label v-if="activeSection === 'projects'" class="projectSearch"><icon-search :size="16" /><input v-model="projectQuery" placeholder="搜索项目" aria-label="搜索项目" /></label><button v-else class="textButton" type="button" :disabled="busy" @click="showProjects">查看全部<icon-arrow-right :size="14" /></button></div>
        <div v-if="visibleProjects.length" class="projectGrid"><button v-for="item in visibleProjects" :key="item.directory" class="projectCard" type="button" :disabled="busy" @click="openProject(item)"><div class="projectPoster"><studioThumbnail v-if="item.previewAsset" :directory="item.directory" :path="item.previewAsset.path" :mimeType="item.previewAsset.mimeType" :label="item.name" /><icon-movie v-else :size="30" /><span class="continueLabel"><icon-player-play :size="13" />{{ item.nextAction || '继续创作' }}</span><span v-if="item.statusLabel" class="projectStage" :class="item.stage">{{ item.statusLabel }}</span></div><div class="projectInfo"><h3>{{ item.name }}</h3><p>{{ formatDate(item.lastOpenedAt) }} 打开<icon-arrow-up-right :size="14" /></p></div></button></div>
        <div v-else class="projectEmpty"><icon-folders :size="24" /><div><strong>{{ projectQuery ? '没有找到这个项目' : '你的第一部作品，从这里开始' }}</strong><p>{{ projectQuery ? '换个关键词，或打开已有项目。' : '创建一个项目，把故事和素材放在一起。' }}</p></div><button class="textButton" type="button" :disabled="busy" @click="projectQuery ? projectQuery = '' : showCreation()">{{ projectQuery ? '清除搜索' : '开始创作' }}<icon-arrow-right :size="14" /></button></div>
        <div class="projectFooter"><button class="textButton" type="button" :disabled="busy" @click="chooseProject"><icon-folder-open :size="15" />打开已有项目</button><div class="demoLinks"><span>示例项目</span><button type="button" :disabled="busy" @click="openDemo(true)">漫剧策划<icon-arrow-up-right :size="12" /></button><button type="button" :disabled="busy" @click="openDemo(false)">咖啡短片<icon-arrow-up-right :size="12" /></button></div></div>
      </section>
      <templateLibrary v-if="activeSection === 'create'" ref="library" :idea="prompt" :busy="busy" :creatingId="creatingTemplateId" :error="templateError" @useTemplate="createFromTemplate" @clearError="templateError = ''" />
      <footer class="mainFooter"><span>为故事而创作</span><button type="button" @click="creditsVisible = true">Demo 与开源说明</button></footer>
    </div>
    <input ref="scriptInput" class="fileInput" type="file" accept=".txt,.md,text/plain,text/markdown" @change="importScript" />
    <input ref="referenceInput" class="fileInput" type="file" accept="image/png,image/jpeg,image/webp" @change="importReference" />
    <briefConfirmation v-model="briefVisible" :draft="briefDraft" :busy="busy" :error="briefError" :style="style" :ratio="ratio" :duration="duration" :referenceName="referenceUpload?.name" @confirm="confirmBrief" @editIdea="showCreation" @clearError="briefError = ''" />
    <el-dialog v-model="generationReviewVisible" :title="resolvedIntent === 'image' ? '生成图片' : '制作视频'" width="min(600px, calc(100vw - 32px))" appendToBody :closeOnClickModal="!busy" :closeOnPressEscape="!busy" :showClose="!busy" class="creationReviewDialog">
      <div class="creationReview">
        <div class="requestSummary"><img v-if="referencePreview" :src="referencePreview" alt="本次生成的参考图片" /><p>{{ prompt }}</p></div>
        <p v-if="needsFirstImage" class="flowExplanation">本次先生成一张首帧。你选定画面后，再用它生成 {{ mediaDuration }} 秒视频。</p>
        <p v-else class="flowExplanation">{{ resolvedIntent === 'image' ? referenceUpload ? '使用这张参考图生成新图片，原图保留。' : '直接生成一张图片，完成后可以继续修改或制作视频。' : '使用参考图片作为视频首帧。' }}</p>
        <p v-if="mediaLoading" role="status">正在读取可用模型…</p>
        <div class="reviewFields">
          <label v-if="resolvedIntent === 'image' || needsFirstImage">图片模型<select v-model="imageSelection" :disabled="busy" aria-label="首页图片模型"><option v-if="!imageModels.length" value="">尚未配置图片模型</option><option v-for="model in imageModels" :key="mediaModelKey(model)" :value="mediaModelKey(model)">{{ model.providerLabel }} · {{ model.label }}</option></select></label>
          <label v-if="resolvedIntent === 'video'">视频模型<select v-model="videoSelection" :disabled="busy" aria-label="首页视频模型"><option v-if="!videoModels.length" value="">尚未配置视频模型</option><option v-for="model in videoModels" :key="mediaModelKey(model)" :value="mediaModelKey(model)">{{ model.providerLabel }} · {{ model.label }}</option></select></label>
          <label>画幅<select v-model="ratio" :disabled="busy" aria-label="首页生成画幅"><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option></select></label>
          <label v-if="resolvedIntent === 'video'">视频时长<select v-model.number="mediaDuration" :disabled="busy" aria-label="首页视频时长"><option :value="5">5 秒</option><option :value="10">10 秒</option></select></label>
        </div>
        <p v-if="generationReviewIssue && !mediaLoading" class="reviewError" role="status">{{ generationReviewIssue }}</p><p class="reviewCost">本次提交 {{ needsFirstImage || resolvedIntent === 'image' ? '1 个图片任务' : '1 个视频任务' }}，按所选 API 实际计费。{{ needsFirstImage ? '视频任务将在你确认首帧后另行提交。' : '已有素材会保留。' }}</p>
        <p v-if="mediaError || generationReviewError" class="reviewError" role="alert">{{ generationReviewError || mediaError }}<button v-if="mediaError" type="button" :disabled="busy" @click="loadMediaCapabilities">重新读取模型</button></p>
        <div class="reviewActions"><button type="button" :disabled="busy" @click="generationReviewVisible = false">返回修改</button><button v-if="!generationModel || resolvedIntent === 'video' && !videoSelection" type="button" :disabled="busy" @click="settingsVisible = true">配置生成模型</button><button v-else class="confirmGeneration" type="button" :disabled="busy || mediaLoading || Boolean(generationReviewIssue)" @click="confirmMediaCreation"><icon-loader-2 v-if="busy" :size="16" class="spinner" />{{ busy ? '正在提交…' : needsFirstImage ? '确认生成首帧' : resolvedIntent === 'image' ? '确认生成图片' : '确认生成视频' }}</button></div>
      </div>
    </el-dialog>
    <workspacePicker ref="picker" hideTrigger /><settings v-model="settingsVisible" />
    <el-dialog v-model="creditsVisible" title="关于 CinePilot" width="min(560px, calc(100vw - 24px))" appendToBody class="webCreditsDialog"><div class="creditsContent"><p>CinePilot 是围绕爱奇艺漫剧创作场景研究制作的 AI Video Agent Demo，提供本机网页版与独立桌面版，并非爱奇艺官方合作产品。</p><p>首页支持直接发起图片或视频创作，提交前核对模型与参数；漫剧策划先确认简报。创建空白项目或模板不会调用生成模型。</p><p>基于 <a href="https://github.com/HBAI-Ltd/Toonflow-app" target="_blank" rel="noopener noreferrer">Toonflow</a> 二次开发，使用 Vue Flow 和 WebAV；参考 AICON 的画布交互、ViMax 的角色/镜头契约及 OpenCut 的编辑器结构。</p><p><a href="/openSource.txt" target="_blank" rel="noopener noreferrer">完整开源许可证与引用说明</a></p></div></el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import { IconAdjustments, IconAlertCircle, IconArrowRight, IconArrowUp, IconArrowUpRight, IconAspectRatio, IconCheck, IconChevronDown, IconFileText, IconFolderOpen, IconFolders, IconInfoCircle, IconLayoutBoard, IconLayoutGrid, IconLoader2, IconMovie, IconPalette, IconPhoto, IconPlayerPlay, IconPlus, IconSearch, IconSettings, IconSparkles, IconTimeline, IconX } from "@tabler/icons-vue";
import { customProviders } from "@/stores/settings";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import { directorError, directorRequest, uploadDirectorFile } from "@/pages/workspace/panels/director/api";
import type { AgentAttachment } from "@/components/agent/types";
import { saveWebPlanningModel } from "@/lib/webPlanningModel";
import settings from "@/components/settings/index.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";
import studioThumbnail from "@/pages/workspace/panels/director/studioThumbnail.vue";
import templateLibrary from "./templateLibrary.vue";
import briefConfirmation from "./briefConfirmation.vue";
import type { CreativeBriefDraft } from "@toonflow/server/directorBrief";
import { creativeTemplates, type CreativeTemplateOverrides } from "@toonflow/server/directorTemplates";
import { detectCreationIntent } from "@toonflow/server/directorCreation";
import type { DirectorGenerationInput, DirectorProject } from "@toonflow/server/directorTypes";
import type { MediaModel } from "@toonflow/tools-scaffold/runtime";

const router = useRouter();
const route = useRoute();
const workspace = useWorkspaceStore();
const picker = ref<InstanceType<typeof workspacePicker>>();
const library = ref<InstanceType<typeof templateLibrary>>();
const creatingTemplateId = ref("");
const templateError = ref("");
const promptInput = ref<HTMLTextAreaElement>();
const titleInput = ref<HTMLInputElement>();
const scriptInput = ref<HTMLInputElement>();
const referenceInput = ref<HTMLInputElement>();
const contentRoot = ref<HTMLElement>();
const prompt = ref("");
const attempted = ref(false);
const promptError = computed(() => attempted.value && !prompt.value.trim() ? "描述你想生成的图片、视频或故事，也可以添加参考图。" : "");
type ReferenceUpload = { name: string; mimeType: string; base64: string };
const referenceUpload = ref<ReferenceUpload>();
const referencePreview = ref("");
const referenceIdentity = ref("");
const readingReference = ref(false);
const briefDraft = ref<CreativeBriefDraft | null>(null);
const briefVisible = ref(false);
const briefError = ref("");
let briefSignature = "";
let preparedModel: { providerId: string; modelId: string; value: string } | undefined;
const importedName = ref("");
type CreationMode = "create" | "comic" | "edit" | "canvas";
const mode = ref<CreationMode>("create");
const creativeIntent = ref<"auto" | "image" | "video" | "story">("auto");
const usesPrompt = computed(() => mode.value === "create" || mode.value === "comic");
const resolvedIntent = computed(() => mode.value === "comic" ? "story" : creativeIntent.value === "auto" ? detectCreationIntent(prompt.value) : creativeIntent.value);
const intentLabel = computed(() => ({ image: "图片生成", video: "视频生成", story: "故事策划", chat: "与助手讨论" }[resolvedIntent.value]));
const mediaModels = ref<MediaModel[]>([]);
const configuredProviders = ref<string[]>([]);
const imageSelection = ref("");
const videoSelection = ref("");
const mediaDuration = ref<5 | 10>(5);
const generationReviewVisible = ref(false);
const generationReviewError = ref("");
const mediaLoading = ref(false);
const mediaError = ref("");
const imageModels = computed(() => mediaModels.value.filter(item => item.type === "image" && configuredProviders.value.includes(item.providerId)));
const videoModels = computed(() => mediaModels.value.filter(item => item.type === "video" && configuredProviders.value.includes(item.providerId)));
const needsFirstImage = computed(() => resolvedIntent.value === "video" && !referenceUpload.value);
const requestedMediaDuration = computed(() => {
  const match = prompt.value.match(/(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b)/i);
  return match ? Number(match[1]) : undefined;
});
const generationModel = computed(() => (resolvedIntent.value === "video" && !needsFirstImage.value ? videoModels.value : imageModels.value).find(item => mediaModelKey(item) === (resolvedIntent.value === "video" && !needsFirstImage.value ? videoSelection.value : imageSelection.value)));
const generationReviewIssue = computed(() => {
  if (!generationModel.value) return "请先配置并选择本次生成模型。";
  const image = imageModels.value.find(item => mediaModelKey(item) === imageSelection.value);
  if ((resolvedIntent.value === "image" || needsFirstImage.value) && image?.imageRatios?.length && !image.imageRatios.includes(ratio.value)) return "当前图片模型不支持这个画幅，请调整画幅或更换模型。";
  if (resolvedIntent.value === "image" && referenceUpload.value && (!Array.isArray(image?.mode) || !image.mode.some(item => item === "singleImage" || item === "multiReference"))) return "当前图片模型不支持参考图，请更换模型或返回移除参考图。";
  if (resolvedIntent.value === "video") {
    if (requestedMediaDuration.value !== undefined && ![5, 10].includes(requestedMediaDuration.value)) return `你要求 ${requestedMediaDuration.value} 秒；当前单镜头入口支持 5 或 10 秒。请修改时长，或切到漫剧策划制作多个镜头。`;
    const video = videoModels.value.find(item => mediaModelKey(item) === videoSelection.value);
    if (!video) return "请先配置视频模型。";
    const modes = Array.isArray(video.mode) ? video.mode : [];
    if (!modes.some(item => ["startFrameOptional", "endFrameOptional", "singleImage"].includes(String(item)) || Array.isArray(item) && item.some(value => /^imageReference:[1-9]\d*$/.test(String(value))))) return "当前视频模型未声明首帧生成能力，请更换图生视频模型。";
    const maps = video.durationResolutionMap?.filter(item => item.duration.length && item.resolution.length) || [];
    const resolutions = maps.flatMap(item => item.resolution);
    const resolution = resolutions.find(item => item.toLowerCase() === "720p") || resolutions[0];
    if (!resolution || !maps.some(item => item.resolution.includes(resolution) && item.duration.includes(mediaDuration.value))) return "当前视频模型不支持这个时长，请调整时长或更换模型。";
  }
  return "";
});
const projectTitle = ref("");
const activeSection = ref<"create" | "projects">("create");
const style = ref("写实电影感");
const ratio = ref<"16:9" | "9:16" | "1:1">("16:9");
const duration = ref(30);
const styles = ["写实电影感", "国风水墨", "日系动漫", "3D 动画", "复古胶片", "清新广告"];
const modes = [{ id: "create", label: "灵感创作", icon: IconSparkles }, { id: "comic", label: "漫剧策划", icon: IconMovie }, { id: "edit", label: "已有素材剪辑", icon: IconTimeline }, { id: "canvas", label: "自由画布", icon: IconLayoutBoard }] as const;
const modeDetails = computed(() => ({
  create: { heading: "让灵感，成为看得见的画面", description: "生成一张图片、一段视频，或和助手一起构思故事。", action: prompt.value.trim() ? resolvedIntent.value === "image" ? "生成图片" : resolvedIntent.value === "video" ? "制作视频" : resolvedIntent.value === "story" ? "开始策划" : "开始对话" : "开始创作" },
  comic: { heading: "你的下一幕，从这里开始", description: "从一句想法开始，让 AI 陪你把故事拍出来。", action: "开始策划" },
  edit: { heading: "把素材，剪成一段故事", description: "从已有的视频和图片开始，编排镜头，完成你的短片。", action: "进入剪辑" },
  canvas: { heading: "给灵感，一张自由画布", description: "连接文字、图像与视频，用你自己的方式探索画面。", action: "打开空白画布" },
}[mode.value]));
const optionsVisible = ref(false);
const settingsVisible = ref(false);
const creditsVisible = ref(false);
const pendingAction = ref<"" | "readScript" | "brief" | "start" | "createMedia" | "createChat" | "createCanvas" | "createEdit" | "createTemplate" | "openProject" | "openDemo" | "chooseProject">("");
const busy = computed(() => pendingAction.value !== "" || readingReference.value);
const pendingLabel = computed(() => ({ "": readingReference.value ? "正在读取参考图…" : "", readScript: "正在读取剧本…", brief: "正在整理想法…", start: "正在生成策划…", createMedia: "正在提交任务…", createChat: "正在打开助手…", createCanvas: "正在创建画布…", createEdit: "正在创建项目…", createTemplate: "正在创建模板项目…", openProject: "正在打开项目…", openDemo: "正在打开示例…", chooseProject: "正在选择项目…" }[pendingAction.value]));
const pendingDescription = computed(() => ({ "": readingReference.value ? "正在读取参考图，完成后可继续创作。" : "", readScript: "正在读取剧本文字，完成后可继续创作。", brief: "正在整理创作简报，下一步由你确认。", start: "正在根据已确认的简报起草剧本，完成后进入工作台。", createMedia: "正在保存创作要求并提交模型任务，结果将在画布中呈现。", createChat: "正在把你的想法带入创作助手。", createCanvas: "正在保存空白项目，随后进入创作画布。", createEdit: "正在保存空白项目，随后进入剪辑工作台。", createTemplate: "正在保存模板与节点，随后进入创作画布。", openProject: "正在读取项目与素材。", openDemo: "正在打开预置示例，保留已有修改。", chooseProject: "请在目录选择器中选择项目。" }[pendingAction.value]));
const error = ref("");
const projectQuery = ref("");
const selectedModel = ref("");
const lifetime = new AbortController();
let lastSignature = "";
let lastRequestId = "";
const templates = [
  { id: "suspense", style: "写实电影感", duration: 30, ratio: "16:9", prompt: "雨夜的码头，一名少女带着父亲留下的旧信寻找守船人。守船人按约把一只铜怀表交给她，她在末班船前停下。做一段 30 秒悬疑漫剧，不揭示写信人的身份，只出现这两个人物，保持人物外观与服装连续。" },
  { id: "coffee", style: "清新广告", duration: 20, ratio: "9:16", prompt: "做一条 20 秒的咖啡产品短片，无人出镜。清晨阳光穿过窗户，咖啡滴入白瓷杯，热气缓缓升起，最后停在安静的产品特写。保持同一只白瓷杯，温暖、有电影感，用简短字幕传达慢下来的一刻，不添加品牌或功效承诺。" },
] as const;
type Inspiration = (typeof templates)[number];
const availableModels = computed(() => customProviders.value.filter(provider => typeof provider.apiKey === "string" && provider.apiKey.trim()).flatMap(provider => provider.models.filter(model => model.id.trim()).map(model => ({ value: JSON.stringify([provider.id, model.id]), providerId: provider.id, modelId: model.id, label: `${provider.label} · ${model.label}` }))));
const allProjects = computed(() => [...workspace.projectList].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt));
const visibleProjects = computed(() => activeSection.value === "projects" ? allProjects.value.filter(item => !projectQuery.value.trim() || item.name.toLowerCase().includes(projectQuery.value.trim().toLowerCase())) : allProjects.value.slice(0, 4));
watch(availableModels, models => { if (!models.some(model => model.value === selectedModel.value)) selectedModel.value = models.find(model => /deepseek/i.test(model.providerId))?.value || models[0]?.value || ""; }, { immediate: true });
watch(prompt, text => {
  const requestedRatio = text.match(/\b(16[:：]9|9[:：]16|1[:：]1)\b/)?.[1]?.replace("：", ":");
  if (requestedRatio === "16:9" || requestedRatio === "9:16" || requestedRatio === "1:1") ratio.value = requestedRatio;
  if (requestedMediaDuration.value === 5 || requestedMediaDuration.value === 10) mediaDuration.value = requestedMediaDuration.value;
});
function mediaModelKey(model: { providerId: string; modelId: string }) { return JSON.stringify([model.providerId, model.modelId]); }
watch(imageModels, models => { if (!models.some(model => mediaModelKey(model) === imageSelection.value)) { const preferred = models.find(model => /gpt-image/.test(model.modelId)) || models[0]; imageSelection.value = preferred ? mediaModelKey(preferred) : ""; } });
watch(videoModels, models => { if (!models.some(model => mediaModelKey(model) === videoSelection.value)) videoSelection.value = models[0] ? mediaModelKey(models[0]) : ""; });
async function loadMediaCapabilities() {
  mediaLoading.value = true; mediaError.value = "";
  try {
    const { data } = await axios.get<{ code: number; data: { mediaModels: MediaModel[]; configuredMediaProviders: string[] }; message?: string }>("/api/director/capabilities", { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200) throw new Error(data.message || "读取生成模型失败");
    mediaModels.value = data.data.mediaModels; configuredProviders.value = data.data.configuredMediaProviders;
  } catch (cause) { if (!lifetime.signal.aborted) mediaError.value = directorError(cause); }
  finally { mediaLoading.value = false; }
}
watch(settingsVisible, (visible, before) => { if (!visible && before) void loadMediaCapabilities(); });

onMounted(async () => {
  void loadMediaCapabilities();
  try {
    const { data } = await axios.get<{ code: number; data: Project[]; message?: string }>("/api/director/projects", { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "读取已有项目失败");
    const remote = new Map(data.data.map(item => [item.directory, item]));
    const knownDirectories = new Set(workspace.projectList.map(item => item.directory));
    workspace.projectList = [...workspace.projectList.map(item => {
      const latest = remote.get(item.directory);
      return latest ? { ...item, ...latest, lastOpenedAt: item.lastOpenedAt, previewAsset: latest.previewAsset } : item;
    }), ...data.data.filter(item => !knownDirectories.has(item.directory))];
  } catch (cause) { if (!lifetime.signal.aborted && !error.value) error.value = directorError(cause); }
});
watch(() => [route.query.project, workspace.projectList] as const, ([name, projects]) => {
  if (typeof name !== "string" || busy.value) return;
  const project = projects.find(item => item.directory.split(/[\\/]/).at(-1) === name);
  if (project) void openProject(project);
}, { immediate: true });

function formatDate(value: number) { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
async function showCreation() {
  activeSection.value = "create";
  contentRoot.value?.scrollTo({ top: 0, behavior: "smooth" });
  await nextTick();
  if (usesPrompt.value) promptInput.value?.focus({ preventScroll: true });
  else titleInput.value?.focus({ preventScroll: true });
}
function newCreation() {
  if (busy.value) return;
  prompt.value = ""; attempted.value = false; creativeIntent.value = "auto"; mode.value = "create"; referenceUpload.value = undefined; referencePreview.value = ""; referenceIdentity.value = ""; briefDraft.value = null; briefSignature = ""; briefVisible.value = false; briefError.value = ""; generationReviewVisible.value = false; generationReviewError.value = ""; importedName.value = ""; projectTitle.value = ""; error.value = ""; projectQuery.value = ""; lastSignature = ""; lastRequestId = "";
  try { sessionStorage.removeItem("cinePilotWebStart"); sessionStorage.removeItem("cinePilotWebCreate"); sessionStorage.removeItem("cinePilotWebBrief"); } catch { /* 新建项目不依赖会话存储。 */ }
  void showCreation();
}
function showProjects() { activeSection.value = "projects"; contentRoot.value?.scrollTo({ top: 0, behavior: "smooth" }); }
function selectMode(value: CreationMode) { if (busy.value) return; mode.value = value; error.value = ""; void showCreation(); }
function useTemplate(item: Inspiration) { mode.value = "comic"; prompt.value = item.prompt; attempted.value = false; duration.value = item.duration; style.value = item.style; ratio.value = item.ratio; importedName.value = ""; error.value = ""; void showCreation(); }
function currentBriefSignature() { return JSON.stringify({ brief: prompt.value.trim(), style: style.value, ratio: ratio.value, duration: duration.value, model: selectedModel.value, reference: referenceIdentity.value }); }
watch([prompt, style, ratio, duration, selectedModel, referenceIdentity], () => { briefSignature = ""; briefDraft.value = null; briefError.value = ""; });
async function enterProject(directory: string, name?: string, view?: "edit" | "canvas", extra: Record<string, string> = {}, message?: string, attachments?: AgentAttachment[]) {
  await workspace.openProject(directory, directory, lifetime.signal);
  if (name) workspace.renameProject(directory, name);
  if (message) workspace.pendingAgentMessage = { directory, prompt: message, model: selectedModel.value, reasoningEffort: "", attachments };
  await router.push({ path: "/workspace", query: { ...(view ? { view } : {}), ...extra } });
}
async function openProject(item: Project) {
  if (busy.value) return;
  pendingAction.value = "openProject"; error.value = "";
  try { await enterProject(item.directory, item.name); }
  catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pendingAction.value = ""; }
}
async function openDemo(production: boolean) {
  if (busy.value) return;
  pendingAction.value = "openDemo"; error.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: { directory: string }; message?: string }>(production ? "/api/director/productionDemo" : "/api/director/demo", {}, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "示例打开失败");
    await enterProject(data.data.directory, production ? "雾港来信 · 漫剧演示" : "清晨第一杯 · 演示项目");
  } catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pendingAction.value = ""; }
}
async function chooseProject() {
  if (busy.value) return;
  pendingAction.value = "chooseProject"; error.value = "";
  try { const directory = await picker.value?.chooseDirectory(); if (directory) await enterProject(directory); }
  catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pendingAction.value = ""; }
}
function requestId(storageKey: string, signature: string) {
  if (lastSignature !== signature) { lastSignature = signature; lastRequestId = crypto.randomUUID(); }
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (saved?.signature === signature && typeof saved.requestId === "string") lastRequestId = saved.requestId;
    sessionStorage.setItem(storageKey, JSON.stringify({ signature, requestId: lastRequestId }));
  } catch { /* 会话存储不可用时，仍保留当前页面的请求ID。 */ }
  return lastRequestId;
}
async function createBlankProject() {
  const kind = mode.value === "edit" ? "edit" : "canvas";
  const fields = { kind, title: projectTitle.value.trim() || (kind === "edit" ? "新的剪辑项目" : "新的画布项目") };
  pendingAction.value = kind === "edit" ? "createEdit" : "createCanvas"; error.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: { directory: string; title: string }; message?: string }>("/api/director/create", { ...fields, requestId: requestId("cinePilotWebCreate", JSON.stringify(fields)) }, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "项目创建失败，请稍后重试");
    await enterProject(data.data.directory, data.data.title, kind);
    try { sessionStorage.removeItem("cinePilotWebCreate"); } catch { /* 项目已保存。 */ }
  } catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pendingAction.value = ""; }
}
async function createFromTemplate(templateId: string, templateOverrides?: CreativeTemplateOverrides) {
  if (busy.value) return;
  const template = creativeTemplates.find(item => item.id === templateId);
  if (!template) return;
  const fields = { kind: "canvas", title: templateOverrides?.title || template.title, templateId, ...(templateOverrides ? { templateOverrides } : {}) };
  pendingAction.value = "createTemplate"; creatingTemplateId.value = templateId; templateError.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: { directory: string; title: string }; message?: string }>("/api/director/create", { ...fields, requestId: requestId("cinePilotTemplateCreate", JSON.stringify(fields)) }, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "模板项目创建失败，请重试");
    await enterProject(data.data.directory, data.data.title, "canvas");
    library.value?.close();
    lastSignature = ""; lastRequestId = "";
    try { sessionStorage.removeItem("cinePilotTemplateCreate"); } catch { /* 项目已保存，下次创建使用新的请求 ID。 */ }
  } catch (cause) {
    if (!lifetime.signal.aborted) templateError.value = axios.isAxiosError(cause) && !cause.response
      ? "暂时无法连接本地服务，请确认 CinePilot 正常运行后重试。重复提交会恢复同一项目。"
      : directorError(cause);
  }
  finally { pendingAction.value = ""; creatingTemplateId.value = ""; }
}
async function startCreation() {
  if (busy.value) return;
  if (!usesPrompt.value) return createBlankProject();
  attempted.value = true;
  if (!prompt.value.trim()) { await nextTick(); promptInput.value?.focus(); return; }
  if (resolvedIntent.value === "image" || resolvedIntent.value === "video") { generationReviewError.value = ""; generationReviewVisible.value = true; return; }
  if (resolvedIntent.value === "chat") return startCreativeConversation();
  if (!availableModels.value.length) { error.value = "先在模型设置中连接文字模型，再整理创作简报。你的想法会保留。"; settingsVisible.value = true; return; }
  const model = availableModels.value.find(item => item.value === selectedModel.value) || availableModels.value[0]!;
  const signature = currentBriefSignature();
  if (briefDraft.value && briefSignature === signature) { briefVisible.value = true; return; }
  const fields = { brief: prompt.value.trim(), style: style.value, ratio: ratio.value, targetDuration: duration.value, providerId: model.providerId, modelId: model.modelId, hasReference: Boolean(referenceUpload.value) };
  pendingAction.value = "brief"; error.value = ""; briefError.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: CreativeBriefDraft; message?: string }>("/api/director/brief", { ...fields, requestId: requestId("cinePilotWebBrief", JSON.stringify(fields)) }, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "创作简报整理失败，请重试");
    if (signature !== currentBriefSignature()) { error.value = "创意或参数已变化，请重新整理简报。"; return; }
    preparedModel = model;
    briefDraft.value = data.data; briefSignature = signature; briefVisible.value = true;
  } catch (cause) { if (!lifetime.signal.aborted) error.value = homeRequestError(cause); }
  finally { pendingAction.value = ""; }
}
async function startCreativeConversation() {
  if (!availableModels.value.length) { error.value = "先连接文字模型，助手才能和你讨论创作要求。"; settingsVisible.value = true; return; }
  pendingAction.value = "createChat"; error.value = "";
  try {
    const fields = { kind: "canvas", title: prompt.value.trim().slice(0, 24) || "新的创作对话" };
    const { data } = await axios.post<{ code: number; data: { directory: string; title: string }; message?: string }>("/api/director/create", { ...fields, requestId: requestId("cinePilotChatCreate", JSON.stringify({ ...fields, prompt: prompt.value })) }, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200) throw new Error(data.message || "创作对话创建失败");
    let attachments: AgentAttachment[] | undefined;
    if (referenceUpload.value) {
      const reference = referenceUpload.value;
      const bytes = Uint8Array.from(atob(reference.base64), character => character.charCodeAt(0));
      const asset = await uploadDirectorFile(data.data.directory, new File([bytes], reference.name, { type: reference.mimeType }));
      attachments = [{ ...asset, name: reference.name }];
    }
    await enterProject(data.data.directory, data.data.title, "canvas", { assistant: "1" }, prompt.value.trim(), attachments);
    try { sessionStorage.removeItem("cinePilotChatCreate"); } catch { /* 对话已移交工作台。 */ }
  } catch (cause) { if (!lifetime.signal.aborted) error.value = homeRequestError(cause); }
  finally { pendingAction.value = ""; }
}
async function confirmMediaCreation() {
  if (busy.value || generationReviewIssue.value || !generationModel.value || !["image", "video"].includes(resolvedIntent.value)) return;
  const kind = resolvedIntent.value as "image" | "video";
  const image = imageModels.value.find(model => mediaModelKey(model) === imageSelection.value);
  const video = videoModels.value.find(model => mediaModelKey(model) === videoSelection.value);
  if (kind === "video" && !video) { generationReviewError.value = "请先配置视频模型，再开始视频制作。"; return; }
  const fields = { kind: "canvas", title: prompt.value.trim().slice(0, 30), creativeRequest: { kind, prompt: prompt.value.trim(), style: style.value, ratio: ratio.value, duration: mediaDuration.value, models: { ...(image ? { image: { providerId: image.providerId, modelId: image.modelId } } : {}), ...(video ? { video: { providerId: video.providerId, modelId: video.modelId } } : {}) }, ...(referenceUpload.value ? { referenceUpload: referenceUpload.value } : {}) } };
  pendingAction.value = "createMedia"; generationReviewError.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: { directory: string; title: string; project: DirectorProject; focusNodeId?: string; initialGeneration: DirectorGenerationInput | null }; message?: string }>("/api/director/create", { ...fields, requestId: requestId("cinePilotMediaCreate", JSON.stringify(fields)) }, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200) throw new Error(data.message || "创作任务创建失败");
    const created = data.data;
    let entryNotice = "";
    if (created.initialGeneration) {
      try { await directorRequest<DirectorProject>("/generation", created.directory, { ...created.initialGeneration, expectedRevision: created.project.revision }, lifetime.signal); }
      catch (cause) {
        entryNotice = axios.isAxiosError(cause) && cause.response && cause.response.status < 500 ? "submissionRejected" : "checkSubmission";
        if (entryNotice === "submissionRejected") {
          try { sessionStorage.setItem(`cinePilotEntryError:${created.project.id}`, directorError(cause)); } catch { /* 节点保留原始输入，仍可修正。 */ }
        }
      }
    } else entryNotice = "configureModel";
    await enterProject(created.directory, created.title, "canvas", { ...(created.focusNodeId ? { focusNode: created.focusNodeId } : {}), ...(entryNotice ? { entryNotice } : {}) });
    try { sessionStorage.removeItem("cinePilotMediaCreate"); } catch { /* 任务请求 ID 已保存在项目。 */ }
  } catch (cause) { if (!lifetime.signal.aborted) generationReviewError.value = homeRequestError(cause); }
  finally { pendingAction.value = ""; }
}
async function confirmBrief(confirmed: { title: string; brief: string; characterConstraints: string; invariants: string }) {
  if (busy.value || !briefDraft.value || !preparedModel) return;
  if (briefSignature !== currentBriefSignature()) { briefError.value = "创意或参数已变化，请返回首页重新整理简报。"; return; }
  const model = preparedModel;
  const fields = { ...confirmed, style: style.value, ratio: ratio.value, targetDuration: duration.value, shotCount: duration.value === 60 ? 12 : duration.value === 20 ? 4 : 6, providerId: model.providerId, modelId: model.modelId };
  const signature = JSON.stringify({ ...fields, reference: referenceIdentity.value });
  pendingAction.value = "start"; briefError.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: { directory: string; title: string }; message?: string }>("/api/director/start", { ...fields, ...(referenceUpload.value ? { referenceUpload: referenceUpload.value } : {}), requestId: requestId("cinePilotWebStart", signature) }, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "剧本起草失败，请稍后重试");
    saveWebPlanningModel(data.data.directory, model.value);
    await enterProject(data.data.directory, data.data.title);
    briefVisible.value = false; briefSignature = ""; briefDraft.value = null;
    try { sessionStorage.removeItem("cinePilotWebStart"); sessionStorage.removeItem("cinePilotWebBrief"); } catch { /* 项目已保存。 */ }
  } catch (cause) { if (!lifetime.signal.aborted) briefError.value = homeRequestError(cause); }
  finally { pendingAction.value = ""; }
}
function homeRequestError(cause: unknown) { return axios.isAxiosError(cause) && !cause.response ? "暂时无法连接本地服务，请确认 CinePilot 正常运行后重试。已填内容会保留。" : directorError(cause); }
function chooseAttachment(command: string) { if (busy.value) return; if (command === "script") scriptInput.value?.click(); else if (command === "reference") referenceInput.value?.click(); }
function removeReference() { if (busy.value) return; referenceUpload.value = undefined; referencePreview.value = ""; referenceIdentity.value = ""; }
async function importReference(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = "";
  if (file) await readReference(file);
}
function dropReference(event: DragEvent) {
  if (!usesPrompt.value || busy.value) return;
  const files = [...(event.dataTransfer?.files || [])];
  if (files.length > 1) { error.value = "当前首页一次使用一张参考图，请选择一张；多素材可在画布中连接。"; return; }
  if (files[0]) void readReference(files[0]);
}
function pasteReference(event: ClipboardEvent) {
  if (!usesPrompt.value || busy.value) return;
  const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith("image/"));
  if (file) { event.preventDefault(); void readReference(file); }
}
async function readReference(file: File) {
  if (!file || busy.value) return;
  readingReference.value = true; error.value = "";
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024 || !file.size) throw new Error("请选择 8 MB 以内的 PNG、JPG 或 WebP 参考图。");
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("参考图读取失败")); reader.onerror = () => reject(new Error("参考图读取失败，请重新选择")); reader.readAsDataURL(file); });
    lifetime.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => !image.naturalWidth || !image.naturalHeight ? reject(new Error("参考图没有有效尺寸")) : image.naturalWidth * image.naturalHeight > 32000000 ? reject(new Error("参考图像素超过限制，请使用不超过 3200 万像素的图片")) : resolve(); image.onerror = () => reject(new Error("无法打开这张参考图，请选择有效图片")); image.src = dataUrl; });
    lifetime.signal.throwIfAborted();
    referenceUpload.value = { name: file.name.slice(0, 200), mimeType: file.type, base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
    referencePreview.value = dataUrl; referenceIdentity.value = crypto.randomUUID();
  } catch (cause) { if (!lifetime.signal.aborted) error.value = homeRequestError(cause); }
  finally { readingReference.value = false; }
}
async function importScript(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ""; if (!file || busy.value) return;
  pendingAction.value = "readScript";
  try { if (!/\.(txt|md)$/i.test(file.name) || file.size > 100000) throw new Error("请选择 100 KB 以内的 TXT 或 Markdown 剧本。"); const text = (await file.text()).trim(); lifetime.signal.throwIfAborted(); if (!text || text.length > 10000) throw new Error("剧本文字需为 1 至 10000 字，请精简后重新导入。"); mode.value = "comic"; prompt.value = text; importedName.value = file.name; error.value = ""; await showCreation(); }
  catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pendingAction.value = ""; }
}
onScopeDispose(() => lifetime.abort());
</script>

<style scoped lang="scss">
.projectStage { position: absolute; top: 11px; right: 11px; border: 1px solid #ffffff20; border-radius: 6px; background: #0c161be6; color: #d7e4db; font-size: 10px; padding: 5px 7px; &.generating { color: #a9d6ff; } &.review { color: #e3c18c; } }
.projectPoster > .studioThumbnail { position: absolute; inset: 0; :deep(img) { object-fit: cover; } }
.creationReview {
  color: #dce5df; font-family: Inter, "PingFang SC", sans-serif;
  .requestSummary { display: flex; gap: 14px; align-items: flex-start; padding: 16px; border: 1px solid #ffffff14; border-radius: 12px; background: #171d19; > img { width: 74px; height: 74px; border-radius: 8px; object-fit: cover; } > p { margin: 0; font-size: 14px; line-height: 1.8; white-space: pre-wrap; max-height: 180px; overflow: auto; overflow-wrap: anywhere; } }
  .flowExplanation, .reviewCost { font-size: 12px; line-height: 1.9; color: #a8b6ad; margin: 14px 0; }
  .reviewFields { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; > label { display: grid; gap: 8px; font-size: 12px; color: #9eafa4; > select { width: 100%; min-width: 0; padding: 10px; font: inherit; color: #e6eee9; border: 1px solid #45564a; border-radius: 8px; background: #202a24; } } }
  .reviewError { color: #e4b18b; font-size: 12px; line-height: 1.8; > button { margin-left: 8px; color: inherit; background: none; border: 0; text-decoration: underline; cursor: pointer; } }
  .reviewActions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; > button { display: inline-flex; align-items: center; gap: 8px; padding: 11px 16px; border: 1px solid #ffffff20; border-radius: 9px; background: #252e28; color: #d5e2da; font: inherit; font-size: 12px; cursor: pointer; &.confirmGeneration { border-color: #00dc69; background: #00dc69; color: #082b16; font-weight: 600; } &:disabled { opacity: .5; cursor: wait; } } }
}
.intentChoice { > select { border: 1px solid #ffffff19; border-radius: 8px; padding: 8px; color: #d1dfd7; background: #202923; font-size: 12px; max-width: 140px; } }
.webHome {
  --el-color-primary: #00dc69; display: flex; height: 100dvh; min-height: 0; background: #0b0d0c; color: #eceeef; font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  *, *::before, *::after { box-sizing: border-box; }
  button, input, textarea, select { font: inherit; }
  button { cursor: pointer; transition: background .16s, border-color .16s, color .16s; &:disabled { opacity: .45; cursor: not-allowed; } }
  button, a, textarea, select, input { &:focus-visible { outline: 2px solid #00dc69; outline-offset: 4px; } }
  .studioSidebar { width: 220px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid #ffffff0d; padding: 30px 16px 20px; background: #101112;
    .studioLogo { display: flex; align-items: center; gap: 10px; color: #f3f4f5; text-decoration: none; margin: 0 7px 35px; img { width: 37px; height: 37px; object-fit: contain; } > span { font-size: 22px; font-weight: 650; letter-spacing: -.7px; } small { display: block; margin-top: 5px; color: #74797f; font-size: 8px; letter-spacing: 1.8px; font-weight: 400; } }
    .newCreation { height: 43px; display: flex; gap: 9px; align-items: center; justify-content: center; border: 1px solid #ffffff25; border-radius: 10px; background: #1b1d20; color: #edeff1; font-size: 13px; font-weight: 500; &:hover:not(:disabled) { background: #26292d; border-color: #ffffff45; } }
    .sideNavigation { display: grid; gap: 6px; margin-top: 18px; > button { display: flex; align-items: center; gap: 11px; border: 0; border-radius: 9px; min-height: 43px; padding: 11px 13px; background: transparent; color: #969ba3; text-align: left; font-size: 13px; > b { margin-left: auto; color: #70757c; font-size: 11px; font-weight: 400; } &.active { color: #f1f3f4; background: #22252a; svg { color: #00dc69; } } &:hover { color: #f1f3f4; background: #1c1f22; } } }
    .sidebarRecent { border-top: 1px solid #ffffff0c; margin: 25px 9px 0; padding-top: 22px; > span { color: #737982; font-size: 11px; } > button { display: flex; gap: 9px; align-items: center; width: 100%; padding: 16px 0 0; background: none; border: 0; color: #a0a6af; text-align: left; font-size: 11px; > span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } > svg { flex-shrink: 0; color: #69717a; } &:hover { color: #eceff2; } } }
    .sidebarBottom { margin-top: auto; padding-top: 45px; > button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 12px; background: none; border: 0; border-radius: 8px; color: #979da6; font-size: 12px; &:hover { background: #1b1e22; color: #f0f2f4; } > i { width: 5px; height: 5px; border-radius: 50%; background: #a88d5f; margin-left: auto; &.ready { background: #00dc69; } } } > small { display: block; color: #555c66; font-size: 9px; margin: 19px 12px 0; } }
  }
  .studioMain { min-width: 0; flex: 1; overflow: auto; padding: 0 44px; background-color: #0b0d0c; background-image: radial-gradient(circle, #ffffff35 .8px, transparent .9px); background-size: 30px 30px; background-position: 14px 14px;
    .topNavigation { height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 20px; .workspaceLabel { display: flex; align-items: center; gap: 8px; color: #8f969f; font-size: 11px; > i { width: 5px; height: 5px; background: #00dc69; border-radius: 50%; } } .topActions { display: flex; gap: 19px; align-items: center; > span { color: #656d77; font-size: 10px; } > button { display: grid; place-items: center; border: 1px solid #ffffff13; border-radius: 8px; background: #17191c; color: #a2a8b1; padding: 8px; &:hover { color: #f0f2f4; border-color: #ffffff30; } } } }
    .homeError { max-width: 1000px; margin: 8px auto 0; display: flex; align-items: center; gap: 10px; padding: 12px 15px; border: 1px solid #8d633d; border-radius: 10px; background: #29231c; color: #deb583; font-size: 12px; > span { flex: 1; } > button { display: grid; place-items: center; border: 0; color: inherit; background: none; padding: 2px; } }
    .creationHero {
      max-width: 1000px; margin: 15px auto 0; text-align: center;
      .creationModes { display: inline-flex; align-items: center; gap: 4px; padding: 5px; border: 1px solid #ffffff0a; background: #191c1a; border-radius: 28px;
        > button { display: flex; gap: 7px; align-items: center; border: 0; border-radius: 24px; padding: 11px 22px; background: none; color: #a0a6a2; font-size: 12px; white-space: nowrap;
          &.active { color: #111715; background: #f0f2f1; box-shadow: 0 2px 8px #0003; }
          &:hover:not(:disabled):not(.active) { background: #282e2a; color: #e6eeea; }
        }
      }
      .heroHeading { margin-top: 40px;
        h1 { margin: 0 0 12px; color: #f2f5f3; font-size: clamp(28px, 3vw, 40px); font-weight: 550; letter-spacing: -1.3px; line-height: 1.4; }
        p { color: #9aa49e; font-size: 13px; line-height: 1.9; margin: 0 0 28px; }
      }
      .promptComposer { position: relative; text-align: left; background: #141715; border: 1px solid #484d49; border-radius: 24px; padding: 18px 20px 17px; box-shadow: 0 12px 40px #0002;
        &:focus-within { border-color: #767f79; }
        .composerAttachments { display: flex; align-items: center; flex-wrap: wrap; min-height: 53px; gap: 11px; margin-bottom: 18px;
          .addAttachment { display: grid; place-items: center; width: 53px; height: 53px; border: 1px dashed #4c544e; border-radius: 14px; background: #1d211e; color: #a6b0a9; padding: 0;
            &:hover:not(:disabled) { border-color: #99b5a4; background: #252e28; color: #e8f1ec; }
          }
          .referenceAttachment { display: flex; align-items: center; gap: 9px; min-width: 0; max-width: min(350px, 100%); min-height: 53px; border: 1px solid #ffffff12; border-radius: 10px; padding: 5px 8px 5px 5px; background: #1e2520;
            > img { width: 41px; height: 41px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
            > span { min-width: 0; > strong { display: block; font-size: 11px; font-weight: 500; color: #d4e0d9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } > small { display: block; color: #8b9b91; font-size: 9px; margin-top: 5px; } }
            > button { flex-shrink: 0; display: grid; place-items: center; padding: 4px; border: 0; background: none; color: #94a29a; &:hover:not(:disabled) { color: #f4f7f5; } }
          }
          .scriptAttachment { display: inline-flex; align-items: center; gap: 7px; min-width: 0; max-width: 240px; padding: 8px 10px; border: 1px solid #ffffff12; border-radius: 8px; background: #202621; color: #aab8af; font-size: 11px;
            > svg, > button { flex-shrink: 0; } > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } > button { display: grid; place-items: center; padding: 2px; border: 0; background: none; color: #95a399; }
          }
        }
        .fieldError { color: #e7b381; font-size: 11px; line-height: 1.7; margin: 6px 0 0; }
        > textarea { display: block; resize: vertical; width: 100%; min-height: 141px; max-height: 310px; padding: 0 2px; border: 0; background: none; font-size: 17px; color: #e8efeb; line-height: 1.9; outline: 0;
          &::placeholder { color: #78847c; } &[aria-invalid="true"]::placeholder { color: #b59b80; }
        }
        .blankProjectContent { display: grid; grid-template-columns: auto 1fr; column-gap: 15px; min-height: 220px; padding: 9px 4px;
          .blankProjectIcon { display: grid; place-items: center; height: 52px; width: 52px; border: 1px solid #ffffff16; border-radius: 13px; background: #222a25; color: #b6c5bc; }
          > div { padding-top: 5px; > strong { font-weight: 500; font-size: 17px; color: #e0ebe4; } > p { font-size: 12px; line-height: 1.9; color: #8e9e94; margin: 8px 0 0; } }
          > label { grid-column: 2; margin-top: 23px; font-size: 11px; color: #98a69e;
            input { display: block; border: 1px solid #ffffff17; border-radius: 8px; background: #111613; color: #e2ede6; padding: 10px 12px; width: 100%; max-width: 390px; font-size: 13px; margin-top: 8px; outline: none; &:focus { border-color: #718c7c; } &::placeholder { color: #6c7b72; } }
          }
        }
        .composerFooter { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px;
          .composerTools { display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
            > button { display: flex; align-items: center; gap: 6px; border: 0; background: none; color: #aab6ae; padding: 8px 9px; border-radius: 7px; font-size: 12px; white-space: nowrap; &:hover:not(:disabled) { background: #ffffff09; color: #e0eee5; } }
          }
          .blankProjectNote { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #8a9b90; > svg { color: #00dc69; flex-shrink: 0; } }
          .createButton { display: inline-flex; justify-content: center; align-items: center; gap: 11px; flex-shrink: 0; white-space: nowrap; min-height: 43px; padding: 10px 17px; border: 0; border-radius: 13px; color: #092114; background: #00dc69; font-size: 12px; font-weight: 600;
            &:hover:not(:disabled) { background: #35e688; } &:disabled { color: #8ac29f; background: #21402e; opacity: .85; }
          }
        }
        .creationOptions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; border-top: 1px solid #ffffff10; margin-top: 17px; padding-top: 16px;
          > label { color: #a2b1a8; font-size: 11px; select { display: block; width: 100%; min-width: 0; margin-top: 7px; color: #d1dfd7; border: 1px solid #414d45; border-radius: 7px; background: #222b25; padding: 8px; font-size: 11px; } }
        }
      }
      .composerHint { margin: 13px 5px 0; display: flex; justify-content: center; align-items: center; gap: 12px; min-height: 18px; color: #87968c; font-size: 10px; line-height: 1.8;
        > span { display: flex; gap: 7px; align-items: center; } > button { display: inline-flex; align-items: center; gap: 5px; color: #b2c0b7; background: none; border: 0; font-size: 10px; padding: 0; }
        .loadingDot { width: 5px; height: 5px; border-radius: 50%; background: #00dc69; animation: pulse 1.2s ease-in-out infinite; }
      }
      .quickTemplates { display: flex; align-items: center; justify-content: center; gap: 11px; flex-wrap: wrap; margin-top: 23px;
        > button { display: inline-flex; align-items: center; gap: 10px; min-width: 170px; color: #c3cdc7; border: 1px solid #38473d; background: #141b17; border-radius: 14px; padding: 6px 11px 6px 6px; font-size: 12px;
          > img, .canvasPreview { display: block; width: 43px; height: 34px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
          .canvasPreview { display: grid; place-items: center; color: #a4b6aa; border: 1px solid #445149; background-color: #101412; background-image: radial-gradient(#ffffff45 .65px, transparent .8px); background-size: 5px 5px; }
          > svg { color: #708c7b; margin-left: auto; }
          &:nth-child(2) { border-color: #4a4030; background: #1c1913; }
          &:nth-child(3) { border-color: #3d3d55; background: #191820; }
          &:last-child { border-color: #414a44; background: #141715; }
          &:hover:not(:disabled) { border-color: #819c8c; background: #222e26; color: #eef6f1; }
        }
      }
    }
    .textButton { display: inline-flex; align-items: center; justify-content: center; gap: 7px; background: none; border: 0; color: #a3afbd; padding: 0; font-size: 11px; &:hover:not(:disabled) { color: #eef2f7; } }
    .projectsSection { max-width: 1000px; margin: 56px auto 0;
      .sectionHeading { display: flex; gap: 15px; justify-content: space-between; align-items: center; margin-bottom: 19px; h2 { display: flex; gap: 9px; align-items: center; font-size: 17px; font-weight: 500; color: #e0e6ed; margin: 0; > span { font-size: 10px; color: #7d8997; font-weight: 400; border: 1px solid #343d48; padding: 2px 5px; border-radius: 5px; } } p { margin: 7px 0 0; font-size: 11px; color: #6e7d8e; } }
      .projectSearch { display: flex; align-items: center; gap: 7px; padding: 9px 12px; color: #7e8fa3; background: #171c23; border: 1px solid #303b49; border-radius: 9px; input { outline: 0; width: 140px; border: 0; background: none; color: #d0dae6; font-size: 11px; &::placeholder { color: #738299; } } }
      .projectGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; .projectCard { min-width: 0; background: #181b20; border: 1px solid #2a3039; border-radius: 12px; padding: 0; overflow: hidden; text-align: left; &:hover:not(:disabled) { border-color: #606b79; .continueLabel { color: #e7edf4; } } .projectPoster { position: relative; height: 124px; display: flex; justify-content: center; align-items: center; color: #68788d; background: #202630; overflow: hidden; > img { width: 100%; height: 100%; object-fit: cover; object-position: center 48%; filter: brightness(.72); } .continueLabel { position: absolute; left: 10px; bottom: 10px; display: flex; align-items: center; gap: 5px; color: #c4cedb; font-size: 9px; padding: 5px 7px; border: 1px solid #ffffff15; background: #141a23b8; border-radius: 5px; } } .projectInfo { padding: 13px; h3 { margin: 0; color: #d1dae5; font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } p { display: flex; justify-content: space-between; align-items: center; margin: 9px 0 0; color: #72839a; font-size: 10px; > svg { color: #71849c; } } } } }
      .projectEmpty { display: flex; gap: 13px; align-items: center; padding: 25px; background: #151a21; border: 1px dashed #354151; border-radius: 12px; > svg { color: #6c7f98; flex-shrink: 0; } > div { flex: 1; strong { color: #bccbde; font-size: 12px; font-weight: 400; } p { font-size: 11px; color: #768aa5; margin: 7px 0 0; } } }
      .projectFooter { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-top: 19px; .demoLinks { display: flex; align-items: center; gap: 13px; > span { font-size: 10px; color: #5f7087; } > button { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; color: #8296b1; font-size: 10px; &:hover:not(:disabled) { color: #c4d6ee; } } } }
    }
    .mainFooter { max-width: 1000px; display: flex; justify-content: space-between; margin: 36px auto 23px; color: #53627a; font-size: 9px; > button { background: none; border: 0; color: inherit; font-size: inherit; padding: 0; } }
  }
  .fileInput { display: none; }
  .screenReaderOnly { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
}
.attachmentMenu :deep(.el-dropdown-menu__item) { gap: 9px; }
.creditsContent { color: #a4adb9; font-size: 12px; line-height: 1.9; a { color: #00dc69; } }
:global(.webCreditsDialog) { --el-dialog-bg-color: #1b1e24; --el-text-color-primary: #e1e7ef; --el-text-color-regular: #a3afbf; --el-color-primary: #00dc69; border: 1px solid #384354; border-radius: 16px; }
@keyframes pulse { 50% { opacity: .3; } }
@keyframes spin { to { transform: rotate(360deg); } }
.spinner { animation: spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .spinner, .loadingDot { animation: none !important; } }
@media (min-width: 1600px) { .webHome .studioMain .creationHero { margin-top: 26px; .heroHeading { margin-top: 48px; } } }
@media (max-width: 1100px) { .webHome { .studioSidebar { width: 190px; padding-inline: 12px; .studioLogo { margin-inline: 5px; > span { font-size: 19px; } } } .studioMain { padding-inline: 25px; .creationHero .creationModes > button { padding-inline: 15px; } .projectsSection .projectGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } } } }
@media (max-width: 750px) {
  .webHome {
    .studioSidebar { width: 64px; padding: 22px 8px 14px; .studioLogo { margin: 0 4px 27px; img { width: 32px; height: 32px; } > span { display: none; } } .newCreation { padding: 0; height: 38px; gap: 0; > span { display: none; } } .sideNavigation > button { justify-content: center; padding: 12px 5px; gap: 0; > span, > b { display: none; } } .sidebarRecent { display: none; } .sidebarBottom { > button { justify-content: center; padding-inline: 4px; > span, > i { display: none; } } > small { display: none; } } }
    .studioMain { padding-inline: 17px;
      .topNavigation { height: 60px; .workspaceLabel { font-size: 10px; } .topActions { gap: 9px; > span { display: none; } } }
      .creationHero { margin-top: 11px;
        .creationModes { max-width: 100%; padding: 3px; gap: 1px; > button { padding: 10px 9px; font-size: 10px; gap: 5px; > svg { display: none; } } }
        .heroHeading { margin-top: 32px; h1 { font-size: 26px; letter-spacing: -.9px; } p { font-size: 11px; max-width: 270px; margin: 0 auto 23px; } }
        .promptComposer { padding: 14px; border-radius: 18px;
          .composerAttachments { gap: 8px; margin-bottom: 16px; .addAttachment { height: 46px; width: 46px; border-radius: 12px; } .referenceAttachment { max-width: 100%; > span > strong { max-width: 120px; } } .scriptAttachment { max-width: 100%; } }
          > textarea { font-size: 14px; min-height: 140px; }
          .blankProjectContent { min-height: 220px; grid-template-columns: 1fr; .blankProjectIcon { display: none; } > div > strong { font-size: 15px; } > label { grid-column: 1; margin-top: 16px; } }
          .composerFooter { flex-wrap: wrap; gap: 12px; .composerTools { gap: 0; width: 100%; > button { font-size: 10px; padding: 7px 5px; gap: 4px; > svg { width: 15px; } > svg:last-child:not(:first-child) { width: 11px; } } } .blankProjectNote { font-size: 10px; line-height: 1.7; } .createButton { margin-left: auto; min-height: 39px; font-size: 11px; padding: 9px 13px; gap: 7px; } }
          .creationOptions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        .composerHint { font-size: 9px; flex-wrap: wrap; gap: 5px; }
        .quickTemplates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 18px; > button { font-size: 10px; padding: 5px; min-width: 0; gap: 6px; border-radius: 10px; > img, .canvasPreview { width: 32px; height: 28px; border-radius: 6px; } > svg { display: none; } } }
      }
      .projectsSection { margin-top: 36px; .sectionHeading { h2 { font-size: 15px; } p { font-size: 10px; max-width: 180px; line-height: 1.7; } } .projectGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; .projectCard .projectPoster { height: 104px; } } .projectSearch { padding: 7px 8px; input { width: 75px; } } .projectEmpty { padding: 16px; flex-wrap: wrap; > div { min-width: 130px; } > button { margin-left: 35px; } } .projectFooter { flex-wrap: wrap; row-gap: 17px; .demoLinks { gap: 10px; } } }
      .mainFooter { font-size: 8px; gap: 10px; }
    }
  }
}
</style>
