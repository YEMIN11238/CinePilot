# 开源许可与来源

CinePilot 包含开源组件和适配代码。公开发布保留以下来源与版权声明；这些说明不表示原项目或相关组织对 CinePilot 的背书。

| 项目 | 使用范围 |
| --- | --- |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) | 仓库包含并修改其 MIT 许可工程代码；原始源码快照为 `30139c9`，HBAI-Ltd 版权声明保留在根目录 LICENSE |
| [ViMax](https://github.com/HKUDS/ViMax) | 角色静态/动态设定、镜头状态与角色关联的设计参考，使用 TypeScript/Zod 实现；未嵌入其 Python 服务 |
| [OpenCut Classic](https://github.com/OpenCut-app/opencut-classic) | 素材、预览、属性与时间轴的信息组织参考；使用 Vue 实现 |
| [Vue Flow](https://github.com/bcakmakoglu/vue-flow) | 节点画布 |
| [WebAV](https://github.com/WebAV-Tech/WebAV) | 浏览器视频预览 |
| [FFmpeg](https://ffmpeg.org/) | 由本地环境提供的媒体处理与导出程序，许可取决于所安装构建 |

已有组件的完整许可文本分别保留在 [studioCredits.txt](../apps/web/public/studioCredits.txt)、[openSource.txt](../apps/web/public/openSource.txt) 及各包中；依赖版本记录在 `bun.lock`。

预置咖啡分镜是用于体验操作的生成素材，四张静态图片不代表已验证跨镜角色或物体一致性；其配乐为无第三方采样的合成音频。来源记录见 [assetNotes.txt](../apps/web/public/studioDemo/assetNotes.txt)。

模型生成能力由用户配置的外部服务提供。CinePilot 负责制作流程、交互、状态管理和接口适配，不声称训练或拥有这些基础模型。
