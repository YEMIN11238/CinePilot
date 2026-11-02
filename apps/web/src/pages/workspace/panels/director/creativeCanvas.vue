<template>
  <section ref="canvasRoot" class="creativeCanvas" :class="{ spacePanning }" tabindex="0" aria-label="自由创作节点画布" @keydown="onKeydown" @keyup="onKeyup" @blur="spacePanning = false" @pointerdown="focusCanvas">
    <vue-flow :id="flowId" v-model:nodes="nodes" v-model:edges="edges" :minZoom="0.25" :maxZoom="1.8" :nodesDraggable="ready && !busy && !spacePanning" :nodesConnectable="ready && !busy" :deleteKeyCode="null" :panOnDrag="spacePanning ? [0, 1, 2] : [1, 2]" :panOnScroll="true" :zoomOnScroll="false" :zoomActivationKeyCode="zoomKey" :selectionKeyCode="!spacePanning" :multiSelectionKeyCode="'Shift'" :zoomOnDoubleClick="false" :fitViewOnInit="false" :isValidConnection="validConnection" @connect="connect" @nodeClick="onNodeClick" @paneClick="clearSelection" @paneContextMenu="openContextMenu" @nodeDragStart="remember" @nodeDragStop="savePositions" @nodesInitialized="initializeView">
      <background :gap="22" :size="1.1" patternColor="#ffffff38" />
      <template #node-creative="{ id, data, selected }">
        <article class="creativeNode" :class="[{ selected }, data.kind]" :aria-label="`${kindLabel(data.kind)}节点 ${data.title}`">
          <handle v-if="data.kind !== 'text'" id="input" type="target" :position="Position.Left" />
          <header class="nodeHeading"><span class="kindIcon"><component :is="data.generation ? IconSparkles : kindIcon(data.kind)" :size="14" /></span><strong>{{ data.title }}</strong><span class="nodeKind">{{ data.generation ? '生成' : '素材' }}</span></header>
          <p v-if="data.asset" class="usageBadge">{{ usedLabel(id) }}<span v-if="usedShots(id).some(shot => needsReplacement(graph.nodes.find(node => node.id === id)!, shot))"> · 成片有旧版</span></p>
          <div v-if="data.kind === 'text'" class="textContent"><p>{{ data.text || '选择节点，在下方写下创意或镜头描述' }}</p></div>
          <div v-else class="nodeMedia nodrag nopan"><mediaPreview v-if="data.kind === 'video' && data.asset" :directory="directory" :path="data.asset.path" :mimeType="data.asset.mimeType" :label="data.title" /><studioThumbnail v-else :directory="directory" :path="data.asset?.path" :mimeType="data.asset?.mimeType" :label="data.generation ? '填写提示词，确认后生成' : data.kind === 'image' ? '导入图片作为视觉参考' : '导入视频素材'" /><span v-if="!data.asset" class="mediaEmptyIcon"><component :is="taskPending(id) ? IconLoader2 : kindIcon(data.kind)" :size="32" :class="{ spinner: taskPending(id) }" /></span></div>
          <footer class="nodeFooter"><span :class="{ waiting: taskPending(id) }"><i />{{ freeStatus(id, data) }}</span><button type="button" class="nodrag nopan" :aria-label="`编辑${data.title}`" @click.stop="selectNode(id)"><icon-arrow-up-right :size="14" /></button></footer>
          <handle id="output" type="source" :position="Position.Right" />
        </article>
      </template>
      <template #node-shot="{ id, data, selected }">
        <article class="creativeNode shotNode" :class="{ selected, locked: data.shot.locked }" :aria-label="`镜头 ${data.shot.order} ${version(data.shot).title}`">
          <handle id="input" type="target" :position="Position.Left" />
          <header class="nodeHeading"><span class="shotNumber">{{ String(data.shot.order).padStart(2, '0') }}</span><strong>{{ version(data.shot).title }}</strong><icon-lock v-if="data.shot.locked" :size="13" /><span v-else class="nodeKind">镜头</span></header>
          <div class="nodeMedia shotMedia"><studioThumbnail :directory="directory" :path="version(data.shot).keyframe?.path || version(data.shot).clip?.path" :mimeType="version(data.shot).keyframe?.mimeType || version(data.shot).clip?.mimeType" label="等待镜头素材" /><span class="durationBadge">{{ version(data.shot).duration }}s</span><button v-if="version(data.shot).keyframe || version(data.shot).clip" type="button" class="nodePlay nodrag nopan" :aria-label="`预览镜头${data.shot.order}`" @click.stop="$emit('preview', data.shot.id)"><icon-player-play-filled :size="15" /></button></div>
          <p class="shotDescription">{{ version(data.shot).description }}</p>
          <footer class="nodeFooter"><span :class="{ waiting: taskFor(data.shot)?.status === 'running' }"><i />{{ shotStatus(data.shot) }}</span><span class="versionTag">V{{ version(data.shot).number }}</span></footer>
          <handle id="output" type="source" :position="Position.Right" />
        </article>
      </template>
    </vue-flow>

    <div class="canvasCaption"><span class="captionDot" /><strong>创作画布</strong><span>双击添加 · 拖线连接 · 拖动空白框选 · 空格平移</span></div>
    <div class="saveIndicator" role="status" :class="{ failed: !!error, pending: dirty || uploading || freeDirty }"><i />{{ error ? '画布保存需处理' : uploading ? '正在导入素材' : !ready ? '正在载入画布' : freeDirty ? '文字尚未保存' : dirty ? '正在保存画布' : '画布已保存' }}</div>
    <nav class="creationTools" aria-label="添加创作节点"><button class="addButton" type="button" :disabled="!ready || busy" aria-label="添加创作节点" :aria-expanded="!!menu" @click="openToolbarMenu"><icon-plus :size="21" /></button><i /><button type="button" :disabled="!ready || busy" aria-label="添加文本节点" title="文字" @click="addNode('text')"><icon-file-text :size="19" /></button><button type="button" :disabled="!ready || busy" aria-label="添加生成图片节点" title="生成图片" @click="addNode('image', true)"><icon-photo :size="19" /></button><button type="button" :disabled="!ready || busy" aria-label="添加生成视频节点" title="生成视频" @click="addNode('video', true)"><icon-movie :size="19" /></button><i /><button type="button" :disabled="!ready || busy || !undoStack.length" aria-label="撤销画布操作" title="撤销" @click="undo"><icon-arrow-back-up :size="18" /></button><button type="button" :disabled="!ready || busy || !redoStack.length" aria-label="重做画布操作" title="重做" @click="redo"><icon-arrow-forward-up :size="18" /></button></nav>

    <div v-if="menu" class="createMenu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" role="menu" aria-label="选择新节点类型" @keydown.esc="menu = undefined"><span>{{ menu.source ? '创建并连接节点' : '添加节点' }}</span><button v-for="item in menuItems" :key="item.type" type="button" role="menuitem" @click="addNode(item.kind, item.generate)"><component :is="item.generate ? IconSparkles : kindIcon(item.kind)" :size="17" /><span>{{ item.label }}<small>{{ item.description }}</small></span><icon-plus :size="14" /></button><p v-if="!menuItems.length">这个输出没有可连接的新节点。</p></div>

    <div class="canvasNavigation"><button type="button" aria-label="缩小创作画布" @click="flow.zoomOut()"><icon-minus :size="16" /></button><span>{{ Math.round(flow.viewport.value.zoom * 100) }}%</span><button type="button" aria-label="放大创作画布" @click="flow.zoomIn()"><icon-plus :size="16" /></button><i /><button type="button" aria-label="适应全部创作节点" title="查看全部" @click="fit"><icon-maximize :size="16" /></button><button type="button" class="arrangeButton" :disabled="!ready || busy || !nodes.length" aria-label="整理画布" title="按连接关系排列节点，可撤销" @click="arrangeGraph"><icon-layout-grid :size="15" /><span>整理画布</span></button><button type="button" :disabled="!ready || busy || !canCopy" aria-label="复制选中素材节点" title="复制选中素材节点 · ⌘/Ctrl D" @click="duplicateSelection"><icon-copy :size="16" /></button><button type="button" :disabled="!ready || busy || !canDelete" aria-label="删除选中素材节点或连线" title="仅删除画布节点，保留素材文件和镜头" @click="deleteSelection"><icon-trash :size="16" /></button></div>

    <aside v-if="selectedFree?.generation" class="nodeDock generationDock" aria-label="生成节点编辑器">
      <header><span class="dockIcon"><icon-sparkles :size="18" /></span><input v-model="draftTitle" maxlength="120" :disabled="busy" aria-label="生成节点名称" @change="saveFree" /><span class="dockType">{{ freeStatus(selectedFree.id, selectedFree) }}</span><button v-if="selectedFree.kind !== 'video'" type="button" class="downstreamButton" :aria-label="`从${selectedFree.title}创建下游节点`" :disabled="busy" @click="openDownstreamMenu($event, selectedFree.id)"><icon-plus :size="14" /><span>创建下游</span></button><button type="button" aria-label="关闭生成节点编辑器" @click="clearSelection"><icon-x :size="17" /></button></header>
      <p v-if="selectedFree.asset" class="usageSummary">{{ usedLabel(selectedFree.id) }}<span v-if="generationChanged(selectedFree.id)"> · 输入已变更，当前结果基于旧输入</span></p>
      <div v-if="selectedFree.asset" class="resultActions" aria-label="当前结果操作"><button type="button" :disabled="busy" @click="openResultPreview"><icon-maximize :size="14" />{{ selectedFree.kind === 'video' ? '播放视频' : '放大预览' }}</button><button type="button" :disabled="busy || downloadingResult" @click="downloadSelectedResult"><icon-loader-2 v-if="downloadingResult" :size="14" class="spinner" /><icon-download v-else :size="14" />{{ downloadingResult ? '正在保存' : '下载' }}</button><template v-if="selectedFree.kind === 'image'"><button type="button" :disabled="busy || uploading" @click="openResultEdit"><icon-pencil :size="14" />继续改图</button><button type="button" :disabled="busy || uploading" @click="createFromResult('video')"><icon-movie :size="14" />用这张图生成视频</button></template></div>
      <form v-if="selectedFree.kind === 'image' && selectedFree.asset && resultEditVisible" class="resultEdit" @submit.prevent="createFromResult('image')"><label :for="`resultEdit${flowId}`">想怎么修改这张图？</label><textarea :id="`resultEdit${flowId}`" ref="resultEditInput" v-model="resultInstruction" rows="2" maxlength="5000" :disabled="busy" placeholder="例如：把猫改成白色，保持姿势、背景和构图" aria-label="图片修改要求" @keydown.meta.enter.prevent="createFromResult('image')" @keydown.ctrl.enter.prevent="createFromResult('image')" /><div><span>保留原图，新建一个修改版本；确认后才生成。</span><button type="button" :disabled="busy" @click="resultEditVisible = false">取消</button><button type="submit" :disabled="busy || !resultInstruction.trim()">准备修改<icon-arrow-right :size="13" /></button></div></form>
      <div v-if="selectedFree.asset && usedShots(selectedFree.id).length" class="usedShotActions"><button v-for="shot in usedShots(selectedFree.id)" :key="shot.id" type="button" :disabled="busy || shot.locked || shotPending(shot.id)" @click="addSelectedToTimeline(shot.id)">{{ needsReplacement(selectedFree, shot) ? '比较并替换' : '比较素材' }}第 {{ shot.order }} 镜{{ shot.locked ? '（已锁定）' : '' }}</button></div>
      <div v-if="project.production" class="productionBinding">
        <label>用于制作<select :value="generationScopeKey" :disabled="busy || generationPending" aria-label="生成内容归属" @change="changeGenerationScope(($event.target as HTMLSelectElement).value)"><option value="">选择角色、场景或镜头</option><optgroup v-if="selectedFree.kind === 'image'" label="角色参考图"><option v-for="character in project.production.characters" :key="character.id" :value="`character:${character.id}`">{{ character.name }} · V{{ character.revision }}</option></optgroup><optgroup v-if="selectedFree.kind === 'image'" label="场景参考图"><option v-for="scene in productionScript?.scenes || []" :key="scene.id" :value="`scene:${scene.id}`">{{ scene.title }}</option></optgroup><optgroup label="分镜素材"><option v-for="shot in project.shots" :key="shot.id" :value="`shot:${shot.id}`">第 {{ shot.order }} 镜 · {{ version(shot).title }}</option></optgroup></select></label>
        <span v-if="scopeShot">绑定 V{{ scopeVersion?.number }} · 结果需手动加入成片</span>
        <button v-if="scopeShot" type="button" class="configureLink" :disabled="busy || generationPending" @click="loadShotGeneration">载入当前镜头参数</button>
        <p v-if="scopeAssetHint">{{ scopeAssetHint }}</p>
      </div>
      <div class="generationReferences"><span>参考</span><button v-for="asset in generationInputs.assets" :key="asset.path" type="button" class="referenceChip" :class="{ active: generationReference?.path === asset.path }" :title="referenceLabel(asset.path)" @click="chooseGenerationReference(asset.path)"><studioThumbnail :directory="directory" :path="asset.path" :mimeType="asset.mimeType" :label="referenceLabel(asset.path)" /><span>{{ referenceLabel(asset.path) }}</span></button><button type="button" class="referenceAdd" :disabled="busy || uploading || generationPending" title="上传一张参考图并连接" @click="chooseReferenceUpload"><icon-plus :size="18" /><span>参考图</span></button></div>
      <p v-if="selectedFree.generation.referenceOnly" class="referenceModeHint">本次使用选中的参考图与下面的要求，保留原始结果。</p>
      <textarea v-model="draftText" maxlength="6000" :disabled="busy || generationPending" rows="3" placeholder="描述主体、动作、场景和镜头运动…" aria-label="生成提示词" @change="saveFree" />
      <p v-if="generationInputs.text" class="upstreamText"><icon-link :size="12" />将合并上游文字：{{ generationInputs.text.slice(0, 140) }}{{ generationInputs.text.length > 140 ? '…' : '' }}</p>
      <div class="generationSettings"><label><span>模型</span><select :value="selectedModelKey" :disabled="busy || generationPending" aria-label="生成模型" @change="changeGenerationModel(($event.target as HTMLSelectElement).value)"><option value="">选择模型</option><option v-for="model in generationModels" :key="modelKey(model)" :value="modelKey(model)">{{ model.providerLabel }} · {{ model.label }}{{ configuredProviders?.includes(model.providerId) ? '' : ' · 待配置' }}</option></select></label><label><span>画幅</span><select :value="selectedFree.generation.ratio" :disabled="busy || generationPending" aria-label="生成画幅" @change="updateGeneration({ ratio: ($event.target as HTMLSelectElement).value as '16:9' | '9:16' | '1:1' })"><option v-for="ratio in generationRatios" :key="ratio" :value="ratio">{{ ratio }}</option></select></label><label v-if="selectedFree.kind === 'video'"><span>时长</span><select :value="selectedFree.generation.duration" :disabled="busy || generationPending" aria-label="生成时长" @change="updateGeneration({ duration: Number(($event.target as HTMLSelectElement).value) as 5 | 10 })"><option v-for="duration in generationDurations" :key="duration" :value="duration">{{ duration }}s</option></select></label><label v-if="generationResolutions.length"><span>分辨率</span><select :value="selectedFree.generation.model?.resolution || ''" :disabled="busy || generationPending" aria-label="生成分辨率" @change="changeGenerationResolution(($event.target as HTMLSelectElement).value)"><option value="">默认</option><option v-for="value in generationResolutions" :key="value" :value="value">{{ value }}</option></select></label></div>
      <p v-if="generationIssue" class="dockHint" role="status">{{ generationIssue }}<button v-if="!selectedModel || !configuredProviders?.includes(selectedModel.providerId)" type="button" class="configureLink" @click="$emit('configure')">模型配置<icon-arrow-up-right :size="12" /></button></p>
      <p v-if="selectedGenerationTask?.error" class="dockHint" role="status">{{ selectedGenerationTask.error }}</p>
      <div v-if="generationResults.length" class="generationResults"><span>生成结果</span><button v-for="(task, index) in generationResults" :key="task.id" type="button" :class="{ active: selectedFree.asset?.path === task.output?.path }" :title="`选用第 ${generationResults.length - index} 个结果`" :disabled="busy" @click="useGenerationResult(task.output!)"><studioThumbnail :directory="directory" :path="task.output?.path" :mimeType="task.output?.mimeType" :label="`结果 ${generationResults.length - index}`" /><span>{{ selectedFree.asset?.path === task.output?.path ? '已选用' : '选用结果' }}</span></button></div>
      <footer><span>确认后提交模型任务；已有结果保留</span><button v-if="referenceResult" type="button" class="dockSecondary" :disabled="busy" @click="$emit('adoptReference', referenceResult)">设为{{ referenceResult.generation?.scope?.kind === 'character' ? '角色' : '场景' }}参考图</button><button v-if="selectedFree.asset" type="button" class="dockSecondary" :disabled="busy" @click="addSelectedToTimeline()">{{ usedShots(selectedFree.id).length ? '另加一镜' : project.production ? '绑定或插入镜头' : '加入成片' }}<icon-plus :size="12" /></button><button type="button" class="configureLink" :disabled="busy" @click="$emit('agent')">交给助手<icon-sparkles :size="12" /></button><button class="dockPrimary" type="button" :disabled="busy || generationPending || !!generationIssue" @click="submitGeneration"><icon-loader-2 v-if="generationPending" :size="14" class="spinner" /><icon-arrow-up v-else :size="14" />{{ generationPending ? '生成中' : selectedGenerationTask?.status === 'verificationRequired' ? '等待核对' : selectedGenerationTask?.status === 'succeeded' ? '再生成一版' : ['failed', 'interrupted'].includes(selectedGenerationTask?.status || '') ? '重试生成' : '确认生成' }}</button></footer>
    </aside>

    <aside v-else-if="selectedFree" class="nodeDock" aria-label="节点编辑器">
      <header><span class="dockIcon"><component :is="kindIcon(selectedFree.kind)" :size="18" /></span><input v-model="draftTitle" maxlength="120" :disabled="busy" aria-label="节点名称" @change="saveFree" /><span class="dockType">{{ kindLabel(selectedFree.kind) }}</span><button v-if="selectedFree.kind !== 'video'" type="button" class="downstreamButton" :aria-label="`从${selectedFree.title}创建下游节点`" :disabled="busy" @click="openDownstreamMenu($event, selectedFree.id)"><icon-plus :size="14" /><span>创建下游</span></button><button type="button" aria-label="关闭节点编辑器" @click="clearSelection"><icon-x :size="17" /></button></header>
      <textarea v-if="selectedFree.kind === 'text'" v-model="draftText" maxlength="6000" :disabled="busy" rows="3" placeholder="描述角色、场景或镜头。连接到镜头后，可作为画面描述应用。" aria-label="文本节点内容" @change="saveFree" />
      <p v-if="selectedFree.asset" class="usageSummary">{{ usedLabel(selectedFree.id) }}</p><div v-if="selectedFree.asset && usedShots(selectedFree.id).length" class="usedShotActions"><button v-for="shot in usedShots(selectedFree.id)" :key="shot.id" type="button" :disabled="busy || shot.locked || shotPending(shot.id)" @click="addSelectedToTimeline(shot.id)">比较并替换第 {{ shot.order }} 镜</button></div>
      <div v-if="selectedFree.asset" class="resultActions" aria-label="当前结果操作"><button type="button" :disabled="busy" @click="openResultPreview"><icon-maximize :size="14" />{{ selectedFree.kind === 'video' ? '播放视频' : '放大预览' }}</button><button type="button" :disabled="busy || downloadingResult" @click="downloadSelectedResult"><icon-loader-2 v-if="downloadingResult" :size="14" class="spinner" /><icon-download v-else :size="14" />{{ downloadingResult ? '正在保存' : '下载' }}</button><template v-if="selectedFree.kind === 'image'"><button type="button" :disabled="busy || uploading" @click="openResultEdit"><icon-pencil :size="14" />继续改图</button><button type="button" :disabled="busy || uploading" @click="createFromResult('video')"><icon-movie :size="14" />用这张图生成视频</button></template></div>
      <form v-if="selectedFree.kind === 'image' && selectedFree.asset && resultEditVisible" class="resultEdit" @submit.prevent="createFromResult('image')"><label :for="`resultEdit${flowId}`">想怎么修改这张图？</label><textarea :id="`resultEdit${flowId}`" ref="resultEditInput" v-model="resultInstruction" rows="2" maxlength="5000" :disabled="busy" placeholder="例如：把猫改成白色，保持姿势、背景和构图" aria-label="图片修改要求" @keydown.meta.enter.prevent="createFromResult('image')" @keydown.ctrl.enter.prevent="createFromResult('image')" /><div><span>保留原图，新建一个修改版本；确认后才生成。</span><button type="button" :disabled="busy" @click="resultEditVisible = false">取消</button><button type="submit" :disabled="busy || !resultInstruction.trim()">准备修改<icon-arrow-right :size="13" /></button></div></form>
      <div v-if="selectedFree.kind !== 'text'" class="mediaDockBody"><div><strong>{{ selectedFree.asset ? '素材可以沿连线用于镜头' : `导入${kindLabel(selectedFree.kind)}素材` }}</strong><p>{{ selectedFree.asset ? `${selectedFree.title} · 工作区${kindLabel(selectedFree.kind)}素材` : '导入不会调用模型；连接到生成节点或镜头后继续创作。' }}</p></div><button class="dockSecondary" type="button" :disabled="busy || uploading" @click="chooseUpload(selectedFree.id, selectedFree.kind)"><icon-upload :size="15" />{{ selectedFree.asset ? '替换素材' : '导入素材' }}</button></div>
      <footer><span>{{ outgoingCount(selectedFree.id) ? `已连接 ${outgoingCount(selectedFree.id)} 个下游节点` : '拖动右侧连接点，将它连接到镜头' }}</span><button v-if="selectedFree.asset" type="button" class="dockPrimary" :disabled="busy" @click="addSelectedToTimeline()">{{ usedShots(selectedFree.id).length ? '另加一镜' : project.production ? '绑定或插入镜头' : '加入成片' }}<icon-plus :size="12" /></button><button v-if="selectedFree.kind === 'text'" class="dockPrimary" type="button" :disabled="busy || !freeDirty" @click="saveFree">保存内容<icon-check :size="13" /></button></footer>
    </aside>

    <aside v-else-if="selectedShot" class="nodeDock shotDock" aria-label="镜头节点操作">
      <header><span class="dockIcon"><icon-movie :size="19" /></span><strong>{{ String(selectedShot.order).padStart(2, '0') }} {{ version(selectedShot).title }}</strong><span class="dockType">V{{ version(selectedShot).number }} · {{ selectedShot.locked ? '已锁定' : '镜头' }}</span><button type="button" class="downstreamButton" :aria-label="`从镜头${selectedShot.order}创建下游节点`" :disabled="busy" @click="openDownstreamMenu($event, `shot:${selectedShot.id}`)"><icon-plus :size="14" /><span>创建下游</span></button><button type="button" aria-label="关闭镜头操作栏" @click="clearSelection"><icon-x :size="17" /></button></header>
      <div v-if="inputBundle.text || inputBundle.assets.length" class="inputSummary"><div><icon-link :size="14" /><span>{{ inputsApplied ? '连接输入已用于当前镜头' : '连接输入待应用' }}</span><small>{{ inputBundle.text ? '文字描述' : '' }}{{ inputBundle.text && inputBundle.assets.length ? ' + ' : '' }}{{ inputBundle.assets.length ? `${inputBundle.assets.length} 份素材` : '' }}</small></div><select v-if="inputBundle.assets.length > 1" v-model="inputAssetPath" aria-label="选择用于镜头的连接素材"><option value="">请选择一份素材</option><option v-for="asset in inputBundle.assets" :key="asset.path" :value="asset.path">{{ asset.path.split('/').at(-1) }} · {{ asset.kind === 'image' ? '关键帧' : '视频' }}</option></select><button class="dockPrimary" type="button" :disabled="busy || selectedShot.locked || shotPending(selectedShot.id) || inputsApplied || !!inputIssue" @click="applyInputs">{{ inputsApplied ? '已应用' : '应用到镜头' }}<icon-arrow-right :size="13" /></button></div>
      <p v-if="inputIssue" class="dockHint">{{ inputIssue }}</p>
      <div class="shotDockActions"><button type="button" :disabled="busy || selectedShot.locked || shotPending(selectedShot.id)" @click="$emit('edit', selectedShot)"><icon-pencil :size="15" />编辑镜头</button><button type="button" :disabled="busy" @click="$emit('versions', selectedShot)"><icon-history :size="15" />版本</button><button type="button" :disabled="busy" @click="$emit('lock', selectedShot)"><icon-lock v-if="selectedShot.locked" :size="15" /><icon-lock-open v-else :size="15" />{{ selectedShot.locked ? '解锁' : '锁定' }}</button><button type="button" :disabled="busy" @click="$emit('agent', selectedShot.id)"><icon-sparkles :size="15" />助手改稿</button><span class="actionSpacer" /><button type="button" :disabled="busy || selectedShot.locked || shotPending(selectedShot.id)" @click="chooseShotImport('image')"><icon-upload :size="14" />导入</button><button class="dockSecondary" type="button" :disabled="busy || selectedShot.locked || shotPending(selectedShot.id) || !imageReady" :title="imageReady ? '生成关键帧' : '尚未配置图片模型'" @click="$emit('generate', selectedShot, 'image')"><icon-photo :size="14" />关键帧</button><button class="dockPrimary" type="button" :disabled="busy || selectedShot.locked || shotPending(selectedShot.id) || !videoReady || !version(selectedShot).keyframe" :title="!videoReady ? '尚未配置视频模型' : !version(selectedShot).keyframe ? '请先导入或生成关键帧' : '生成视频将调用已配置模型'" @click="$emit('generate', selectedShot, 'video')"><icon-player-play :size="14" />生成视频</button></div>
      <footer><span>{{ selectedShot.locked ? '此镜头已锁定，连接与素材不会自动覆盖它' : '连接只引用输入，应用修改与生成分别确认' }}</span><button type="button" class="configureLink" @click="$emit('configure')">模型配置<icon-arrow-up-right :size="12" /></button></footer>
    </aside>

    <p v-if="error || notice" class="canvasNotice" :class="{ error: !!error }" role="status">{{ error || notice }}<button type="button" aria-label="关闭画布提示" @click="notice = ''; if (!dirty) error = ''"><icon-x :size="13" /></button></p>
    <input ref="uploadInput" type="file" :accept="uploadKind + '/*'" class="fileInput" @change="uploadMedia" />
    <el-dialog v-model="resultPreviewVisible" :title="resultPreview?.title || '素材预览'" width="min(1080px, calc(100vw - 32px))" appendToBody destroyOnClose class="studioDialog" @closed="resultPreview = undefined"><mediaPreview v-if="resultPreviewVisible && resultPreview" class="resultPreviewMedia" :directory="resultPreview.directory" :path="resultPreview.asset.path" :mimeType="resultPreview.asset.mimeType" :label="resultPreview.title" /></el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { VueFlow, Handle, Position, useVueFlow, type Node, type Edge, type Connection, type NodeMouseEvent } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { IconPlus, IconMinus, IconMaximize, IconTrash, IconCopy, IconPhoto, IconMovie, IconFileText, IconUpload, IconDownload, IconArrowUp, IconArrowUpRight, IconArrowRight, IconArrowBackUp, IconArrowForwardUp, IconCheck, IconX, IconLink, IconPencil, IconHistory, IconLock, IconLockOpen, IconSparkles, IconPlayerPlay, IconPlayerPlayFilled, IconLoader2, IconLayoutGrid } from "@tabler/icons-vue";
