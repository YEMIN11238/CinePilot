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
      <section v-show="activeSection === 'create'" class="creationHero" aria-label="开始创作视频">
        <nav class="creationModes" aria-label="创作方式" role="tablist"><button v-for="item in modes" :key="item.id" type="button" role="tab" :aria-selected="mode === item.id" :class="{ active: mode === item.id }" :disabled="busy" @click="selectMode(item.id)"><component :is="item.icon" :size="16" />{{ item.label }}</button></nav>
        <div class="heroHeading"><span class="heroEyebrow">CINEPILOT</span><h1>{{ modeDetails.heading }}</h1><p>{{ modeDetails.description }}</p></div>
        <form class="promptComposer" @submit.prevent="startCreation">
          <template v-if="mode === 'comic'">
            <label class="briefLabel" for="creationPrompt">创意描述</label>
            <textarea id="creationPrompt" ref="promptInput" v-model="prompt" :disabled="busy" :aria-invalid="Boolean(briefErrors.prompt)" :aria-describedby="briefErrors.prompt ? 'promptError' : undefined" maxlength="10000" placeholder="描述你的故事和想要的画面，也可以导入一份剧本…" @keydown.meta.enter.prevent="startCreation" @keydown.ctrl.enter.prevent="startCreation" />
            <p v-if="briefErrors.prompt" id="promptError" class="fieldError">{{ briefErrors.prompt }}</p>
            <div v-if="importedName" class="importedScript"><icon-file-text :size="14" /><span>{{ importedName }}</span><button type="button" aria-label="关闭剧本来源提示" @click="importedName = ''"><icon-x :size="12" /></button></div>
            <div class="briefDetails">
              <div class="briefField">
                <label for="creationCharacters">角色设定<span>必填</span></label>
                <textarea id="creationCharacters" ref="characterInput" v-model="characterConstraints" :disabled="busy" :aria-invalid="Boolean(briefErrors.characters)" :aria-describedby="briefErrors.characters ? 'charactersError' : undefined" maxlength="6000" placeholder="谁出场、人物关系、固定外观或服装；没有人物请明确说明。" />
                <p v-if="briefErrors.characters" id="charactersError" class="fieldError">{{ briefErrors.characters }}</p>
              </div>
              <div class="briefField">
                <label for="creationInvariants">必须保留项<span>必填</span></label>
                <textarea id="creationInvariants" ref="invariantsInput" v-model="invariants" :disabled="busy || noSpecialRequirements" :aria-invalid="Boolean(briefErrors.invariants)" :aria-describedby="briefErrors.invariants ? 'invariantsError' : undefined" maxlength="4000" placeholder="例如：只出现两位角色、不揭示结局、保留指定台词。" />
                <label class="noRequirements"><input v-model="noSpecialRequirements" type="checkbox" :disabled="busy" />无特殊要求，允许 AI 起草后由我确认</label>
                <p v-if="briefErrors.invariants" id="invariantsError" class="fieldError">{{ briefErrors.invariants }}</p>
              </div>
            </div>
          </template>
          <div v-else class="blankProjectContent"><span class="blankProjectIcon"><icon-layout-board v-if="mode === 'canvas'" :size="27" /><icon-timeline v-else :size="27" /></span><div><strong>{{ mode === 'canvas' ? '一张空白画布，留给你的创意' : '从你已有的素材开始' }}</strong><p>{{ mode === 'canvas' ? '进入后添加文字、参考图片和视频，连接节点继续创作。' : '进入工作台导入视频与图片，再编排镜头、字幕和配乐。' }}</p></div><label for="blankProjectTitle">项目名称<input id="blankProjectTitle" ref="titleInput" v-model="projectTitle" :disabled="busy" maxlength="120" :placeholder="mode === 'canvas' ? '新的画布项目' : '新的剪辑项目'" /></label></div>
          <div class="composerFooter"><div v-if="mode === 'comic'" class="composerTools"><button type="button" :disabled="busy" title="导入 100 KB 以内的 TXT 或 Markdown 剧本" @click="scriptInput?.click()"><icon-paperclip :size="17" /><span>导入剧本</span></button><button type="button" :disabled="busy" :aria-expanded="optionsVisible" @click="optionsVisible = !optionsVisible"><icon-palette :size="16" /><span>{{ style }}</span><icon-chevron-down :size="12" /></button><button type="button" :disabled="busy" :aria-expanded="optionsVisible" @click="optionsVisible = !optionsVisible"><icon-aspect-ratio :size="16" /><span>{{ ratio }} · {{ duration }} 秒</span></button></div><span v-else class="blankProjectNote"><icon-check :size="14" />创建空项目，不调用生成模型</span><button class="createButton" type="submit" :disabled="busy"><icon-loader-2 v-if="busy" :size="17" class="spinner" /><span>{{ busy ? pendingLabel : modeDetails.action }}</span><icon-arrow-up v-if="!busy" :size="19" /></button></div>
          <div v-if="mode === 'comic' && optionsVisible" class="creationOptions"><label>画面风格<select v-model="style" :disabled="busy"><option v-for="value in styles" :key="value" :value="value">{{ value }}</option></select></label><label>画幅<select v-model="ratio" :disabled="busy"><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option></select></label><label>目标时长<select v-model.number="duration" :disabled="busy"><option :value="20">20 秒</option><option :value="30">30 秒</option><option :value="60">60 秒</option></select></label><label>策划模型<select v-model="selectedModel" :disabled="busy || !availableModels.length"><option v-if="!availableModels.length" value="">请先配置模型</option><option v-for="model in availableModels" :key="model.value" :value="model.value">{{ model.label }}</option></select></label></div>
        </form>
        <div class="composerHint" role="status"><span v-if="busy"><i class="loadingDot" />{{ pendingDescription }}</span><span v-else>{{ mode === 'comic' ? '先确认剧本与分镜，再决定生成。⌘ / Ctrl + Enter 开始。' : '图片、视频和每一次修改都会保存在这个项目中。' }}</span><button v-if="!busy && mode === 'comic' && !availableModels.length" type="button" @click="settingsVisible = true">连接策划模型<icon-arrow-right :size="12" /></button></div>
        <div v-if="mode === 'comic'" class="quickTemplates" aria-label="创意模板"><span>试试</span><button v-for="item in templates" :key="item.id" type="button" :disabled="busy" @click="useTemplate(item)"><component :is="item.icon" :size="15" />{{ item.label }}<icon-arrow-up-right :size="12" /></button></div>
      </section>
      <section class="projectsSection" aria-label="我的项目">
        <div class="sectionHeading"><div><h2>{{ activeSection === 'projects' ? '我的项目' : '最近项目' }}<span>{{ workspace.projectList.length }}</span></h2><p>{{ activeSection === 'projects' ? '继续你的故事，或打开已有项目。' : '接着上一次的灵感，继续往下做。' }}</p></div><label v-if="activeSection === 'projects'" class="projectSearch"><icon-search :size="16" /><input v-model="projectQuery" placeholder="搜索项目" aria-label="搜索项目" /></label><button v-else class="textButton" type="button" :disabled="busy" @click="showProjects">查看全部<icon-arrow-right :size="14" /></button></div>
        <div v-if="visibleProjects.length" class="projectGrid"><button v-for="item in visibleProjects" :key="item.directory" class="projectCard" type="button" :disabled="busy" @click="openProject(item)"><div class="projectPoster"><img v-if="item.name.includes('清晨')" src="/studioDemo/finish.png" alt="" /><icon-movie v-else :size="30" /><span class="continueLabel"><icon-player-play :size="13" />继续创作</span></div><div class="projectInfo"><h3>{{ item.name }}</h3><p>{{ formatDate(item.lastOpenedAt) }} 打开<icon-arrow-up-right :size="14" /></p></div></button></div>
        <div v-else class="projectEmpty"><icon-folders :size="24" /><div><strong>{{ projectQuery ? '没有找到这个项目' : '你的第一部作品，从这里开始' }}</strong><p>{{ projectQuery ? '换个关键词，或打开已有项目。' : '创建一个项目，把故事和素材放在一起。' }}</p></div><button class="textButton" type="button" :disabled="busy" @click="projectQuery ? projectQuery = '' : showCreation()">{{ projectQuery ? '清除搜索' : '开始创作' }}<icon-arrow-right :size="14" /></button></div>
        <div class="projectFooter"><button class="textButton" type="button" :disabled="busy" @click="chooseProject"><icon-folder-open :size="15" />打开已有项目</button><div class="demoLinks"><span>示例项目</span><button type="button" :disabled="busy" @click="openDemo(true)">漫剧策划<icon-arrow-up-right :size="12" /></button><button type="button" :disabled="busy" @click="openDemo(false)">咖啡短片<icon-arrow-up-right :size="12" /></button></div></div>
      </section>
      <footer class="mainFooter"><span>为故事而创作</span><button type="button" @click="creditsVisible = true">Demo 与开源说明</button></footer>
    </div>
    <input ref="scriptInput" class="fileInput" type="file" accept=".txt,.md,text/plain,text/markdown" @change="importScript" />
    <workspacePicker ref="picker" hideTrigger /><settings v-model="settingsVisible" />
    <el-dialog v-model="creditsVisible" title="关于 CinePilot" width="min(560px, calc(100vw - 24px))" appendToBody class="webCreditsDialog"><div class="creditsContent"><p>CinePilot 是围绕爱奇艺漫剧创作场景研究制作的 AI Video Agent Demo，提供本机网页版与独立桌面版，并非爱奇艺官方合作产品。</p><p>漫剧策划会调用已配置的文字模型。图片、视频生成在工作台中另行确认；创建空白画布和剪辑项目不会调用模型。</p><p>基于 <a href="https://github.com/HBAI-Ltd/Toonflow-app" target="_blank" rel="noopener noreferrer">Toonflow</a> 二次开发，使用 Vue Flow 和 WebAV；参考 AICON 的画布交互、ViMax 的角色/镜头契约及 OpenCut 的编辑器结构。</p><p><a href="/openSource.txt" target="_blank" rel="noopener noreferrer">完整开源许可证与引用说明</a></p></div></el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import { IconAdjustments, IconAlertCircle, IconArrowRight, IconArrowUp, IconArrowUpRight, IconAspectRatio, IconCheck, IconChevronDown, IconFileText, IconFolderOpen, IconFolders, IconInfoCircle, IconLayoutBoard, IconLoader2, IconMovie, IconPalette, IconPaperclip, IconPlayerPlay, IconPlus, IconSearch, IconSettings, IconSparkles, IconTimeline, IconUsers, IconX } from "@tabler/icons-vue";
