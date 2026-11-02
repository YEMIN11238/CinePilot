export type CreativeIntent = "image" | "video" | "story" | "chat";

export function detectCreationIntent(prompt: string): CreativeIntent {
  // ACT: 仅对明确交付物做确定性分流；复杂或含糊要求交给助手，用户仍可手动选择任务类型。
  const text = prompt.trim().toLowerCase().replace(/(?:不要|无需|不需要|别生成)[^，。；\n]*/g, "");
  const singleImage = /(?:一张|一幅|单张|single\s+image).{0,24}(?:图|海报|封面|插画|照片|image|poster)|(?:海报|封面|角色立绘|头像|产品图|表情包)/.test(text);
  const imageToVideo = /图生视频|(?:让|把|用).{0,35}(?:动起来|动一动)|(?:然后|再|接着).{0,20}(?:视频|动画)/.test(text);
  if (singleImage && !imageToVideo) return "image";
  if (/剧本|分镜|多镜头|多个镜头|(?:\d+|[二两三四五六七八九十]+)\s*(?:个)?镜头|storyboard|screenplay|script/.test(text)) return "story";
  const story = /漫剧|短剧|剧情短片/.test(text);
  if (story && !singleImage) return "story";
  if (/图生视频|文生视频|生成.{0,30}(?:视频|动画)|(?:做|制作|剪|创作).{0,24}(?:视频|短片|动画)|动起来|动一动|image.to.video|text.to.video|(?:make|generate|create).{0,30}(?:video|animation)/.test(text)) return "video";
  if (singleImage || /生图|图生图|生成.{0,30}(?:图|照片)|(?:画|绘制|画出).{0,30}(?:猫|狗|图|人|风景|场景|角色)|(?:make|generate|create|draw).{0,30}(?:image|picture|photo|illustration)/.test(text)) return "image";
  if (/写.{0,16}(?:故事|剧情)|策划|故事创作/.test(text)) return "story";
  return "chat";
}
