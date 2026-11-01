<template>
  <section class="directorPanel webDirector" aria-label="爱奇艺漫剧创作演示工作台">
    <header class="studioHeader">
      <button class="studioBrand" type="button" @click="leaveProject" aria-label="返回项目"><span class="brandMark"><img src="/cinePilotIcon.png" alt="CinePilot" /></span><span>CinePilot <small>iQIYI · AI Video Agent · DEMO</small></span></button>
      <div class="projectIdentity"><span>CinePilot / CREATOR STUDIO</span><h1>{{ project?.title || '新的漫剧项目' }}</h1></div>
      <div class="headerActions">
        <span v-if="project" class="saveState" role="status" aria-live="polite"><i />{{ busy ? '正在保存' : '已保存到本地' }}</span>
        <button v-if="project" class="headerText taskButton" type="button" @click="tasksVisible = true"><icon-list-check :size="16" />任务<span v-if="activeTaskCount">{{ activeTaskCount }}</span></button>
        <button class="headerIcon" type="button" aria-label="供应商设置" @click="$emit('openSettings')"><icon-settings :size="17" /></button>
        <el-button v-if="project?.shots.length" class="previewButton" :icon="IconPlayerPlay" @click="openPreview()">预览短片</el-button>
        <el-button v-if="project" type="primary" :disabled="busy || !project.shots.length" @click="openExport"><icon-download :size="14" />导出</el-button>
      </div>
    </header>
    <div v-if="project && (latestExport || latestExportTask) && (exporting || requestedExportTaskId)" class="exportStatus" role="status" aria-live="polite"><icon-loader-2 v-if="exporting" class="spinner" :size="16" /><icon-check v-else-if="latestExportTask?.status === 'succeeded'" :size="16" /><icon-alert-circle v-else :size="16" /><span>{{ exportStatusText }}</span><el-button v-if="latestExportTask && ['failed', 'interrupted'].includes(latestExportTask.status)" text :disabled="busy || !canRetry(latestExportTask)" @click="retryTask(latestExportTask)">重试导出</el-button><el-button v-if="latestExport" type="primary" :loading="savingExport" :disabled="exporting" @click="downloadExport(latestExport.asset)">{{ latestExportStale ? '保存上次导出' : '保存视频' }}</el-button></div>
    <div v-if="error" class="errorBanner" role="alert"><icon-alert-circle :size="16" /><span>{{ error }}</span><button type="button" aria-label="关闭错误提示" @click="error = ''"><icon-x :size="15" /></button></div>
    <div v-if="loading && !project" class="loadingState" role="status"><icon-loader-2 :size="24" class="spinner" />正在打开创作空间…</div>
    <div v-else-if="!project" class="creationArea">
      <div class="creationIntro"><span class="introStep">NEW EPISODE / 创作简报</span><h2>一个故事，<br />从清楚的设定开始。</h2><p>先起草剧本，确认人物动机与对白。<br />角色和分镜确认后，再制作第一个镜头小样。</p><div class="creationSteps"><span><b>01</b> 剧本确认</span><span><b>02</b> 角色与分镜</span><span><b>03</b> 小样与审片</span></div><div class="scopeNote"><icon-shield-check :size="16" />每次修改保留版本，已采用素材可追溯。</div></div>
      <el-form class="creationForm" labelPosition="top" @submit.prevent="createStoryboard">
        <div class="formEyebrow">STORY BRIEF <span>第 {{ draft.episode }} 集</span></div><h3>开始你的漫剧项目</h3>
        <el-form-item label="项目名称"><el-input v-model="draft.title" maxlength="100" placeholder="为这个故事取个名字" :disabled="busy" /></el-form-item>
        <el-form-item label="故事创意与本集目标"><el-input v-model="draft.brief" type="textarea" :rows="3" maxlength="8000" showWordLimit placeholder="故事发生在哪里？人物遇到什么问题？本集要推进到哪里？" :disabled="busy" /></el-form-item>
        <el-form-item label="角色设定与已知事实"><el-input v-model="draft.characterConstraints" type="textarea" :rows="2" maxlength="6000" placeholder="写下主要角色、动机、关系，以及人物此时已经知道的事情" :disabled="busy" /></el-form-item>
        <el-form-item label="必须保持的剧情约束"><el-input v-model="draft.invariants" type="textarea" :rows="2" maxlength="4000" placeholder="哪些事实不能改？哪些信息暂时不能被角色知道？对白由谁说？" :disabled="busy" /></el-form-item>
        <div class="creationRow"><el-form-item label="视觉风格"><el-input v-model="draft.style" maxlength="500" placeholder="例如：写实动漫、冷色悬疑" :disabled="busy" /></el-form-item><el-form-item label="策划模型"><el-select v-model="aiSelection" placeholder="选择已配置模型" :disabled="busy"><el-option v-for="model in aiModels" :key="modelKey(model)" :value="modelKey(model)" :label="`${model.providerLabel} · ${model.label}`" /></el-select></el-form-item></div>
        <div class="creationSpecs"><el-form-item label="集数"><el-input-number v-model="draft.episode" :min="1" :max="999" :disabled="busy" /></el-form-item><el-form-item label="画幅"><el-select v-model="draft.ratio" :disabled="busy"><el-option value="16:9" label="16:9 横屏" /><el-option value="9:16" label="9:16 竖屏" /><el-option value="1:1" label="1:1 方形" /></el-select></el-form-item><el-form-item label="目标时长 / 秒"><el-input-number v-model="draft.targetDuration" :min="10" :max="120" :step="5" :disabled="busy" /></el-form-item><el-form-item label="镜头数"><el-input-number v-model="draft.shotCount" :min="1" :max="24" :disabled="busy" /></el-form-item></div>
        <div v-if="!aiModels.length" class="configurationTip">需要先配置语言模型。<el-button text @click="$emit('openSettings')">打开设置</el-button></div><el-button type="primary" nativeType="submit" :icon="IconSparkles" :loading="busy" :disabled="!draft.title.trim() || !draft.brief.trim() || !draft.style.trim() || !draft.characterConstraints.trim() || !draft.invariants.trim() || !aiSelection" class="createButton">{{ busy ? '正在起草剧本…' : '起草剧本，进入审阅' }}</el-button><p class="creationNote">此步只生成文字剧本，确认后再调用媒体模型。</p>
      </el-form>
    </div>
    <div v-else class="studioShell" :class="{ inspectorHidden: !inspectorVisible || viewMode === 'production', creativeCanvasMode: canvasActive }" :style="studioColumns">
      <aside v-show="assetRailVisible && viewMode !== 'production'" class="assetRail" aria-label="项目素材">
        <div class="railTitle"><icon-folders :size="16" /><h2>项目素材</h2><span>{{ project.shots.length }} 镜</span></div>
        <div v-if="project.referenceImage || !project.production" class="referenceSection"><div class="railLabel">视觉参考 <span>REFERENCE</span></div><div class="referenceFrame"><studioThumbnail :directory="directory" :path="project.referenceImage?.path" :mimeType="project.referenceImage?.mimeType" :label="project.referenceImage ? '项目参考图' : '本项目未设置参考图'" /><span v-if="project.referenceImage" class="referenceTag"><icon-link :size="10" />所有镜头共用</span></div><p>参考图用于约束画面，角色与连续性仍需人工审阅。</p></div>
        <div v-if="project.production" class="productionResources"><div class="railLabel">角色与场景</div><button v-for="character in project.production.characters" :key="character.id" type="button" @click="openCharacters"><studioThumbnail v-if="character.referenceImage" :directory="directory" :path="character.referenceImage.path" :mimeType="character.referenceImage.mimeType" :label="character.name" /><span v-else class="characterInitial">{{ character.name.slice(0, 1) }}</span><span>{{ character.name }}<small>{{ character.confirmedAt ? '已确认' : '待确认' }}</small></span><icon-arrow-up-right :size="12" /></button><button type="button" @click="setView('production')"><icon-file-text :size="14" />剧本与场景<icon-arrow-up-right :size="12" /></button></div>
        <div class="assetList"><div class="railLabel">镜头素材 <span>{{ readyImages + readyClips }}</span></div><button v-for="shot in project.shots" :key="shot.id" type="button" :class="{ active: selectedShotId === shot.id }" @click="selectShot(shot.id)"><div class="assetThumb"><studioThumbnail :directory="directory" :path="currentVersion(shot).keyframe?.path || currentVersion(shot).clip?.path" :mimeType="currentVersion(shot).keyframe?.mimeType || currentVersion(shot).clip?.mimeType" label="待生成" /></div><div><strong>{{ String(shot.order).padStart(2, '0') }} {{ currentVersion(shot).title }}</strong><span>{{ currentVersion(shot).clip ? '视频已就绪' : currentVersion(shot).keyframe ? '关键帧已就绪' : '等待素材' }}</span></div><icon-lock v-if="shot.locked" :size="11" /></button></div>
        <p v-if="!project.shots.length" class="railEmpty">剧本和角色确认后，分镜素材会出现在这里。</p><div class="creativeBrief"><div class="railLabel">创作简报</div><strong>{{ project.style || '自由风格' }}</strong><p>{{ project.brief }}</p><div class="briefSpecs"><span>{{ project.ratio }}</span><span>{{ totalDuration }} 秒</span><span>{{ project.shots.length }} 个镜头</span></div></div>
        <div class="railBottom"><span class="localDot" />本地创作空间<button type="button" aria-label="刷新项目" @click="load(true)"><icon-refresh :size="13" /></button></div>
      </aside>
      <main class="creativeArea">
        <div class="boardToolbar"><div class="workspaceTabs" role="group" aria-label="工作视图"><button v-if="viewMode !== 'production'" type="button" :class="{ active: assetRailVisible }" @click="assetRailVisible = !assetRailVisible"><icon-folders :size="14" />素材</button><button v-if="project.production" type="button" :class="{ active: viewMode === 'production' }" @click="setView('production')"><icon-file-text :size="14" />故事与分镜</button><button type="button" :class="{ active: viewMode === 'canvas' }" @click="setView('canvas')"><icon-layout-board :size="14" />创作画布</button><button type="button" :class="{ active: viewMode === 'preview' }" @click="setView('preview')"><icon-timeline :size="14" />剪辑</button></div><div class="boardActions"><button v-if="canvasActive && project.shots.length" class="canvasTimelineToggle" type="button" :aria-pressed="canvasTimelineVisible" @click="canvasTimelineVisible = !canvasTimelineVisible"><icon-timeline :size="14" />时间轴</button><span class="readyCount">{{ readyClips }} / {{ project.shots.length }} 视频</span><button v-if="viewMode !== 'production'" class="toggleInspector" type="button" aria-label="显示或隐藏导演助手" :aria-pressed="inspectorVisible" @click="toggleAgent"><icon-sparkles :size="15" /><span>AI 助手</span></button></div></div>
        <div class="workspaceStage" :class="{ productionStage: viewMode === 'production', previewWorkspace: viewMode === 'preview' }">
          <productionPanel ref="productionEditor" v-if="viewMode === 'production' && project.production" :project="project" :directory="directory" :aiSelection="aiSelection" :busy="busy" @updated="acceptProject($event, directory)" @busyChange="productionBusy = $event" @selectShot="focusProductionShot" @generate="generate" @preview="openPreview()" @configure="openModelSettings" />
          <studioPreview ref="inlinePlayer" v-else-if="viewMode === 'preview' && !previewVisible && project.shots.length" :key="directory" :directory="directory" :project="project" :initialShotId="inlineShotId" @selectShot="selectedShotId = $event" @timeUpdate="playhead = $event" />
          <div v-else-if="viewMode === 'preview' && !project.shots.length" class="emptyEdit"><icon-movie :size="36" /><h2>从第一个素材开始</h2><p>导入视频或图片，加入时间轴后调整顺序、裁剪和字幕。</p><el-button type="primary" @click="chooseTimelineImport()">导入视频或图片</el-button><el-button text @click="setView('canvas')">去画布生成素材</el-button></div>
          <div v-else-if="viewMode === 'preview' && previewVisible" class="previewInDialog"><icon-player-play :size="30" /><p>正在独立窗口预览</p></div>
          <creativeCanvas ref="creativeEditor" v-else :key="directory" :directory="directory" :project="project" :selectedId="selectedShotId" :busy="busy" :imageReady="imageReady" :videoReady="videoReady" :mediaModels="mediaModels" :configuredProviders="configuredProviders" :generationIssues="readiness.generation" @select="selectShot" @lock="toggleLock" @edit="editShot" @versions="showVersions" @preview="openShotPreview" @generate="generateShot" @generateNode="generateCanvasNode" @adoptReference="adoptGeneratedReference" @addToTimeline="addToTimeline" @nodeLabels="labels => canvasNodeLabels = labels" @attach="attachFile" @applyInputs="applyCanvasInputs" @agent="openCanvasAgent" @configure="openModelSettings" />
        </div>
        <timelineEditor v-if="(project.shots.length || project.history?.past.length || project.history?.future.length) && (!canvasActive || canvasTimelineVisible)" :project="project" :directory="directory" :selectedId="selectedShotId" :playhead="playhead" :busy="busy" :canUndo="!!project.history?.past.length" :canRedo="!!project.history?.future.length" :undoLabel="project.history?.past.at(-1)?.label" :redoLabel="project.history?.future.at(-1)?.label" @select="selectShot" @inspect="id => editShot(findShot(id)!)" @seek="seekTimeline" @play="playTimeline" @patch="saveTimelinePatch" @reorder="ids => perform('reorder', { shotIds: ids })" @split="input => perform('splitShot', input)" @import="chooseTimelineImport()" @music="rightTab = 'music'; inspectorVisible = true" @undo="perform('undo')" @redo="perform('redo')" @remove="removeShot" @replace="chooseTimelineImport" />

      </main>
      <aside v-show="inspectorVisible && viewMode !== 'production'" class="inspector" aria-label="导演助手与镜头属性">
        <div class="inspectorTabs"><button type="button" :class="{ active: rightTab === 'agent' }" @click="rightTab = 'agent'"><icon-sparkles :size="14" />导演助手</button><button type="button" :class="{ active: rightTab === 'shot' }" @click="rightTab = 'shot'">镜头属性</button><button type="button" :class="{ active: rightTab === 'music' }" aria-label="声音与配乐设置" @click="rightTab = 'music'"><icon-music :size="14" />声音</button></div>
        <div v-if="rightTab === 'agent'" class="inspectorContent agentWorkspace">
          <div class="liveAgent"><div class="agentContext"><icon-sparkles :size="14" /><span>{{ selectedShot ? `镜头 ${selectedShot.order} · ${currentVersion(selectedShot).title}` : '当前项目与选中节点' }}</span><small>准备方案 · 确认后生成</small></div><agent v-model="agentVisible" /></div>
          <div v-if="pendingPlan" class="planCard"><div class="planHeading"><span><icon-git-branch :size="14" />修改计划</span><b>{{ pendingPlan.changes.length }} 个镜头</b><el-button class="discardPlan" text :disabled="busy" @click="discardPlan">放弃计划</el-button></div><p class="planInstruction" :title="planInstructionText">{{ planInstructionText }}</p><div v-for="change in pendingPlan.changes" :key="change.shotId" class="planChange" @click="selectShot(change.shotId)"><div class="changeTitle"><span>{{ String(shotOrder(change.shotId)).padStart(2, '0') }}</span><strong>{{ currentVersion(findShot(change.shotId)).title }}</strong><icon-arrow-up-right :size="12" /></div><dl><template v-for="(value, key) in change.patch" :key="key"><dt>{{ fieldLabels[key] }}</dt><dd>{{ planFieldValue(key, value) }}</dd></template></dl><div class="effectLine"><span v-for="step in planEffect(change.shotId)?.regenerate" :key="step" class="regenerateTag"><icon-refresh :size="10" />重做{{ step === 'image' ? '关键帧' : '视频' }}</span><span v-for="step in planEffect(change.shotId)?.reuse" :key="step" class="reuseTag"><icon-check :size="10" />复用{{ step === 'image' ? '关键帧' : '视频' }}</span></div></div><p class="preserveNote"><icon-shield-check :size="12" />{{ preservedShotText }}</p><p v-if="planConflict" class="staleNote" role="status">{{ planConflict }}</p><el-button type="primary" :disabled="busy || !!planConflict" :loading="applying" @click="executePlan">{{ planActionLabel }}<icon-arrow-right :size="14" /></el-button><div v-if="planConflict" class="planControls"><el-button text :disabled="busy || !aiSelection" @click="planRevision(true)">重新制定</el-button></div><p v-if="planHasRegeneration && !canGeneratePlan" class="planHint">可以先保存修改，接入生成模型后再生成。</p></div>
        </div>
        <div v-else-if="rightTab === 'shot'" class="inspectorContent">
          <template v-if="selectedShot"><div class="detailHeading"><span>SHOT {{ String(selectedShot.order).padStart(2, '0') }}</span><button type="button" :disabled="busy" @click="toggleLock(selectedShot)"><icon-lock v-if="selectedShot.locked" :size="13" /><icon-lock-open v-else :size="13" />{{ selectedShot.locked ? '已锁定' : '未锁定' }}</button></div><h3 class="detailTitle">{{ currentVersion(selectedShot).title }}</h3><p class="detailDescription">{{ currentVersion(selectedShot).description }}</p><div v-if="currentVersion(selectedShot).characterIds?.length" class="detailCast"><span v-for="id in currentVersion(selectedShot).characterIds" :key="id">{{ characterName(id) }}</span></div><div v-if="currentVersion(selectedShot).startState || currentVersion(selectedShot).endState" class="continuityStates"><div><span>镜头起始</span><p>{{ currentVersion(selectedShot).startState || '未记录' }}</p></div><div><span>镜头结束</span><p>{{ currentVersion(selectedShot).endState || '未记录' }}</p></div></div><div v-if="currentVersion(selectedShot).dialogues?.length" class="detailDialogues"><span>对白归属</span><p v-for="(line, index) in currentVersion(selectedShot).dialogues" :key="index"><b>{{ characterName(line.speakerId) }}</b>{{ line.text }}</p></div><div class="detailMeta"><span>运镜</span><p>{{ currentVersion(selectedShot).camera }}</p></div><div class="timingOverview"><div><span>镜头时长</span><strong>{{ currentVersion(selectedShot).duration }}<small>s</small></strong></div><div><span>素材入点</span><strong>{{ currentVersion(selectedShot).trimStart || 0 }}<small>s</small></strong></div></div><div class="detailSubtitle"><span>字幕</span><p>{{ currentVersion(selectedShot).subtitle || '没有字幕' }}</p><small>{{ currentVersion(selectedShot).subtitleStart || 0 }}s — {{ currentVersion(selectedShot).subtitleEnd ?? currentVersion(selectedShot).duration }}s</small></div><el-button class="fullButton" :icon="IconPencil" :disabled="busy || selectedShot.locked" @click="editShot(selectedShot)">编辑画面、裁剪与字幕</el-button><div class="detailActions"><el-button :icon="IconHistory" @click="showVersions(selectedShot)">{{ selectedShot.versions.length }} 个版本</el-button><el-button :icon="IconSparkles" @click="rightTab = 'agent'">让助手改稿</el-button></div><div class="reorderActions"><span>调整镜头顺序</span><button type="button" :disabled="busy || selectedShot.order === 1" @click="moveShot(selectedShot.id, -1)"><icon-chevron-left :size="14" />前移</button><button type="button" :disabled="busy || selectedShot.order === project.shots.length" @click="moveShot(selectedShot.id, 1)">后移<icon-chevron-right :size="14" /></button></div><div class="detailAssets"><span>本镜素材</span><el-button :disabled="busy || selectedShot.locked" :icon="IconUpload" @click="chooseSelectedImport('image')">导入关键帧</el-button><el-button :disabled="busy || selectedShot.locked" :icon="IconUpload" @click="chooseSelectedImport('video')">导入视频</el-button></div></template>
          <div v-else class="detailEmpty"><icon-layout-board :size="26" /><p>在画布或时间轴上选择一个镜头，<br />查看画面、素材和剪辑参数。</p></div>
        </div>
        <div v-else class="inspectorContent musicInspector"><div class="musicHeading"><icon-music :size="24" /><h3>声音与配乐</h3><p>导入对白、音效和背景音乐，在预览与成片中同步播放。</p></div><template v-if="project.music"><div class="musicFile"><icon-file-music :size="22" /><strong>{{ musicName }}</strong></div><label>配乐音量 <span>{{ musicVolume }}%</span></label><el-slider v-model="musicVolume" :min="0" :max="100" :disabled="busy" @change="saveMusicVolume" /><p class="musicNote">音乐从成片开始循环播放，铺满成片时长。{{ project.originalAudio ? '保留原视频声音，并与配乐、已添加的对白和音效一起混合。' : '原视频声音关闭；配乐与已添加的对白、音效一起混合。' }}</p><el-button :disabled="busy" @click="musicInput?.click()">更换配乐</el-button><el-button text type="danger" :disabled="busy" @click="perform('music', { music: null })">移除</el-button></template><el-button v-else class="musicUpload" :icon="IconUpload" :disabled="busy" @click="musicInput?.click()">导入背景音乐</el-button><audioPanel :project="project" :directory="directory" :busy="busy" :selectedShotId="selectedShotId" @import="importAudioTrack" @update="(trackId, patch) => perform('updateAudioTrack', { trackId, patch })" @remove="trackId => perform('removeAudioTrack', { trackId })" /></div>
        <div class="inspectorFooter"><i :class="{ configured: imageReady && videoReady }" /><span>{{ generationConnectionText }}</span><button type="button" @click="openModelSettings">配置 <icon-arrow-up-right :size="11" /></button></div>
      </aside>
    </div>
    <input ref="musicInput" type="file" accept="audio/*" class="fileInput" @change="uploadMusic" /><input ref="selectedImportInput" type="file" class="fileInput" :accept="selectedImportKind + '/*'" @change="importSelectedFile" />
    <input ref="timelineImportInput" type="file" accept="image/*,video/*" class="fileInput" @change="importTimelineFile" />
    <taskDrawer v-if="project" v-model="tasksVisible" :project="project" :directory="directory" :busy="busy" :canRetry="canRetry" :nodeLabels="canvasNodeLabels" @refresh="refreshTask" @retry="retryTask" @locate="locateTask" @download="downloadTaskAsset" @cancel="cancelTask" @resolve="resolveTask" />
    <el-dialog :modelValue="!!placementInput" title="将素材用于成片" width="min(760px, calc(100vw - 24px))" appendToBody class="studioDialog" :closeOnClickModal="false" :showClose="!busy" :closeOnPressEscape="!busy" @update:modelValue="value => { if (!value) placementInput = undefined; }">
      <template v-if="placementInput">
        <el-radio-group v-model="placementMode" :disabled="busy"><el-radio-button value="add">新增一镜</el-radio-button><el-radio-button value="replace" :disabled="!project?.shots.length">替换已有镜头</el-radio-button></el-radio-group>
        <div class="placementFields"><label v-if="placementMode === 'replace'">替换哪一镜<select v-model="placementTarget" aria-label="选择要替换的镜头"><option v-for="shot in project?.shots" :key="shot.id" :value="shot.id" :disabled="shot.locked || shotWorking(shot.id)">第 {{ shot.order }} 镜 · {{ currentVersion(shot).title }}{{ shot.locked ? '（已锁定）' : shotWorking(shot.id) ? '（生成中）' : '' }}</option></select></label><label v-else>插入位置<select v-model="placementAfter" aria-label="选择补镜插入位置"><option value="">第一镜之前</option><option v-for="shot in project?.shots" :key="shot.id" :value="shot.id">第 {{ shot.order }} 镜之后 · {{ currentVersion(shot).title }}</option></select></label>
        <template v-if="placementMode === 'add' && project?.production"><label>所属场景<select v-model="placementScene" aria-label="补镜所属场景"><option value="">选择已确认剧本中的场景</option><option v-for="scene in placementScenes" :key="scene.id" :value="scene.id">{{ scene.title }}</option></select></label><div><span>出镜角色（空镜可不选）</span><el-checkbox-group v-model="placementCharacters"><el-checkbox v-for="character in project.production.characters" :key="character.id" :value="character.id">{{ character.name }}</el-checkbox></el-checkbox-group></div></template></div>
        <div class="placementCompare"><section v-if="placementMode === 'replace' && placementShot"><h4>成片当前素材 · V{{ currentVersion(placementShot).number }}</h4><mediaPreview :directory="directory" :path="(placementInput.kind === 'video' ? currentVersion(placementShot).clip : currentVersion(placementShot).keyframe)?.path" :mimeType="(placementInput.kind === 'video' ? currentVersion(placementShot).clip : currentVersion(placementShot).keyframe)?.mimeType" label="当前镜头暂无此类素材" /></section><section><h4>{{ placementMode === 'replace' ? '替换为' : '新增素材' }} · {{ placementInput.title }}</h4><mediaPreview :directory="directory" :path="placementInput.asset.path" :mimeType="placementInput.asset.mimeType" :label="placementInput.title" /></section></div>
        <p v-if="placementUnchanged" class="dialogNote">这个镜头已使用所选结果，无需再次替换。</p><p class="dialogNote">{{ placementMode === 'replace' ? '替换会创建镜头新版本，保留字幕、裁剪与旧素材。若新素材不足以覆盖原裁剪区间，将提示重新调整。' : '素材加入成片后可在时间轴继续编排；漫剧补镜需关联场景与角色，并重新审片。' }}</p>
      </template><template #footer><el-button :disabled="busy" @click="placementInput = undefined">取消</el-button><el-button type="primary" :disabled="!canPlaceMedia" :loading="busy" @click="confirmMediaPlacement">{{ placementUnchanged ? '已使用此结果' : placementMode === 'replace' ? '确认替换，保留旧版' : '确认加入成片' }}</el-button></template>
    </el-dialog>
    <el-dialog v-model="exportVisible" title="导出短片" width="min(520px, calc(100vw - 24px))" appendToBody class="studioDialog">
      <div v-if="project" class="exportOverview"><strong>{{ project.title }}</strong><span>{{ totalDuration.toFixed(1) }} 秒 · {{ project.ratio }} · {{ readyClips }}/{{ project.shots.length }} 个视频镜头</span></div>
      <label v-if="project" class="exportRatio">成片画幅<select :value="project.ratio" :disabled="busy" aria-label="成片画幅" @change="setProjectRatio(($event.target as HTMLSelectElement).value as DirectorProject['ratio'])"><option value="16:9">16:9 横屏</option><option value="9:16">9:16 竖屏</option><option value="1:1">1:1 方形</option></select></label>
      <label v-if="project" class="exportRatio">导出分辨率<select :value="project.exportSettings?.resolution || '720p'" :disabled="busy" aria-label="导出分辨率" @change="setExportResolution(($event.target as HTMLSelectElement).value as '720p' | '1080p')"><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
      <p class="dialogNote">成片按当前镜头版本、裁剪、字幕、对白、音效与配乐合成为 MP4。选择更高分辨率不会增加源素材的真实细节。</p>
      <div v-if="unverifiedTasks.length" class="deliveryBlockers"><h4>先核对上游任务结果</h4><button type="button" @click="exportVisible = false; tasksVisible = true"><icon-alert-circle :size="13" />{{ unverifiedTasks.length }} 个任务尚待核对，处理后再导出<icon-arrow-up-right :size="13" /></button></div>
      <div v-if="readiness.delivery.length" class="deliveryBlockers"><h4>完成这些步骤后可导出成片</h4><button v-for="(issue, index) in readiness.delivery" :key="index" type="button" @click="goToReview(issue.shotId)"><icon-alert-circle :size="13" />{{ issue.message }}<icon-arrow-up-right :size="13" /></button></div>
      <p v-else-if="readyClips !== project?.shots.length" class="dialogNote">还有 {{ (project?.shots.length || 0) - readyClips }} 个镜头缺少视频。可先导出静态分镜预览。</p>
      <template #footer><el-button v-if="latestExport" :loading="savingExport" @click="downloadExport(latestExport.asset)">下载上次导出</el-button><el-button :disabled="busy || !!unverifiedTasks.length || !project?.shots.length || readyImages !== project?.shots.length" @click="exportMode('storyboard')">分镜预览</el-button><el-button type="primary" :disabled="busy || !!unverifiedTasks.length || !project?.shots.length || readyClips !== project?.shots.length || !!readiness.delivery.length" @click="exportMode('video')">合成 MP4</el-button></template>
    </el-dialog>
    <el-dialog v-model="modelsVisible" title="生成模型配置" width="min(560px, calc(100vw - 24px))" appendToBody class="studioDialog" :closeOnClickModal="!busy" :closeOnPressEscape="!busy" :showClose="!busy">
      <p class="dialogNote">选择图片和视频模型。首次接入时，请先到供应商设置填写 API 配置。</p>
      <el-button text :disabled="busy" @click="openProviderSettings">打开供应商设置</el-button>
      <el-form labelPosition="top" size="small" :disabled="busy"><el-form-item label="策划模型"><el-select v-model="modelAiSelection" placeholder="选择语言模型"><el-option v-for="model in aiModels" :key="modelKey(model)" :value="modelKey(model)" :label="`${model.providerLabel} · ${model.label}`" /></el-select></el-form-item><el-form-item label="图片模型"><el-select v-model="imageSelection" clearable placeholder="待选择"><el-option v-for="model in imageModels" :key="modelKey(model)" :value="modelKey(model)" :label="mediaLabel(model)" /></el-select></el-form-item><el-form-item label="视频模型"><el-select v-model="videoSelection" clearable placeholder="待选择"><el-option v-for="model in videoModels" :key="modelKey(model)" :value="modelKey(model)" :label="mediaLabel(model)" /></el-select></el-form-item><el-form-item v-if="videoResolutions.length" label="视频分辨率"><el-select v-model="resolution"><el-option v-for="item in videoResolutions" :key="item" :value="item" :label="item" /></el-select></el-form-item></el-form>
      <template #footer><el-button :disabled="busy" @click="modelsVisible = false">取消</el-button><el-button type="primary" :loading="busy" @click="saveModels">保存配置</el-button></template>
    </el-dialog>
    <el-dialog v-model="editVisible" title="编辑镜头" width="min(600px, calc(100vw - 24px))" appendToBody :closeOnClickModal="false" :closeOnPressEscape="!busy" :showClose="!busy" class="studioDialog"><el-form labelPosition="top" :disabled="busy"><el-form-item label="镜头名称"><el-input v-model="editFields.title" maxlength="120" /></el-form-item><el-form-item label="画面描述"><el-input v-model="editFields.description" type="textarea" :rows="3" maxlength="8000" /></el-form-item><el-form-item label="运镜"><el-input v-model="editFields.camera" maxlength="1000" /></el-form-item><div class="editTiming"><el-form-item label="镜头时长（秒）"><el-input-number v-model="editFields.duration" :min="1" :max="30" :step="0.5" /></el-form-item><el-form-item label="视频素材入点（秒）"><el-input-number v-model="editFields.trimStart" :min="0" :max="600" :step="0.5" /></el-form-item></div><el-form-item label="字幕"><el-input v-model="editFields.subtitle" maxlength="300" /></el-form-item><div class="editTiming"><el-form-item label="字幕出现（相对镜头，秒）"><el-input-number v-model="editFields.subtitleStart" :min="0" :max="editFields.duration" :step="0.1" /></el-form-item><el-form-item label="字幕结束（相对镜头，秒）"><el-input-number v-model="editFields.subtitleEnd" :min="0" :max="editFields.duration" :step="0.1" /></el-form-item></div><p class="editTip">时长、入点和字幕调整会复用当前视频；画面或运镜改变时，需要重新生成素材。</p></el-form><template #footer><el-button :disabled="busy" @click="editVisible = false">取消</el-button><el-button type="primary" :loading="busy" @click="saveEdit">保存修改</el-button></template></el-dialog>
    <el-dialog v-model="versionsVisible" :title="`镜头 ${versionShot?.order || ''} · 版本比较`" width="min(900px, calc(100vw - 24px))" appendToBody class="studioDialog"><div v-if="versionShot" class="versionCompare"><section v-for="side in ['left', 'right'] as const" :key="side"><el-select v-model="compareIds[side]" class="versionSelect"><el-option v-for="version in [...versionShot.versions].reverse()" :key="version.id" :value="version.id" :label="`V${version.number} · ${version.reason}`" /></el-select><template v-if="comparedVersion(side)"><mediaPreview :directory="directory" :path="comparedVersion(side)?.clip?.path || comparedVersion(side)?.keyframe?.path" :mimeType="comparedVersion(side)?.clip?.mimeType || comparedVersion(side)?.keyframe?.mimeType" label="此版本暂无媒体" /><p class="versionDescription">{{ comparedVersion(side)?.description }}</p><p class="versionMeta">{{ comparedVersion(side)?.camera }} · {{ comparedVersion(side)?.duration }} 秒</p><p class="versionMeta">字幕：{{ comparedVersion(side)?.subtitle || '无' }}</p><el-button :type="compareIds[side] === versionShot.currentVersionId ? 'default' : 'primary'" :disabled="busy || versionShot.locked || compareIds[side] === versionShot.currentVersionId" @click="selectVersion(compareIds[side])">{{ compareIds[side] === versionShot.currentVersionId ? '当前版本' : '选用此版本' }}</el-button></template></section></div></el-dialog>
    <el-dialog v-model="previewVisible" title="短片预览" width="min(900px, calc(100vw - 24px))" appendToBody destroyOnClose class="studioDialog previewDialog" @opened="previewPlayer?.focus()"><studioPreview v-if="project && previewVisible" ref="previewPlayer" :directory="directory" :project="project" :autoplay="previewAutoplay" :initialShotId="previewShotId" @selectShot="selectedShotId = $event" /><div v-if="latestExport" class="exportResult"><span>{{ latestExportStale ? '镜头或配乐已更新，可重新导出' : latestExport.mode === 'storyboard' ? '分镜预览已就绪（静态关键帧）' : '最近成片已就绪' }}</span><span>{{ formatTime(latestExport.createdAt) }}</span><el-button text :icon="IconDownload" @click="downloadExport(latestExport.asset)">{{ latestExport?.mode === 'storyboard' ? '下载分镜预览' : '下载最近成片' }}</el-button></div></el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, provide, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { IconAdjustmentsHorizontal, IconFileText, IconAlertCircle, IconArrowRight, IconArrowUp, IconArrowUpRight, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconDownload, IconFileMusic, IconFolders, IconGitBranch, IconHistory, IconLayoutBoard, IconLayoutSidebarRight, IconLink, IconListCheck, IconLoader2, IconLock, IconLockOpen, IconMovie, IconMusic, IconPencil, IconPlayerPlay, IconPlayerPlayFilled, IconPlus, IconRefresh, IconSettings, IconShieldCheck, IconSparkles, IconTimeline, IconTypography, IconUpload, IconX } from "@tabler/icons-vue";
