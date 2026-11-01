<template>
  <main class="studioHome" :aria-busy="busy">
    <header class="studioNav">
      <a class="wordmark" href="#/home" aria-label="返回创作项目"><span class="brandMark"><img src="/cinePilotIcon.png" alt="CinePilot" /></span><span><strong>CinePilot</strong><small>iQIYI · AI Video Agent <b>DEMO</b></small></span></a>
      <nav class="navPill" aria-label="应用导航"><button class="active" type="button" @click="projectQuery = ''"><icon-layout-grid :size="15" />创作项目</button><button type="button" :disabled="busy" @click="chooseProject"><icon-folders :size="15" />打开本地项目</button></nav>
      <div class="navActions"><button class="iconButton" aria-label="模型设置" type="button" @click="settingsVisible = true"><icon-settings :size="19" /></button><button class="avatar" aria-label="项目说明与开源致谢" type="button" @click="creditsVisible = true">CP</button></div>
    </header>
    <div class="homeBody">
      <aside class="homeRail" aria-label="快捷操作"><div><button class="active" type="button" aria-label="查看全部项目" @click="projectQuery = ''"><icon-layout-grid :size="21" /></button><button type="button" aria-label="打开本地项目" :disabled="busy" @click="chooseProject"><icon-folders :size="21" /></button></div><div><button type="button" aria-label="模型设置" @click="settingsVisible = true"><icon-settings :size="21" /></button><button type="button" aria-label="开源致谢" @click="creditsVisible = true"><icon-info-circle :size="21" /></button></div></aside>
      <div class="homeContent">
        <section class="workspaceHeading"><div><span class="eyebrow">CREATOR WORKSPACE</span><h1>创作项目</h1><p>从剧本到镜头，让每一次确认都有据可循。</p></div><button class="primaryButton" type="button" :disabled="busy" @click="chooseProject"><icon-plus :size="17" />选择创作文件夹</button></section>
        <div v-if="error" class="homeError" role="alert">{{ error }}<button type="button" @click="error = ''">关闭</button></div>
        <section class="startSection" aria-label="创作流程">
          <div class="startCopy"><div class="sectionKicker"><icon-sparkles :size="15" />AI 漫剧创作辅助</div><h2>先把故事讲清楚，<br />再让镜头动起来。</h2><p>编导确认剧本，美术确认角色与分镜。<br />先看单镜小样，再逐步完成整片。</p><button class="startButton" type="button" :disabled="busy" @click="openDemo(true)">{{ demoOpening ? '正在打开…' : '体验漫剧项目' }}<icon-arrow-right :size="16" /></button></div>
          <div class="workflowMap" aria-label="创作流程说明"><div class="workflowNode"><span class="workflowIcon"><icon-file-text :size="22" /></span><div><small>01 / STORY</small><strong>剧本与对白</strong><p>人物前提、场景与说话人</p></div><span class="reviewBadge">人工确认</span></div><i /><div class="workflowNode"><span class="workflowIcon"><icon-users :size="22" /></span><div><small>02 / CHARACTERS</small><strong>角色与分镜</strong><p>参考素材、动作与连续性</p></div><span class="reviewBadge">人工确认</span></div><i /><div class="workflowNode"><span class="workflowIcon"><icon-movie :size="22" /></span><div><small>03 / PRODUCTION</small><strong>小样、审片与交付</strong><p>保留合格素材，局部返工</p></div><icon-arrow-up-right :size="18" /></div></div>
        </section>
        <section class="projectSection" aria-label="本地项目">
          <div class="sectionHeading"><div><h2>最近的项目 <span>{{ workspace.projectList.length }}</span></h2><p>项目素材、修改版本和模型配置保存在本机。</p></div><label class="projectSearch"><icon-search :size="17" /><input v-model="projectQuery" placeholder="搜索项目" aria-label="搜索本地项目" /></label></div>
          <div v-if="recentProjects.length" class="projectGrid"><button v-for="(item, index) in recentProjects" :key="item.directory" type="button" class="projectCard" :disabled="busy" @click="openProject(item.directory)"><div class="projectCover"><div class="coverFrames"><span /><span /><span /></div><span class="projectIndex">{{ String(index + 1).padStart(2, '0') }}</span><icon-movie :size="26" /><span class="localBadge">本地项目</span></div><div class="projectCardBody"><div><h3>{{ item.name }}</h3><icon-arrow-up-right :size="17" /></div><p>{{ formatDate(item.lastOpenedAt) }} 打开</p><small>{{ item.directory }}</small></div></button><button class="newProjectCard" type="button" :disabled="busy" @click="chooseProject"><span><icon-plus :size="24" /></span><strong>打开创作文件夹</strong><small>继续已有项目，或在空文件夹开始</small></button></div>
          <div v-else class="emptyProjects"><span><icon-folders :size="28" /></span><h3>{{ projectQuery ? '没有找到对应的项目' : '还没有本地创作项目' }}</h3><p>{{ projectQuery ? '换一个项目名试试，或打开其他项目文件夹。' : '选择一个文件夹，开始整理你的剧本、角色和分镜。' }}</p><button type="button" :disabled="busy" @click="chooseProject">打开本地文件夹 <icon-arrow-right :size="15" /></button></div>
        </section>
        <section class="legacyExample" aria-label="旧版短片示例"><div class="exampleThumbs"><img v-for="name in ['morning', 'pour', 'steam']" :key="name" :src="`/studioDemo/${name}.png`" alt="旧版咖啡短片分镜" /></div><div><span>保留的短片示例</span><h3>清晨第一杯</h3><p>四镜头图片分镜，用于体验画布、版本与局部改稿。</p></div><button type="button" :disabled="busy" @click="openDemo()">{{ demoOpening ? '正在打开…' : '打开旧版示例' }}<icon-arrow-up-right :size="16" /></button></section>
        <footer class="studioFooter"><span><i />单人 · 本地创作空间</span><button type="button" @click="creditsVisible = true">项目说明与开源致谢</button></footer>
      </div>
    </div>
    <workspacePicker ref="picker" hideTrigger /><settings v-model="settingsVisible" />
    <el-dialog v-model="creditsVisible" title="项目说明与开源致谢" width="min(560px, calc(100vw - 24px))" appendToBody class="homeCreditsDialog"><div class="creditsContent"><p>CinePilot 是围绕爱奇艺 AIGC 漫剧创作场景制作的演示项目，基于 Toonflow 二次开发，保留上游版权和许可证。</p><p><a href="https://github.com/HBAI-Ltd/Toonflow-app" target="_blank" rel="noopener noreferrer">Toonflow · MIT</a>，用于创作基础、模型接入与任务执行。</p><p><a href="https://github.com/bcakmakoglu/vue-flow" target="_blank" rel="noopener noreferrer">Vue Flow · MIT</a>，用于镜头画布。</p><p><a href="https://github.com/WebAV-Tech/WebAV" target="_blank" rel="noopener noreferrer">WebAV · MIT</a>，用于视频预览。</p><p><a href="https://github.com/HKUDS/ViMax" target="_blank" rel="noopener noreferrer">ViMax · MIT</a>，参考并改写角色静态／动态特征和镜头首尾状态契约。</p><p><a href="https://github.com/OpenCut-app/opencut-classic" target="_blank" rel="noopener noreferrer">OpenCut Classic · MIT</a>，参考素材、预览、属性三栏与下方时间轴的交互结构。</p><p>旧版短片示例使用预置图片。真实媒体生成取决于本地已配置的模型服务。</p></div></el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import { useRouter } from "vue-router";
