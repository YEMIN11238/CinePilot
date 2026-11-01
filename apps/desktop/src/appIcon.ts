import { resolve } from "node:path";
import { dlopen, ptr } from "bun:ffi";
import { PATHS } from "electrobun/main";

function loadMacAppIcon() {
  return dlopen(resolve(PATHS.RESOURCES_FOLDER, "app/native/macAppIcon.dylib"), {
    applyNativeAppIcon: { args: ["ptr", "ptr"], returns: "bool" },
  });
}
let macAppIcon: ReturnType<typeof loadMacAppIcon> | undefined;

export default function configureAppIcon() {
  if (process.platform !== "darwin") return;
  try {
    const library = macAppIcon ??= loadMacAppIcon();
    const bundle = Buffer.from(`${resolve(PATHS.RESOURCES_FOLDER, "../..")}\0`);
    const image = Buffer.from(`${resolve(PATHS.VIEWS_FOLDER, "mainview/cinePilotIcon.png")}\0`);
    if (!library.symbols.applyNativeAppIcon(ptr(bundle), ptr(image))) console.warn("应用图标未能保存为自定义图标，已设置本次运行图标。");
  } catch (error) { console.warn("设置应用图标失败：", error); }
}
