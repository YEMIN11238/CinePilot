import { t } from "@toonflow/server/i18n";
import { execFile } from "node:child_process";
import { writeAtomic } from "@toonflow/file";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { PATHS } from "electrobun/main";
import { CString, dlopen, ptr } from "bun:ffi";

const execFileAsync = promisify(execFile);
// ACT: 同一桌面进程只显示一个保存对话框；后续若支持多窗口，可按窗口分别加锁。
let dialogOpen = false;
// 选好路径到实际写入之间用一次性 token 中转，不把绝对路径回传给前端。
const pendingSaves = new Map<string, { path: string; expiresAt: number }>();
const tokenTtlMs = 5 * 60 * 1000;

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of pendingSaves) if (entry.expiresAt <= now) pendingSaves.delete(token);
}

function loadMacDialog() {
  return dlopen(join(PATHS.RESOURCES_FOLDER, "app/native/macSaveFile.dylib"), {
    beginNativeSaveFile: { args: ["ptr"], returns: "ptr" },
    readNativeSaveFile: { args: ["ptr"], returns: "ptr" },
    closeNativeSaveFile: { args: ["ptr"], returns: "void" },
  });
}
let macDialog: ReturnType<typeof loadMacDialog> | undefined;

async function selectMacFile(fileName: string) {
  const library = macDialog ??= loadMacDialog();
  const name = Buffer.from(`${fileName}\0`);
  const handle = library.symbols.beginNativeSaveFile(ptr(name));
  if (!handle) throw new Error("无法打开保存窗口");
  try {
    // ACT: 保存面板属于应用主窗口，等待选择时保持 Bun 服务与后台任务运行。
    for (;;) {
      const result = library.symbols.readNativeSaveFile(handle);
      if (result) return new CString(result).toString();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    library.symbols.closeNativeSaveFile(handle);
  }
}

export async function selectSaveFile(fileName: string): Promise<string | null> {
  if (!fileName.trim() || fileName === "." || fileName === ".." || /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/.test(fileName)) {
    throw new Error(t`保存文件名无效，不能包含路径或控制字符`);
  }
  if (dialogOpen) throw new Error(t`已有保存窗口正在操作，请先完成或取消`);
  if (process.platform !== "win32" && process.platform !== "darwin") throw new Error(t`当前系统不支持桌面另存为`);
  dialogOpen = true;
  try {
    const { stdout } = process.platform === "win32"
      ? await execFileAsync(join(PATHS.RESOURCES_FOLDER, "app/saveFileDialog.exe"), [fileName], {
        windowsHide: true,
        encoding: "utf8",
      })
      : { stdout: await selectMacFile(fileName) };
    const selected = stdout.replace(/\r?\n$/, "");
    if (!selected) return null;
    if (!isAbsolute(selected) || /[\u0000-\u001f\u007f-\u009f]/.test(selected)) throw new Error(t`另存为窗口返回了无效的文件路径`);
    cleanupExpiredTokens();
    const token = crypto.randomUUID();
    pendingSaves.set(token, { path: selected, expiresAt: Date.now() + tokenTtlMs });
    return token;
  } catch (error) {
    throw new Error(t`选择保存位置失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    dialogOpen = false;
  }
}

export default async function saveFile(token: string, content: Uint8Array): Promise<boolean> {
  const entry = pendingSaves.get(token);
  pendingSaves.delete(token);
  if (!entry || entry.expiresAt <= Date.now()) throw new Error(t`保存位置已过期，请重新选择保存位置`);
  const selected = entry.path;
  try {
    await writeAtomic(selected, content);
    return true;
  } catch (error) {
    throw new Error(t`保存文件失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