import axios from "axios";
import { IconArrowUpRight, IconFolders, IconSparkles, IconMovie, IconPlus, IconSettings, IconSearch, IconLayoutGrid, IconArrowRight, IconFileText, IconUsers, IconInfoCircle } from "@tabler/icons-vue";
import settings from "@/components/settings/index.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { directorError } from "@/pages/workspace/panels/director/api";

const router = useRouter();
const workspace = useWorkspaceStore();
const picker = ref<InstanceType<typeof workspacePicker>>();
const settingsVisible = ref(false);
const creditsVisible = ref(false);
const busy = ref(false);
const demoOpening = ref(false);
const error = ref("");
const projectQuery = ref("");
const lifetime = new AbortController();
const recentProjects = computed(() => [...workspace.projectList].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt).filter(item => !projectQuery.value.trim() || item.name.toLowerCase().includes(projectQuery.value.trim().toLowerCase())));
function formatDate(value: number) { return new Date(value).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
async function enterProject(directory: string) {
  await workspace.openProject(directory, directory, lifetime.signal);
  await router.push("/workspace");
}
async function openProject(directory: string) {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try { await enterProject(directory); }
  catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { busy.value = false; }
}
async function openDemo(production = false) {
  if (busy.value) return;
  busy.value = true; demoOpening.value = true; error.value = "";
  try {
    const { data } = await axios.post<{ code: number; data: { directory: string }; message?: string }>(production ? "/api/director/productionDemo" : "/api/director/demo", {}, { headers: { "x-toonflow-workspace": "1" }, signal: lifetime.signal });
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "演示项目打开失败");
    await enterProject(data.data.directory);
    workspace.renameProject(data.data.directory, production ? "雾港来信 · 漫剧演示" : "清晨第一杯 · 演示项目");
  } catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { busy.value = false; demoOpening.value = false; }
}
async function chooseProject() {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try { const directory = await picker.value?.chooseDirectory(); if (directory) await enterProject(directory); }
  catch (cause) { if (!lifetime.signal.aborted) error.value = directorError(cause); }
  finally { busy.value = false; }
}
onScopeDispose(() => lifetime.abort());
</script>