import { customProviders } from "@/stores/settings";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import { directorError } from "@/pages/workspace/panels/director/api";
import { saveWebPlanningModel } from "@/lib/webPlanningModel";
import settings from "@/components/settings/index.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";

const router = useRouter();
const route = useRoute();
const workspace = useWorkspaceStore();
const picker = ref<InstanceType<typeof workspacePicker>>();
const promptInput = ref<HTMLTextAreaElement>();
const characterInput = ref<HTMLTextAreaElement>();
const invariantsInput = ref<HTMLTextAreaElement>();
const titleInput = ref<HTMLInputElement>();
const scriptInput = ref<HTMLInputElement>();
const contentRoot = ref<HTMLElement>();
const prompt = ref("");
const characterConstraints = ref("");
const invariants = ref("");
const noSpecialRequirements = ref(false);
const attempted = ref(false);
const briefErrors = computed(() => ({
  prompt: attempted.value && !prompt.value.trim() ? "请先描述你想制作的故事。" : "",
  characters: attempted.value && !characterConstraints.value.trim() ? "请补充出场角色及固定设定；没有人物也请明确说明。" : "",
  invariants: attempted.value && !noSpecialRequirements.value && !invariants.value.trim() ? "请填写必须保留的条件，或明确勾选无特殊要求。" : "",
}));
const importedName = ref("");
type CreationMode = "comic" | "edit" | "canvas";
const mode = ref<CreationMode>("comic");
const projectTitle = ref("");
const activeSection = ref<"create" | "projects">("create");
const style = ref("写实电影感");
const ratio = ref("16:9");
const duration = ref(30);
const styles = ["写实电影感", "国风水墨", "日系动漫", "3D 动画", "复古胶片", "清新广告"];
const modes = [{ id: "comic", label: "漫剧创作", icon: IconSparkles }, { id: "edit", label: "已有素材剪辑", icon: IconTimeline }, { id: "canvas", label: "自由画布", icon: IconLayoutBoard }] as const;
const modeDetails = computed(() => ({
  comic: { heading: "你的下一幕，从这里开始", description: "说出你的故事，让 AI 帮你写剧本、定角色、做分镜。", action: "生成策划" },
  edit: { heading: "把素材，剪成一段故事", description: "从已有的视频和图片开始，编排镜头，完成你的短片。", action: "进入剪辑" },
  canvas: { heading: "给灵感，一张自由画布", description: "连接文字、图像与视频，用你自己的方式探索画面。", action: "打开空白画布" },
}[mode.value]));
const optionsVisible = ref(false);
const settingsVisible = ref(false);
const creditsVisible = ref(false);
const pendingAction = ref<"" | "start" | "createCanvas" | "createEdit" | "openProject" | "openDemo" | "chooseProject">("");
const busy = computed(() => pendingAction.value !== "");
const pendingLabel = computed(() => ({ "": "", start: "正在起草…", createCanvas: "正在创建画布…", createEdit: "正在创建项目…", openProject: "正在打开项目…", openDemo: "正在打开示例…", chooseProject: "正在选择项目…" }[pendingAction.value]));
const pendingDescription = computed(() => ({ "": "", start: "正在整理人物与剧情，完成后进入剧本工作台。", createCanvas: "正在保存空白项目，随后进入创作画布。", createEdit: "正在保存空白项目，随后进入剪辑工作台。", openProject: "正在读取项目与素材。", openDemo: "正在打开预置示例，保留已有修改。", chooseProject: "请在目录选择器中选择项目。" }[pendingAction.value]));
const error = ref("");
const projectQuery = ref("");
const selectedModel = ref("");
const lifetime = new AbortController();
let lastSignature = "";
let lastRequestId = "";
const templates = [
  { id: "suspense", mode: "comic", label: "悬疑故事", icon: IconFileText, style: "写实电影感", duration: 30, characters: "只出现少女与守船人。少女带着父亲留下的旧信寻找守船人，守船人按约交出铜怀表。两人的外观和服装在各镜头保持连续。", invariants: "不揭示写信人的身份，只出现少女与守船人，保留旧信、铜怀表和末班船。", prompt: "雨夜的码头，一名少女带着父亲留下的旧信寻找守船人。守船人按约把一只铜怀表交给她，她在末班船前停下。做一段 30 秒悬疑漫剧，不揭示写信人的身份，只出现这两个人物。" },
  { id: "coffee", mode: "product", label: "产品广告", icon: IconMovie, style: "清新广告", duration: 20, characters: "无人出镜，主体是白瓷杯中的咖啡；白瓷杯及场景在各镜头保持一致。", invariants: "不添加品牌或功效承诺，保留清晨阳光、咖啡滴落、热气和最终产品特写。", prompt: "做一条 20 秒的咖啡产品短片。清晨阳光穿过窗户，咖啡滴入白瓷杯，热气缓缓升起，最后停在安静的产品特写。温暖、有电影感，用简短字幕传达慢下来的一刻，不添加品牌或功效承诺。" },
  { id: "character", mode: "comic", label: "双人对白", icon: IconUsers, style: "日系动漫", duration: 30, characters: "只出现总是迟到的顾客与即将离职的便利店店员，两人通过遗落的雨伞认出彼此；服装和外观连续。", invariants: "保持深夜便利店场景、遗落的雨伞与温暖的小悬念结尾。", prompt: "制作一段 30 秒双人对白漫剧。深夜便利店，一位总是迟到的顾客遇到即将离职的店员，两人通过一把遗落的雨伞认出彼此。保持两个人物的服装和外观连续，以一个温暖的小悬念结束。" },
] as const;
type Inspiration = (typeof templates)[number];
const availableModels = computed(() => customProviders.value.filter(provider => typeof provider.apiKey === "string" && provider.apiKey.trim()).flatMap(provider => provider.models.filter(model => model.id.trim()).map(model => ({ value: JSON.stringify([provider.id, model.id]), providerId: provider.id, modelId: model.id, label: `${provider.label} · ${model.label}` }))));
const allProjects = computed(() => [...workspace.projectList].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt));
const visibleProjects = computed(() => activeSection.value === "projects" ? allProjects.value.filter(item => !projectQuery.value.trim() || item.name.toLowerCase().includes(projectQuery.value.trim().toLowerCase())) : allProjects.value.slice(0, 4));
watch(availableModels, models => { if (!models.some(model => model.value === selectedModel.value)) selectedModel.value = models.find(model => /deepseek/i.test(model.providerId))?.value || models[0]?.value || ""; }, { immediate: true });