import type { DirectorAsset, DirectorGenerationInput, DirectorProject, DirectorShot, ShotVersion } from "@toonflow/server/directorTypes";
import type { CanvasContext, MediaModel, NodeToolInfo } from "@toonflow/tools-scaffold/runtime";
import { canvasSchemas } from "@toonflow/tool-canvas/runtime";
import { directorError, uploadDirectorFile } from "./api";
import { emptyCreativeGraph, readCreativeGraph, type CreativeGraph, type CreativeKind, type CreativeNode, type CreativeGeneration } from "./creativeGraph";
import studioThumbnail from "./studioThumbnail.vue";
import mediaPreview from "./mediaPreview.vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import saveFile from "@/lib/saveFile";
import { createCanvasQueries, isCanvasRead } from "../canvas/canvasQueries";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = defineProps<{ directory: string; project: DirectorProject; selectedId: string; busy: boolean; imageReady: boolean; videoReady: boolean; mediaModels?: MediaModel[]; configuredProviders?: string[]; generationIssues?: { message: string; shotId?: string }[] }>();
type GenerationPayload = DirectorGenerationInput;
const emit = defineEmits<{ select: [id: string]; edit: [shot: DirectorShot]; versions: [shot: DirectorShot]; lock: [shot: DirectorShot]; preview: [id: string]; generate: [shot: DirectorShot, stage: "image" | "video"]; generateNode: [payload: GenerationPayload]; addToTimeline: [payload: { title: string; kind: "image" | "video"; asset: { path: string; mimeType: string }; duration?: number; sourceNodeId?: string; sourceTaskId?: string; sourceInputHash?: string; targetShotId?: string }]; nodeLabels: [labels: Record<string, string>]; attach: [shot: DirectorShot, kind: "image" | "video", file: File]; applyInputs: [payload: { shotId: string; signature: string; text?: string; asset?: { path: string; mimeType: string; kind: "image" | "video" } }]; adoptReference: [task: DirectorProject["tasks"][number]]; agent: [shotId?: string]; configure: [] }>();
type GraphData = { kind: CreativeKind | "shot"; title: string; text: string; asset?: { path: string; mimeType: string }; generation?: CreativeGeneration; shot?: DirectorShot };
type InputAsset = { path: string; mimeType: string; kind: "image" | "video" };
const flowId = `creativeCanvas${crypto.randomUUID()}`;
const flow = useVueFlow(flowId);
const canvasRoot = ref<HTMLElement>();
const graph = ref<CreativeGraph>(emptyCreativeGraph());
const nodes = ref<(Node<GraphData> & { selected?: boolean })[]>([]);
const edges = ref<Edge[]>([]);
const ready = ref(false);
const dirty = ref(false);
const error = ref("");
const notice = ref("");
const selectedNodeId = ref("");
const selectedFree = computed(() => graph.value.nodes.find(node => node.id === selectedNodeId.value));
const selectedShot = computed(() => props.project.shots.find(shot => `shot:${shot.id}` === selectedNodeId.value));
const draftTitle = ref("");
const draftText = ref("");
const resultEditVisible = ref(false);
const resultInstruction = ref("");
const resultEditInput = ref<HTMLTextAreaElement>();
const downloadingResult = ref(false);
const resultPreviewVisible = ref(false);
const resultPreview = ref<{ directory: string; title: string; asset: { path: string; mimeType: string } }>();
const freeDirty = computed(() => !!selectedFree.value && (draftTitle.value !== selectedFree.value.title || draftText.value !== selectedFree.value.text));
const menu = ref<{ x: number; y: number; flowX: number; flowY: number; source?: string }>();
const zoomKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control";
const spacePanning = ref(false);
const createItems = [
  { type: "text", kind: "text" as const, generate: false, label: "文字", description: "创意、提示词与对白" },
  { type: "generateImage", kind: "image" as const, generate: true, label: "生成图片", description: "角色、场景与关键帧" },
  { type: "generateVideo", kind: "video" as const, generate: true, label: "生成视频", description: "连接首帧，制作动态镜头" },
  { type: "image", kind: "image" as const, generate: false, label: "上传图片", description: "导入已有视觉参考" },
  { type: "video", kind: "video" as const, generate: false, label: "上传视频", description: "导入已有视频素材" },
];
const undoStack = ref<CreativeGraph[]>([]);
const redoStack = ref<CreativeGraph[]>([]);
const inputAssetPath = ref("");
const uploadInput = ref<HTMLInputElement>();
const uploadKind = ref<"image" | "video">("image");
const uploading = ref(false);
let uploadNodeId = "";
let uploadShotId = "";
let referenceTargetId = "";
let uploadDirectory = "";
let clipboard: { directory: string; nodes: CreativeNode[]; edges: CreativeGraph["edges"] } | undefined;
let generation = 0;
let saveCounter = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let writer: Awaited<ReturnType<typeof readCreativeGraph>> | undefined;
let writing: Promise<void> | undefined;
let viewInitialized = false;
let canvasAborter = new AbortController();
let contextCache: { token: number; value: CanvasContext } | undefined;
const canDelete = computed(() => !!selectedFree.value || flow.getSelectedEdges.value.length > 0 || flow.getSelectedNodes.value.some(node => !node.id.startsWith("shot:")));
const canCopy = computed(() => !!selectedFree.value || flow.getSelectedNodes.value.some(node => !node.id.startsWith("shot:")));
function version(shot: DirectorShot): ShotVersion { return shot.versions.find(item => item.id === shot.currentVersionId)!; }
function kindLabel(kind: string) { return kind === "text" ? "文本" : kind === "image" ? "图片" : "视频"; }
function kindIcon(kind: string) { return kind === "text" ? IconFileText : kind === "image" ? IconPhoto : IconMovie; }
function shotPending(id: string) { return props.project.tasks.some(task => task.shotId === id && ["queued", "running"].includes(task.status)); }
function taskFor(shot: DirectorShot) { return props.project.tasks.findLast(task => task.shotId === shot.id && task.versionId === shot.currentVersionId); }
function generationTask(id: string) { return props.project.tasks.findLast(task => task.nodeId === id); }
function usedShots(id: string) { return props.project.shots.filter(shot => [version(shot).keyframe, version(shot).clip].some(asset => asset?.sourceNodeId === id)); }
function usedLabel(id: string) { const used = usedShots(id); return used.length ? `已用于第 ${used.map(shot => shot.order).join("、")} 镜` : "尚未加入成片"; }
function needsReplacement(node: CreativeNode, shot: DirectorShot) { const asset = node.kind === "video" ? version(shot).clip : version(shot).keyframe; const task = props.project.tasks.find(item => item.nodeId === node.id && item.output?.path === node.asset?.path); return !!asset && (task ? asset.sourceTaskId !== task.id : asset.sourceNodeId === node.id && asset.inputHash !== node.asset?.path); }
function taskPending(id: string) { return props.project.tasks.some(task => task.nodeId === id && ["queued", "running"].includes(task.status)); }
function freeStatus(id: string, data: GraphData) { const task = generationTask(id); if (data.generation && data.asset && !taskPending(id)) { const inputState = generationInputState(id); if (inputState === "changed") return "输入已变更 · 结果待更新"; if (inputState === "referenceUnknown" && task?.status === "succeeded") return "结果已就绪 · 参考来源待核对"; } return data.generation && task ? ({ queued: "排队中", running: "生成中", succeeded: "结果已就绪", failed: "生成失败", interrupted: "已中断", verificationRequired: "上游结果待核对", cancelled: "已停止本地任务" }[task.status]) : data.asset ? "素材已就绪" : data.generation ? "等待生成" : data.kind === "text" ? `${data.text.length} 字` : "等待导入素材"; }
function shotStatus(shot: DirectorShot) { const task = taskFor(shot); return task?.status === "running" || task?.status === "queued" ? "素材生成中" : task?.status === "failed" ? "生成失败，查看执行记录" : task?.status === "verificationRequired" ? "上游结果待核对" : version(shot).clip ? "视频已就绪" : version(shot).keyframe ? "关键帧已就绪" : "等待素材"; }
function nodeData(id: string) { return nodes.value.find(node => node.id === id)?.data; }
function outputKind(id: string) { return nodeData(id)?.kind; }
function connectionIssue(source: string, target: string, ignoredEdgeId?: string, candidateEdges: Pick<Edge, "id" | "source" | "target">[] = edges.value) {
  if (!source || !target || source === target) return "不能连接到自身";
  const from = outputKind(source); const to = nodeData(target)?.kind;
  if (!from || !to || to === "text" || (from === "video" && to !== "shot")) return "这两类节点不能传递输入";
  if (candidateEdges.some(edge => edge.id !== ignoredEdgeId && edge.source === source && edge.target === target)) return "这两个节点已连接";
  const pending = [target]; const visited = new Set<string>();
  while (pending.length) { const id = pending.pop()!; if (id === source) return "连接会形成循环，请选择其他节点"; if (visited.has(id)) continue; visited.add(id); pending.push(...candidateEdges.filter(edge => edge.id !== ignoredEdgeId && edge.source === id).map(edge => edge.target)); }
  return "";
}
function validConnection(connection: Connection & { id?: string }) { return !connectionIssue(connection.source, connection.target, connection.id); }
const menuItems = computed(() => createItems.filter(item => !menu.value?.source || item.generate && outputKind(menu.value.source) !== "video"));
function snapshotGraph(): CreativeGraph {
  const positions = Object.fromEntries(nodes.value.map(node => [node.id, { x: node.position.x, y: node.position.y }]));
  return JSON.parse(JSON.stringify({ ...graph.value, nodes: graph.value.nodes.map(node => ({ ...node, position: positions[node.id] || node.position })), edges: edges.value.map(({ id, source, target }) => ({ id, source, target })), positions }));
}
function remember() { if (!ready.value || props.busy) return; undoStack.value.push(snapshotGraph()); if (undoStack.value.length > 40) undoStack.value.shift(); redoStack.value = []; }
function renderNodes(preferSaved = false) {
  const existing = new Map(nodes.value.map(node => [node.id, node.position]));
  const point = (id: string, fallback: { x: number; y: number }) => preferSaved ? graph.value.positions[id] || fallback : existing.get(id) || graph.value.positions[id] || fallback;
  const freeBounds = graph.value.nodes.map(node => { const position = point(node.id, node.position); const width = flow.findNode(node.id)?.dimensions.width || 286; return { ...position, width }; });
  const shotStartX = freeBounds.length ? Math.max(190, ...freeBounds.map(box => box.x + box.width + 64)) : 190;
  nodes.value = [
    ...graph.value.nodes.map(node => ({ id: node.id, type: "creative", position: point(node.id, node.position), data: { ...node }, selected: selectedNodeId.value === node.id, zIndex: selectedNodeId.value === node.id ? 100 : 20, dragHandle: ".nodeHeading" })),
    ...props.project.shots.map((shot, index) => ({ id: `shot:${shot.id}`, type: "shot", position: point(`shot:${shot.id}`, { x: shotStartX + index * 340, y: 140 }), data: { kind: "shot" as const, title: version(shot).title, text: version(shot).description, shot }, selected: selectedNodeId.value === `shot:${shot.id}`, zIndex: selectedNodeId.value === `shot:${shot.id}` ? 100 : 1, deletable: false, dragHandle: ".nodeHeading" })),
  ];
  emit("nodeLabels", Object.fromEntries(nodes.value.map(node => [node.id, node.data?.shot ? `第 ${node.data.shot.order} 镜 · ${node.data.title}` : node.data?.title || "创作节点"])));
  const ids = new Set(nodes.value.map(node => node.id));
  edges.value = graph.value.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({ ...edge, sourceHandle: "output", targetHandle: "input", type: "smoothstep", style: { stroke: "#6bba87", strokeWidth: 1.6 } }));
}
function changed() { dirty.value = true; saveCounter++; if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { void flushSave().catch(() => {}); }, 280); }
async function flushSave(): Promise<void> {
  if (uploading.value) throw new Error("素材正在导入，请完成后再切换视图或退出项目。");
  if (freeDirty.value) saveFree();
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
  if (writing) await writing;
  if (!dirty.value) return;
  if (!writer || !ready.value) throw new Error(error.value || "画布尚未就绪，修改尚未保存");
  const currentWriter = writer; const count = saveCounter; const document = snapshotGraph(); const currentGeneration = generation;
  writing = currentWriter.save(document).then(() => { if (generation === currentGeneration) { if (count === saveCounter) dirty.value = false; error.value = ""; } }).catch(cause => { if (generation === currentGeneration) error.value = directorError(cause); throw cause; });
  try { await writing; } finally { writing = undefined; }
  if (dirty.value && count !== saveCounter) await flushSave();
}
function savePositions() { graph.value.positions = Object.fromEntries(nodes.value.map(node => [node.id, { ...node.position }])); changed(); }
function selectNode(id: string) {
  if (freeDirty.value) saveFree();
  if (id !== selectedNodeId.value) { resultEditVisible.value = false; resultInstruction.value = ""; }
  selectedNodeId.value = id; menu.value = undefined;
  nodes.value.forEach(node => { node.selected = node.id === id; node.zIndex = node.id === id ? 100 : node.type === "creative" ? 20 : 1; });
  const free = graph.value.nodes.find(node => node.id === id); draftTitle.value = free?.title || ""; draftText.value = free?.text || ""; inputAssetPath.value = "";
  if (id.startsWith("shot:")) emit("select", id.slice(5));
}
function onNodeClick(event: NodeMouseEvent) {
  if (event.event.shiftKey) { selectedNodeId.value = ""; menu.value = undefined; return; }
  selectNode(event.node.id);
}
function clearSelection() { if (freeDirty.value) saveFree(); selectedNodeId.value = ""; resultEditVisible.value = false; resultInstruction.value = ""; menu.value = undefined; nodes.value.forEach(node => { node.selected = false; node.zIndex = node.type === "creative" ? 20 : 1; }); }
function openMenuAt(clientX: number, clientY: number, source?: string) {
  if (!ready.value || props.busy || !canvasRoot.value) return;
  const bounds = canvasRoot.value.getBoundingClientRect(); const point = flow.screenToFlowCoordinate({ x: clientX, y: clientY });
  menu.value = { x: Math.max(65, Math.min(clientX - bounds.left, bounds.width - 238)), y: Math.max(48, Math.min(clientY - bounds.top, bounds.height - 365)), flowX: point.x, flowY: point.y, source };
}
function openDownstreamMenu(event: MouseEvent, source: string) {
  const node = flow.findNode(source);
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!node) return;
  openMenuAt(anchor.right + 8, anchor.top, source);
  if (menu.value?.source === source) {
    menu.value.flowX = node.position.x + (node.dimensions.width || 286) + 54;
    menu.value.flowY = node.position.y;
  }
}
function openToolbarMenu() { const bounds = canvasRoot.value?.getBoundingClientRect(); if (bounds) openMenuAt(bounds.left + 86, bounds.top + 75); }
function openContextMenu(event: MouseEvent) { event.preventDefault(); openMenuAt(event.clientX, event.clientY); }
function openPosition(preferred: { x: number; y: number }, kind: CreativeKind) {
  const width = 286; const height = kind === "text" ? 230 : 285;
  const occupied = flow.getNodes.value.map(node => ({ x: node.position.x, y: node.position.y, width: node.dimensions.width || 286, height: node.dimensions.height || (node.type === "shot" ? 340 : 285) }));
  const available = (point: { x: number; y: number }) => occupied.every(box => point.x + width + 28 <= box.x || point.x >= box.x + box.width + 28 || point.y + height + 28 <= box.y || point.y >= box.y + box.height + 28);
  const bounds = canvasRoot.value?.getBoundingClientRect();
  const topLeft = bounds ? flow.screenToFlowCoordinate({ x: bounds.left + 80, y: bounds.top + 58 }) : { x: -Infinity, y: -Infinity };
  const bottomRight = bounds ? flow.screenToFlowCoordinate({ x: bounds.right - 24, y: bounds.bottom - 200 }) : { x: Infinity, y: Infinity };
  // ACT: 画布限 150 个自由节点，搜索附近空位足以避免新增卡片遮住连接点。
  const candidates = [preferred];
  for (let ring = 1; ring <= 6; ring++) for (let y = -ring; y <= ring; y++) for (let x = -ring; x <= ring; x++) if (Math.abs(x) === ring || Math.abs(y) === ring) candidates.push({ x: preferred.x + x * 325, y: preferred.y + y * 320 });
  return candidates.find(point => point.x >= topLeft.x && point.y >= topLeft.y && point.x + width <= bottomRight.x && point.y + height <= bottomRight.y && available(point)) || candidates.find(available) || { x: preferred.x, y: preferred.y + 2240 };
}
async function revealNewNode(id: string) {
  await nextTick(); const node = flow.findNode(id); const bounds = canvasRoot.value?.getBoundingClientRect(); if (!node || !bounds) return;
  const { x, y, zoom } = flow.viewport.value; const screenX = node.position.x * zoom + x; const screenY = node.position.y * zoom + y;
  const dock = canvasRoot.value?.querySelector(".nodeDock")?.getBoundingClientRect();
  const bottom = dock ? Math.max(160, dock.top - bounds.top - 18) : bounds.height - 70;
  const height = node.dimensions.height || 285;
  if (screenX < 76 || screenX + 286 * zoom > bounds.width - 20 || screenY < 50 || screenY + height * zoom > bottom) {
    const targetZoom = Math.max(0.25, Math.min(zoom, (bottom - 58) / height));
    await flow.setViewport({ x: bounds.width / 2 - (node.position.x + 143) * targetZoom, y: 58 + (bottom - 58) / 2 - (node.position.y + height / 2) * targetZoom, zoom: targetZoom }, { duration: 160 });
  }
}
function defaultGeneration(kind: "image" | "video", ratio = props.project.ratio): CreativeGeneration {
  const configured = (props.mediaModels || []).filter(model => model.type === kind && props.configuredProviders?.includes(model.providerId));
  const preferred = props.project.models[kind];
  const selected = configured.find(model => preferred && model.providerId === preferred.providerId && model.modelId === preferred.modelId) || configured[0];
  if (!selected) return { ratio, duration: 5 };
  const model = preferred?.providerId === selected.providerId && preferred.modelId === selected.modelId ? { ...preferred } : { providerId: selected.providerId, modelId: selected.modelId, ...(selected.imageSizes?.[0] ? { size: selected.imageSizes[0] } : {}) };
  const allowedRatios = selected.imageRatios?.filter(value => ["16:9", "9:16", "1:1"].includes(value));
  const durations = selected.durationResolutionMap?.flatMap(item => item.duration).filter(value => value === 5 || value === 10);
  return { model, ratio: allowedRatios?.length && !allowedRatios.includes(ratio) ? allowedRatios[0] as CreativeGeneration["ratio"] : ratio, duration: durations?.length && !durations.includes(5) ? durations[0] as 5 | 10 : 5 };
}
function openResultPreview() {
  const node = selectedFree.value; if (!node?.asset) return;
  resultPreview.value = { directory: props.directory, title: node.title, asset: { ...node.asset } }; resultPreviewVisible.value = true;
}
async function downloadSelectedResult() {
  const node = selectedFree.value; if (!node?.asset || downloadingResult.value) return;
  const directory = props.directory; const asset = { ...node.asset }; const token = generation;
  const extension = asset.path.split("/").at(-1)?.split(".").at(-1)?.replace(/[^a-zA-Z0-9]/g, "") || (node.kind === "image" ? "png" : "mp4");
  const title = node.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100) || "CinePilot";
  downloadingResult.value = true;
  try {
    const saved = await saveFile(async () => new Blob([await useWorkspaceFiles(directory).read(asset.path)], { type: asset.mimeType }), `${title}.${extension}`);
    if (token === generation) notice.value = saved ? "素材已保存。" : "已取消保存，素材仍保留在项目中。";
  } catch (cause) { if (token === generation) notice.value = directorError(cause); }
  finally { if (token === generation) downloadingResult.value = false; }
}
async function openResultEdit() {
  if (props.busy || selectedFree.value?.kind !== "image" || !selectedFree.value.asset) return;
  resultEditVisible.value = true; await nextTick(); resultEditInput.value?.focus();
}
async function createFromResult(kind: "image" | "video") {
  const source = selectedFree.value; if (!ready.value || props.busy || uploading.value || source?.kind !== "image" || !source.asset || kind === "image" && !resultInstruction.value.trim()) return;
  if (graph.value.nodes.length >= 150 || edges.value.length >= 400) { notice.value = "画布节点或连线已达上限，请先精简画布。"; return; }
  if (freeDirty.value) saveFree();
  const text = kind === "image" ? `以直接连接的参考图为基础进行修改。保持未提及的主体特征、构图和画面内容，只按以下要求修改：\n${resultInstruction.value.trim()}` : "保持参考图中的主体外观与场景，镜头缓慢推进，生成自然、连续的动作。";
  const position = openPosition({ x: (flow.findNode(source.id)?.position.x ?? source.position.x) + 350, y: flow.findNode(source.id)?.position.y ?? source.position.y }, kind);
  const settings = defaultGeneration(kind, source.generation?.ratio || props.project.ratio);
  const scope = source.generation?.scope;
  remember();
  const id = crypto.randomUUID();
  const node: CreativeNode = { id, kind, title: `${source.title.slice(0, 105)} · ${kind === "image" ? "修改版" : "视频"}`, text, position, generation: { ...settings, referencePath: source.asset.path, referenceOnly: true, ...(scope && (kind === "image" || scope.kind === "shot") ? { scope: { ...scope } } : {}) } };
  graph.value.nodes.push(node); graph.value.positions[id] = position; graph.value.edges = [...edges.value.map(({ id, source, target }) => ({ id, source, target })), { id: crypto.randomUUID(), source: source.id, target: id }];
  renderNodes(); selectNode(id); changed();
  notice.value = kind === "image" ? "修改要求已准备，原图保留。检查参数后点击确认生成。" : "已用这张图准备视频节点。可修改动作和时长，确认后生成。";
  try { await flushSave(); await revealNewNode(id); }
  catch (cause) { notice.value = directorError(cause); }
}
function addNode(kind: CreativeKind, generate = false) {
  if (!ready.value || props.busy) return;
  if (graph.value.nodes.length >= 150) { notice.value = "当前画布最多添加 150 个素材节点。"; return; }
  if (menu.value?.source && edges.value.length >= 400) { notice.value = "当前画布已达到 400 条连线上限，请先删除不需要的连线。"; return; }
  const bounds = canvasRoot.value?.getBoundingClientRect(); if (!bounds) return;
  const preferred = menu.value ? { x: menu.value.flowX, y: menu.value.flowY } : flow.screenToFlowCoordinate({ x: bounds.left + bounds.width / 2 - 120, y: bounds.top + bounds.height / 2 - 90 }); const source = menu.value?.source;
  const point = source ? preferred : openPosition(preferred, kind);
  remember();
  const id = crypto.randomUUID();
  graph.value.nodes.push({ id, kind, title: `${generate ? '生成' : ''}${kindLabel(kind)} ${graph.value.nodes.filter(node => node.kind === kind).length + 1}`, text: "", position: point, ...(generate && kind !== "text" ? { generation: defaultGeneration(kind) } : {}) });
  graph.value.positions[id] = point; renderNodes();
  if (source && !connectionIssue(source, id)) { const edge = { id: crypto.randomUUID(), source, target: id }; graph.value.edges.push(edge); renderNodes(); }
  selectNode(id); changed(); void revealNewNode(id);
  if (kind !== "text" && !generate) chooseUpload(id, kind);
}
function connect(connection: Connection) {
  if (!ready.value || props.busy) return;
  const issue = connectionIssue(connection.source, connection.target); if (issue) { notice.value = issue; return; }
  if (edges.value.length >= 400) { notice.value = "当前画布最多保存 400 条连线。"; return; }
  remember(); graph.value.edges = [...edges.value.map(({ id, source, target }) => ({ id, source, target })), { id: crypto.randomUUID(), source: connection.source, target: connection.target }]; renderNodes(); changed();
}
function saveFree() {
  const target = selectedFree.value; if (!target || !freeDirty.value || props.busy) return;
  remember(); target.title = draftTitle.value.trim() || `${kindLabel(target.kind)}节点`; target.text = draftText.value; draftTitle.value = target.title; renderNodes(); changed();
}
function deleteSelection() {
  if (!ready.value || props.busy) return;
  const ids = new Set(flow.getSelectedNodes.value.filter(node => !node.id.startsWith("shot:")).map(node => node.id)); if (selectedFree.value) ids.add(selectedFree.value.id);
  const edgeIds = new Set(flow.getSelectedEdges.value.map(edge => edge.id)); if (!ids.size && !edgeIds.size) return;
  if ([...ids].some(id => taskPending(id) || generationTask(id)?.status === "verificationRequired")) { notice.value = "此节点有进行中或待核对任务，请先处理任务。"; return; }
  remember(); graph.value.nodes = graph.value.nodes.filter(node => !ids.has(node.id)); graph.value.edges = edges.value.filter(edge => !ids.has(edge.source) && !ids.has(edge.target) && !edgeIds.has(edge.id)).map(({ id, source, target }) => ({ id, source, target })); for (const id of ids) delete graph.value.positions[id]; selectedNodeId.value = ""; renderNodes(); changed();
}
function duplicateSelection() {
  if (copySelection()) pasteSelection();
}
function copySelection() {
  if (!ready.value || props.busy) return;
  if (freeDirty.value) saveFree();
  const selectedIds = new Set(flow.getSelectedNodes.value.filter(node => !node.id.startsWith("shot:")).map(node => node.id)); if (selectedFree.value) selectedIds.add(selectedFree.value.id);
  const originals = graph.value.nodes.filter(node => selectedIds.has(node.id));
  if (!originals.length) { notice.value = "镜头请使用版本管理；这里只复制素材节点。"; return; }
  const internalEdges = edges.value.filter(edge => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  clipboard = { directory: props.directory, nodes: JSON.parse(JSON.stringify(originals)), edges: internalEdges.map(({ id, source, target }) => ({ id, source, target })) }; notice.value = `已复制 ${originals.length} 个节点，可用 ⌘/Ctrl V 粘贴。`; return true;
}
function pasteSelection() {
  if (!ready.value || props.busy || !clipboard) return;
  if (clipboard.directory !== props.directory) { notice.value = "跨项目素材引用不能直接粘贴，请在当前项目重新导入素材。"; return; }
  const originals = clipboard.nodes; const internalEdges = clipboard.edges;
  if (graph.value.nodes.length + originals.length > 150 || edges.value.length + internalEdges.length > 400) { notice.value = "复制后会超过画布节点或连线上限，请先精简选区。"; return; }
  remember(); const copiedIds = new Map<string, string>();
  for (const original of originals) {
    const id = crypto.randomUUID(); copiedIds.set(original.id, id);
    const position = nodes.value.find(node => node.id === original.id)?.position || original.position;
    const copy = JSON.parse(JSON.stringify({ ...original, id, title: `${original.title.slice(0, 117)} 副本`, position: openPosition({ x: position.x + 50, y: position.y + 50 }, original.kind), ...(original.asset ? { asset: { ...original.asset } } : {}) })) as CreativeNode;
    if (copy.generation) { delete copy.generation.requestId; delete copy.generation.inputSignature; delete copy.generation.lastOutputTaskId; }
    graph.value.nodes.push(copy); graph.value.positions[id] = copy.position; renderNodes();
  }
  graph.value.edges = [...edges.value.map(({ id, source, target }) => ({ id, source, target })), ...internalEdges.map(edge => ({ id: crypto.randomUUID(), source: copiedIds.get(edge.source)!, target: copiedIds.get(edge.target)! }))];
  renderNodes(); const ids = new Set(copiedIds.values());
  if (ids.size === 1) selectNode([...ids][0]!); else { selectedNodeId.value = ""; nodes.value.forEach(node => { node.selected = ids.has(node.id); node.zIndex = ids.has(node.id) ? 100 : node.type === "creative" ? 20 : 1; }); }
  changed(); void revealNewNode([...ids][0]!);
}
function restoreHistory(from: typeof undoStack, to: typeof redoStack) { if (!ready.value || props.busy || !from.value.length) return; to.value.push(snapshotGraph()); graph.value = from.value.pop()!; selectedNodeId.value = ""; renderNodes(true); changed(); }
function undo() { restoreHistory(undoStack, redoStack); }
function redo() { restoreHistory(redoStack, undoStack); }
function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (event.key === "Escape") { clearSelection(); return; }
  if (event.code === "Space") { event.preventDefault(); spacePanning.value = true; return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelection(); }
  else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
}
function onKeyup(event: KeyboardEvent) { if (event.code === "Space") spacePanning.value = false; }
function focusCanvas(event: PointerEvent) { if (!(event.target as HTMLElement)?.closest('input,textarea,select,button,[contenteditable="true"]')) canvasRoot.value?.focus({ preventScroll: true }); }
function fit() { void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 180 }); }
async function arrangeGraph() { if (!ready.value || props.busy) return; try { await getCanvasContext().call({ name: "arrangeCanvas", args: {} }); notice.value = "画布已按连接关系排列，可撤销。"; } catch (cause) { notice.value = directorError(cause); } }
function initializeView() { if (!ready.value || viewInitialized || !nodes.value.length || flow.getNodes.value.some(node => !node.dimensions.width)) return; viewInitialized = true; void flow.fitView({ padding: 0.2, maxZoom: 0.9, minZoom: 0.35, duration: 0 }); }
function outgoingCount(id: string) { return edges.value.filter(edge => edge.source === id).length; }
function collectInputs(targetId: string) {
  const texts: string[] = []; const assets: InputAsset[] = []; const missing: string[] = []; const visited = new Set<string>();
  if (graph.value.nodes.find(node => node.id === targetId)?.generation?.referenceOnly) {
    for (const edge of edges.value.filter(edge => edge.target === targetId)) {
      const data = nodeData(edge.source); if (data?.kind !== "image") continue;
      if (!data.asset) { missing.push(data.title); continue; }
      if (!assets.some(asset => asset.path === data.asset!.path)) assets.push({ ...data.asset, kind: "image" });
    }
    return { text: "", assets, missing };
  }
  function read(id: string, collectMedia: boolean) {
    if (visited.has(id)) return; visited.add(id);
    for (const edge of edges.value.filter(edge => edge.target === id)) {
      read(edge.source, false); const data = nodeData(edge.source); if (!data) continue;
      const text = data.kind === "text" ? data.text.trim() : ""; if (text && !texts.includes(text)) texts.push(text);
      const media = data.shot ? version(data.shot).clip || version(data.shot).keyframe : data.asset;
      if (collectMedia && media && !assets.some(asset => asset.path === media.path)) assets.push({ path: media.path, mimeType: media.mimeType, kind: media.mimeType.startsWith("video/") ? "video" : "image" });
      if (collectMedia && (data.kind === "image" || data.kind === "video" || data.kind === "shot") && !media) missing.push(data.title);
    }
  }
  // 文字可沿依赖传递；视觉参考取直接相连的输出，避免把生成结果的原参考图误作另一份首帧。
  read(targetId, true);
  return { text: texts.join("\n\n"), assets, missing };
}
const inputBundle = computed(() => selectedShot.value ? collectInputs(`shot:${selectedShot.value.id}`) : { text: "", assets: [] as InputAsset[], missing: [] as string[] });
const chosenInputAsset = computed(() => inputBundle.value.assets.length === 1 ? inputBundle.value.assets[0] : inputBundle.value.assets.find(asset => asset.path === inputAssetPath.value));
const inputIssue = computed(() => inputBundle.value.missing.length ? `上游「${inputBundle.value.missing[0]}」尚无素材，请先导入或生成。` : inputBundle.value.text.length > 8000 ? "连接文字超过镜头描述上限，请精简后再应用。" : inputBundle.value.assets.length > 1 && !chosenInputAsset.value ? "连接了多份素材，请明确选择本次用于镜头的一份。" : "");
const inputSignature = computed(() => JSON.stringify({ text: inputBundle.value.text || "", asset: chosenInputAsset.value || null }));
const inputsApplied = computed(() => {
  const shot = selectedShot.value; if (!shot || inputIssue.value || (!inputBundle.value.text && !chosenInputAsset.value)) return false;
  try { const record = JSON.parse(graph.value.appliedInputs[shot.id] || "null"); return record?.signature === inputSignature.value && record.versionId === shot.currentVersionId; }
  catch { return false; }
});
function applyInputs() { if (!selectedShot.value || props.busy || selectedShot.value.locked || inputIssue.value) return; emit("applyInputs", { shotId: selectedShot.value.id, signature: inputSignature.value, ...(inputBundle.value.text ? { text: inputBundle.value.text } : {}), ...(chosenInputAsset.value ? { asset: chosenInputAsset.value } : {}) }); }
function confirmApplied(shotId: string, signature: string, versionId: string) {
  if (!props.project.shots.some(shot => shot.id === shotId) || !ready.value) return;
  graph.value.appliedInputs[shotId] = JSON.stringify({ signature, versionId }); changed();
}
const selectedGenerationTask = computed(() => selectedFree.value ? generationTask(selectedFree.value.id) : undefined);
const generationPending = computed(() => !!selectedFree.value && taskPending(selectedFree.value.id));
const generationInputs = computed(() => selectedFree.value?.generation ? collectInputs(selectedFree.value.id) : { text: "", assets: [] as InputAsset[], missing: [] as string[] });
const generationReference = computed(() => {
  const connected = generationInputs.value.assets.length === 1 ? generationInputs.value.assets[0] : generationInputs.value.assets.find(asset => asset.path === selectedFree.value?.generation?.referencePath);
  if (connected || generationInputs.value.assets.length) return connected;
  const frame = selectedFree.value?.kind === "video" ? scopeVersion.value?.keyframe : undefined;
  return frame ? { ...frame, kind: "image" as const } : undefined;
});
const productionScript = computed(() => props.project.production?.scriptVersions.find(script => script.id === props.project.production?.currentScriptVersionId));
const generationScope = computed(() => selectedFree.value?.generation?.scope);
const generationScopeKey = computed(() => { const scope = generationScope.value; return scope ? `${scope.kind}:${scope.kind === "shot" ? scope.shotId : scope.kind === "character" ? scope.characterId : scope.sceneId}` : ""; });
const scopeShot = computed(() => { const scope = generationScope.value; return scope?.kind === "shot" ? props.project.shots.find(shot => shot.id === scope.shotId) : undefined; });
const scopeVersion = computed(() => { const scope = generationScope.value; return scope?.kind === "shot" ? scopeShot.value?.versions.find(version => version.id === scope.versionId) : undefined; });
const scopeAssetHint = computed(() => generationScope.value?.kind === "character" || generationScope.value?.kind === "scene" ? "参考图先生成候选。采用后在制作流程中核验来源，再确认用于镜头。" : selectedFree.value?.kind === "video" && scopeVersion.value?.keyframe && !generationInputs.value.assets.length ? "本次使用所绑定镜头的关键帧作为首帧。" : "");
function changeGenerationScope(key: string) {
  const [kind, id] = key.split(":"); const workflow = props.project.production;
  if (!workflow) return;
  let scope: DirectorGenerationInput["scope"];
  if (kind === "shot") { const shot = props.project.shots.find(shot => shot.id === id); if (shot) scope = { kind, shotId: shot.id, versionId: shot.currentVersionId }; }
  if (kind === "character") { const character = workflow.characters.find(character => character.id === id); if (character) scope = { kind, characterId: character.id, revision: character.revision }; }
  if (kind === "scene" && productionScript.value?.scenes.some(scene => scene.id === id)) scope = { kind, sceneId: id!, scriptVersionId: productionScript.value.id };
  updateGeneration({ scope });
  if (scope?.kind === "shot" && !draftText.value.trim()) loadShotGeneration();
}
function loadShotGeneration() {
  const node = selectedFree.value; const shot = scopeShot.value; if (!node?.generation || !shot || props.busy || generationPending.value) return;
  const adopted = version(shot);
  updateGeneration({ scope: { kind: "shot", shotId: shot.id, versionId: adopted.id }, model: props.project.models[node.kind as "image" | "video"], ratio: props.project.ratio, duration: adopted.duration + (adopted.trimStart || 0) > 5 ? 10 : 5 });
  draftText.value = adopted.description; saveFree();
}