<style scoped lang="scss">
.studioHome {
  --el-color-primary: #087c52;
  --el-dialog-bg-color: #fff;
  height: 100dvh;
  overflow: auto;
  padding: 20px 28px 0;
  background: #f2f4f3;
  color: #202b26;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  *, *::before, *::after { box-sizing: border-box; }
  button, input { font: inherit; }
  button { cursor: pointer; &:disabled { opacity: .5; cursor: wait; } }
  button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #91c8af; outline-offset: 4px; }
  .studioNav { height: 72px; padding: 0 22px; display: flex; align-items: center; gap: 32px; border-radius: 40px; background: #fff; border: 1px solid #e9eeeb;
    .wordmark { display: flex; align-items: center; gap: 11px; text-decoration: none; color: #1c3b2d; .brandMark { display: grid; place-items: center; width: 40px; height: 40px; background: transparent; flex-shrink: 0; img { display: block; width: 100%; height: 100%; object-fit: contain; } } strong { display: block; font-size: 17px; letter-spacing: -.5px; em { font-style: normal; color: #a2b4aa; padding: 0 2px; } } small { display: flex; gap: 7px; align-items: center; margin-top: 4px; font-size: 9px; letter-spacing: 1px; color: #94a198; b { font-size: 8px; font-weight: 500; color: #6b8776; border: 1px solid #d8e4dd; padding: 1px 4px; border-radius: 3px; } } }
    .navPill { display: flex; gap: 4px; margin: 0 auto; background: #f5f7f6; padding: 4px; border-radius: 24px; button { display: flex; gap: 6px; align-items: center; color: #7c8981; border: 0; background: none; padding: 10px 18px; border-radius: 21px; font-size: 12px; &.active { color: #1b382a; background: #fff; box-shadow: 0 2px 7px #122d1d08; } } }
    .navActions { display: flex; gap: 10px; align-items: center; .iconButton, .avatar { display: grid; place-items: center; height: 36px; width: 36px; border: 0; border-radius: 50%; background: #f5f7f6; color: #687e70; } .avatar { color: #0b744f; background: #e7f0e9; font-size: 12px; } }
  }
  .homeBody { display: flex; gap: 27px; }
  .homeRail { width: 54px; flex-shrink: 0; padding-top: 38px; padding-bottom: 25px; display: flex; flex-direction: column; justify-content: space-between; > div { display: flex; flex-direction: column; gap: 10px; background: #fff; padding: 7px; border-radius: 28px; border: 1px solid #e8eeea; } button { width: 38px; height: 40px; border-radius: 50%; display: grid; place-items: center; border: 0; background: none; color: #829087; &.active { background: #087c52; color: #fff; box-shadow: 0 4px 10px #087c5220; } &:hover:not(.active) { color: #087c52; background: #eff5f1; } } }
  .homeContent { min-width: 0; width: 100%; max-width: 1510px; margin: 0 auto; }
  .workspaceHeading { display: flex; align-items: center; justify-content: space-between; padding: 35px 0 25px; .eyebrow { display: block; font-size: 9px; color: #8fa096; letter-spacing: 2px; } h1 { margin: 8px 0 7px; font-size: 29px; font-weight: 600; letter-spacing: -1px; } p { margin: 0; font-size: 12px; color: #8a968e; } }
  .primaryButton { display: flex; align-items: center; gap: 6px; border: 0; border-radius: 24px; padding: 12px 19px; color: #fff; background: #087c52; font-size: 12px; box-shadow: 0 4px 10px #087c5215; }
  .startSection { display: grid; grid-template-columns: 1fr 1.05fr; gap: 35px; padding: 30px 37px; background: #fff; border: 1px solid #e5ece7; border-radius: 24px; }
  .startCopy { .sectionKicker { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #53866b; } h2 { margin: 16px 0 15px; font-size: 30px; line-height: 1.5; font-weight: 500; letter-spacing: -.7px; color: #203d2e; } p { font-size: 12px; line-height: 1.9; color: #8a978d; } .startButton { display: flex; gap: 20px; align-items: center; border: 0; border-radius: 21px; padding: 11px 17px; margin-top: 20px; font-size: 12px; color: #fff; background: #087c52; } }
  .workflowMap { padding: 15px 0; display: flex; flex-direction: column; justify-content: center; > i { width: 1px; height: 15px; background: #d9e5dd; margin-left: 34px; } .workflowNode { display: flex; align-items: center; gap: 14px; padding: 15px 17px; border: 1px solid #e5ece7; border-radius: 14px; background: #f9fbf9; .workflowIcon { display: grid; place-items: center; width: 38px; height: 38px; color: #187d54; background: #e8f2eb; border: 1px solid #dcebe0; border-radius: 11px; } > div { flex: 1; min-width: 0; small { display: block; color: #95aa9d; font-size: 8px; letter-spacing: 1px; } strong { display: block; margin: 5px 0 4px; font-size: 13px; font-weight: 550; color: #3e5b49; } p { margin: 0; font-size: 10px; color: #95a59b; } } .reviewBadge { padding: 4px 7px; color: #6a8c76; background: #eaf1eb; border-radius: 5px; font-size: 9px; white-space: nowrap; } > svg { color: #79a088; } } }
  .projectSection { margin-top: 28px; .sectionHeading { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding-bottom: 17px; h2 { font-size: 17px; font-weight: 550; margin: 0; display: flex; gap: 9px; align-items: center; span { color: #7a9484; font-size: 10px; font-weight: 400; border: 1px solid #dce6df; border-radius: 7px; padding: 3px 6px; } } p { color: #99a39c; font-size: 11px; margin: 6px 0 0; } .projectSearch { display: flex; gap: 8px; align-items: center; padding: 10px 13px; border: 1px solid #e2e9e4; border-radius: 22px; background: #fff; color: #98a69c; input { font-size: 11px; outline: none; width: 140px; border: 0; color: #41634d; background: none; &::placeholder { color: #a5afa9; } } } } }
  .projectGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; .projectCard { min-width: 0; padding: 0; border: 1px solid #e2e9e4; border-radius: 17px; overflow: hidden; background: #fff; text-align: left; transition: border-color .15s, transform .15s; &:hover { border-color: #9bbb9f; transform: translateY(-2px); } .projectCover { height: 132px; position: relative; display: flex; align-items: center; justify-content: center; background: #eaf0eb; overflow: hidden; > svg { color: #7fa18a; position: relative; } .projectIndex { position: absolute; top: 16px; left: 17px; color: #99b0a2; font: 10px ui-monospace, monospace; } .localBadge { position: absolute; bottom: 13px; left: 15px; padding: 4px 7px; border: 1px solid #ffffff9c; border-radius: 5px; color: #71917b; background: #ffffff60; font-size: 9px; } .coverFrames { position: absolute; inset: 20px 40px; display: flex; gap: 9px; justify-content: center; align-items: center; transform: rotate(-9deg); > span { width: 56px; height: 70px; background: #d3e3d7; border: 1px solid #c3d8c9; border-radius: 7px; &:nth-child(2) { height: 84px; background: #dcebe0; } &:nth-child(3) { background: #e1eee4; } } } } .projectCardBody { padding: 16px; > div { display: flex; gap: 8px; justify-content: space-between; align-items: center; h3 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; margin: 0; color: #3b5143; } > svg { color: #8c9d91; flex-shrink: 0; } } p { margin: 8px 0 6px; color: #94a297; font-size: 10px; } small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a9b3ac; font-size: 9px; } } }
    .newProjectCard { min-height: 213px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 11px; border: 1px dashed #ccdbd0; border-radius: 17px; color: #668873; background: #f4f8f4; > span { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: #e5eee7; color: #4a8862; } strong { font-weight: 500; font-size: 12px; } small { font-size: 10px; color: #96a69b; } }
  }
  .emptyProjects { padding: 30px; text-align: center; border: 1px dashed #d9e4dc; border-radius: 17px; background: #f8faf8; > span { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: #eaf1eb; color: #80a28b; } h3 { font-size: 13px; font-weight: 500; color: #6e8677; margin: 14px 0 7px; } p { font-size: 11px; color: #a0aca3; margin: 0 0 16px; } button { display: inline-flex; align-items: center; gap: 10px; background: none; border: 0; color: #33875c; font-size: 11px; } }
  .legacyExample { display: flex; gap: 17px; align-items: center; padding: 17px 21px; margin-top: 24px; background: #fff; border: 1px solid #e5ece7; border-radius: 17px; .exampleThumbs { display: flex; gap: 5px; flex-shrink: 0; img { width: 31px; height: 44px; object-fit: cover; border-radius: 6px; } } > div:nth-child(2) { flex: 1; min-width: 0; > span { font-size: 9px; color: #91a096; } h3 { margin: 4px 0; color: #4d6656; font-size: 12px; font-weight: 500; } p { font-size: 10px; color: #a4aea7; margin: 0; } } > button { display: flex; align-items: center; gap: 8px; border: 0; background: #f0f5f1; color: #699078; padding: 9px 12px; border-radius: 17px; font-size: 10px; } }
  .studioFooter { display: flex; align-items: center; justify-content: space-between; padding: 20px 0 23px; font-size: 10px; color: #a0ada4; > span { display: flex; align-items: center; gap: 5px; i { width: 4px; height: 4px; background: #8aa493; border-radius: 50%; } } button { border: 0; background: none; color: inherit; font-size: inherit; padding: 0; } }
  .homeError { padding: 12px 15px; margin-bottom: 18px; border: 1px solid #ecd8d1; background: #fff9f6; color: #a06750; font-size: 12px; border-radius: 11px; button { float: right; border: 0; background: none; color: inherit; } }
}
:global(.homeCreditsDialog) { --el-dialog-bg-color: #fff; --el-text-color-primary: #34523f; --el-text-color-regular: #789782; --el-color-primary: #087c52; border: 1px solid #e2ebe5; border-radius: 18px; }
.creditsContent { font-size: 13px; line-height: 1.9; color: #6a7d70; a { color: #087c52; } }
@media (min-width: 1600px) { .studioHome .homeBody { gap: 37px; } }
@media (max-width: 1050px) { .studioHome { padding-inline: 18px; .studioNav { gap: 16px; padding-inline: 18px; .wordmark strong { font-size: 15px; } .navPill button { padding-inline: 11px; } } .homeBody { gap: 18px; } .startSection { padding: 27px; gap: 23px; grid-template-columns: 1fr 1.1fr; } .startCopy h2 { font-size: 25px; } .workflowMap .workflowNode { padding: 13px; gap: 9px; .reviewBadge { display: none; } } .projectGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } }
@media (max-width: 750px) { .studioHome { padding: 12px 14px 0; .studioNav { height: 64px; .navPill { display: none; } .navActions { margin-left: auto; } } .homeRail { display: none; } .workspaceHeading { padding-top: 25px; h1 { font-size: 25px; } > .primaryButton { padding: 10px 13px; font-size: 10px; } } .startSection { grid-template-columns: 1fr; padding: 24px; gap: 14px; } .startCopy { h2 { font-size: 25px; margin: 14px 0 8px; br { display: none; } } p { display: none; } } .workflowMap { padding: 4px 0; .workflowNode { > div p { display: none; } } } .projectSection .sectionHeading { align-items: flex-start; > div p { max-width: 190px; line-height: 1.6; } .projectSearch { padding: 8px 10px; input { width: 95px; } } } .projectGrid { gap: 11px; .projectCard .projectCover { height: 105px; } .projectCard .projectCardBody { padding: 12px; } } .legacyExample { padding: 15px; .exampleThumbs img:not(:first-child) { display: none; } > div:nth-child(2) p { line-height: 1.6; } > button { white-space: nowrap; font-size: 9px; gap: 3px; } } } }
</style>
