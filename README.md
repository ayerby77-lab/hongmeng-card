# 名片夹 · HarmonyOS 课程项目

原生 ArkTS / ArkUI 课程应用，包含电子名片管理和省市天气预报。

## 已实现

- 名片新增、列表、详情、修改、删除；删除和放弃编辑带确认。
- 姓名、公司／学校、职位／专业、电话、邮箱、分组、备注。
- 姓名必填，电话与邮箱至少一项；格式、长度校验。
- 搜索姓名、公司、职位、电话、邮箱、备注；分组与收藏组合筛选。
- 收藏、名片总数与收藏计数、空列表及搜索无结果状态。
- vCard 3.0 文本复制，包含特殊字符转义和 UTF-8 折行；可将复制内容另存为 `.vcf` 交换联系人。
- 本地 JSON 持久化，启动时自动恢复；名片功能离线可用。
- 省市联动天气查询：温度、天气状况、湿度、风力、风向、七日预报与降水概率。
- 天气加载、断网、超时及服务异常提示，支持重试；请求独立封装并在离页时释放。
- 天气使用 Open-Meteo HTTPS 接口，无需 API 密钥、无第三方运行时依赖。

天气设计、接口说明、验收步骤与验证记录见根目录 [doc/天气功能说明.md](doc/天气功能说明.md)。

## 打开与构建

本机验证环境：DevEco Studio 自带 Hvigor 6.26.4、HarmonyOS SDK 26.0.0，最低兼容 API 12。

```sh
bash scripts/test.sh
bash scripts/build.sh
```

`build.sh` 自动复制到临时英文路径编译，成功后将 HAP 放入 `dist/`。这是为了兼容 Hvigor 对工程路径字符的限制。DevEco 安装位置可通过 `DEVECO_DIR` 环境变量设置。

使用 IDE 时，将工程复制或解压到全英文路径（例如 `~/Projects/CardFolio`），用 DevEco Studio 打开根目录，等待同步完成，选择手机模拟器或设备运行。按 IDE 提示配置 SDK。当前 `local.properties` 为本机路径且已排除 Git。

当前产物为 **unsigned HAP**。真机安装需在 `File > Project Structure > Project > Signing Configs` 配置个人签名，然后重新构建。请使用自己的华为开发者账号；证书和密码不要提交到仓库。

## 文件结构

```text
AppScope/                         应用信息与图标
entry/src/main/ets/
  entryability/EntryAbility.ets    应用入口
  pages/Index.ets                  列表、详情、编辑页面
  pages/Weather.ets                天气页面
  model/Weather.ts                 天气校验与转换
  model/WeatherCities.ts           省市坐标
  service/WeatherService.ets       天气网络服务
  model/Card.ts                   数据模型、校验、筛选和 vCard
  store/CardStore.ets              本地读写与恢复
entry/src/main/resources/         页面路由与资源
scripts/                          编译、测试脚本
tests/                            业务与存储测试
```

## 本地保存机制

数据位于应用私有目录 `context.filesDir/cards.json`。每次新增、编辑、收藏、删除，将完整快照写入同目录临时文件，执行 `fsync` 并关闭后通过 `rename` 替换正式文件。页面仅在保存成功后更新列表。写入失败保留已保存数据；读取异常时提示错误并禁用编辑，避免将损坏文件覆盖为空列表。

卸载应用或清除应用数据会删除名片。当前实现面向课程规模、小型个人名片夹；全部数据在内存中加载，保存同步执行。大量名片场景应迁移到关系型数据库和异步读写。

## 验收操作

1. 首次启动看到空状态，新建“张三”，填入 `13800138000`，选择“同学”并保存。
2. 查看详情，修改公司和备注，返回列表搜索公司名称，应找到该名片。
3. 收藏该名片，开启“仅看收藏”，再按“同学”分组筛选。
4. 终止应用后重启，检查名片内容、分组与收藏仍存在。
5. 复制 vCard，粘贴到文本文件，检查 `BEGIN:VCARD` 与联系人信息。
6. 测试空姓名、无联系方式和错误邮箱，页面应拒绝保存并提示。
7. 删除时选择取消，名片应保留；确认删除并重启，名片应消失。

自动化测试使用 Node 文件系统模拟鸿蒙文件 API，验证核心行为；设备 UI 与签名安装需要按上述步骤验收。

## 合并到已有课程项目

复制 `model/Card.ts`、`store/CardStore.ets` 和 `pages/Index.ets` 到原项目。可将页面改名为 `pages/CardList.ets`，在原项目 `main_pages.json` 增加路由，再从原首页通过 `router.pushUrl({ url: 'pages/CardList' })` 进入。保留原项目的应用入口、包名与签名配置。

## 代码库提交

工程包含 `.gitignore`，排除构建产物、本机设置、缓存与签名文件。远程仓库为 https://github.com/ayerby77-lab/hongmeng-card 。最新天气任务要求于 2026-09-24 前提交；本次实现日期为 2026-09-29，提交记录使用实际日期。

API 参考：[华为 HarmonyOS 文档中心](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/)、本机 SDK 的 `@ohos.file.fs.d.ts` 类型定义。