onMounted(async () => {
  try {
    const { data } = await axios.get<{ code: number; data: Project[]; message?: string }>("/api/director/projects", { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "读取已有项目失败");
    const knownDirectories = new Set(workspace.projectList.map(item => item.directory));
    workspace.projectList = [...workspace.projectList, ...data.data.filter(item => !knownDirectories.has(item.directory))];
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
  if (mode.value === "comic") promptInput.value?.focus({ preventScroll: true });
  else titleInput.value?.focus({ preventScroll: true });
}
function newCreation() {
  if (busy.value) return;
  prompt.value = ""; characterConstraints.value = ""; invariants.value = ""; noSpecialRequirements.value = false; attempted.value = false; importedName.value = ""; projectTitle.value = ""; error.value = ""; projectQuery.value = ""; lastSignature = ""; lastRequestId = "";
  try { sessionStorage.removeItem("cinePilotWebStart"); sessionStorage.removeItem("cinePilotWebCreate"); } catch { /* 新建项目不依赖会话存储。 */ }
  void showCreation();
}
function showProjects() { activeSection.value = "projects"; contentRoot.value?.scrollTo({ top: 0, behavior: "smooth" }); }
function selectMode(value: CreationMode) { if (busy.value) return; mode.value = value; error.value = ""; void showCreation(); }
function useTemplate(item: Inspiration) { mode.value = "comic"; prompt.value = item.prompt; characterConstraints.value = item.characters; invariants.value = item.invariants; noSpecialRequirements.value = false; attempted.value = false; duration.value = item.duration; style.value = item.style; ratio.value = item.mode === "product" ? "9:16" : "16:9"; importedName.value = ""; error.value = ""; void showCreation(); }
async function enterProject(directory: string, name?: string, view?: "edit" | "canvas") {
  await workspace.openProject(directory, directory, lifetime.signal);
  if (name) workspace.renameProject(directory, name);
  await router.push({ path: "/workspace", query: view ? { view } : {} });
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
async function startCreation() {
  if (busy.value) return;
  if (mode.value !== "comic") return createBlankProject();
  attempted.value = true;
  const missingField = briefErrors.value.prompt ? promptInput : briefErrors.value.characters ? characterInput : briefErrors.value.invariants ? invariantsInput : null;
  if (missingField) {
    error.value = "请补齐创作简报中的标记项。已填内容会保留，尚未调用模型。";
    await nextTick();
    missingField.value?.focus();
    return;
  }
  if (!availableModels.value.length) { error.value = "先在模型设置中连接语言模型，再开始起草。你的创意会保留。"; settingsVisible.value = true; return; }
  const model = availableModels.value.find(item => item.value === selectedModel.value) || availableModels.value[0]!;
  const brief = prompt.value.trim();
  const fields = { brief, characterConstraints: characterConstraints.value.trim(), invariants: noSpecialRequirements.value ? "无特殊要求，允许 AI 起草后由用户确认。" : invariants.value.trim(), title: brief.split(/[\n。！？]/)[0]!.slice(0, 30) || "新的漫剧项目", style: style.value, ratio: ratio.value, targetDuration: duration.value, shotCount: duration.value === 60 ? 12 : duration.value === 20 ? 4 : 6, providerId: model.providerId, modelId: model.modelId };
  pendingAction.value = "start"; error.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: { directory: string; title: string }; message?: string }>("/api/director/start", { ...fields, requestId: requestId("cinePilotWebStart", JSON.stringify(fields)) }, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "剧本起草失败，请稍后重试");
    saveWebPlanningModel(data.data.directory, model.value);
    await enterProject(data.data.directory, data.data.title);
    try { sessionStorage.removeItem("cinePilotWebStart"); } catch { /* 项目已保存。 */ }
  } catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { pendingAction.value = ""; }
}
async function importScript(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ""; if (!file || busy.value) return;
  try { if (!/\.(txt|md)$/i.test(file.name) || file.size > 100000) throw new Error("请选择 100 KB 以内的 TXT 或 Markdown 剧本。"); const text = (await file.text()).trim(); if (!text || text.length > 10000) throw new Error("剧本文字需为 1 至 10000 字，请精简后重新导入。"); prompt.value = text; importedName.value = file.name; error.value = ""; await showCreation(); }
  catch (cause) { error.value = directorError(cause); }
}
onScopeDispose(() => lifetime.abort());
</script>

<style scoped lang="scss">
.webHome {
  --el-color-primary: #00dc69; display: flex; height: 100dvh; min-height: 0; background: #101112; color: #eceeef; font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
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
  .studioMain { min-width: 0; flex: 1; overflow: auto; padding: 0 44px; background-image: radial-gradient(#ffffff13 .65px, transparent .65px); background-size: 24px 24px;
    .topNavigation { height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 20px; .workspaceLabel { display: flex; align-items: center; gap: 8px; color: #8f969f; font-size: 11px; > i { width: 5px; height: 5px; background: #00dc69; border-radius: 50%; } } .topActions { display: flex; gap: 19px; align-items: center; > span { color: #656d77; font-size: 10px; } > button { display: grid; place-items: center; border: 1px solid #ffffff13; border-radius: 8px; background: #17191c; color: #a2a8b1; padding: 8px; &:hover { color: #f0f2f4; border-color: #ffffff30; } } } }
    .homeError { max-width: 1000px; margin: 8px auto 0; display: flex; align-items: center; gap: 10px; padding: 12px 15px; border: 1px solid #8d633d; border-radius: 10px; background: #29231c; color: #deb583; font-size: 12px; > span { flex: 1; } > button { display: grid; place-items: center; border: 0; color: inherit; background: none; padding: 2px; } }
    .creationHero { max-width: 1000px; margin: 15px auto 0; text-align: center;
      .creationModes { display: inline-flex; align-items: center; gap: 4px; padding: 5px; border: 1px solid #ffffff0a; background: #1a1c1f; border-radius: 26px; > button { display: flex; gap: 7px; align-items: center; border: 0; border-radius: 22px; padding: 11px 22px; background: none; color: #9299a3; font-size: 12px; white-space: nowrap; &.active { color: #111715; background: #f0f2f1; box-shadow: 0 2px 8px #0003; } &:hover:not(:disabled):not(.active) { background: #26292e; color: #e6eaee; } } }
      .heroHeading { margin-top: 45px; .heroEyebrow { font-size: 10px; color: #00dc69; letter-spacing: 3.3px; } h1 { margin: 15px 0 13px; color: #f0f2f4; font-size: clamp(28px, 3vw, 40px); font-weight: 550; letter-spacing: -1.3px; } p { color: #828b97; font-size: 13px; line-height: 1.9; margin: 0 0 28px; } }
      .promptComposer { position: relative; text-align: left; background: #191b1e; border: 1px solid #3a3e45; border-radius: 19px; padding: 24px 25px 18px; box-shadow: 0 15px 50px #0002; &:focus-within { border-color: #737b86; }
        .briefLabel { display: block; color: #b7c0ca; font-size: 11px; margin-bottom: 12px; }
        .fieldError { color: #e7b381; font-size: 11px; line-height: 1.7; margin: 6px 0 0; }
        .briefDetails { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; border-top: 1px solid #ffffff0b; padding-top: 17px; margin-top: 8px;
          .briefField { min-width: 0; > label { display: flex; align-items: center; gap: 8px; color: #b7c0ca; font-size: 11px; > span { color: #66737b; font-size: 9px; } }
            > textarea { display: block; min-height: 88px; max-height: 180px; margin-top: 9px; padding: 10px 12px; border: 1px solid #353b42; border-radius: 8px; background: #14171a; font-size: 12px; line-height: 1.7; &:focus { border-color: #737b86; } &[aria-invalid="true"] { border-color: #aa7952; } &:disabled { opacity: .45; } }
            > .noRequirements { margin-top: 9px; color: #929ea9; font-size: 10px; line-height: 1.6; input { accent-color: #00dc69; margin: 0; flex-shrink: 0; } }
          }
        }
        textarea { resize: vertical; width: 100%; min-height: 137px; max-height: 310px; padding: 0; border: 0; background: none; font-size: 17px; color: #e8ebef; line-height: 1.9; outline: 0; &::placeholder { color: #686f79; } }
        .importedScript { display: inline-flex; gap: 6px; align-items: center; max-width: 100%; font-size: 11px; color: #b9c0c9; background: #262a30; border: 1px solid #ffffff0b; padding: 6px 9px; border-radius: 6px; margin: 0 0 10px; > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } > button { border: 0; background: none; color: #969ea9; display: grid; place-items: center; padding: 0; } }
        .blankProjectContent { display: grid; grid-template-columns: auto 1fr; column-gap: 15px; min-height: 180px; .blankProjectIcon { display: grid; place-items: center; height: 52px; width: 52px; border: 1px solid #ffffff16; border-radius: 13px; background: #23262b; color: #aeb6c2; } > div { padding-top: 5px; > strong { font-weight: 500; font-size: 17px; color: #e0e5eb; } > p { font-size: 12px; line-height: 1.9; color: #7e8997; margin: 8px 0 0; } } > label { grid-column: 2; margin-top: 23px; font-size: 11px; color: #8b94a1; input { display: block; border: 1px solid #ffffff17; border-radius: 8px; background: #141619; color: #e2e7ed; padding: 10px 12px; width: 100%; max-width: 390px; font-size: 13px; margin-top: 8px; outline: none; &:focus { border-color: #6e7987; } &::placeholder { color: #656e7a; } } } }
        .composerFooter { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 17px; .composerTools { display: flex; gap: 3px; flex-wrap: wrap; > button { display: flex; align-items: center; gap: 6px; border: 0; background: none; color: #a1a9b4; padding: 8px 9px; border-radius: 7px; font-size: 11px; &:hover:not(:disabled) { background: #ffffff07; color: #e0e6ee; } } } .blankProjectNote { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #7e8a96; > svg { color: #00dc69; } } .createButton { display: inline-flex; justify-content: center; align-items: center; gap: 11px; flex-shrink: 0; white-space: nowrap; min-height: 42px; padding: 10px 17px; border: 0; border-radius: 10px; color: #092114; background: #00dc69; font-size: 12px; font-weight: 600; &:hover:not(:disabled) { background: #35e688; } &:disabled { color: #75a58a; background: #21402e; opacity: .8; } } }
        .creationOptions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; border-top: 1px solid #ffffff0b; margin-top: 17px; padding-top: 16px; > label { color: #959fab; font-size: 11px; select { display: block; width: 100%; min-width: 0; margin-top: 7px; color: #d1d7df; border: 1px solid #3a4049; border-radius: 7px; background: #23272d; padding: 8px; font-size: 11px; } } }
      }
      .composerHint { margin: 13px 5px 0; display: flex; justify-content: center; align-items: center; gap: 12px; min-height: 18px; color: #727e8b; font-size: 10px; > span { display: flex; gap: 7px; align-items: center; } > button { display: inline-flex; align-items: center; gap: 5px; color: #b2bfc0; background: none; border: 0; font-size: 10px; padding: 0; } .loadingDot { width: 5px; height: 5px; border-radius: 50%; background: #00dc69; animation: pulse 1.2s ease-in-out infinite; } }
      .quickTemplates { display: flex; align-items: center; justify-content: center; gap: 9px; flex-wrap: wrap; margin-top: 23px; > span { color: #636f7d; font-size: 10px; margin-right: 2px; } > button { display: inline-flex; align-items: center; gap: 7px; color: #b3bdc9; border: 1px solid #303640; background: #191d23; border-radius: 9px; padding: 10px 14px; font-size: 11px; > svg:first-child { color: #8895a5; } > svg:last-child { color: #667586; margin-left: 8px; } &:hover:not(:disabled) { border-color: #596574; color: #e3eaf1; } } }
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
}
.creditsContent { color: #a4adb9; font-size: 12px; line-height: 1.9; a { color: #00dc69; } }
:global(.webCreditsDialog) { --el-dialog-bg-color: #1b1e24; --el-text-color-primary: #e1e7ef; --el-text-color-regular: #a3afbf; --el-color-primary: #00dc69; border: 1px solid #384354; border-radius: 16px; }
@keyframes pulse { 50% { opacity: .3; } }
@keyframes spin { to { transform: rotate(360deg); } }
.spinner { animation: spin 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .spinner, .loadingDot { animation: none !important; } }
@media (min-width: 1600px) { .webHome .studioMain .creationHero { margin-top: 26px; .heroHeading { margin-top: 55px; } } }
@media (max-width: 1100px) { .webHome { .studioSidebar { width: 190px; padding-inline: 12px; .studioLogo { margin-inline: 5px; > span { font-size: 19px; } } } .studioMain { padding-inline: 25px; .creationHero .creationModes > button { padding-inline: 15px; } .projectsSection .projectGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } } } }
@media (max-width: 750px) {
  .webHome {
    .studioSidebar { width: 64px; padding: 22px 8px 14px; .studioLogo { margin: 0 4px 27px; img { width: 32px; height: 32px; } > span { display: none; } } .newCreation { padding: 0; height: 38px; gap: 0; > span { display: none; } } .sideNavigation > button { justify-content: center; padding: 12px 5px; gap: 0; > span, > b { display: none; } } .sidebarRecent { display: none; } .sidebarBottom { > button { justify-content: center; padding-inline: 4px; > span, > i { display: none; } } > small { display: none; } } }
    .studioMain { padding-inline: 17px; .topNavigation { height: 60px; .workspaceLabel { font-size: 10px; } .topActions { gap: 9px; > span { display: none; } } } .creationHero { margin-top: 11px; .creationModes { padding: 3px; gap: 1px; > button { padding: 10px 11px; font-size: 10px; gap: 5px; > svg { display: none; } } } .heroHeading { margin-top: 32px; h1 { font-size: 26px; letter-spacing: -.9px; } p { font-size: 11px; max-width: 270px; margin: 0 auto 23px; } } .promptComposer { padding: 17px; border-radius: 14px; .briefDetails { grid-template-columns: 1fr; gap: 14px; } textarea { font-size: 14px; min-height: 145px; } .blankProjectContent { min-height: 220px; grid-template-columns: 1fr; .blankProjectIcon { display: none; } > div > strong { font-size: 15px; } > label { grid-column: 1; margin-top: 16px; } } .composerFooter { align-items: flex-end; gap: 6px; .composerTools { gap: 0; > button { font-size: 9px; padding: 7px 5px; gap: 4px; &:first-child > span { display: none; } } } .blankProjectNote { font-size: 9px; max-width: 125px; line-height: 1.7; > svg { flex-shrink: 0; } } .createButton { min-height: 39px; font-size: 10px; padding: 9px 11px; gap: 6px; } } .creationOptions { grid-template-columns: repeat(2, minmax(0, 1fr)); } } .composerHint { font-size: 9px; line-height: 1.8; flex-wrap: wrap; gap: 5px; } .quickTemplates { gap: 7px; margin-top: 18px; > button { font-size: 10px; padding: 9px 10px; > svg:last-child { display: none; } } } } .projectsSection { margin-top: 36px; .sectionHeading { h2 { font-size: 15px; } p { font-size: 10px; max-width: 180px; line-height: 1.7; } } .projectGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; .projectCard .projectPoster { height: 104px; } } .projectSearch { padding: 7px 8px; input { width: 75px; } } .projectEmpty { padding: 16px; flex-wrap: wrap; > div { min-width: 130px; } > button { margin-left: 35px; } } .projectFooter { flex-wrap: wrap; row-gap: 17px; .demoLinks { gap: 10px; } } } .mainFooter { font-size: 8px; gap: 10px; } }
  }
}
</style>
