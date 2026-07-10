# IM 回复格式化(Markdown 美化)设计

**日期:** 2026-07-10
**分支:** feat/im-feishu-gateway(承接飞书网关)
**状态:** 待用户过目

## 问题

agent 的回复是 Markdown(如 `**Wraith CLI**`)。QQ / 飞书的普通**文本消息不渲染 Markdown**,
于是 `**`、`#`、反引号等标记原样显示,难看(见用户截图:`**Wraith CLI**` 显示为带星号)。

## 目标

两端回复都整洁:
- **飞书**:用 `msg_type=post` 富文本,**内联**渲染加粗/斜体/链接,仍是普通聊天气泡(非卡片框)。
- **QQ**:无法渲染 Markdown(官方 bot 的 Markdown 需模板报备,不现实),清洗成整洁纯文本
  (去掉标记、保留可读结构)。

用户已在方案选择中拍板:**飞书 post + QQ 清洗**。

## 架构

一次解析 → 中间表示(IR)→ 两个渲染器。IR 直接对应 post 的「行 × 段」结构。

```
agent 原文 (markdown)
   │  MarkdownLite.parse
   ▼
List<Line>            Line = List<Run>
   │                  Run  = { text, bold, italic, code, href? }
   ├── MarkdownLite.toPlainText(lines) ──▶ QQ 纯文本(String)
   └── FeishuPost.contentJson(lines)   ──▶ 飞书 post content(JSON String)
```

## 组件

### 1. `gateway/format/MarkdownLite.java`(纯函数,共享)
- `record Run(String text, boolean bold, boolean italic, boolean code, String href)` —— href 非空即链接。
- `record Line(java.util.List<Run> runs)` —— 一行(可空 = 空行)。
- `static List<Line> parse(String md)`
- `static String toPlainText(String md)` / `toPlainText(List<Line>)`

**行级(block)处理:**
- 按 `\n` 切行(单换行即一行;连续空行折叠为最多一个空行)。
- 标题 `#{1,6} 文本` → 去掉 `#` 前缀,整行标记 `bold`。
- 无序列表 `- ` / `* ` / `+ ` 开头 → 行首文本前缀 `• `(其余按行内解析)。
- 有序列表 `1. ` 等 → 原样保留序号(按行内解析)。
- 代码围栏 ` ``` ` 行 → 丢弃围栏行本身;围栏内各行整行标记 `code`(纯文本渲染时原样,post 无 code 内联样式→当普通文本)。
- 引用 `> ` → 去掉 `> ` 前缀。
- 表格/图片等未列出的:退化为「按普通行内解析的可读文本」,绝不报错。

**行内(inline)处理**(按序识别,先到先匹配,未闭合的标记当普通字符):
- 加粗 `**x**` 或 `__x__` → Run.bold。
- 斜体 `*x*` 或 `_x_` → Run.italic。
- 行内代码 `` `x` `` → Run.code(文本保留,去反引号)。
- 链接 `[t](u)` → Run{text=t, href=u}。
- 转义 `\*` `\_` `\`` `\[` → 输出字面字符。

### 2. `gateway/feishu/FeishuPost.java`(纯函数,飞书专用)
- `static String contentJson(List<MarkdownLite.Line> lines)` —— 用 Jackson(与 `FeishuApproval` 同一套
  `ObjectMapper`)拼 post wire:
  ```json
  {"zh_cn":{"title":"","content":[ <每行一个段数组> ]}}
  ```
  - text 段:`{"tag":"text","text":<run.text>}`,bold/italic 时加 `"style":["bold"]`/`["italic"]`(可并列)。
  - 链接段:`{"tag":"a","text":<run.text>,"href":<run.href>}`。
  - 空行 → `[{"tag":"text","text":""}]`。
  - code run 在 post 无对应内联样式 → 退化为普通 text 段(不加 style)。
- 转义由 Jackson 保证(规避此前 `MessageText` 裸拼致 code=230001 的坑)。

### 3. 接线
- `FeishuProvider`:新增 `sendPost(rest, openId, postContentJson)`(`msgType("post")`),含 `resp.success()` 失败日志
  (与 `sendText`/`sendCard` 同款容错)。**只改 agent 回复出口那个 Sender lambda**:
  `(openid,text,replyTo) -> sendPost(rest, openid, FeishuPost.contentJson(MarkdownLite.parse(text)))`。
  配对回显/非文本提示/审批说明等短系统文案继续走 `sendText`(无 markdown,纯文本即可)。
- `QqProvider`:agent 回复 Sender lambda 里,`api.sendC2C(openid, MarkdownLite.toPlainText(text), replyTo)`。

## 不做(YAGNI)

- 不支持嵌套列表缩进层级、表格网格对齐、图片渲染、@人。
- 不改审批卡(已是 card markdown,本就渲染)。
- 不做流式/分段;不改 QQ 的被动窗口逻辑。

## 测试

- `MarkdownLiteTest`:加粗/斜体/行内代码/链接/标题/无序列表/引用/代码围栏/混合/纯文本/多行/空行折叠/
  未闭合标记当字面/转义。断言 `parse` 的 IR 与 `toPlainText` 输出。
- `FeishuPostTest`:输出是合法 JSON(Jackson 可解析);bold/italic 段带正确 `style`;链接段 `tag=a`+`href`;
  空行段;含引号/换行/反斜杠的文本经转义后仍合法且无损。

## 红线

- 全程不碰密钥;post/纯文本只承载 agent 可见回复。
- 提交前照常 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
