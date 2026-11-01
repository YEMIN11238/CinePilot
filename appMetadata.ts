// 网页与服务只读取应用元信息，不依赖桌面 SDK 的生成目录。
export default {
  name: "CinePilot",
  identifier: "local.frameflow.desktop",
  version: process.env.appVersion ?? "0.1.0",
  urlSchemes: ["frameflow"],
};
