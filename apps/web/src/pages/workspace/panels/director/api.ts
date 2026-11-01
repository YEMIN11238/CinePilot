import axios from "axios";
import { registerApiLanguage } from "@/lib/i18n";
import useWorkspaceFiles from "@/lib/workspaceFiles";

const client = axios.create({ baseURL: "/api/director", headers: { "x-toonflow-workspace": "1" } });
registerApiLanguage(client);

export async function directorRequest<T>(path: string, directory: string, input?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { data } = input === undefined
    ? await client.get<{ code: number; data: T; message?: string }>(path, { params: { directory }, signal })
    : await client.post<{ code: number; data: T; message?: string }>(path, { directory, ...input }, { signal });
  if (data.code !== 200) throw new Error(data.message || "镜头操作失败");
  return data.data;
}

export function directorError(cause: unknown) {
  return axios.isAxiosError<{ message?: string }>(cause)
    ? cause.response?.data?.message || cause.message
    : cause instanceof Error ? cause.message : "操作失败，请重试";
}

export async function uploadDirectorFile(directory: string, file: File) {
  if (!file.size || file.size > 100 * 1024 * 1024) throw new Error("请选择不超过 100 MB 的非空素材");
  if (!/^(image|video|audio)\//.test(file.type)) throw new Error("仅支持图片、视频和音频文件");
  const files = useWorkspaceFiles(directory);
  for (const folder of ["assets", "assets/directorUploads"]) {
    await files.mkdir(folder).catch((cause: { response?: { data?: { data?: { code?: string } } } }) => {
      if (cause.response?.data?.data?.code !== "EEXIST") throw cause;
    });
  }
  const extension = file.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0].toLowerCase() || "";
  const path = `assets/directorUploads/${crypto.randomUUID()}${extension}`;
  await files.write(path, file, true);
  return { path, mimeType: file.type };
}
