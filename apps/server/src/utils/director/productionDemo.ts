import { randomUUID } from "node:crypto";
import type { DirectorCreateInput, ProductionWorkflow, ShotFields } from "@/lib/directorTypes";

export function productionDemoInput(): DirectorCreateInput {
  const lin = randomUUID(); const zhou = randomUUID(); const shelter = randomUUID(); const pier = randomUUID(); const scriptId = randomUUID();
  const production: ProductionWorkflow = {
    episode: 1, targetDuration: 30, shotCount: 6,
    characterConstraints: "林澜，23岁，黑色齐耳短发，灰绿色雨衣；周叔，55岁，短灰发，深蓝旧外套。林澜还不知道写信人身份，周叔知道父亲留下的约定。",
    invariants: "写信人身份保持悬念；林澜不能提前知道父亲的下落；铜怀表始终由周叔交给林澜。",
    currentScriptVersionId: scriptId,
    scriptVersions: [{ id: scriptId, number: 1, logline: "雨夜码头，一封来自失踪父亲的信，让林澜停在最后一班渡船前。", createdAt: new Date().toISOString(), scenes: [
      { id: shelter, title: "候船亭的来信", location: "外景 · 雾港候船亭 · 雨夜", action: "林澜捏着来信走进候船亭。周叔递给她父亲留下的铜怀表，提醒她先读完信。", dialogues: [{ speakerId: zhou, text: "你父亲说，开船前把这个交给你。" }] },
      { id: pier, title: "最后一班渡船", location: "外景 · 码头栈桥 · 同一雨夜", action: "林澜抬头望向鸣笛的渡船，停下脚步。周叔没有回答写信人的身份。", dialogues: [{ speakerId: lin, text: "这封信，究竟是谁写的？" }] },
    ] }],
    characters: [
      { id: lin, name: "林澜", appearance: "23岁女性，黑色齐耳短发，清瘦，深棕眼睛", costume: "灰绿色连帽雨衣，深色长裤，湿运动鞋", props: "牛皮纸信封；后半段持铜怀表", goal: "寻找失踪父亲，决定是否登上最后一班渡船", knownFacts: "知道父亲失踪；收到了父亲笔迹的信；不知道写信人的真实身份与父亲下落", revision: 1 },
      { id: zhou, name: "周叔", appearance: "55岁男性，短灰发，眼角细纹，身形结实", costume: "深蓝色旧外套，黑色胶靴", props: "交给林澜的铜怀表", goal: "按旧约把怀表交给林澜，让她先读完信", knownFacts: "认识林澜父亲；知道交付怀表的约定；此段不揭示写信人", revision: 1 },
    ], reviews: [],
  };
  const shots: ShotFields[] = [
    { title: "雾港夜色", description: "雨夜候船亭前，暖色灯光穿过薄雾，远处渡船停在码头。", camera: "大全景，缓慢推进", duration: 5, subtitle: "雾港 · 雨夜", sceneId: shelter, characterIds: [], startState: "空镜，渡船静泊", endState: "候船亭灯光进入画面中心", dialogues: [] },
    { title: "捏紧的来信", description: "林澜站在候船亭门口，低头捏紧湿润的牛皮纸信封。", camera: "中近景，固定机位", duration: 5, subtitle: "", sceneId: shelter, characterIds: [lin], startState: "林澜右手持信封", endState: "林澜抬头看向亭内", dialogues: [] },
    { title: "交付怀表", description: "周叔从深蓝旧外套口袋取出铜怀表，放入林澜空着的左手。", camera: "手部特写，固定机位", duration: 5, subtitle: "你父亲说，开船前把这个交给你。", sceneId: shelter, characterIds: [lin, zhou], startState: "周叔持铜怀表，林澜右手持信", endState: "林澜左手持怀表，右手仍持信", dialogues: [{ speakerId: zhou, text: "你父亲说，开船前把这个交给你。" }] },
    { title: "未说出口的疑问", description: "林澜看着掌心的铜怀表，雨衣帽沿落下水滴，她抬起目光。", camera: "面部近景，轻微推进", duration: 5, subtitle: "", sceneId: shelter, characterIds: [lin], startState: "林澜低头看左手怀表", endState: "林澜望向渡船方向", dialogues: [] },
    { title: "栈桥前的停步", description: "林澜在栈桥入口停下，转头向身后的周叔问话，右手仍紧握信封。", camera: "双人中景，侧面固定", duration: 5, subtitle: "这封信，究竟是谁写的？", sceneId: pier, characterIds: [lin, zhou], startState: "林澜面向栈桥，周叔在身后", endState: "林澜转头，周叔沉默", dialogues: [{ speakerId: lin, text: "这封信，究竟是谁写的？" }] },
    { title: "雾中的末班船", description: "渡船灯光在雾中亮起，栈桥雨水倒映暖光，故事停在尚未做出的选择。", camera: "远景，固定机位", duration: 5, subtitle: "待续", sceneId: pier, characterIds: [], startState: "渡船停泊，灯光模糊", endState: "雾加深，灯光仍停在原处", dialogues: [] },
  ];
  return { title: "雾港来信 · 漫剧演示", brief: "预置的30秒漫剧流程案例，用于体验剧本、角色、分镜确认与人工审片。此案例未调用图片或视频模型，角色参考图和镜头素材需自行导入或生成。", style: "写实漫剧，雨夜雾港，冷灰环境与暖色船灯，克制悬疑", ratio: "16:9", shots, production };
}