function referenceLabel(path: string) { return graph.value.nodes.find(node => node.asset?.path === path)?.title || "镜头参考素材"; }
function generationInputState(id: string): "unchanged" | "changed" | "referenceUnknown" {
  const node = graph.value.nodes.find(node => node.id === id);
  if (!node?.generation || !node.asset) return "unchanged";
  const task = props.project.tasks.find(item => item.nodeId === id && item.output?.path === node.asset?.path);
  if (!task?.generation) return "unchanged";
  const inputs = collectInputs(id);
  const scope = node.generation.scope;
  const boundFrame = scope?.kind === "shot" && node.kind === "video" ? props.project.shots.find(shot => shot.id === scope.shotId)?.versions.find(version => version.id === scope.versionId)?.keyframe : undefined;
  const reference = inputs.assets.length === 1 ? inputs.assets[0] : inputs.assets.length ? inputs.assets.find(asset => asset.path === node.generation?.referencePath) : boundFrame;
  type ComparableInput = { nodeId: string; kind: string; prompt: string; reference?: { path: string }; scope?: DirectorGenerationInput["scope"]; model?: { providerId: string; modelId: string; resolution?: string; size?: string }; ratio: string; duration?: number };
  const normalize = (input: ComparableInput, includeReference = true) => JSON.stringify({ nodeId: input.nodeId, kind: input.kind, prompt: input.prompt, scope: input.scope, referencePath: includeReference ? input.reference?.path || "" : undefined, providerId: input.model?.providerId, modelId: input.model?.modelId, resolution: input.model?.resolution || "", size: input.model?.size || "", ratio: input.ratio, duration: input.kind === "video" ? input.duration : undefined });
  const current = { nodeId: node.id, kind: node.kind, prompt: [inputs.text, node.id === selectedNodeId.value ? draftText.value.trim() : node.text.trim()].filter(Boolean).join("\n\n"), reference, scope: node.generation.scope, model: node.generation.model, ratio: node.generation.ratio, duration: node.generation.duration };
  let original: ComparableInput | undefined;
  if (node.generation.requestId === task.requestId && node.generation.inputSignature) {
    try {
      const saved = JSON.parse(node.generation.inputSignature) as ComparableInput | null;
      if (saved && normalize(saved, false) === normalize(task.generation, false) && Boolean(saved.reference) === Boolean(task.generation.reference) && (!saved.reference || typeof saved.reference.path === "string")) original = saved;
    } catch { /* 旧快照不可用时只判断已知字段，不猜测原始参考路径。 */ }
  }
  const baseline = original || task.generation;
  if (inputs.missing.length > 0 || normalize(baseline, false) !== normalize(current, false) || Boolean(baseline.reference) !== Boolean(reference)) return "changed";
  if (normalize(baseline) === normalize(current)) return "unchanged";
  // 服务端复制的不可变参考路径是任务执行位置，不能当作用户更换了输入。
  return original ? "changed" : "referenceUnknown";
}
function generationChanged(id: string) { return generationInputState(id) === "changed"; }
const generationModels = computed(() => (props.mediaModels || []).filter(model => model.type === selectedFree.value?.kind));
function modelKey(model: { providerId: string; modelId: string }) { return `${model.providerId}:${model.modelId}`; }
const selectedModelKey = computed(() => selectedFree.value?.generation?.model ? modelKey(selectedFree.value.generation.model) : "");
const selectedModel = computed(() => generationModels.value.find(model => modelKey(model) === selectedModelKey.value));
const generationRatios = computed(() => { const supported = selectedModel.value?.imageRatios?.filter(value => ["16:9", "9:16", "1:1"].includes(value)); return supported?.length ? supported : ["16:9", "9:16", "1:1"]; });
const generationDurations = computed(() => { const supported = selectedModel.value?.durationResolutionMap?.flatMap(item => item.duration).filter(value => value === 5 || value === 10); return supported?.length ? [...new Set(supported)] : [5, 10]; });
const generationResolutions = computed(() => [...new Set(selectedModel.value?.durationResolutionMap?.filter(item => item.duration.includes(selectedFree.value?.generation?.duration || 5)).flatMap(item => item.resolution) || [])]);
const referenceResult = computed(() => props.project.tasks.find(task => task.nodeId === selectedFree.value?.id && task.output?.path === selectedFree.value?.asset?.path && task.stage === "image" && ["character", "scene"].includes(task.generation?.scope?.kind || "")));
const generationResults = computed(() => selectedFree.value?.generation ? props.project.tasks.filter(task => task.nodeId === selectedFree.value?.id && task.status === "succeeded" && task.output).slice(-12).reverse() : []);
const generationIssue = computed(() => {
  if (!ready.value || error.value) return error.value || "画布尚未载入。";
  if (selectedGenerationTask.value?.status === "verificationRequired") return "上次提交的结果待核对，请在顶部任务面板查询恢复后再生成。";
  if (props.project.production) {
    const scope = generationScope.value;
    if (!scope) return "先选择本次生成用于哪个角色、场景或镜头。";
    if (!productionScript.value?.confirmedAt) return "请先在制作流程中确认当前剧本。";
    if (scope.kind === "character") {
      const character = props.project.production.characters.find(character => character.id === scope.characterId);
      if (!character?.confirmedAt || character.revision !== scope.revision) return "角色设定未确认或已更新，请确认后重新选择角色。";
    } else if (scope.kind === "scene") {
      if (scope.scriptVersionId !== productionScript.value.id || !productionScript.value.scenes.some(scene => scene.id === scope.sceneId)) return "场景已变更，请重新选择当前剧本的场景。";
    } else {
      if (!scopeShot.value || !scopeVersion.value) return "绑定镜头已变更，请重新选择。";
      if (scopeShot.value.locked) return "这个镜头已锁定，请先解锁。";
      if (props.generationIssues?.length) return props.generationIssues[0]!.message;
      const missingCharacter = props.project.production.characters.find(character => scopeVersion.value?.characterIds?.includes(character.id) && (!character.referenceImage || character.referenceImage.rights === "unverified"));
      if (missingCharacter) return `请先为「${missingCharacter.name}」绑定参考图并核验来源，再生成镜头。`;
      if (scope.versionId !== scopeShot.value.currentVersionId) return "镜头已切换版本，请载入当前镜头参数；候选生成可在审片面板操作。";
      if ([generationInputs.value.text, draftText.value.trim()].filter(Boolean).join("\n\n") !== scopeVersion.value.description) return "镜头生成需使用已确认描述。请载入镜头参数；改稿先应用到镜头并确认分镜。";
      const projectModel = props.project.models[selectedFree.value!.kind as "image" | "video"];
      if (["providerId", "modelId", "resolution", "size"].some(key => (selectedFree.value?.generation?.model as Record<string, string> | undefined)?.[key] !== (projectModel as Record<string, string> | undefined)?.[key]) || selectedFree.value?.generation?.ratio !== props.project.ratio) return "镜头生成需与项目模型及画幅一致，请载入当前镜头参数。";
    }
  }
  if (!selectedModel.value) return "请先选择已接入的生成模型。";
  if (!props.configuredProviders?.includes(selectedModel.value.providerId)) return "该模型的 API 尚未配置，填写后即可生成。";
  if (!generationRatios.value.includes(selectedFree.value?.generation?.ratio || "")) return "当前模型不支持这个画幅，请重新选择。";
  if (selectedFree.value?.kind === "video" && !generationDurations.value.includes(selectedFree.value.generation!.duration)) return "当前模型不支持这个时长，请重新选择。";
  const resolution = selectedFree.value?.generation?.model?.resolution;
  if (resolution && generationResolutions.value.length && !generationResolutions.value.includes(resolution)) return "该时长不支持当前分辨率，请重新选择。";
  if (generationInputs.value.missing.length) return `参考「${generationInputs.value.missing[0]}」尚无素材，请先完成上游节点。`;
  if (generationInputs.value.assets.length > 1 && !generationReference.value) return "连接了多个参考，请点击选中本次使用的一份。";
  if (selectedFree.value?.kind === "video" && generationReference.value?.kind !== "image") return "当前视频接入需要一张首帧图片，请连接或上传参考图。";
  const prompt = [generationInputs.value.text, draftText.value.trim()].filter(Boolean).join("\n\n");
  if (!prompt) return "填写提示词，或连接一个文字节点。";
  if (prompt.length > 12000) return "合并后的提示词超过 12000 字，请精简上游文字。";
  return "";
});
function updateGeneration(patch: Partial<CreativeGeneration>) {
  const node = selectedFree.value; if (!node?.generation || props.busy || generationPending.value) return;
  remember(); node.generation = { ...node.generation, ...patch }; renderNodes(); changed();
}
function chooseGenerationReference(path: string) { updateGeneration({ referencePath: path }); }
function changeGenerationModel(key: string) {
  const model = generationModels.value.find(item => modelKey(item) === key); if (!model) return;
  const old = selectedFree.value?.generation; if (!old) return;
  const allowed = model.imageRatios?.filter(value => ["16:9", "9:16", "1:1"].includes(value));
  const durations = model.durationResolutionMap?.flatMap(item => item.duration).filter(value => value === 5 || value === 10);
  updateGeneration({ model: { providerId: model.providerId, modelId: model.modelId, ...(model.imageSizes?.[0] ? { size: model.imageSizes[0] } : {}) }, ratio: allowed?.length && !allowed.includes(old.ratio) ? allowed[0] as CreativeGeneration["ratio"] : old.ratio, duration: durations?.length && !durations.includes(old.duration) ? durations[0] as 5 | 10 : old.duration });
}
function changeGenerationResolution(value: string) { const model = selectedFree.value?.generation?.model; if (model) updateGeneration({ model: { ...model, resolution: value || undefined } }); }
function useGenerationResult(asset: DirectorAsset) {
  const node = selectedFree.value; if (!node?.generation || props.busy || !asset.mimeType.startsWith(`${node.kind}/`)) return;
  remember(); node.asset = { path: asset.path, mimeType: asset.mimeType }; renderNodes(); changed();
}
function addSelectedToTimeline(targetShotId?: string) {
  const node = selectedFree.value; if (!node?.asset || node.kind === "text" || props.busy) return;
  const task = props.project.tasks.find(item => item.nodeId === node.id && item.output?.path === node.asset?.path);
  emit("addToTimeline", { title: node.title, kind: node.kind, asset: { ...node.asset }, sourceNodeId: node.id, sourceInputHash: task?.inputHash || node.asset.path, ...(task ? { sourceTaskId: task.id } : {}), ...(targetShotId ? { targetShotId } : {}), ...(node.generation ? { duration: task?.generation?.duration || node.generation.duration } : node.kind === "image" ? { duration: 5 } : {}) });
}
async function submitGeneration() {
  const node = selectedFree.value; if (!node?.generation || node.kind === "text" || !selectedModel.value || generationIssue.value || props.busy || generationPending.value) return;
  saveFree();
  const reference = generationReference.value;
  const input = { nodeId: node.id, kind: node.kind, ...(node.generation.scope ? { scope: node.generation.scope } : {}), prompt: [generationInputs.value.text, node.text.trim()].filter(Boolean).join("\n\n"), ...(reference ? { reference: { path: reference.path, mimeType: reference.mimeType } } : {}), model: { ...node.generation.model! }, ratio: node.generation.ratio, ...(node.kind === "video" ? { duration: node.generation.duration } : {}) };
  const signature = JSON.stringify(input); const previous = props.project.tasks.find(task => task.requestId === node.generation?.requestId);
  if (node.generation.inputSignature !== signature || !node.generation.requestId || previous && ["succeeded", "failed", "interrupted", "cancelled"].includes(previous.status)) node.generation.requestId = crypto.randomUUID();
  node.generation.inputSignature = signature; changed();
  try { await flushSave(); if (props.directory && graph.value.nodes.some(item => item.id === node.id)) emit("generateNode", { ...input, kind: node.kind, requestId: node.generation.requestId! }); }
  catch (cause) { notice.value = directorError(cause); }
}
function syncGenerationResults() {
  let modified = false;
  for (const node of graph.value.nodes) {
    if (!node.generation) continue;
    const task = props.project.tasks.findLast(task => task.nodeId === node.id && task.status === "succeeded" && task.output && !task.cancelRequested);
    if (!task?.output || task.id === node.generation.lastOutputTaskId) continue;
    node.generation.lastOutputTaskId = task.id; node.asset = { path: task.output.path, mimeType: task.output.mimeType }; modified = true;
  }
  if (modified) { renderNodes(); changed(); }
}
function chooseReferenceUpload() { if (!selectedFree.value?.generation) return; uploadDirectory = props.directory; referenceTargetId = selectedFree.value.id; uploadNodeId = ""; uploadShotId = ""; uploadKind.value = "image"; uploadInput.value?.click(); }
function chooseUpload(id: string, kind: CreativeKind) { if (kind === "text") return; uploadDirectory = props.directory; referenceTargetId = ""; uploadNodeId = id; uploadShotId = ""; uploadKind.value = kind; uploadInput.value?.click(); }
function chooseShotImport(kind: "image" | "video") { if (!selectedShot.value) return; uploadDirectory = props.directory; referenceTargetId = ""; uploadNodeId = ""; uploadShotId = selectedShot.value.id; uploadKind.value = kind; uploadInput.value?.click(); }
async function uploadMedia(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ""; if (!file || props.busy || uploading.value) return;
  if (uploadDirectory !== props.directory) { notice.value = "项目已经切换，请在当前项目重新选择素材。"; return; }
  if (!file.type.startsWith(`${uploadKind.value}/`)) { notice.value = `请选择${kindLabel(uploadKind.value)}文件。`; return; }
  const directory = props.directory; const id = uploadNodeId; const shotId = uploadShotId; const targetId = referenceTargetId; const token = generation;
  if (shotId) { const shot = props.project.shots.find(item => item.id === shotId); if (shot) emit("attach", shot, uploadKind.value, file); return; }
  uploading.value = true;
  try {
    const asset = await uploadDirectorFile(directory, file); if (props.directory !== directory || token !== generation) return;
    if (targetId) {
      const target = graph.value.nodes.find(node => node.id === targetId); if (!target?.generation) return;
      if (graph.value.nodes.length >= 150 || graph.value.edges.length >= 400) throw new Error("当前画布节点或连线已达上限。");
      remember(); const referenceId = crypto.randomUUID(); const position = openPosition({ x: target.position.x - 340, y: target.position.y }, "image");
      graph.value.nodes.push({ id: referenceId, kind: "image", title: file.name.slice(0, 120), text: "", asset, position }); graph.value.positions[referenceId] = position; graph.value.edges.push({ id: crypto.randomUUID(), source: referenceId, target: targetId }); target.generation.referencePath = asset.path;
    } else {
      const target = graph.value.nodes.find(node => node.id === id); if (!target) return; remember(); target.asset = asset; const previousTitle = target.title; if (/^(图片|视频) \d+$/.test(target.title)) target.title = file.name.slice(0, 120); if (selectedNodeId.value === id && draftTitle.value === previousTitle) draftTitle.value = target.title;
    }
    renderNodes(); changed(); notice.value = targetId ? "参考图已上传并连接。" : "素材已导入，连接到镜头后可应用。";
  }
  catch (cause) { if (directory === props.directory && token === generation) notice.value = directorError(cause); }
  finally { if (token === generation) uploading.value = false; }
}
const configureNodeParameters = { type: "object", additionalProperties: false, properties: { title: { type: "string", minLength: 1, maxLength: 120 }, prompt: { type: "string", maxLength: 6000 }, model: { type: "object", additionalProperties: false, required: ["providerId", "modelId"], properties: { providerId: { type: "string", minLength: 1, maxLength: 160 }, modelId: { type: "string", minLength: 1, maxLength: 200 }, resolution: { type: "string", maxLength: 100 }, size: { type: "string", maxLength: 100 } } }, ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] }, duration: { type: "number", enum: [5, 10] } } };
function readNodeConfiguration(input: Record<string, unknown>) {
  const result: { title?: string; prompt?: string; model?: NonNullable<CreativeGeneration["model"]>; ratio?: CreativeGeneration["ratio"]; duration?: 5 | 10 } = {};
  if (Object.keys(input).some(key => !Object.hasOwn(configureNodeParameters.properties, key))) throw new Error("节点配置包含未知字段。");
  for (const [key, limit] of [["title", 120], ["prompt", 6000]] as const) if (input[key] !== undefined) { if (typeof input[key] !== "string" || input[key].length > limit || key === "title" && !input[key].trim()) throw new Error("节点名称或提示词无效。"); result[key] = key === "title" ? input[key].trim() : input[key]; }
  if (input.ratio !== undefined) { if (!["16:9", "9:16", "1:1"].includes(String(input.ratio))) throw new Error("画幅无效。"); result.ratio = input.ratio as CreativeGeneration["ratio"]; }
  if (input.duration !== undefined) { if (input.duration !== 5 && input.duration !== 10) throw new Error("时长应为 5 或 10 秒。"); result.duration = input.duration; }
  if (input.model !== undefined) {
    if (!input.model || typeof input.model !== "object" || Array.isArray(input.model)) throw new Error("模型配置无效。");
    const model = input.model as Record<string, unknown>;
    if (Object.keys(model).some(key => !["providerId", "modelId", "resolution", "size"].includes(key)) || typeof model.providerId !== "string" || !model.providerId || model.providerId.length > 160 || typeof model.modelId !== "string" || !model.modelId || model.modelId.length > 200) throw new Error("模型配置无效。");
    result.model = { providerId: model.providerId, modelId: model.modelId };
    for (const key of ["resolution", "size"] as const) if (model[key] !== undefined) { if (typeof model[key] !== "string" || model[key].length > 100) throw new Error("模型规格无效。"); result.model[key] = model[key]; }
  }
  return result;
}
function configurableNode(id: string) {
  const node = graph.value.nodes.find(item => item.id === id);
  if (!node) throw new Error("镜头业务内容请通过导演改稿处理；画布工具只编辑自由节点。");
  if (taskPending(id) || generationTask(id)?.status === "verificationRequired") throw new Error("此节点有进行中或待核对任务，请先处理任务。");
  return node;
}
function nodeToolInfo(node: CreativeNode): NodeToolInfo {
  return { nodeId: node.id, nodeLabel: node.title, name: "node:configure", description: "更新节点名称、文字或生成配置，仅准备任务，不调用模型。prompt 是文本内容或生成提示词。model 必须来自节点 data.availableModels。确认生成由用户在节点中点击。", parameters: configureNodeParameters };
}
function queryNodes() {
  return nodes.value.map(node => {
    const data = node.data!; const type = data.kind === "shot" ? "shot" : data.generation ? data.kind === "image" ? "generateImage" : "generateVideo" : data.kind;
    const asset = data.shot ? version(data.shot).clip || version(data.shot).keyframe : data.asset;
    return { id: node.id, type, position: node.position, selected: node.selected, data: { label: data.title, prompt: data.text, generation: data.generation || null, handles: [...(data.kind !== "text" ? [{ id: "input", type: "target" }] : []), { id: "output", type: "source" }], outputs: asset || {}, ...(data.generation ? { availableModels: (props.mediaModels || []).filter(model => model.type === data.kind).map(model => ({ providerId: model.providerId, modelId: model.modelId, label: model.label, configured: !!props.configuredProviders?.includes(model.providerId), ratios: model.imageRatios, durationResolutionMap: model.durationResolutionMap })) } : {}), ...(data.shot ? { shotId: data.shot.id, locked: data.shot.locked, versionId: data.shot.currentVersionId, readOnly: true } : {}) } };
  });
}
function getCanvasContext(): CanvasContext {
  if (contextCache?.token === generation) return contextCache.value;
  const token = generation; const directory = props.directory; const canvasId = `creative:${props.project.id}`; const bindingSignal = canvasAborter.signal;
  function guard(signal?: AbortSignal) { bindingSignal.throwIfAborted(); signal?.throwIfAborted(); if (token !== generation || props.directory !== directory || !ready.value) throw new Error("创作画布已切换或尚未就绪，请重新查询。"); }
  function requireNode(id: string) { const node = nodes.value.find(item => item.id === id); if (!node) throw new Error(`节点不存在：${id}`); return node; }
  const nodeTools = {
    get tools() { return graph.value.nodes.map(nodeToolInfo); }, get version() { return saveCounter; },
    *list(ids: string[], names?: string[]) { for (const node of graph.value.nodes) if (ids.includes(node.id) && (!names || names.includes("node:configure"))) yield nodeToolInfo(node); },
    async call(request: { nodeId: string; name: `node:${string}`; args: Record<string, unknown> }, signal?: AbortSignal) {
      guard(signal); if (request.name !== "node:configure") throw new Error("此节点没有该函数，请查询 getNodeTools。");
      const node = configurableNode(request.nodeId); const args = readNodeConfiguration(request.args);
      if (!node.generation && (args.model || args.ratio || args.duration)) throw new Error("导入素材节点没有生成配置，请新建生成节点。");
      if (args.model && !(props.mediaModels || []).some(model => model.providerId === args.model!.providerId && model.modelId === args.model!.modelId && model.type === node.kind)) throw new Error("模型不可用，请先读取节点的 availableModels。");
      remember(); if (args.title) node.title = args.title; if (args.prompt !== undefined) node.text = args.prompt;
      if (node.generation) node.generation = { ...node.generation, ...(args.model ? { model: args.model } : {}), ...(args.ratio ? { ratio: args.ratio } : {}), ...(args.duration ? { duration: args.duration } : {}) };
      if (selectedNodeId.value === node.id) { draftTitle.value = node.title; draftText.value = node.text; }
      renderNodes(); changed(); return { nodeId: node.id, prepared: true, generationSubmitted: false, message: "配置已更新，用户可在节点中确认生成。" };
    },
  };
  const readCanvas = createCanvasQueries({ nodes: queryNodes, edges: () => edges.value, findNode: id => queryNodes().find(node => node.id === id), viewport: () => flow.viewport.value, selectedCount: () => flow.getSelectedNodes.value.length, nodeRevision: () => saveCounter + props.project.revision, edgeRevision: () => saveCounter, canvases: async () => [{ id: canvasId, name: props.project.title }], nodeTypes: () => createItems.map(item => ({ type: item.type, label: item.label })), nodeTools: () => nodeTools });
  const context: CanvasContext = {
    id: canvasId, tools: [], getNodeLabel: id => { const shot = props.project.shots.find(shot => `shot:${shot.id}` === id); return shot ? `第 ${shot.order} 镜 · ${version(shot).title}` : graph.value.nodes.find(node => node.id === id)?.title; },
    async call(request, signal) {
      guard(signal);
      if (isCanvasRead(request.name)) { const result = await readCanvas(request, canvasId, AbortSignal.any([bindingSignal, ...(signal ? [signal] : [])])); guard(signal); return result; }
      if (props.busy || uploading.value) throw new Error("项目正在保存或导入，请稍后再修改画布。");
      if (freeDirty.value) saveFree();
      let result: unknown;
      switch (request.name) {
        case "addNode": {
          const args = canvasSchemas.addNode.parse(request.args); const item = createItems.find(item => item.type === args.type); if (!item) throw new Error("未知节点类型，请先查询 getCanvas。");
          if (graph.value.nodes.length >= 150 || Math.abs(args.position.x) > 1000000 || Math.abs(args.position.y) > 1000000 || args.label && args.label.length > 120) throw new Error("节点数量、位置或名称超过画布限制。");
          remember(); const id = crypto.randomUUID();
          const node: CreativeNode = { id, kind: item.kind, title: args.label || item.label, text: "", position: args.position, ...(item.generate && item.kind !== "text" ? { generation: defaultGeneration(item.kind) } : {}) };
          graph.value.nodes.push(node); graph.value.positions[id] = args.position; renderNodes(); changed(); result = { node: { id, type: item.type, label: node.title, position: node.position } }; break;
        }
        case "moveNodes": {
          const { moves } = canvasSchemas.moveNodes.parse(request.args); moves.forEach(move => { requireNode(move.nodeId); if (Math.abs(move.position.x) > 1000000 || Math.abs(move.position.y) > 1000000) throw new Error("节点位置超出画布范围。"); });
          remember(); for (const move of moves) { requireNode(move.nodeId).position = { ...move.position }; graph.value.positions[move.nodeId] = { ...move.position }; const free = graph.value.nodes.find(node => node.id === move.nodeId); if (free) free.position = { ...move.position }; } changed(); result = { moves }; break;
        }
        case "renameNodes": {
          const { renames } = canvasSchemas.renameNodes.parse(request.args); const entries = renames.map(rename => { if (rename.label.length > 120) throw new Error("节点名称最多 120 字。"); return { node: configurableNode(rename.nodeId), label: rename.label }; });
          remember(); entries.forEach(({ node, label }) => { node.title = label; if (selectedNodeId.value === node.id) draftTitle.value = label; }); renderNodes(); changed(); result = { renamed: renames.length }; break;
        }
        case "connectNodes": {
          const { connections } = canvasSchemas.connectNodes.parse(request.args); const pending = edges.value.map(({ id, source, target }) => ({ id, source, target })); const added: string[] = [];
          for (const connection of connections) { requireNode(connection.source); requireNode(connection.target); if (connection.sourceHandle !== "output" || connection.targetHandle !== "input") throw new Error("连接端口应为 output → input。"); const issue = connectionIssue(connection.source, connection.target, undefined, pending); if (issue) throw new Error(issue); const id = crypto.randomUUID(); pending.push({ id, source: connection.source, target: connection.target }); added.push(id); }
          if (pending.length > 400) throw new Error("画布最多 400 条连线。"); remember(); graph.value.edges = pending; renderNodes(); changed(); result = { edgeIds: added }; break;
        }
        case "deleteNodes": {
          const { nodeIds } = canvasSchemas.deleteNodes.parse(request.args); nodeIds.forEach(configurableNode); const ids = new Set(nodeIds); const removed = edges.value.filter(edge => ids.has(edge.source) || ids.has(edge.target));
          remember(); graph.value.nodes = graph.value.nodes.filter(node => !ids.has(node.id)); graph.value.edges = edges.value.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)).map(({ id, source, target }) => ({ id, source, target })); for (const id of ids) delete graph.value.positions[id]; clearSelection(); renderNodes(); changed(); result = { nodeIds, removedEdgeCount: removed.length, removedEdgeIds: removed.slice(0, 100).map(edge => edge.id), truncated: removed.length > 100 }; break;
        }
        case "deleteEdges": {
          const { edgeIds } = canvasSchemas.deleteEdges.parse(request.args); edgeIds.forEach(id => { if (!edges.value.some(edge => edge.id === id)) throw new Error(`连线不存在：${id}`); });
          remember(); graph.value.edges = edges.value.filter(edge => !edgeIds.includes(edge.id)).map(({ id, source, target }) => ({ id, source, target })); renderNodes(); changed(); result = { edgeIds }; break;
        }
        case "selectNodes": {
          const { nodeIds } = canvasSchemas.selectNodes.parse(request.args); nodeIds.forEach(requireNode); clearSelection(); if (nodeIds.length === 1) selectNode(nodeIds[0]!); else { const ids = new Set(nodeIds); nodes.value.forEach(node => { node.selected = ids.has(node.id); }); } result = { nodeIds }; break;
        }
        case "fitCanvas": {
          const { nodeIds } = canvasSchemas.fitCanvas.parse(request.args); nodeIds?.forEach(requireNode); await flow.fitView({ ...(nodeIds ? { nodes: nodeIds } : {}), padding: 0.22, maxZoom: 1, duration: 180 }); result = { fitted: true, viewport: { ...flow.viewport.value }, nodeCount: nodeIds?.length ?? nodes.value.length }; break;
        }
        case "arrangeCanvas": {
          canvasSchemas.arrangeCanvas.parse(request.args); const levels = new Map<string, number>(); const pending = [...nodes.value];
          while (pending.length) { const index = pending.findIndex(node => edges.value.filter(edge => edge.target === node.id).every(edge => levels.has(edge.source))); if (index < 0) throw new Error("画布有循环，无法排列。"); const node = pending.splice(index, 1)[0]!; levels.set(node.id, Math.max(0, ...edges.value.filter(edge => edge.target === node.id).map(edge => (levels.get(edge.source) || 0) + 1))); }
          remember(); const rows = new Map<number, number>(); for (const node of nodes.value) { const level = levels.get(node.id)!; const row = rows.get(level) || 0; const position = { x: 100 + level * 355, y: 95 + row * 365 }; rows.set(level, row + 1); node.position = position; graph.value.positions[node.id] = position; const free = graph.value.nodes.find(item => item.id === node.id); if (free) free.position = position; } changed(); fit(); result = { arrangedCount: nodes.value.length }; break;
        }
        case "nodeTools": { const args = canvasSchemas.nodeTools.parse(request.args); result = await nodeTools.call(args, signal); break; }
        default: throw new Error("创作画布仅支持当前工程内的节点操作；创建项目请使用首页。");
      }
      guard(signal); if (!["selectNodes", "fitCanvas"].includes(request.name)) await flushSave(); guard(signal); return result;
    },
  };
  contextCache = { token, value: context }; return context;
}
async function whenReady() {
  if (!ready.value) {
    const signal = canvasAborter.signal;
    await new Promise<void>((resolve, reject) => {
      let stop = () => {};
      const finish = (cause?: unknown) => { clearTimeout(timer); stop(); signal.removeEventListener("abort", cancel); cause ? reject(cause) : resolve(); };
      const cancel = () => finish(signal.reason || new Error("画布已关闭。"));
      const timer = setTimeout(() => finish(new Error("画布载入超时，请重新打开项目。")), 15000);
      signal.addEventListener("abort", cancel, { once: true });
      stop = watch([ready, error], ([loaded, message]) => { if (loaded) finish(); else if (message) finish(new Error(message)); });
      if (ready.value) finish(); else if (error.value) finish(new Error(error.value)); else if (signal.aborted) cancel();
    });
  }
}
async function selectNodes(nodeIds: string[]) {
  await whenReady();
  return getCanvasContext().call({ name: "selectNodes", args: { nodeIds } });
}
async function focusNode(nodeId: string) {
  await selectNodes([nodeId]);
  viewInitialized = true;
  await revealNewNode(nodeId);
}
flow.onPaneClick(() => { menu.value = undefined; });
flow.onConnectEnd(event => {
  const handle = flow.connectionStartHandle.value; if (!handle || handle.type !== "source" || flow.connectionStatus.value === "valid" || !event || event.type === "touchcancel") return;
  const point = "changedTouches" in event ? event.changedTouches[0] : event; if (!point) return;
  const target = document.elementFromPoint(point.clientX, point.clientY); if (!target?.classList.contains("vue-flow__pane")) return;
  const token = generation; const x = point.clientX; const y = point.clientY; const source = handle.nodeId;
  requestAnimationFrame(() => { if (token === generation) openMenuAt(x, y, source); });
});
function onDoubleClick(event: MouseEvent) { if ((event.target as Element)?.classList.contains("vue-flow__pane")) openMenuAt(event.clientX, event.clientY); }
watch(() => props.directory, async (directory, _old, cleanup) => {
  resultPreviewVisible.value = false; resultPreview.value = undefined; resultEditVisible.value = false; resultInstruction.value = ""; downloadingResult.value = false;
  canvasAborter.abort(); canvasAborter = new AbortController(); const token = ++generation; const aborter = canvasAborter; cleanup(() => aborter.abort()); ready.value = false; error.value = ""; writer = undefined; graph.value = emptyCreativeGraph(); selectedNodeId.value = ""; dirty.value = false; undoStack.value = []; redoStack.value = []; viewInitialized = false; renderNodes(true);
  try {
    const result = await readCreativeGraph(directory, aborter.signal); if (token !== generation || aborter.signal.aborted) return;
    writer = result; graph.value = result.graph; renderNodes(true);
    const invalidEdge = edges.value.find(edge => connectionIssue(edge.source, edge.target, edge.id));
    if (invalidEdge) throw new Error("保存的画布包含不兼容或循环连线，已暂停编辑以保护文件，请恢复有效画布后重新打开。");
    if (edges.value.length !== graph.value.edges.length) notice.value = "已有镜头不存在，相关引用线未显示；原素材文件仍保留。";
    ready.value = true; syncGenerationResults(); await nextTick(); initializeView();
  }
  catch (cause) { if (!aborter.signal.aborted && token === generation) error.value = directorError(cause); }
}, { immediate: true });
watch(() => props.project.revision, () => { renderNodes(); if (ready.value) syncGenerationResults(); });
watch(() => props.selectedId, id => { if (id && selectedNodeId.value !== `shot:${id}` && !selectedFree.value) selectNode(`shot:${id}`); });
watch(canvasRoot, (element, _previous, cleanup) => { if (!element) return; element.addEventListener("dblclick", onDoubleClick); cleanup(() => element.removeEventListener("dblclick", onDoubleClick)); });
onBeforeUnmount(() => { if (saveTimer) clearTimeout(saveTimer); if (dirty.value && ready.value) void flushSave().catch(() => {}); canvasAborter.abort(); generation++; });
defineExpose({ flushSave, hasUnsavedChanges: () => dirty.value || uploading.value || freeDirty.value, confirmApplied, fit, getCanvasContext, selectNodes, focusNode, whenReady });
</script>

