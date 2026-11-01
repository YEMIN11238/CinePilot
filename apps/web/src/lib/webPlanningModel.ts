const modelSelections = new Map<string, string>();

function validModelSelection(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const model: unknown = JSON.parse(value);
    return Array.isArray(model) && model.length === 2 && model.every(item => typeof item === "string" && item.trim()) ? value : "";
  } catch { return ""; }
}

export function readWebPlanningModel(directory: string) {
  if (!directory) return "";
  if (modelSelections.has(directory)) return modelSelections.get(directory)!;
  try {
    const selection = validModelSelection(localStorage.getItem(`cinePilot.webPlanningModel:${directory}`));
    if (selection) modelSelections.set(directory, selection);
    return selection;
  } catch { return modelSelections.get(directory) || ""; }
}

export function saveWebPlanningModel(directory: string, value: string) {
  const selection = validModelSelection(value);
  if (!directory || !selection) return;
  modelSelections.set(directory, selection);
  try { localStorage.setItem(`cinePilot.webPlanningModel:${directory}`, selection); }
  catch { /* 浏览器存储不可用时，当前会话仍保留模型选择，不阻断已创建项目。 */ }
}
