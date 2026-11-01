# 开发说明

## 网页开发

```bash
bun install --frozen-lockfile
bun run dev:plugins
bun run dev
```

前端 Vite 默认使用 5173 端口，开发服务默认使用 3000 端口。首次完整构建使用 `bun run build:server`，它会构建节点、工具、扩展、网页、服务及 MCP，并复制运行所需的供应商和技能文件。

针对改动运行已有检查：

```bash
bun run --cwd apps/web typecheck
bun run --cwd apps/server typecheck
```

新增或移动服务路由后执行 `bun run --cwd apps/server routes`。具体贡献规则见根目录 `AGENTS.md`。

## 本地数据

服务端默认使用仓库根目录的 `data/`。可设置：

| 环境变量 | 用途 |
| --- | --- |
| `TOONFLOW_SERVER_HOST` | 服务监听地址；本地使用建议设为 `127.0.0.1` |
| `TOONFLOW_SERVER_PORT` | 服务端口，默认 `3000` |
| `TOONFLOW_DATA_DIR` | 自定义数据目录 |

项目使用本地 JSON 和素材文件。配置文件的权限为 `0600`；密钥需要自行在设置中填写，不随源码分发。不要让两个服务进程同时写入同一个工作目录。内部包命名与环境变量保留兼容名称，避免破坏模块引用及已有数据。

媒体导出需要 FFmpeg 和 FFprobe。Linux 中文字幕目前使用 Noto Sans CJK 或文泉驿常见安装路径；未安装中文字体时应先安装相应字体。

## macOS 桌面构建

另需 Xcode Command Line Tools、可在 PATH 找到的 FFmpeg 和 FFprobe。

```bash
bun packages/startup/scripts/buildMac.ts
bun run build:desktop
```

构建脚本会准备桌面运行依赖并输出到 `build/desktop/`。本地签名、公证与跨平台发布需要各自环境配置；首发仓库不提供上游产品的自动发布工作流。本次发布只交付源码，不附带含个人配置的安装目录。

macOS 桌面与网页共用界面，原生文件弹窗仍由桌面宿主处理。Windows 与 Intel Mac 的当前完整流程未实测。