import type { MediaModel } from "@toonflow/tools-scaffold/runtime";
import type { DirectorAsset, DirectorGenerationInput, DirectorModels, DirectorProject, DirectorShot, DirectorTask, ShotFields, ShotPatch } from "@toonflow/server/directorTypes";
import { ElMessage, ElMessageBox } from "element-plus";
import { useWorkspaceStore } from "@/stores/workspace";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import saveFile from "@/lib/saveFile";
import { readWebPlanningModel, saveWebPlanningModel } from "@/lib/webPlanningModel";
import { directorError, directorRequest, uploadDirectorFile } from "./api";
import mediaPreview from "./mediaPreview.vue";
import creativeCanvas from "./creativeCanvas.vue";
import studioThumbnail from "./studioThumbnail.vue";
import studioPreview from "./studioPreview.vue";
import productionPanel from "./productionPanel.vue";
import agent from "@/components/agent/index.vue";
import taskDrawer from "./taskDrawer.vue";
import timelineEditor from "./timelineEditor.vue";
import audioPanel from "./audioPanel.vue";

const props = defineProps<{ settingsVisible?: boolean }>();
const emit = defineEmits<{ openSettings: []; exit: []; openCanvas: [] }>();
type AiModel = { providerId: string; modelId: string; providerLabel: string; label: string };
type ReadinessIssue = { message: string; shotId?: string };
type Snapshot = { project: DirectorProject | null; mediaModels: MediaModel[]; aiModels: AiModel[]; configuredMediaProviders: string[]; readiness?: { generation: ReadinessIssue[]; delivery: ReadinessIssue[] } };
const workspace = useWorkspaceStore();
const route = useRoute();
const directory = computed(() => workspace.project?.directory || "");
const project = ref<DirectorProject | null>(null);
const mediaModels = ref<MediaModel[]>([]);
const aiModels = ref<AiModel[]>([]);
const configuredProviders = ref<string[]>([]);
const loading = ref(false);
const requestBusy = ref(false);
const productionBusy = ref(false);
const productionEditor = ref<InstanceType<typeof productionPanel>>();
const busy = computed({ get: () => requestBusy.value || productionBusy.value, set: (value: boolean) => { requestBusy.value = value; } });
const planning = ref(false);
const applying = ref(false);
const error = ref("");
const aiSelection = ref("");
const imageSelection = ref("");
const videoSelection = ref("");
const resolution = ref("");
const instruction = ref("");
const selectedShotId = ref("");
const inlineShotId = ref("");
const viewMode = ref<"production" | "canvas" | "preview">("preview");
const canvasActive = computed(() => viewMode.value === "canvas");
const canvasTimelineVisible = ref(false);
const creativeEditor = ref<InstanceType<typeof creativeCanvas>>();
const canvasNodeLabels = ref<Record<string, string>>({});
const inspectorVisible = ref(true);
const assetRailVisible = ref(false);
const agentVisible = ref(true);
const tasksVisible = ref(false);
const exportVisible = ref(false);
const readiness = ref<{ generation: ReadinessIssue[]; delivery: ReadinessIssue[] }>({ generation: [], delivery: [] });
const inlinePlayer = ref<InstanceType<typeof studioPreview>>();
const playhead = ref(0);
const timelineImportInput = ref<HTMLInputElement>();
type PlacementInput = { title: string; kind: "image" | "video"; asset: { path: string; mimeType: string }; duration?: number; sourceNodeId?: string; sourceTaskId?: string; sourceInputHash?: string; targetShotId?: string };
const placementInput = ref<PlacementInput>();
const placementMode = ref<"add" | "replace">("add");
const placementTarget = ref("");
const placementAfter = ref("");
const placementScene = ref("");
const placementCharacters = ref<string[]>([]);
const replacementImportId = ref("");
const placementScenes = computed(() => project.value?.production?.scriptVersions.find(script => script.id === project.value?.production?.currentScriptVersionId)?.scenes || []);
const placementShot = computed(() => findShot(placementTarget.value));
const placementUnchanged = computed(() => {
  const input = placementInput.value; const shot = placementShot.value;
  if (placementMode.value !== "replace" || !input || !shot) return false;
  const asset = input.kind === "video" ? currentVersion(shot).clip : currentVersion(shot).keyframe;
  return input.sourceTaskId ? asset?.sourceTaskId === input.sourceTaskId : !!input.sourceInputHash && asset?.sourceNodeId === input.sourceNodeId && asset?.inputHash === input.sourceInputHash;
});
const canPlaceMedia = computed(() => !!placementInput.value && !busy.value && !placementUnchanged.value && (placementMode.value === "replace" ? !!placementShot.value && !placementShot.value.locked && !shotWorking(placementShot.value.id) : !project.value?.production || !!placementScene.value));
const studioColumns = computed(() => ({ gridTemplateColumns: `${assetRailVisible.value && viewMode.value !== "production" ? "220px " : ""}minmax(0, 1fr)${inspectorVisible.value && viewMode.value !== "production" ? " 360px" : ""}` }));
const rightTab = ref<"agent" | "shot" | "music">("agent");
const previewVisible = ref(false);
const previewPlayer = ref<InstanceType<typeof studioPreview>>();
const previewAutoplay = ref(false);
const previewShotId = ref("");
const modelsVisible = ref(false);
const modelAiSelection = ref("");
const savingExport = ref(false);
const requestedExportTaskId = ref("");
const draggedShotId = ref("");
const musicInput = ref<HTMLInputElement>();
const musicVolume = ref(25);
const selectedImportInput = ref<HTMLInputElement>();
const selectedImportKind = ref<"image" | "video">("image");
const draft = reactive({ title: "", brief: "", style: "写实动漫", characterConstraints: "", invariants: "", ratio: "16:9", episode: 1, targetDuration: 30, shotCount: 6 });
const editVisible = ref(false);
const editingShotId = ref("");
const editingBaseVersionId = ref("");
const editFields = reactive<ShotFields>({ title: "", description: "", camera: "", duration: 4, subtitle: "", trimStart: 0, subtitleStart: 0, subtitleEnd: 4 });
const versionsVisible = ref(false);
const versionShotId = ref("");
const compareIds = reactive({ left: "", right: "" });
const lifetime = new AbortController();
let loadSequence = 0;
let disposed = false;
const fieldLabels: Record<keyof ShotFields, string> = { title: "名称", description: "画面", camera: "运镜", duration: "时长", subtitle: "字幕", trimStart: "入点", subtitleStart: "出现", subtitleEnd: "结束", sceneId: "场景", characterIds: "角色", startState: "起始状态", endState: "结束状态", dialogues: "对白" };
const taskLabels = { queued: "排队中", running: "执行中", succeeded: "已完成", failed: "失败", interrupted: "已中断", verificationRequired: "上游待核对", cancelled: "已停止本地任务" };
const unverifiedTasks = computed(() => project.value?.tasks.filter(task => task.status === "verificationRequired") || []);
const activeTaskCount = computed(() => project.value?.tasks.filter(task => ["queued", "running", "verificationRequired"].includes(task.status)).length ?? 0);
provide("canvas", (): CanvasContext | undefined => {
  const target = directory.value;
  const id = project.value?.id;
  if (!target || !id) return;
  return {
    id: `creative:${id}`, tools: [],
    getNodeLabel: nodeId => creativeEditor.value?.getCanvasContext().getNodeLabel?.(nodeId) || canvasNodeLabels.value[nodeId] || (nodeId.startsWith("shot:") && findShot(nodeId.slice(5)) ? `第 ${findShot(nodeId.slice(5))!.order} 镜 · ${currentVersion(findShot(nodeId.slice(5))).title}` : "创作节点"),
    async call(request, signal) {
      signal?.throwIfAborted();
      if (disposed || directory.value !== target || project.value?.id !== id) throw new Error("项目已切换，请重新发送请求。");
      if (viewMode.value !== "canvas") { await setView("canvas"); inspectorVisible.value = true; await nextTick(); }
      if (viewMode.value !== "canvas" || !creativeEditor.value) throw new Error("请先保存当前编辑，再打开创作画布。");
      await creativeEditor.value.whenReady();
      const result = await creativeEditor.value.getCanvasContext().call(request, signal);
      await load();
      return result;
    },
  };
});
const imageModels = computed(() => mediaModels.value.filter(model => model.type === "image"));
const videoModels = computed(() => mediaModels.value.filter(model => model.type === "video"));
const videoResolutions = computed(() => { const model = videoModels.value.find(item => modelKey(item) === videoSelection.value); return [...new Set(model?.durationResolutionMap?.map(item => item.resolution).flat() || [])]; });
const lockedShots = computed(() => project.value?.shots.filter(shot => shot.locked) || []);
const totalDuration = computed(() => project.value?.shots.reduce((sum, shot) => sum + currentVersion(shot).duration, 0) || 0);
const readyClips = computed(() => project.value?.shots.filter(shot => currentVersion(shot).clip).length || 0);
const readyImages = computed(() => project.value?.shots.filter(shot => currentVersion(shot).keyframe).length || 0);
const selectedShot = computed(() => findShot(selectedShotId.value));
const affectedIds = computed(() => pendingPlan.value?.changes.map(change => change.shotId) || []);
const preservedShotText = computed(() => { const kept = project.value?.shots.filter(shot => !affectedIds.value.includes(shot.id)).map(shot => shot.order); return kept?.length ? `镜头 ${kept.join('、')} 保持不变，原版本保留` : "所有镜头原版本继续保留"; });
const musicName = computed(() => project.value?.music ? "项目背景音乐" : "未添加音乐");
const canGenerateMissing = computed(() => {
  const shots = project.value?.shots.filter(shot => !shot.locked && !currentVersion(shot).clip) || [];
  return shots.length > 0 && shots.every(shot => videoReady.value && (currentVersion(shot).keyframe || imageReady.value));
});
const imageReady = computed(() => !!project.value?.models.image && configuredProviders.value.includes(project.value.models.image.providerId));
const videoReady = computed(() => !!project.value?.models.video && configuredProviders.value.includes(project.value.models.video.providerId));
const generationConnectionText = computed(() => imageReady.value && videoReady.value ? "生成模型已接入" : videoReady.value ? "视频已接入 · 图片待配置" : imageReady.value ? "图片已接入 · 视频待配置" : "图片 / 视频模型待接入");
const pendingPlan = computed(() => { const plan = project.value?.plans.at(-1); return plan?.status === "pending" ? plan : undefined; });
const planInstructionText = computed(() => pendingPlan.value?.instruction.replace(/^当前选中镜头[\s\S]*?用户要求：/, "") || "");
const planConflict = computed(() => {
  for (const change of pendingPlan.value?.changes || []) {
    const shot = findShot(change.shotId);
    if (!shot) return "计划中的镜头已不存在，请重新制定或放弃计划。";
    if (shot.locked) return `镜头 ${shot.order} 已锁定。解锁后可以继续，或放弃这份计划。`;
    if (shot.currentVersionId !== change.baseVersionId) return `镜头 ${shot.order} 已有新版本，请重新制定或放弃计划。`;
  }
  return "";
});
const generationBlockReason = computed(() => {
  if (busy.value) return "正在保存，请稍候";
  const missing = project.value?.shots.filter(shot => !shot.locked && !currentVersion(shot).clip) || [];
  if (!missing.length) return "没有待生成的未锁定镜头";
  if (!videoReady.value) return "请先在“配置”中接入并选择视频模型";
  if (!imageReady.value && missing.some(shot => !currentVersion(shot).keyframe)) return "请配置图片模型，或为待生成镜头导入关键帧";
  return "";
});
const latestExport = computed(() => project.value?.exports.at(-1));
const latestExportTask = computed(() => project.value?.tasks.findLast(task => task.stage === "export"));
const exporting = computed(() => !!latestExportTask.value && ["queued", "running"].includes(latestExportTask.value.status));
const exportStatusText = computed(() => {
  if (exporting.value) return "正在导出短片，完成后可在这里保存";
  if (latestExportTask.value && ["failed", "interrupted"].includes(latestExportTask.value.status)) return latestExportTask.value.error || "导出未完成，请重试";
  if (latestExportStale.value) return "镜头或配乐已更新，请重新导出。上次的文件仍可保存。";
  return latestExport.value?.mode === "storyboard" ? "分镜预览已导出 · 静态关键帧与配乐" : "视频已导出，可以保存到电脑";
});
const latestExportStale = computed(() => {
  const movie = latestExport.value;
  const current = project.value;
  return !!movie && !!current && (movie.shotVersions.length !== current.shots.length
    || current.shots.some((shot, index) => movie.shotVersions[index]?.shotId !== shot.id || movie.shotVersions[index]?.versionId !== shot.currentVersionId)
    || movie.musicPath !== current.music?.asset.path || movie.musicVolume !== current.music?.volume
    || (movie.originalAudio ?? false) !== (current.originalAudio ?? false) || !!movie.ratio && movie.ratio !== current.ratio
    || (movie.audioSignature ?? "[]") !== JSON.stringify(current.audioTracks ?? []) || (movie.resolution ?? "720p") !== (current.exportSettings?.resolution ?? "720p"));
});
const versionShot = computed(() => project.value?.shots.find(shot => shot.id === versionShotId.value));
const planHasRegeneration = computed(() => pendingPlan.value?.effects.some(effect => effect.regenerate.length > 0) || false);
const planActionLabel = computed(() => {
  if (project.value?.production && planHasRegeneration.value) return "保存改稿，复查分镜";
  if (project.value?.production && !planHasRegeneration.value) return "保存修改，复查字幕";
  if (!planHasRegeneration.value) return project.value && readyClips.value === project.value.shots.length ? "应用并重新合成" : "应用分镜修改";
  return canGeneratePlan.value ? "执行计划并生成" : "应用分镜修改";
});
const canGeneratePlan = computed(() => !!pendingPlan.value && pendingPlan.value.effects.every(effect => effect.regenerate.every(step => step === "image" ? imageReady.value : videoReady.value)));
function modelKey(model: { providerId: string; modelId: string }) { return JSON.stringify([model.providerId, model.modelId]); }
function modelValue(value: string) { const [providerId, modelId] = JSON.parse(value) as [string, string]; return { providerId, modelId }; }
function mediaLabel(model: MediaModel) { return `${model.providerLabel} · ${model.label}${configuredProviders.value.includes(model.providerId) ? "" : "（待配置）"}`; }
function currentVersion(shot: DirectorShot | undefined) { const version = shot?.versions.find(item => item.id === shot.currentVersionId) ?? shot?.versions[0]; if (!version) throw new Error("镜头版本不存在，请刷新项目"); return version; }
function findShot(id: string) { return project.value?.shots.find(shot => shot.id === id); }
function shotOrder(id?: string) { return findShot(id || "")?.order ?? ""; }
function latestShotTask(id: string) { return project.value?.tasks.findLast(task => task.shotId === id && task.versionId === findShot(id)?.currentVersionId); }
function planEffect(id: string) { return pendingPlan.value?.effects.find(effect => effect.shotId === id); }
function characterName(id: string) { return project.value?.production?.characters.find(character => character.id === id)?.name || "未关联角色"; }
function planFieldValue(key: keyof ShotFields, value: unknown) {
  if (key === "characterIds" && Array.isArray(value)) return value.map(id => characterName(String(id))).join("、");
  if (key === "sceneId") return project.value?.production?.scriptVersions.find(script => script.id === project.value?.production?.currentScriptVersionId)?.scenes.find(scene => scene.id === value)?.title || "未关联场景";
  if (key === "dialogues" && Array.isArray(value)) return value.map(line => `${characterName(line.speakerId)} · ${line.text}`).join("\n");
  return String(value ?? "");
}
function formatTime(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function acceptProject(value: DirectorProject, target: string) { if (!disposed && directory.value === target) { project.value = value; if (selectedShotId.value && !value.shots.some(shot => shot.id === selectedShotId.value)) selectedShotId.value = ""; } }
async function load(reportError = false) {
  const target = directory.value;
  if (!target || busy.value) return;
  const sequence = ++loadSequence;
  if (!project.value) loading.value = true;
  try {
    const result = await directorRequest<Snapshot>("/get", target, undefined, lifetime.signal);
    if (disposed || sequence !== loadSequence || directory.value !== target) return;
    if (project.value?.id !== result.project?.id) { viewMode.value = result.project?.production ? "production" : result.project?.creationKind === "edit" || route.query.view === "edit" ? "preview" : "canvas"; inspectorVisible.value = !canvasActive.value; }
    project.value = result.project;
    mediaModels.value = result.mediaModels;
    aiModels.value = result.aiModels;
    configuredProviders.value = result.configuredMediaProviders;
    readiness.value = result.readiness ?? { generation: [], delivery: [] };
    const savedSelection = readWebPlanningModel(target);
    if (savedSelection && result.aiModels.some(model => modelKey(model) === savedSelection)) aiSelection.value = savedSelection;
    else if (!aiSelection.value || !result.aiModels.some(model => modelKey(model) === aiSelection.value)) aiSelection.value = result.aiModels.find(model => model.modelId.includes("deepseek")) ? modelKey(result.aiModels.find(model => model.modelId.includes("deepseek"))!) : result.aiModels[0] ? modelKey(result.aiModels[0]) : "";
    if (imageSelection.value === "" && result.project?.models.image) imageSelection.value = modelKey(result.project.models.image);
    if (videoSelection.value === "" && result.project?.models.video) { videoSelection.value = modelKey(result.project.models.video); resolution.value = result.project.models.video.resolution || ""; }
  } catch (cause) { if (!disposed && directory.value === target && (reportError || !project.value)) error.value = directorError(cause); }
  finally { if (sequence === loadSequence) loading.value = false; }
}
async function requestProject(path: string, input: Record<string, unknown>) {
  const target = directory.value;
  busy.value = true;
  error.value = "";
  ++loadSequence;
  try { const result = await directorRequest<DirectorProject>(path, target, input, lifetime.signal); acceptProject(result, target); return result; }
  catch (cause) { if (!disposed && directory.value === target) { error.value = directorError(cause); ElMessage.error(error.value); } return undefined; }
  finally { if (!disposed && directory.value === target) busy.value = false; }
}
async function perform(action: string, args: Record<string, unknown> = {}) { if (!project.value || busy.value) return; return requestProject("/action", { action, expectedRevision: project.value.revision, ...args }); }
async function createStoryboard() {
  if (!aiSelection.value || !draft.title.trim() || !draft.brief.trim() || !draft.style.trim() || !draft.characterConstraints.trim() || !draft.invariants.trim()) return;
  const result = await requestProject("/production", { action: "draft", ...draft, ...modelValue(aiSelection.value) });
  if (result) viewMode.value = "production";
}
async function toggleLock(shot: DirectorShot) { await perform("lock", { shotId: shot.id, locked: !shot.locked }); }
async function planRevision(rebuild = false) {
  if (!project.value || !aiSelection.value) return;
  const context = selectedShot.value ? `当前选中镜头 ${selectedShot.value.order}（${currentVersion(selectedShot.value).title}）；用户说“这个镜头”时指该镜头。用户要求：` : "";
  planning.value = true;
  const text = rebuild ? pendingPlan.value?.instruction : context + instruction.value;
  if (!text?.trim()) { planning.value = false; return; }
  try { await requestProject("/plan", { instruction: text, expectedRevision: project.value.revision, ...modelValue(aiSelection.value) }); }
  finally { planning.value = false; }
}
async function discardPlan() {
  const plan = pendingPlan.value;
  if (plan && await perform("discardPlan", { planId: plan.id })) ElMessage.success("已放弃计划，镜头内容保持不变");
}
function openPreview(autoplay = false, shotId = "") {
  previewAutoplay.value = autoplay;
  previewShotId.value = shotId;
  previewVisible.value = true;
}
function openModelSettings() {
  modelAiSelection.value = aiSelection.value;
  imageSelection.value = project.value?.models.image ? modelKey(project.value.models.image) : "";
  videoSelection.value = project.value?.models.video ? modelKey(project.value.models.video) : "";
  resolution.value = project.value?.models.video?.resolution || "";
  modelsVisible.value = true;
}
function openProviderSettings() { modelsVisible.value = false; emit("openSettings"); }
async function executePlan() {
  const plan = pendingPlan.value;
  if (!plan) return;
  const shouldGenerate = canGeneratePlan.value;
  applying.value = true;
  try {
    const result = await perform("apply", { planId: plan.id });
    if (!result) return;
    if (result.production) {
      await load();
      ElMessage.success(plan.effects.some(effect => effect.regenerate.length) ? "改稿已保存，请确认新的分镜版本后生成。" : "修改已保存，原画面素材保留，请复查字幕与审片。");
      await goToReview(plan.changes[0]?.shotId);
      return;
    }
    const affected = plan.effects.filter(effect => effect.regenerate.length).map(effect => effect.shotId);
    if (shouldGenerate && affected.length) await generate(affected, "all");
    else if (!affected.length && readyClips.value === result.shots.length) await exportMode("video");
    else ElMessage.success("分镜修改已保存，其他镜头保持不变");
  } finally { applying.value = false; }
}
async function generate(shotIds: string[] | undefined, stage: "image" | "video" | "all", versionId?: string) {
  await load();
  if (readiness.value.generation.length) { error.value = readiness.value.generation[0]!.message; await goToReview(readiness.value.generation[0]!.shotId); return; }
  const result = await perform("generate", { shotIds, stage, ...(versionId ? { versionId } : {}) });
  if (result) tasksVisible.value = true;
}
async function generateShot(shot: DirectorShot, stage: "image" | "video") { await generate([shot.id], stage); }
function editShot(shot: DirectorShot) {
  selectShot(shot.id);
  if (shot.locked || busy.value || shotWorking(shot.id)) { rightTab.value = "shot"; return; }
  const version = currentVersion(shot);
  editingShotId.value = shot.id;
  editingBaseVersionId.value = version.id;
  Object.assign(editFields, { title: version.title, description: version.description, camera: version.camera, duration: version.duration, subtitle: version.subtitle, trimStart: version.trimStart ?? 0, subtitleStart: version.subtitleStart ?? 0, subtitleEnd: version.subtitleEnd ?? version.duration });
  editVisible.value = true;
}
async function saveEdit() {
  const shot = findShot(editingShotId.value); if (!shot) return;
  if ((editFields.subtitleStart ?? 0) >= (editFields.subtitleEnd ?? editFields.duration)) { ElMessage.warning("字幕结束时间需要晚于出现时间"); return; }
  const original = currentVersion(shot);
  if (original.id !== editingBaseVersionId.value) { ElMessage.warning("镜头已有新版本，请关闭后重新编辑，当前内容未被覆盖"); return; }
  const previous = { ...original, trimStart: original.trimStart ?? 0, subtitleStart: original.subtitleStart ?? 0, subtitleEnd: original.subtitleEnd ?? original.duration }; const patch: ShotPatch = {};
  for (const field of Object.keys(editFields) as (keyof ShotFields)[]) if (editFields[field] !== previous[field]) Object.assign(patch, { [field]: editFields[field] });
  if (!Object.keys(patch).length) { editVisible.value = false; return; }
  if (await perform("edit", { shotId: shot.id, patch })) {
    editVisible.value = false; rightTab.value = "shot"; inspectorVisible.value = true;
    ElMessage.success("镜头已保存，可在版本比较中恢复之前的内容");
  }
}
async function attachFile(shot: DirectorShot, kind: "image" | "video", file: File) {
  const target = directory.value; const revision = project.value?.revision;
  if (revision === undefined || busy.value) return;
  busy.value = true; error.value = "";
  try { if (!file.type.startsWith(`${kind}/`)) throw new Error("文件类型与所选素材不匹配"); const asset = await uploadDirectorFile(target, file); const result = await directorRequest<DirectorProject>("/action", target, { action: "attach", shotId: shot.id, kind, ...asset, expectedRevision: revision }, lifetime.signal); acceptProject(result, target); }
  catch (cause) { if (!disposed && target === directory.value) error.value = directorError(cause); }
  finally { if (!disposed && target === directory.value) busy.value = false; }
}
function showVersions(shot: DirectorShot) { versionShotId.value = shot.id; compareIds.right = shot.currentVersionId; compareIds.left = shot.versions.filter(version => version.id !== shot.currentVersionId).at(-1)?.id || shot.currentVersionId; versionsVisible.value = true; }
function comparedVersion(side: "left" | "right") { return versionShot.value?.versions.find(version => version.id === compareIds[side]); }
async function selectVersion(versionId: string) { if (versionShot.value && await perform("selectVersion", { shotId: versionShot.value.id, versionId })) ElMessage.success("已切换镜头版本，合成时将使用此版本"); }
async function saveModels() {
  const target = directory.value;
  const selection = modelAiSelection.value;
  const models: DirectorModels = {};
  if (imageSelection.value) models.image = modelValue(imageSelection.value);
  if (videoSelection.value) models.video = { ...modelValue(videoSelection.value), ...(resolution.value ? { resolution: resolution.value } : {}) };
  if (await perform("configure", { models })) {
    saveWebPlanningModel(target, selection);
    aiSelection.value = selection;
    modelsVisible.value = false;
    ElMessage.success("模型选择已保存");
  }
}
function canRetry(task: DirectorTask) { if (task.nodeId) return !!task.generation && configuredProviders.value.includes(task.generation.model.providerId); if (task.stage === "export") return (task.exportMode === "storyboard" ? readyImages.value : readyClips.value) === project.value?.shots.length; const shot = findShot(task.shotId || ""); return !!shot && !shot.locked && shot.versions.some(version => version.id === task.versionId) && (task.stage === "image" ? imageReady.value : videoReady.value); }
async function retryTask(task: DirectorTask) { if (task.nodeId && task.generation) { const result = await requestProject("/generation", { ...task.generation, requestId: crypto.randomUUID(), expectedRevision: project.value?.revision }); if (result) tasksVisible.value = true; } else if (task.stage === "export") await exportMode(task.exportMode || "video"); else if (task.shotId) await generate([task.shotId], task.stage, task.versionId); }
async function downloadExport(asset: DirectorAsset, mode = latestExport.value?.mode) {
  if (savingExport.value) return;
  const target = directory.value;
  const title = project.value?.title || "短片";
  savingExport.value = true;
  try {
    const saved = await saveFile(async () => new Blob([await useWorkspaceFiles(target).read(asset.path)], { type: asset.mimeType }), `${title}${mode === "storyboard" ? "_分镜预览" : ""}.mp4`);
    ElMessage({ type: saved ? "success" : "info", message: saved ? "视频文件已保存" : "已取消保存，导出结果仍保留在项目中" });
  } catch (cause) { if (directory.value === target) error.value = directorError(cause); ElMessage.error(directorError(cause)); }
  finally { savingExport.value = false; }
}
function selectShot(id: string) { selectedShotId.value = id; inlineShotId.value = id; if (!canvasActive.value) inspectorVisible.value = true; if (rightTab.value === "music") rightTab.value = "shot"; }
function openCanvasAgent(shotId?: string) { if (shotId) selectShot(shotId); else selectedShotId.value = ""; rightTab.value = "agent"; inspectorVisible.value = true; }
async function toggleAgent() { inspectorVisible.value = !inspectorVisible.value; if (inspectorVisible.value) { rightTab.value = "agent"; agentVisible.value = true; } await nextTick(); creativeEditor.value?.fit(); }
async function generateCanvasNode(input: DirectorGenerationInput) {
  if (!project.value || busy.value) return;
  await creativeEditor.value?.flushSave();
  const result = await requestProject("/generation", { ...input, expectedRevision: project.value.revision });
  if (result) { tasksVisible.value = true; ElMessage.success("生成任务已提交，结果会回到当前节点，其他镜头可继续编辑。"); }
}
async function adoptGeneratedReference(task: DirectorTask) {
  const workflow = project.value?.production; const scope = task.generation?.scope;
  if (!project.value || !workflow || !task.output || !scope || scope.kind === "shot" || busy.value) return;
  const target = directory.value; const revision = project.value.revision;
  const referenceImage = { path: task.output.path, mimeType: task.output.mimeType, rights: "unverified" };
  let fields: Record<string, unknown>;
  if (scope.kind === "character") {
    const character = workflow.characters.find(character => character.id === scope.characterId);
    if (!character || character.revision !== scope.revision) { ElMessage.warning("角色设定已变化，请先核对候选图与当前角色，再重新绑定参考图。"); return; }
    const { revision: _revision, confirmedAt: _confirmedAt, ...details } = character;
    fields = { action: "saveCharacter", character: { ...details, referenceImage } };
  } else {
    if (workflow.currentScriptVersionId !== scope.scriptVersionId) { ElMessage.warning("剧本已变化，请先核对当前场景，再绑定参考图。"); return; }
    fields = { action: "sceneReference", sceneId: scope.sceneId, referenceImage };
  }
  try { await ElMessageBox.confirm("将这张候选图设为制作参考。已有镜头素材保留，相关审片标记为待复查；请在制作流程中核验素材来源并重新确认。", "采用参考图", { confirmButtonText: "采用并核验", cancelButtonText: "暂不采用", type: "warning" }); } catch { return; }
  if (directory.value !== target || project.value.revision !== revision) { ElMessage.warning("项目已更新，请核对后重新采用。"); return; }
  await creativeEditor.value?.flushSave();
  const result = await requestProject("/production", { ...fields, expectedRevision: revision });
  if (result) { await setView("production"); await nextTick(); productionEditor.value?.openStage(scope.kind === "character" ? "characters" : "script"); ElMessage.success("参考图已绑定，请核验来源后确认。"); }
}
function addToTimeline(input: PlacementInput) {
  placementInput.value = input;
  placementMode.value = input.targetShotId ? "replace" : "add";
  placementTarget.value = input.targetShotId || selectedShotId.value || project.value?.shots[0]?.id || "";
  placementAfter.value = selectedShotId.value || project.value?.shots.at(-1)?.id || "";
  placementScene.value = (selectedShot.value ? currentVersion(selectedShot.value).sceneId : "") || placementScenes.value[0]?.id || "";
  placementCharacters.value = selectedShot.value ? [...(currentVersion(selectedShot.value).characterIds || [])] : [];
}
async function confirmMediaPlacement() {
  const input = placementInput.value;
  if (!input || !canPlaceMedia.value) return;
  const { asset, targetShotId: _targetShotId, ...source } = input;
  const before = new Set(project.value?.shots.map(shot => shot.id));
  const result = await perform("addMediaShot", { ...source, ...asset, ...(placementMode.value === "replace" ? { targetShotId: placementTarget.value } : { ...(placementAfter.value ? { afterShotId: placementAfter.value } : {}), allowDuplicate: true, ...(project.value?.production ? { sceneId: placementScene.value, characterIds: placementCharacters.value } : {}) }) });
  if (!result) return;
  selectedShotId.value = placementMode.value === "replace" ? placementTarget.value : result.shots.find(shot => !before.has(shot.id))?.id || "";
  placementInput.value = undefined;
  canvasTimelineVisible.value = true;
  ElMessage.success(placementMode.value === "replace" ? "已替换镜头素材，裁剪与字幕保留，旧版本可恢复。" : "已加入成片，角色与场景关联已保留。");
}
function chooseTimelineImport(shotId = "") { replacementImportId.value = shotId; timelineImportInput.value?.click(); }
async function removeShot(shotId: string) { if (await perform("deleteShot", { shotId })) ElMessage.success("镜头已移出成片，素材文件保留，可撤销。"); }
function shotWorking(shotId: string) { return !!project.value?.tasks.some(task => task.shotId === shotId && ["queued", "running"].includes(task.status)); }
async function importTimelineFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = "";
  if (!file || busy.value || !project.value) return;
  const target = directory.value;
  busy.value = true;
  try {
    if (!/^(image|video)\//.test(file.type)) throw new Error("请选择图片或视频文件。");
    const asset = await uploadDirectorFile(target, file);
    if (target === directory.value) addToTimeline({ title: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "导入素材", kind: file.type.startsWith("image/") ? "image" : "video", asset, ...(replacementImportId.value ? { targetShotId: replacementImportId.value } : {}) });
  } catch (cause) { error.value = directorError(cause); }
  finally { if (target === directory.value) busy.value = false; }
}
async function importAudioTrack(kind: "dialogue" | "sfx", file: File, shotId?: string, characterId?: string) {
  if (busy.value || !project.value) return;
  const target = directory.value;
  const revision = project.value.revision;
  busy.value = true;
  try {
    const asset = await uploadDirectorFile(target, file);
    const result = await directorRequest<DirectorProject>("/action", target, { action: "addAudioTrack", expectedRevision: revision, ...asset, label: file.name.slice(0, 120), kind, ...(shotId ? { shotId } : {}), ...(characterId ? { characterId } : {}), start: 0 }, lifetime.signal);
    acceptProject(result, target);
    ElMessage.success("声音已加入，可调整起点、裁剪与音量。");
  } catch (cause) { if (directory.value === target) { error.value = directorError(cause); ElMessage.error(error.value); } }
  finally { if (directory.value === target) busy.value = false; }
}
async function cancelTask(task: DirectorTask) { if (await perform("cancelTask", { taskId: task.id })) ElMessage.info(task.status === "queued" ? "已取消排队。" : "已停止本地等待；远端是否完成仍需查询核对。"); }
async function resolveTask(input: { taskId: string; resolution: "notSubmitted" | "failed" | "abandoned"; note: string }) { if (await perform("resolveTask", input)) ElMessage.success("人工核对已记录。"); }
async function refreshTask(task: DirectorTask) { const result = await perform("refreshTask", { taskId: task.id }); if (result) ElMessage.info("已查询原任务，未重新提交生成。"); }
async function locateTask(task: DirectorTask) { tasksVisible.value = false; if (task.nodeId) { await setView("canvas"); await nextTick(); await creativeEditor.value?.selectNodes([task.nodeId]); creativeEditor.value?.fit(); } else if (task.shotId) { await setView("canvas"); selectShot(task.shotId); } }
async function downloadTaskAsset(task: DirectorTask) { if (!task.output) return; if (task.stage === "export") return downloadExport(task.output, task.exportMode); const asset = task.output; const target = directory.value; try { await saveFile(async () => new Blob([await useWorkspaceFiles(target).read(asset.path)], { type: asset.mimeType }), asset.path.split("/").at(-1) || "创作素材"); } catch (cause) { ElMessage.error(directorError(cause)); } }
function seekTimeline(time: number) { playhead.value = time; inlinePlayer.value?.seek(time); }
function playTimeline() { if (viewMode.value === "preview") inlinePlayer.value?.togglePlayback(); else openPreview(true); }
async function saveTimelinePatch(input: { shotId: string; baseVersionId: string; patch: ShotPatch }) {
  const shot = findShot(input.shotId);
  if (!shot || busy.value) return;
  if (shot.currentVersionId !== input.baseVersionId) { ElMessage.warning("镜头已有新版本，本次编辑未覆盖它。请重新选择片段后调整。"); return; }
  await perform("edit", { shotId: input.shotId, patch: input.patch });
}
async function openExport() { await load(true); exportVisible.value = true; }
async function setExportResolution(resolution: "720p" | "1080p") { if (await perform("setExportSettings", { settings: { resolution } })) await load(); }
async function setProjectRatio(ratio: DirectorProject["ratio"]) { if (await perform("setRatio", { ratio })) await load(); }
async function openCharacters() { await setView("production"); await nextTick(); productionEditor.value?.openStage("characters"); }
async function goToReview(shotId?: string) { exportVisible.value = false; if (shotId) selectedShotId.value = shotId; if (project.value?.production) { await setView("production"); await nextTick(); productionEditor.value?.openStage("review", shotId); } else { await setView("canvas"); } }
async function applyCanvasInputs(input: { shotId: string; signature: string; text?: string; asset?: { path: string; mimeType: string; kind: "image" | "video" } }) {
  if (shotWorking(input.shotId)) { ElMessage.info("这个镜头正在生成，请完成或停止任务后再应用输入。其他镜头可以继续编辑。"); return; }
  const editor = creativeEditor.value;
  const { shotId, signature, ...inputs } = input;
  const result = await perform("applyCanvasInputs", { shotId, inputs });
  if (result) {
    const versionId = result.shots.find(shot => shot.id === shotId)?.currentVersionId;
    if (versionId) editor?.confirmApplied(shotId, signature, versionId);
    ElMessage.success("输入已应用到镜头，原版本保留。");
  }
}
async function allowLeaveCanvas() {
  if (!canvasActive.value || !creativeEditor.value) return true;
  try { await creativeEditor.value.whenReady(); await creativeEditor.value.flushSave(); return true; }
  catch (cause) { ElMessage.error(`画布尚未保存：${directorError(cause)}`); return false; }
}
function allowLeaveProduction() { if (viewMode.value === "production" && productionEditor.value?.hasUnsavedChanges()) { ElMessage.warning("有未保存的剧本、角色或镜头修改，请先保存或撤销后再切换。"); return false; } return true; }
async function setView(mode: "production" | "preview" | "canvas") { if (busy.value) { ElMessage.info("请等待当前操作完成后切换视图。"); return; } if (mode === viewMode.value) return; if (allowLeaveProduction() && await allowLeaveCanvas()) { viewMode.value = mode; inspectorVisible.value = mode !== "canvas"; } }
async function leaveProject() { if (busy.value) { ElMessage.info("请等待当前操作完成后返回项目。"); return; } if (allowLeaveProduction() && await allowLeaveCanvas()) emit("exit"); }
function focusProductionShot(id: string) { if (!allowLeaveProduction()) return; selectShot(id); viewMode.value = "preview"; rightTab.value = "shot"; }
function openShotPreview(id: string) { selectedShotId.value = id; openPreview(true, id); }
function suggestRevision(text: string) { instruction.value = selectedShot.value ? `只修改镜头 ${selectedShot.value.order}：${text}，其余镜头保持。` : text; }
function timelineStart(index: number) { return project.value?.shots.slice(0, index).reduce((sum, shot) => sum + currentVersion(shot).duration, 0) || 0; }
function subtitleBlockStyle(shot: DirectorShot) { const version = currentVersion(shot); const start = version.subtitleStart ?? 0; const end = version.subtitleEnd ?? version.duration; return { marginLeft: `${start / version.duration * 100}%`, width: `${(end - start) / version.duration * 100}%` }; }
async function moveShot(id: string, offset: number) {
  if (!project.value) return;
  const ids = project.value.shots.map(shot => shot.id);
  const index = ids.indexOf(id); const next = index + offset;
  if (index < 0 || next < 0 || next >= ids.length) return;
  ids.splice(index, 1); ids.splice(next, 0, id);
  await perform("reorder", { shotIds: ids });
}
async function dropShot(id: string) {
  const moved = draggedShotId.value; draggedShotId.value = "";
  if (!project.value || !moved || moved === id || busy.value) return;
  const ids = project.value.shots.map(shot => shot.id); const targetIndex = ids.indexOf(id); const sourceIndex = ids.indexOf(moved);
  if (targetIndex < 0 || sourceIndex < 0) return;
  ids.splice(sourceIndex, 1); ids.splice(targetIndex, 0, moved);
  await perform("reorder", { shotIds: ids });
}
function chooseSelectedImport(kind: "image" | "video") { selectedImportKind.value = kind; if (selectedImportInput.value) { selectedImportInput.value.accept = `${kind}/*`; selectedImportInput.value.click(); } }
async function importSelectedFile(event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ""; if (file && selectedShot.value) await attachFile(selectedShot.value, selectedImportKind.value, file); }
async function uploadMusic(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = "";
  const target = directory.value; const revision = project.value?.revision;
  if (!file || revision === undefined || busy.value) return;
  busy.value = true; error.value = "";
  try {
    if (!file.type.startsWith("audio/")) throw new Error("请选择音频文件");
    const asset = await uploadDirectorFile(target, file);
    const result = await directorRequest<DirectorProject>("/action", target, { action: "music", music: { ...asset, volume: musicVolume.value / 100 }, expectedRevision: revision }, lifetime.signal);
    acceptProject(result, target); rightTab.value = "music"; inspectorVisible.value = true;
  } catch (cause) { if (!disposed && target === directory.value) error.value = directorError(cause); }
  finally { if (!disposed && target === directory.value) busy.value = false; }
}
async function saveMusicVolume() {
  const music = project.value?.music;
  if (!music) return;
  const result = await perform("music", { music: { path: music.asset.path, mimeType: music.asset.mimeType, volume: musicVolume.value / 100 } });
  if (!result) musicVolume.value = Math.round((project.value?.music?.volume ?? .25) * 100);
}
async function exportMode(mode: string) {
  if (mode === "download" && latestExport.value) { await downloadExport(latestExport.value.asset); return; }
  if (mode !== "video" && mode !== "storyboard") return;
  await load(true);
  if (unverifiedTasks.value.length || mode === "video" && readiness.value.delivery.length) { exportVisible.value = true; return; }
  const result = await perform("export", { mode });
  if (!result) return;
  exportVisible.value = false;
  tasksVisible.value = true;
  requestedExportTaskId.value = result.tasks.findLast(task => task.stage === "export")?.id || "";
  ElMessage.info("导出任务已提交，可在工作台顶部查看并保存结果");
}
watch(() => project.value?.tasks.find(task => task.id === requestedExportTaskId.value)?.status, status => {
  if (status === "succeeded") { ElMessage.success("导出完成，可在任务面板预览或保存视频"); requestedExportTaskId.value = ""; }
  else if (status === "failed" || status === "interrupted") { ElMessage.error("导出未完成，请查看任务记录后重试"); requestedExportTaskId.value = ""; }
});
watch(() => editFields.duration, duration => { if ((editFields.subtitleEnd ?? duration) > duration) editFields.subtitleEnd = duration; if ((editFields.subtitleStart ?? 0) >= duration) editFields.subtitleStart = 0; });
watch(() => project.value?.music?.volume, volume => { musicVolume.value = Math.round((volume ?? .25) * 100); });
watch(directory, () => { canvasNodeLabels.value = {}; placementInput.value = undefined; project.value = null; error.value = ""; busy.value = false; imageSelection.value = ""; videoSelection.value = ""; instruction.value = ""; selectedShotId.value = ""; inlineShotId.value = ""; viewMode.value = "preview"; editVisible.value = false; versionsVisible.value = false; previewVisible.value = false; modelsVisible.value = false; requestedExportTaskId.value = ""; void load(true); }, { immediate: true });
watch(videoResolutions, values => { if (!values.includes(resolution.value)) resolution.value = values[0] || ""; });
watch(() => props.settingsVisible, (visible, previous) => { if (previous && !visible) void load(true); });
watch(agentVisible, visible => { if (!visible) { inspectorVisible.value = false; agentVisible.value = true; } });
onBeforeRouteLeave(async () => {
  if (busy.value) { ElMessage.info("请等待当前保存完成后离开项目。"); return false; }
  return allowLeaveProduction() && await allowLeaveCanvas();
});
const timer = setInterval(() => { if (!disposed && !busy.value && document.visibilityState === "visible") void load(); }, 2500);
onScopeDispose(() => { disposed = true; lifetime.abort(); clearInterval(timer); });
</script>

<style scoped lang="scss">
.placementFields { display: grid; gap: 14px; margin: 18px 0; label { display: grid; gap: 7px; } select { padding: 9px; border: 1px solid #454952; border-radius: 6px; background: #202227; color: #e1e3e9; } }
.placementCompare { display: flex; gap: 16px; > section { flex: 1; min-width: 0; h4 { font-size: 12px; font-weight: 500; margin-bottom: 8px; } :deep(video), :deep(img) { max-height: 260px; } } }

.directorPanel {
  --el-color-primary: #087c52; --el-color-primary-light-3: #429d72; --el-color-primary-light-5: #7eb99a; --el-color-primary-light-7: #bddac8; --el-color-primary-light-8: #d7e9de; --el-color-primary-light-9: #eef6f0; --el-color-primary-dark-2: #05623f;
  --el-bg-color: #f5f8f5; --el-bg-color-overlay: #fff; --el-fill-color-blank: #fff; --el-fill-color-light: #f1f5f2; --el-fill-color: #eaf0ec; --el-text-color-primary: #253b2d; --el-text-color-regular: #526c5b; --el-text-color-secondary: #81968a; --el-text-color-placeholder: #a0b0a5; --el-border-color: #dce6df; --el-border-color-light: #e4ece6; --el-border-color-lighter: #eaf0eb; --el-border-color-extra-light: #f0f4f1; --el-disabled-bg-color: #f1f5f2; --el-disabled-text-color: #a7b5ab;
  position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; padding: 0 16px 16px; background: #f1f4f2; color: #26392d; overflow: hidden; font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; &:focus-visible { outline: 2px solid #72b38d; outline-offset: 3px; } &:disabled { cursor: default; } }
  .fileInput { display: none; }
  .studioHeader { display: flex; align-items: center; flex-shrink: 0; height: 80px; gap: 26px; padding: 0 8px;
    .studioBrand { display: flex; align-items: center; gap: 10px; padding: 0; border: 0; color: #24563b; background: none; cursor: pointer; flex-shrink: 0; .brandMark { display: grid; place-items: center; width: 35px; height: 35px; background: transparent; flex-shrink: 0; img { display: block; width: 100%; height: 100%; object-fit: contain; } } > span:last-child { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; font-size: 18px; font-weight: 650; letter-spacing: -.5px; } small { color: #94a79b; font-size: 11px; font-weight: 400; letter-spacing: .7px; } }
    .projectIdentity { min-width: 0; flex: 1; padding-left: 25px; border-left: 1px solid #dce6df; > span { color: #9caf9f; font-size: 8px; letter-spacing: 1.3px; } h1 { margin: 5px 0 0; font-size: 14px; font-weight: 550; line-height: 1.4; color: #3c5445; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .headerActions { display: flex; align-items: center; gap: 11px; flex-shrink: 0; .saveState { display: flex; gap: 5px; align-items: center; color: #94a49a; font-size: 11px; margin-right: 7px; i { width: 4px; height: 4px; border-radius: 50%; background: #6fa181; } } .headerIcon, .headerText { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px; background: none; border: 0; color: #789181; cursor: pointer; font-size: 11px; } .headerIcon { width: 33px; height: 33px; border-radius: 50%; background: #fff; border: 1px solid #e5ece7; } .el-button { margin: 0; height: 34px; border-radius: 20px; font-size: 11px; } .previewButton { color: #567360; border-color: #dfe8e2; background: #fff; } :deep(.el-button > span) { gap: 5px; } }
  }
  .exportStatus { display: flex; align-items: center; flex-shrink: 0; gap: 9px; margin-bottom: 10px; padding: 8px 15px; border: 1px solid #dbe9df; border-radius: 11px; background: #fff; color: #5b7c65; font-size: 12px; > span { flex: 1; min-width: 0; overflow-wrap: anywhere; } > svg { flex-shrink: 0; } .el-button { height: 28px; margin: 0; font-size: 11px; } }
  .errorBanner { display: flex; align-items: flex-start; flex-shrink: 0; gap: 9px; margin-bottom: 10px; padding: 10px 15px; color: #9f694e; background: #fff9f4; border: 1px solid #eadacf; border-radius: 11px; font-size: 12px; line-height: 1.7; > span { flex: 1; overflow-wrap: anywhere; } button { color: inherit; border: 0; background: none; padding: 0; cursor: pointer; } }
  .loadingState { flex: 1; display: flex; align-items: center; justify-content: center; gap: 12px; color: #879e8d; font-size: 13px; }
  .creationArea { display: grid; grid-template-columns: .85fr 1.15fr; align-items: center; gap: 65px; width: min(1120px, calc(100% - 80px)); margin: auto; padding: 30px 0; overflow: auto; min-height: 0;
    .creationIntro { .introStep { color: #7b9b85; font-size: 11px; letter-spacing: 1.6px; } h2 { margin: 25px 0 20px; font-size: 37px; line-height: 1.55; font-weight: 500; letter-spacing: -1px; color: #2c4e39; } > p { color: #91a296; font-size: 12px; line-height: 2; } .creationSteps { display: flex; flex-wrap: wrap; gap: 17px; margin-top: 28px; span { font-size: 11px; color: #728e7c; b { font: 10px ui-monospace, monospace; margin-right: 5px; color: #379263; } } } .scopeNote { display: flex; gap: 7px; align-items: center; margin-top: 50px; font-size: 11px; color: #8ba291; } }
    .creationForm { padding: 26px; background: #fff; border: 1px solid #dfe9e2; border-radius: 20px; box-shadow: 0 10px 30px #244a2d04; .formEyebrow { display: flex; justify-content: space-between; color: #95aa9c; font-size: 11px; letter-spacing: 1.5px; } h3 { margin: 13px 0 22px; font-size: 19px; font-weight: 550; color: #34543e; } :deep(.el-form-item) { margin-bottom: 17px; } :deep(.el-form-item__label) { color: #718e7b; font-size: 11px; } .creationRow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .creationSpecs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; .el-input-number, .el-select { width: 100%; } } .createButton { width: 100%; height: 39px; border-radius: 20px; font-size: 12px; } .configurationTip { display: flex; align-items: center; color: #8a9f90; font-size: 11px; margin-bottom: 10px; } .creationNote { font-size: 11px; color: #a1b1a7; text-align: center; margin: 10px 0 0; } }
  }
  .studioShell { display: grid; grid-template-columns: 180px minmax(0, 1fr) 312px; gap: 12px; flex: 1; min-height: 0; &.inspectorHidden { grid-template-columns: 180px minmax(0, 1fr); }
    .assetRail { display: flex; flex-direction: column; min-height: 0; overflow: auto; border: 1px solid #e0e8e2; border-radius: 17px; background: #fff;
      .railTitle { display: flex; align-items: center; gap: 7px; height: 49px; padding: 0 14px; border-bottom: 1px solid #e9efea; color: #6e8c78; flex-shrink: 0; h2 { margin: 0; font-weight: 550; font-size: 11px; } > span { margin-left: auto; font: 9px ui-monospace, monospace; color: #a4b4a9; } }
      .railLabel { display: flex; justify-content: space-between; align-items: center; color: #90a597; font-size: 11px; margin-bottom: 11px; > span { font: 8px ui-monospace, monospace; color: #b1bfb5; letter-spacing: .7px; } }
      .referenceSection { padding: 17px 13px 0; .referenceFrame { height: 125px; border: 1px solid #e2eae4; border-radius: 10px; position: relative; overflow: hidden; .referenceTag { position: absolute; bottom: 6px; left: 6px; display: flex; gap: 4px; align-items: center; border-radius: 4px; padding: 4px 5px; color: #e6f1e9; background: #1f3a2ccc; font-size: 11px; } } > p { color: #a0b0a6; font-size: 11px; line-height: 1.8; margin: 9px 0 0; } }
      .assetList { padding: 20px 8px 0; .railLabel { padding-inline: 5px; } > button { display: flex; align-items: center; gap: 7px; width: 100%; padding: 8px 5px; margin: 3px 0; border: 1px solid transparent; border-radius: 9px; text-align: left; background: none; color: #9bb0a1; cursor: pointer; &.active { color: #40885c; border-color: #d4e6da; background: #edf5ef; } .assetThumb { width: 34px; height: 36px; overflow: hidden; border-radius: 5px; flex-shrink: 0; :deep(.emptyMedia) { padding: 2px; span { display: none; } svg { width: 14px; } } } > div:nth-child(2) { min-width: 0; flex: 1; strong { display: block; font-size: 11px; font-weight: 500; color: #5f7b69; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } > span { display: block; font-size: 11px; color: #a0b2a5; margin-top: 5px; } } > svg { flex-shrink: 0; } } }
      .railEmpty { padding: 0 14px; margin: 6px 0 0; color: #8ca594; font-size: 11px; line-height: 1.9; }
      .creativeBrief { border-top: 1px solid #e8eee9; padding-top: 17px; margin: 20px 13px 0; > strong { color: #7a9383; font-size: 11px; font-weight: 500; } > p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden; font-size: 11px; line-height: 1.9; color: #a0b1a6; margin: 8px 0 10px; } .briefSpecs { display: flex; gap: 5px; flex-wrap: wrap; > span { border: 1px solid #e0e9e3; border-radius: 5px; padding: 3px 5px; color: #98ad9f; font-size: 11px; } } }
      .railBottom { display: flex; align-items: center; flex-shrink: 0; gap: 5px; padding: 22px 13px 15px; margin-top: auto; color: #a0b0a6; font-size: 11px; .localDot { width: 4px; height: 4px; border-radius: 50%; background: #95ad9e; } button { display: flex; padding: 0; margin-left: auto; color: #8ba493; background: none; border: 0; cursor: pointer; } }
    }
    .creativeArea { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid #dfe8e2; border-radius: 18px; overflow: hidden; background: #fff;
      .boardToolbar { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 50px; padding: 0 14px; border-bottom: 1px solid #e4ece6; background: #fff;
        .workspaceTabs { display: flex; gap: 3px; align-items: center; > button { display: flex; align-items: center; gap: 5px; padding: 7px 10px; border: 0; border-radius: 17px; color: #8fa397; background: none; cursor: pointer; font-size: 11px; white-space: nowrap; &.active { color: #177b4b; background: #eaf4ed; font-weight: 550; } &:disabled { opacity: .45; cursor: default; } } }
        .boardActions { display: flex; gap: 10px; align-items: center; .readyCount { color: #a3b3a8; font-size: 11px; white-space: nowrap; } .el-button { border-radius: 17px; font-size: 11px; height: 27px; background: #f2f7f3; } .toggleInspector { display: flex; padding: 0 0 0 9px; border: 0; border-left: 1px solid #e3eae5; background: none; color: #93a99a; cursor: pointer; } }
      }
      .workspaceStage { flex: 1; min-height: 0; overflow: hidden; position: relative; &.productionStage { display: flex; } &.previewWorkspace { display: flex; background: #e9eeeb; padding: 15px; align-items: stretch; justify-content: center; > :deep(.studioPreview) { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; border: 0; border-radius: 13px; background: #1c2520; padding: 14px; .previewHeading { flex-shrink: 0; } .previewStage { flex: 1; min-height: 0; align-items: center; canvas { max-height: 100%; max-width: 100%; width: auto; height: auto; } } .previewTransport, .previewFootnote, .previewNotices { flex-shrink: 0; } .previewNotices { max-height: 65px; overflow: auto; } .previewSeek { flex-shrink: 0; } } } .previewInDialog { display: flex; align-items: center; justify-content: center; flex-direction: column; color: #8a9e90; font-size: 12px; width: 100%; p { margin-top: 10px; } } }
      .timelinePanel { flex-shrink: 0; height: 207px; border-top: 1px solid #e0e9e2; background: #fafcf9;
        .timelineToolbar { display: flex; justify-content: space-between; align-items: center; padding: 0 17px; height: 40px; border-bottom: 1px solid #e8eee9; > div { display: flex; align-items: center; gap: 8px; color: #7e9886; strong { color: #617e6b; font-size: 11px; font-weight: 550; } > span { font: 9px ui-monospace, monospace; color: #a4b4a9; } .timelineHint { font-family: inherit; font-size: 11px; } .timelinePlay { display: flex; align-items: center; gap: 4px; border: 0; padding: 4px 0 4px 8px; background: none; color: #438e60; cursor: pointer; font-size: 11px; } } }
        .timelineContent { display: flex; padding: 0 15px 0 12px; height: 163px; .trackLabels { width: 55px; flex-shrink: 0; padding-right: 9px; display: flex; flex-direction: column; > span { display: flex; align-items: center; gap: 4px; color: #9aada1; font-size: 11px; flex-shrink: 0; &:nth-child(1) { height: 28px; font-size: 11px; } &:nth-child(2) { height: 51px; } &:nth-child(3) { height: 33px; } &:nth-child(4) { height: 28px; } } }
          .trackScroll { overflow: auto hidden; min-width: 0; flex: 1; .trackInner { min-width: 450px; } }
          .timeRuler { display: flex; align-items: center; position: relative; height: 28px; > span { display: flex; align-items: flex-start; gap: 9px; font: 9px ui-monospace, monospace; color: #a3b4a8; height: 100%; padding-top: 9px; border-left: 1px solid #d9e4dc; > i { height: 4px; flex: 1; border-right: 1px solid #d5e2d9; } } > b { position: absolute; right: 0; top: 9px; font: 9px ui-monospace, monospace; color: #a3b4a8; background: #fafcf9; } }
          .videoTrack { display: flex; gap: 5px; height: 51px; > button { display: flex; align-items: center; min-width: 0; padding: 3px; background: #e2eee5; border: 1px solid #d2e3d7; border-radius: 6px; color: #6c8e77; overflow: hidden; cursor: grab; text-align: left; &.selected { border-color: #5d9c74; background: #dceee0; box-shadow: inset 0 0 0 1px #5d9c7422; } &.affected { border-color: #71a381; } .trackThumbnail { width: 32px; height: 41px; border-radius: 4px; overflow: hidden; flex-shrink: 0; :deep(.emptyMedia) { display: none; } } > span { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; margin: 0 6px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; b { color: #91aa99; font: 9px ui-monospace, monospace; } } > small { display: flex; flex-direction: column; align-items: flex-end; gap: 7px; color: #8ba594; font-size: 11px; margin-right: 2px; } } }
          .subtitleTrack { display: flex; gap: 5px; align-items: center; height: 33px; > div { min-width: 0; height: 22px; > button { display: block; height: 22px; padding: 4px 5px; font-size: 11px; color: #879376; border: 1px solid #dfe5cc; background: #edf1e3; border-radius: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; } } }
          .musicTrack { height: 28px; > button { width: 100%; height: 24px; display: flex; align-items: center; gap: 6px; text-align: left; color: #809d8b; border: 1px solid #d8e4dc; background: #edf4ef; border-radius: 5px; font-size: 11px; padding: 4px 8px; cursor: pointer; > span { margin-left: auto; color: #a2b5a8; } &.addMusic { border-style: dashed; color: #a9b9af; background: transparent; } } }
        }
      }
    }
    .inspector { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid #dfe8e2; border-radius: 17px; background: #fff; overflow: hidden;
      .inspectorTabs { display: flex; gap: 19px; height: 49px; flex-shrink: 0; padding: 0 15px; border-bottom: 1px solid #e6ede8; > button { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 0; background: none; border: 0; border-bottom: 2px solid transparent; color: #95aa9c; font-size: 11px; cursor: pointer; &.active { color: #258455; border-color: #34895a; } &:last-child { margin-left: auto; } } }
      .inspectorContent { flex: 1; min-height: 0; overflow: auto; padding: 20px 16px;
        .agentIntro { display: flex; align-items: center; gap: 9px; margin-bottom: 20px; .agentSymbol { width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; background: #eaf4ed; color: #418b5e; border-radius: 11px; } strong { font-size: 13px; color: #4b6c57; font-weight: 500; } p { font-size: 11px; line-height: 1.7; color: #a0b2a5; margin: 5px 0 0; } }
        .contextChip { display: flex; align-items: center; gap: 5px; padding: 8px 10px; border-radius: 10px 10px 0 0; background: #edf5ef; color: #9cb3a3; font-size: 11px; strong { font-weight: 500; color: #698b74; flex-shrink: 0; } > span:nth-child(3) { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } button { display: flex; padding: 0; margin-left: auto; background: none; border: 0; color: #8da997; cursor: pointer; } }
        .instructionBox { overflow: hidden; border: 1px solid #d8e5dc; border-radius: 11px; background: #fafcf9; textarea { display: block; width: 100%; min-height: 108px; resize: vertical; padding: 12px; border: 0; outline: none; background: none; color: #4b6a56; font-family: inherit; font-size: 12px; line-height: 1.85; &::placeholder { color: #adbbb1; } } > div { display: flex; align-items: center; justify-content: space-between; padding: 2px 10px 9px; > span { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #a3b6aa; } > button { display: flex; align-items: center; justify-content: center; width: 29px; height: 29px; border: 0; border-radius: 9px; background: #087c52; color: #fff; cursor: pointer; &:disabled { color: #a9bdb0; background: #e6eee8; } } } }
        .promptSuggestions { display: flex; gap: 5px; margin: 10px 0 14px; > button { padding: 5px 7px; border: 1px solid #e1eae4; border-radius: 6px; color: #9bb1a2; background: #fff; font-size: 11px; cursor: pointer; } }
        .protectedNote { display: flex; align-items: center; gap: 5px; color: #a0b4a6; font-size: 11px; line-height: 1.7; margin-bottom: 21px; }
        .planCard { padding: 15px; border: 1px solid #c9dece; border-radius: 15px; background: #f0f7f1; color: #52775b;
          .planHeading { display: flex; align-items: center; justify-content: space-between; gap: 5px; > span { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #52775b; } b { font-size: 11px; color: #7b9e85; background: #deebe1; border-radius: 5px; padding: 3px 5px; font-weight: 400; white-space: nowrap; } .discardPlan { font-size: 11px; height: 24px; margin: 0 0 0 4px; padding: 0; color: #89a991; } }
          .planInstruction { margin: 11px 0; color: #89a892; font-size: 11px; line-height: 1.8; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
          .planChange { cursor: pointer; border-top: 1px solid #dceadd; padding-top: 12px; margin-top: 12px; .changeTitle { display: flex; align-items: center; gap: 7px; > span { font: 9px ui-monospace, monospace; padding: 3px 4px; background: #dfede2; color: #5a8b66; border-radius: 3px; } strong { flex: 1; min-width: 0; font-size: 11px; font-weight: 500; color: #64856b; } > svg { color: #9bb7a2; } } dl { display: grid; grid-template-columns: 25px 1fr; gap: 6px 8px; font-size: 11px; line-height: 1.8; margin: 11px 0; dt { color: #9ab29f; } dd { margin: 0; color: #6d8c75; overflow-wrap: anywhere; } } .effectLine { display: flex; flex-wrap: wrap; gap: 5px; > span { display: flex; align-items: center; gap: 3px; padding: 4px 5px; border-radius: 4px; font-size: 11px; } .regenerateTag { color: #aa8a59; background: #f0eadb; } .reuseTag { color: #769e7c; background: #dfeddf; } } }
          .preserveNote { display: flex; align-items: flex-start; gap: 5px; color: #91ae98; font-size: 11px; line-height: 1.7; margin: 14px 0; svg { flex-shrink: 0; margin-top: 2px; } } > .el-button { display: flex; width: 100%; height: 34px; margin-top: 12px; border-radius: 18px; font-size: 11px; :deep(span) { gap: 7px; } } .planHint, .staleNote { color: #9aac97; font-size: 11px; line-height: 1.8; margin: 9px 0 0; } .staleNote { color: #b28a5d; }
        }
        .planEmpty { display: flex; gap: 10px; padding: 14px 2px 24px; color: #b2c1b6; p { margin: 0; font-size: 11px; line-height: 1.9; } }
        .sidebarSections { margin-top: 20px; --el-collapse-header-bg-color: transparent; --el-collapse-content-bg-color: transparent; --el-collapse-border-color: #e8eee9; :deep(.el-collapse-item__header) { height: 41px; } :deep(.el-collapse-item__content) { padding-bottom: 15px; } .collapseLabel { display: flex; align-items: center; gap: 6px; color: #91a999; font-size: 11px; > span { color: #afc0b4; margin-left: 5px; font-size: 11px; } } .emptyTasks { color: #afbeb3; font-size: 11px; } .taskRow { padding: 10px 0; border-bottom: 1px solid #edf2ee; > div { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #a4b6aa; strong { font-weight: 400; flex: 1; color: #7f9b88; } } .taskDot { width: 4px; height: 4px; border-radius: 50%; background: #b8c7bd; &.succeeded { background: #8ab495; } &.running, &.queued { background: #3b9860; } &.failed, &.interrupted { background: #b28d64; } } p { font-size: 11px; line-height: 1.7; color: #a28263; margin: 6px 0 0 9px; overflow-wrap: anywhere; } .el-button { height: 25px; padding: 0 0 0 9px; margin: 0; font-size: 11px; } } }
        .detailHeading { display: flex; align-items: center; justify-content: space-between; > span { color: #95ad9d; font: 9px ui-monospace, monospace; letter-spacing: 1.2px; } > button { display: flex; align-items: center; gap: 4px; border: 0; border-radius: 5px; background: #edf4ef; color: #83a28e; padding: 5px 7px; font-size: 11px; cursor: pointer; } }
        .detailTitle { color: #587663; font-size: 17px; line-height: 1.6; font-weight: 500; margin: 19px 0 10px; } .detailDescription { font-size: 12px; line-height: 1.9; color: #94aa9b; } .detailMeta { padding: 17px 0; border-top: 1px solid #e7eee9; margin-top: 18px; span { color: #a3b6a9; font-size: 11px; } p { color: #8aa392; font-size: 11px; line-height: 1.8; margin: 8px 0 0; } }
        .detailCast { display: flex; flex-wrap: wrap; gap: 5px; margin: 11px 0; > span { padding: 4px 7px; border-radius: 5px; background: #edf5ef; color: #79a087; font-size: 11px; } }
        .continuityStates { margin: 15px 0; border: 1px solid #e5ede7; border-radius: 9px; overflow: hidden; > div { padding: 11px 12px; & + div { border-top: 1px solid #e5ede7; } > span { font-size: 11px; color: #96ad9e; } p { font-size: 11px; line-height: 1.8; margin: 6px 0 0; color: #7f9a88; } } }
        .detailDialogues { margin: 15px 0; > span { font-size: 11px; color: #96ad9e; } p { font-size: 11px; line-height: 1.8; color: #829c8a; b { display: block; font-size: 10px; font-weight: 500; color: #5e8e6d; margin-bottom: 3px; } } }
        .timingOverview { display: flex; gap: 32px; padding: 15px; border: 1px solid #e0e9e3; border-radius: 9px; background: #f7faf7; div { span { display: block; color: #a0b3a7; font-size: 11px; margin-bottom: 8px; } strong { color: #789882; font: 23px ui-monospace, monospace; small { font-size: 11px; margin-left: 4px; color: #adbbb2; } } } } .detailSubtitle { padding: 20px 0; > span { color: #a2b6a8; font-size: 11px; } p { font-size: 12px; line-height: 1.8; color: #8da495; margin: 9px 0; } small { color: #acbdb2; font: 10px ui-monospace, monospace; } } .fullButton { width: 100%; font-size: 11px; border-radius: 17px; } .detailActions { display: flex; gap: 7px; margin: 10px 0 20px; .el-button { flex: 1; margin: 0; padding-inline: 9px; font-size: 11px; } } .reorderActions { display: flex; align-items: center; gap: 7px; padding: 17px 0; border-top: 1px solid #e6eee8; > span { flex: 1; color: #9bb1a3; font-size: 11px; } button { display: flex; align-items: center; border: 0; padding: 3px; background: none; color: #89a594; font-size: 11px; cursor: pointer; &:disabled { opacity: .35; } } } .detailAssets { border-top: 1px solid #e6eee8; padding-top: 17px; > span { display: block; font-size: 11px; color: #9bb2a3; margin-bottom: 12px; } .el-button { font-size: 11px; padding-inline: 9px; margin: 0 7px 6px 0; } } .detailEmpty { color: #b1c1b6; text-align: center; padding: 55px 0; p { font-size: 11px; line-height: 1.9; } }
      }
      .musicInspector { .musicHeading { color: #88a493; padding: 10px 0 20px; h3 { font-size: 17px; font-weight: 450; margin: 17px 0 10px; } p { font-size: 11px; line-height: 1.9; color: #a3b7aa; } } .musicFile { display: flex; align-items: center; gap: 9px; padding: 15px; margin-bottom: 24px; border: 1px solid #dce8e0; background: #f2f7f3; border-radius: 8px; color: #8fa897; strong { font-size: 11px; font-weight: 450; } } label { display: flex; justify-content: space-between; color: #a1b6a8; font-size: 11px; } .musicNote { color: #a5b8ac; font-size: 11px; line-height: 1.9; margin: 20px 0; } .el-button { font-size: 11px; } .musicUpload { width: 100%; height: 65px; border-style: dashed; color: #9bb3a4; background: #f6faf6; } }
      .inspectorFooter { display: flex; align-items: center; flex-shrink: 0; gap: 6px; height: 36px; padding: 0 15px; border-top: 1px solid #e7eee9; background: #fafcf9; color: #acbeb1; font-size: 11px; > i { width: 4px; height: 4px; border-radius: 50%; background: #bac9be; &.configured { background: #81ac8e; } } button { display: flex; align-items: center; gap: 3px; margin-left: auto; padding: 0; border: 0; background: none; color: #91ad9b; cursor: pointer; font-size: 11px; } }
    }
  }
}
.dialogNote { font-size: 13px; line-height: 1.8; color: #7b9383; }
.versionCompare { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; section { min-width: 0; } .versionSelect { width: 100%; margin-bottom: 14px; } .versionDescription { font-size: 12px; line-height: 1.8; } .versionMeta { color: #8aa292; font-size: 11px; line-height: 1.7; } }
.editTiming { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.editTip { font-size: 11px; line-height: 1.8; color: #95ab9b; margin: 0; }
.exportResult { display: flex; gap: 12px; align-items: center; margin-top: 16px; color: #8ca495; font-size: 11px; > span:first-child { flex: 1; } .el-button { font-size: 11px; } }
.planControls { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; .el-button { margin: 0; color: inherit; } }
:global(.studioDialog) { font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif; --el-color-primary: #087c52; --el-color-primary-light-9: #edf6ef; --el-bg-color: #fff; --el-dialog-bg-color: #fff; --el-fill-color-blank: #fff; --el-text-color-primary: #34523f; --el-text-color-regular: #789782; --el-border-color: #dbe7df; --el-text-color-placeholder: #abc0b1; border: 1px solid #e2ebe5; border-radius: 18px; }
.spinner { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
@media (min-width: 1700px) { .directorPanel .studioShell { grid-template-columns: 200px minmax(0, 1fr) 340px; &.inspectorHidden { grid-template-columns: 200px minmax(0, 1fr); } } }
@media (max-width: 1250px) { .directorPanel { padding: 0 12px 12px; .studioHeader { gap: 18px; .projectIdentity { padding-left: 18px; } .headerActions { gap: 8px; .saveState { display: none; } } } .studioShell { grid-template-columns: 158px minmax(0, 1fr) 285px; gap: 9px; &.inspectorHidden { grid-template-columns: 158px minmax(0, 1fr); } .assetRail { .referenceSection { padding-inline: 11px; .referenceFrame { height: 108px; } } .creativeBrief { margin-inline: 11px; } } .creativeArea .boardToolbar { padding-inline: 10px; .workspaceTabs > button { gap: 4px; padding-inline: 7px; font-size: 11px; } .boardActions { gap: 6px; .readyCount { display: none; } } } .inspector .inspectorTabs { gap: 14px; } } .creationArea { gap: 35px; width: calc(100% - 45px); .creationIntro h2 { font-size: 31px; } } } }
@media (max-width: 1000px) { .directorPanel { .studioHeader { height: 72px; gap: 15px; .projectIdentity { padding-left: 15px; > span { display: none; } } .headerActions .headerText { display: none; } } .studioShell { grid-template-columns: minmax(0, 1fr) 278px; &.inspectorHidden { grid-template-columns: minmax(0, 1fr); } .assetRail { display: none; } .creativeArea .boardToolbar .workspaceTabs > button { font-size: 11px; padding-inline: 9px; } } .creationArea { grid-template-columns: 1fr 1.3fr; gap: 25px; .creationIntro { h2 { font-size: 28px; } > p { font-size: 11px; } .creationSteps { gap: 10px; } .scopeNote { font-size: 11px; } } .creationForm { padding: 23px; } } } }
@media (max-width: 750px) { .directorPanel { padding: 0 9px 9px; .studioHeader { gap: 10px; padding-inline: 5px; height: 66px; .studioBrand { gap: 7px; .brandMark { width: 30px; height: 30px; border-radius: 9px; } > span:last-child { font-size: 15px; } small { font-size: 7px; } } .projectIdentity { border: 0; padding-left: 0; h1 { font-size: 11px; } } .headerActions { gap: 6px; .headerIcon, .previewButton { display: none; } .el-button { font-size: 11px; padding-inline: 10px; } } } .studioShell { display: flex; flex-direction: column; overflow: auto; .creativeArea { flex: none; height: 650px; } .inspector { flex: none; height: 530px; } .creativeArea .boardToolbar { height: 46px; .workspaceTabs > button { font-size: 11px; padding-inline: 7px; > svg { display: none; } } .boardActions .el-button { padding-inline: 7px; font-size: 11px; } } .creativeArea .timelinePanel { height: 200px; .timelineToolbar { padding-inline: 10px; .timelineHint { display: none; } } .timelineContent { padding-inline: 9px; .trackLabels { width: 43px; } } } } .creationArea { display: block; width: calc(100% - 22px); padding: 15px 0; .creationIntro { padding: 10px 10px 18px; h2 { font-size: 26px; line-height: 1.5; margin: 12px 0 8px; br { display: none; } } > p { display: none; } .creationSteps, .scopeNote { display: none; } } .creationForm { padding: 22px; .creationSpecs { gap: 8px; } } } } .versionCompare, .editTiming { grid-template-columns: 1fr; } .exportResult { flex-wrap: wrap; } }
</style>

<style lang="scss" src="./webTheme.scss"></style>
