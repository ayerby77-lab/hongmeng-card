# AnatomyLearning · 人体解剖学习

HarmonyOS Stage / ArkTS 课程项目源码工程。包名：`com.example.anatomylearning`。

## 收到工程后如何打开

1. 解压 ZIP，保留内部 `AnatomyLearning` 目录结构。
2. 放到全路径均无空格、无中文的目录，例如 Windows 的 `C:/Projects/AnatomyLearning`，或 macOS 的 `/Users/yourname/Projects/AnatomyLearning`。
3. 在 DevEco Studio 中选择 Open，选中直接包含 `build-profile.json5` 的 `AnatomyLearning` 目录。
4. 安装或选择匹配的 SDK，等待工程同步。当前构建使用 DevEco Studio 26.0，目标 SDK 配置为 `26.0.0`，最低兼容 `5.0.0(12)`。
5. SDK 路径由接收者本机配置。压缩包排除了原作者的 `local.properties`；如 IDE 未自动生成，请参考 `local.properties.example` 创建本地文件。
6. 在 DevEco 配置自己的调试签名，选择模拟器并运行 `entry`。

## 已包含的内容

- 人体浏览页面、JSBridge，以及离线 Human Atlas 网页与模型资源。
- 结构详情、收藏、历史、笔记及 RDB 存储。
- 12 篇课程示例资料、资料管理、切分、检索与索引同步。
- 问答消息、流式展示、引用原文、意图分发与执行入口。
- 云端请求适配层与云函数源码、自动化测试、项目说明文档。

## 运行模式与验证范围

默认 `entry/src/main/ets/app/CloudConfig.ets` 中 `CLOUD_FUNCTION_URL` 为空，使用本地演示回答；该模式按检索片段组合输出，便于展示资料与引用流程。真实大模型问答需要部署并验证云端服务，再填写地址。模型密钥仅配置在云端。

本包经过源码构建和自动化测试。模拟器完整交互、系统 ArkAF 分发及真实云端调用仍需实际验收。详细记录见 `doc/验证记录.md`，接收说明见 `doc/工程交接说明.md`。

## 命令行（macOS）

需安装 DevEco Studio、Python 3；Bash 脚本按 macOS 工具目录编写。Windows 请使用 DevEco Studio 构建运行。

```bash
bash scripts/build.sh
bash scripts/test.sh
/Applications/DevEco-Studio.app/Contents/tools/node/bin/node scripts/test-sse-parser.js
```

DevEco 安装位置不同时，可设置 `DEVECO_DIR` 为其 Contents 目录。构建脚本会在临时目录生成本机 SDK 配置；产物输出至 `dist/`，默认未签名。

## 目录

- `entry/`：ArkTS 页面、业务代码、模型资源
- `AppScope/`：应用配置与图标
- `cloud-functions/`：云函数源码及部署依赖
- `scripts/`、`tests/`：构建与测试
- `doc/`：接口、部署、任务和验证记录

Human Atlas 与 BodyParts3D 署名见 `entry/src/main/resources/rawfile/human-atlas/ATTRIBUTION.md`，分发时保留。
