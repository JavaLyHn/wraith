# 占位兑现波(UI Fulfillment)设计 spec

> 日期:2026-07-03 · 分支:`feat/ui-fulfillment` · 定位:清债波(`2026-07-03-debt-sweep.md`)之后、Phase F(打包)之前的第二波
> 兑现 Phase A 遗留的三个 UI 占位:Composer 附件、模型切换、侧栏搜索。
> 决策(用户已确认):附件=**图片+文本文件**;模型=**会话级切换+可设默认**;**强度不做**(留待真 reasoning 模型);搜索=**标题+项目过滤,纯渲染层**(全文搜索进 backlog)。

## 0. 目标与非目标

**目标**:三个占位变为完整功能,桌面端不再有"点了没反应/只读"的前门元素。

**非目标**:强度/temperature 调节(明确不做);全文搜索(backlog);附件的拖拽/粘贴板图片(首期只做文件选择,拖拽粘贴进 backlog);模型能力(vision)预判(API 错误透传);多会话并行。

## 1. 附件(Composer)

### 1.1 交互
- 附件按钮启用:点击经 IPC 走 main 的 `dialog.showOpenDialog(mainWindow, ...)`(**模态**,Phase D 教训),多选,过滤器:图片(png/jpg/jpeg/gif/webp)+ 文本/代码(常见扩展 + 无扩展按文本试探)。
- 选中后在输入框上方显示附件 chips(文件名+类型图标+移除钮);提交时随 turn 发出并清空;turn running 期间附件按钮禁用(与输入框同步)。

### 1.2 wire 契约(新增,双端同任务落地)
- `turn.submit` params 增可选 `attachments: [{ path: string, kind: 'image' | 'text' }]`(kind 由渲染端按扩展判定;后端复核)。
- 后端(AppServer/SessionRunner 链)读取文件:
  - `text`:内容注入本轮 user message 前缀块(格式 ` ```<文件名>\n<内容>\n``` `,多文件依次;正文在附件块之后);
  - `image`:base64 data URL 构造 image part,走 `AbstractOpenAiCompatibleClient` 既有 `image_url` 管道。
- **上限**:单文件 512KB、单轮总量 2MB、图片单张 4MB;超限该 turn 以 `turn.failed`(友好错误文案,含超限文件名)拒绝,不发起 LLM 调用。
- **错误处理**:文件不存在/不可读 → turn.failed 友好文案;模型不支持图片 → API 错误原样经 turn.failed 透传(首期不预判能力)。
- **落盘**:文本附件注入块随 user message 自然落盘(resume 回放可见);图片在落盘 message 中以 `[图片: <文件名>]` 占位标记(不存 base64)。

### 1.3 安全
- 路径必须解析为存在的普通文件;读取发生在 agent 进程(用户主动选择,不涉审批/沙箱);附件内容不进任何日志(LlmTraceLogger 若记录请求体,图片 base64 截断)。

## 2. 模型切换(Composer chip → 下拉)

### 2.1 交互
- 只读 chip 变可点下拉(Radix,与 ProjectSwitcher 同款风格):列出 `~/.wraith/config.json` 中已配置的 provider(显示 `provider / model`,标注当前与默认);无 key 的 provider 置灰不可选。
- 选择即会话级切换(下一 turn 生效,turn running 期间禁用);条目行内「设为默认」动作改写 `defaultProvider` 落盘(只影响之后的新会话)。
- 「强度」字样从 chip 移除(本期不做,不再展示占位文案)。

### 2.2 wire 契约(新增)
- `model.list` → `{ current: {provider, model}, default: string, providers: [{name, model, hasKey}] }`——**绝不返回 apiKey/baseUrl 值**(E-1 env 红线同款);
- `session.setModel` params `{provider}` → 当前会话经 LlmClientFactory 重建 client,resp 回 `{provider, model}`;渲染端据此更新 chip;
- `config.setDefaultProvider` params `{provider}` → 校验存在+有 key 后 `WraithConfig.save()`。
- 会话落盘:`SessionMeta` 已有 provider/model 字段,setModel 后随下轮落盘;**resume 恢复会话时按 meta.provider 恢复**(该 provider 已无 key 或已删则回退默认并经 status/横幅提示)。
- CLI 路径零改动(manager/factory 同步语义不变)。

## 3. 侧栏搜索(标题+项目过滤)

### 3.1 交互
- 侧栏搜索框启用(移除 disabled 与占位 tooltip):输入即时过滤,**纯渲染层**,零后端改动。
- 过滤范围:当前项目的会话列表(按 title 不区分大小写 contains)+ 项目条目(ProjectSwitcher 数据源,按显示名/路径尾段)。呈现:搜索激活时侧栏显示两个分区「会话」「项目」;点会话=既有 handleSelectSession,点项目=既有 switchToProject;清空/Esc 退出过滤态恢复原列表。
- 空结果显示空态文案;搜索框带清除钮。

### 3.2 backlog(不做)
- 全文搜索(后端扫 JSONL)记入 ROADMAP backlog,等真需求。

## 4. 测试与门禁

- Java:附件读取/上限/注入格式、model.list 序列化负断言(无 key 值)、setModel 重建与 resume 恢复——新测并入全量(基线以清债波 C2 结果为准:0F/0E 或 3F/38E 文档化);
- vitest:chips 状态、附件 kind 判定、下拉数据流、搜索过滤纯函数;
- E2E(mock 需按清债波 B3 保真后的 fixture 扩展):附件选择→chips→提交携带 attachments 参数(record 断言)、模型下拉切换→chip 更新(mock 回放 setModel)、搜索过滤会话/项目两分区;
- 实机眼验(边清边验延续):真图片发给 DeepSeek 验证 vision 实际支持与降级文案;真切 provider 一轮对话;搜索大列表体感。

## 5. 风险

- DeepSeek-V4-Flash 图片支持未知:已按"API 错误透传"设计,实机验证是眼验卡必项;若不支持,图片附件仍可用于将来换模型,错误文案要可读。
- turn.submit 契约扩展是本波唯一主链 wire 变更:mock fixture 同步保真(record 断言),防 E-1 式 mock 掩蔽。
- resume 恢复 provider 是跨阶段行为变化(以前恒用默认):spec 明确回退链,E2E 覆盖"provider 失效回退"。