<style scoped lang="scss">
.resultPreviewMedia { height: min(68vh, 760px); min-height: 220px; aspect-ratio: auto; background: #101214; }
.usageBadge { margin: 0; padding: 6px 12px; border-top: 1px solid #30343b; color: #8fcba5; font-size: 10px; span { color: #e4bd77; } }
.usageSummary { margin: 4px 0 10px; color: #a3b5a9; font-size: 11px; span { color: #d3b880; } }
.usedShotActions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; button { border: 1px solid #41564a; border-radius: 5px; padding: 5px 8px; background: #28382e; color: #b0dfbe; font: inherit; font-size: 11px; cursor: pointer; &:disabled { opacity: .4; cursor: default; } } }

.creativeCanvas {
  position: relative; width: 100%; height: 100%; min-height: 420px; outline: none; overflow: hidden; background: #202124; color: #e5ebe7; --canvasAccent: #69e695;
  :deep(.vue-flow__node) { border: 0; background: none; padding: 0; box-shadow: none; }
  :deep(.vue-flow__handle) { width: 14px; height: 14px; background: #262f29; border: 2px solid #8fb89d; z-index: 4; &::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; background: transparent; } &:hover, &.connecting { background: #7eeeaa; border-color: #afffc9; box-shadow: 0 0 0 5px #70e99d1a; } }
  :deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: #a4ffc6; stroke-width: 2.5; }
  :deep(.vue-flow__selection) { background: #6bdf9220; border-color: #69dc97; }
  .creativeNode { width: 276px; border: 1px solid #444b46; border-radius: 14px; background: #292c2a; box-shadow: 0 10px 28px #0002; overflow: visible; transition: border-color .15s, box-shadow .15s; &.selected { border-color: #84e9a7; box-shadow: 0 0 0 2px #6ada9620, 0 16px 38px #0003; } .nodeHeading { height: 47px; display: flex; align-items: center; padding: 0 14px; gap: 9px; cursor: grab; color: #e1e8e2; .kindIcon { color: #a6b8aa; display: flex; } strong { min-width: 0; flex: 1; font-size: 12px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .nodeKind { color: #91a295; font-size: 9px; } .shotNumber { font: 11px ui-monospace, monospace; color: #93b19d; } } .textContent { min-height: 120px; padding: 2px 17px 17px; p { margin: 0; font-size: 12px; line-height: 1.9; color: #c7d0ca; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden; } } .nodeMedia { position: relative; height: 160px; margin: 0 10px; border-radius: 8px; overflow: hidden; background: #202322; :deep(.studioThumbnail.empty) { background: #242825; color: #8c9b90; .emptyMedia { padding-top: 35px; font-size: 11px; > svg { display: none; } } } .mediaEmptyIcon { position: absolute; top: 35px; left: calc(50% - 16px); pointer-events: none; color: #657b6c; } .durationBadge { position: absolute; top: 9px; right: 9px; background: #111a15c9; color: #e4ece7; border-radius: 5px; padding: 4px 6px; font: 10px ui-monospace, monospace; } .nodePlay { position: absolute; right: 10px; bottom: 10px; width: 31px; height: 31px; border: 0; border-radius: 50%; background: #f0f7f1; color: #31553e; display: flex; align-items: center; justify-content: center; cursor: pointer; } } .shotDescription { font-size: 11px; color: #aebfb3; line-height: 1.8; margin: 12px 14px; min-height: 40px; max-height: 60px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; } .nodeFooter { height: 36px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #3a423c; color: #9caf9f; font-size: 10px; > span:first-child { display: flex; align-items: center; gap: 5px; i { width: 4px; height: 4px; border-radius: 50%; background: #7ba288; } &.waiting { color: #93daa9; } } button { background: none; border: 0; color: #91a899; cursor: pointer; padding: 4px; } .versionTag { font: 10px ui-monospace, monospace; } } &.shotNode { width: 286px; .nodeMedia { height: 180px; } &.locked .nodeHeading > svg { color: #a5c1ae; } } }
  .nodeMedia :deep(.mediaPreview) { height: 100%; border-radius: 0; }
  .canvasCaption { position: absolute; top: 20px; left: 85px; display: flex; align-items: center; gap: 8px; pointer-events: none; strong { color: #d9e2dc; font-size: 12px; font-weight: 500; } > span:last-child { color: #85978c; font-size: 10px; margin-left: 6px; } .captionDot { background: #87dfa3; width: 5px; height: 5px; border-radius: 50%; } }
  .saveIndicator { position: absolute; right: 20px; top: 20px; color: #8fa597; font-size: 10px; display: flex; align-items: center; gap: 5px; pointer-events: none; i { width: 4px; height: 4px; border-radius: 50%; background: #76bb8d; } &.pending { color: #b3c6b8; } &.failed { color: #e8bc85; i { background: #e8bc85; } } }
  .creationTools { position: absolute; left: 17px; top: 64px; width: 42px; padding: 6px; border-radius: 14px; background: #242a26f2; border: 1px solid #3c4941; box-shadow: 0 5px 22px #0003; display: flex; align-items: center; flex-direction: column; gap: 3px; > button { background: none; border: 0; color: #b9c9be; display: flex; align-items: center; justify-content: center; width: 34px; height: 35px; cursor: pointer; border-radius: 8px; &:hover:not(:disabled) { background: #3b4b40; color: #dbf4e3; } &:disabled { opacity: .35; cursor: default; } &.addButton { color: #182b1f; background: #7be7a0; } } > i { width: 20px; height: 1px; background: #3e4a42; margin: 5px 0; } }
  .createMenu { position: absolute; z-index: 12; width: 225px; border: 1px solid #495a4e; border-radius: 13px; background: #252d28fa; box-shadow: 0 18px 50px #0006; padding: 8px; > span { display: block; color: #8fa497; font-size: 10px; padding: 8px 9px; } > button { width: 100%; padding: 11px 9px; display: flex; gap: 12px; align-items: center; color: #dce9e0; background: none; border: 0; border-radius: 8px; cursor: pointer; text-align: left; &:hover { background: #3a5141; } > span { flex: 1; font-size: 12px; small { display: block; margin-top: 5px; font-size: 9px; color: #8ea795; } } > svg:last-child { color: #7eaa8c; } } p { color: #aebcb2; font-size: 11px; } }
  .canvasNavigation { position: absolute; left: 18px; bottom: 18px; border: 1px solid #405047; border-radius: 12px; background: #222b26ed; padding: 5px 6px; display: flex; align-items: center; gap: 3px; color: #a9c1b1; > button { display: flex; align-items: center; justify-content: center; width: 28px; height: 27px; border: 0; background: none; color: #bbd0c2; border-radius: 6px; cursor: pointer; &:hover { background: #3a4b40; } &:disabled { opacity: .3; cursor: default; } } > span { min-width: 35px; text-align: center; font: 10px ui-monospace, monospace; } > i { width: 1px; height: 15px; margin: 0 4px; background: #3c4e42; } }
  .nodeDock { position: absolute; z-index: 8; bottom: 18px; left: 50%; transform: translateX(-50%); width: min(760px, calc(100% - 160px)); border: 1px solid #496352; border-radius: 17px; background: #19231df7; box-shadow: 0 15px 55px #0005; backdrop-filter: blur(18px); padding: 15px 18px 11px; box-sizing: border-box; > header { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; > input { background: none; border: 0; color: #e2ede5; flex: 1; outline: none; font-size: 12px; min-width: 0; } > strong { flex: 1; min-width: 0; font-size: 12px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .dockIcon { display: flex; color: #9cdab0; } .dockType { margin-left: auto; color: #80a28c; font-size: 10px; } > button { background: none; border: 0; display: flex; color: #8aa493; cursor: pointer; padding: 3px; } } > textarea { box-sizing: border-box; width: 100%; resize: vertical; max-height: 200px; min-height: 65px; border: 0; background: none; outline: none; color: #d0dfd5; font-size: 12px; line-height: 1.85; font-family: inherit; &::placeholder { color: #75927f; } } > footer { display: flex; align-items: center; gap: 8px; color: #7e9b88; font-size: 9px; margin-top: 10px; > span { flex: 1; } } button { font-family: inherit; } .dockPrimary, .dockSecondary { display: inline-flex; gap: 6px; justify-content: center; align-items: center; border-radius: 7px; padding: 8px 11px; font-size: 10px; border: 1px solid transparent; cursor: pointer; white-space: nowrap; &:disabled { opacity: .35; cursor: default; } } .dockPrimary { background: #7ce49c; color: #173621; font-weight: 550; } .dockSecondary { background: #263c2d; border-color: #3a5a44; color: #b7d4c1; } .mediaDockBody { display: flex; align-items: center; gap: 12px; > div { flex: 1; min-width: 0; strong { font-size: 11px; font-weight: 500; color: #c0d5c7; } p { font-size: 10px; color: #7f9f8b; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; } } } .shotDockActions { display: flex; align-items: center; gap: 6px; > button:not(.dockPrimary):not(.dockSecondary) { display: flex; gap: 5px; align-items: center; padding: 8px 7px; border: 0; background: none; color: #b4cebe; font-size: 10px; cursor: pointer; &:disabled { opacity: .35; cursor: default; } } .actionSpacer { flex: 1; } } .configureLink { display: inline-flex; align-items: center; gap: 3px; background: none; border: 0; color: #9abda7; cursor: pointer; font-size: 9px; } .inputSummary { display: flex; align-items: center; gap: 9px; border: 1px solid #355440; border-radius: 9px; padding: 8px 10px; margin-bottom: 10px; > div { display: flex; align-items: center; gap: 6px; color: #a9d9b9; font-size: 10px; flex-wrap: wrap; flex: 1; small { color: #7a9d86; font-size: 9px; } } select { max-width: 180px; color: #c6ddcf; background: #223729; border: 1px solid #48614f; border-radius: 5px; font-size: 10px; padding: 5px; } } .dockHint { color: #d8bd86; font-size: 10px; margin: 0 0 10px; } }
  .canvasNotice { position: absolute; top: 48px; left: 85px; right: 25px; width: fit-content; max-width: calc(100% - 130px); padding: 9px 12px; margin: 0; color: #bbd8c5; border: 1px solid #42624e; border-radius: 8px; font-size: 11px; background: #1f3528f5; z-index: 15; display: flex; align-items: center; gap: 14px; &.error { color: #e6c59e; border-color: #765e3e; background: #3a2e20f5; } button { background: none; color: inherit; border: 0; padding: 0; display: flex; cursor: pointer; } }
  .creativeNode {
    background: #24262a; border-color: #42454b;
    .nodeHeading { color: #eceef0; .kindIcon, .shotNumber { color: #a7aeb6; } .nodeKind { color: #9198a1; } }
    .nodeMedia { background: #17191c; :deep(.studioThumbnail.empty) { background: #202226; color: #8f969f; } .mediaEmptyIcon { color: #747c87; } }
    .textContent p, .shotDescription { color: #bec3ca; }
    .nodeFooter { border-color: #35383d; color: #a2a9b2; }
  }
  &.spacePanning :deep(.vue-flow__pane) { cursor: grab; }
  .creationTools, .canvasNavigation { background: #25282dec; border-color: #42474f; > button { color: #bfc5cd; &:hover:not(:disabled) { background: #383d44; } } > i { background: #464b54; } }
  .canvasNavigation > .arrangeButton { width: auto; gap: 5px; padding: 0 7px; font-size: 11px; white-space: nowrap; }
  .createMenu { background: #25282dfc; border-color: #494e57; > span { color: #9ca4ae; } > button { color: #e2e5e9; &:hover { background: #363c44; } > span { font-size: 13px; small { color: #9ca4ae; font-size: 11px; } } } }
  .nodeDock {
    background: #23262af7; border-color: #494f58; max-height: calc(100% - 90px); overflow-y: auto;
    > header > .downstreamButton { display: inline-flex; align-items: center; gap: 4px; flex: none; padding: 5px 7px; border: 1px solid #4a515b; border-radius: 6px; color: #c3d6ca; font-size: 11px; white-space: nowrap; &:hover:not(:disabled) { color: #82efa7; border-color: #82efa7; } &:disabled { opacity: .35; cursor: default; } }
    > header { > input, > strong { color: #edf0f3; font-size: 13px; } .dockType { color: #a5adb7; } }
    > textarea { color: #e0e4e9; font-size: 13px; &::placeholder { color: #929ba7; } }
    > footer { color: #9ca6b2; font-size: 11px; flex-wrap: wrap; }
    .dockPrimary, .dockSecondary { font-size: 12px; }
    .dockSecondary { color: #d5dbe3; background: #343a42; border-color: #4a515b; }
    .configureLink { color: #b5c0cb; font-size: 11px; }
    .mediaDockBody > div { strong { color: #d5dbe3; } p { color: #9ea7b2; } }
    .dockHint { color: #e8c695; font-size: 12px; line-height: 1.65; display: flex; align-items: center; gap: 12px; }
    .resultActions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 10px 0 12px; > button { display: inline-flex; align-items: center; gap: 5px; background: #303740; color: #d1dce5; border: 1px solid #4a5662; border-radius: 7px; padding: 7px 10px; font-size: 11px; cursor: pointer; &:hover:not(:disabled) { border-color: #81c99a; color: #d9f4e2; } &:disabled { opacity: .4; cursor: default; } } }
    .resultEdit { margin: 8px 0 14px; padding: 12px; border: 1px solid #476353; border-radius: 10px; background: #1d2922; > label { display: block; color: #c4d8ca; font-size: 12px; margin-bottom: 7px; } > textarea { box-sizing: border-box; display: block; width: 100%; min-height: 58px; max-height: 150px; resize: vertical; border: 1px solid #415a4a; border-radius: 7px; padding: 8px 10px; background: #162019; color: #e0ece4; font: inherit; font-size: 12px; line-height: 1.7; &::placeholder { color: #8a9f91; } } > div { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 9px; > span { flex: 1; color: #9eb4a6; font-size: 10px; line-height: 1.6; } > button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #486351; border-radius: 6px; padding: 6px 9px; background: #2a3d30; color: #d1e6d8; font-size: 11px; cursor: pointer; &[type="submit"] { background: #82dfa1; border-color: #82dfa1; color: #153020; } &:disabled { opacity: .4; cursor: default; } } } }
  }
  .generationDock {
    width: min(740px, calc(100% - 160px)); padding: 15px 18px; scrollbar-width: thin;
    .productionBinding { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 9px 0; color: #a9b6ad; font-size: 11px;
    label { display: flex; align-items: center; gap: 8px; }
    select { max-width: 280px; border: 1px solid #405047; border-radius: 7px; background: #242b27; color: #e2ece5; padding: 7px; }
    p { flex-basis: 100%; margin: 0; line-height: 1.5; }
  }
  .generationReferences { display: flex; gap: 8px; align-items: center; overflow-x: auto; padding: 2px 0 11px; > span { font-size: 11px; color: #9ca6b2; flex: none; } .referenceChip { display: flex; gap: 7px; align-items: center; max-width: 180px; border: 1px solid #4d5560; background: #292e35; color: #bec7d3; padding: 4px 8px 4px 4px; border-radius: 8px; cursor: pointer; > span { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } :deep(.studioThumbnail) { flex: none; width: 35px; height: 35px; border-radius: 4px; } &.active { border-color: #72db96; background: #29372f; } } .referenceAdd { height: 42px; display: flex; gap: 5px; align-items: center; flex: none; color: #b4bdc9; border: 1px dashed #59616d; background: transparent; border-radius: 8px; padding: 0 10px; cursor: pointer; font-size: 11px; } }
    > textarea { resize: vertical; min-height: 64px; max-height: 150px; }
    .upstreamText { color: #aab4bf; font-size: 11px; line-height: 1.6; display: flex; gap: 6px; margin: 3px 0 10px; > svg { flex: none; margin-top: 3px; } }
    .referenceModeHint { color: #a2bfad; font-size: 11px; line-height: 1.6; margin: 0 0 8px; }
    .generationSettings { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 7px; > label { display: flex; gap: 5px; align-items: center; min-width: 0; > span { color: #969fab; font-size: 10px; } select { background: #30353c; color: #dbe1e8; border: 1px solid #4a515c; border-radius: 7px; padding: 7px 8px; max-width: 230px; font-size: 12px; outline: none; } &:first-child { flex: 1; select { max-width: 100%; flex: 1; min-width: 140px; } } } }
    .generationResults { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding: 11px 0 3px; border-top: 1px solid #3a4049; margin-top: 12px; > span { color: #a3adb9; font-size: 11px; flex: none; } > button { width: 74px; flex: none; background: #292f35; border: 1px solid #48515b; border-radius: 8px; padding: 3px; cursor: pointer; color: #bdc6d2; &.active { border-color: #72db96; } :deep(.studioThumbnail) { width: 66px; height: 42px; border-radius: 5px; } > span { display: block; font-size: 10px; padding: 5px 0 3px; } } }
    > footer { border-top: 1px solid #3a4049; padding-top: 11px; margin-top: 12px; .dockPrimary { min-height: 35px; } }
  }
  .spinner { animation: canvasSpinner 1s linear infinite; }
  .fileInput { display: none; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid #82e7a5; outline-offset: 3px; }
}
@keyframes canvasSpinner { to { transform: rotate(360deg); } }
@media (max-width: 850px) { .creativeCanvas { .canvasCaption > span:last-child { display: none; } .nodeDock { left: 72px; right: 13px; transform: none; width: auto; bottom: 55px; padding-inline: 12px; .shotDockActions { flex-wrap: wrap; .actionSpacer { display: none; } } .inputSummary { flex-wrap: wrap; } } .saveIndicator { font-size: 9px; right: 12px; } } }
</style>
