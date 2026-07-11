# MCP 服务最佳实践

## 速查

### 服务命名
- **Python**:`{service}_mcp`(如 `slack_mcp`)
- **Node/TypeScript**:`{service}-mcp-server`(如 `slack-mcp-server`)

### 工具命名
- snake_case + 服务前缀
- 格式:`{service}_{action}_{resource}`
- 例:`slack_send_message`、`github_create_issue`

### 响应格式
- 同时支持 JSON 和 Markdown
- JSON 供程序处理;Markdown 供人阅读

### 分页
- 始终尊重 `limit` 参数
- 返回 `has_more`、`next_offset`、`total_count`
- 默认 20-50 条

### 传输
- **Streamable HTTP**:远程服务、多客户端
- **stdio**:本地集成、命令行工具
- 避免 SSE(已弃用,由 streamable HTTP 取代)

---

## 服务命名约定

- **Python**:`{service}_mcp`(小写下划线),如 `slack_mcp`、`github_mcp`
- **Node/TypeScript**:`{service}-mcp-server`(小写连字符),如 `slack-mcp-server`

名字应通用、能描述所集成的服务、易从任务描述推断,且不带版本号。

---

## 工具命名与设计

### 命名
1. **snake_case**:`search_users`、`create_project`、`get_channel_info`
2. **带服务前缀**:预期你的 MCP 会和别的 MCP 一起用——用 `slack_send_message` 而非 `send_message`
3. **动作导向**:动词开头(get、list、search、create……)
4. **要具体**:避免会和别的服务冲突的泛名

### 设计
- 工具描述必须**狭窄、无歧义**地描述功能
- 描述必须与实际功能精确匹配
- 提供工具注解(readOnlyHint、destructiveHint、idempotentHint、openWorldHint)
- 工具操作保持聚焦、原子

---

## 响应格式

所有返回数据的工具都应支持多格式:

### JSON(`response_format="json"`)
- 机器可读的结构化数据;含所有字段与元数据;字段名与类型一致;供程序处理。

### Markdown(`response_format="markdown"`,通常默认)
- 人可读的格式化文本;用标题/列表提升清晰度;时间戳转人类可读;显示名 + 括号里带 ID;省略冗长元数据。

---

## 分页

列举资源的工具:
- **始终尊重 `limit`**
- **实现分页**:offset 或游标式
- **返回分页元数据**:`has_more`、`next_offset`/`next_cursor`、`total_count`
- **绝不把全部结果载入内存**:大数据集尤其重要
- **默认合理上限**:20-50 条

分页响应示例:
```json
{
  "total": 150,
  "count": 20,
  "offset": 0,
  "items": [...],
  "has_more": true,
  "next_offset": 20
}
```

---

## 传输选项

### Streamable HTTP
**最适合:** 远程服务、Web 服务、多客户端
**特点:** HTTP 双向通信;支持多客户端并发;可部署为 Web 服务;支持服务端→客户端通知
**用当:** 同时服务多客户端、部署为云服务、集成 Web 应用

### stdio
**最适合:** 本地集成、命令行工具
**特点:** 标准输入输出流通信;设置简单、无需网络配置;作为客户端子进程运行
**用当:** 本地开发环境工具、集成桌面应用、单用户单会话
**注意:** stdio 服务**不要**往 stdout 打日志(用 stderr)

### 传输选择

| 标准 | stdio | Streamable HTTP |
|------|-------|-----------------|
| **部署** | 本地 | 远程 |
| **客户端** | 单 | 多 |
| **复杂度** | 低 | 中 |
| **实时** | 否 | 是 |

---

## 安全最佳实践

### 鉴权与授权
**OAuth 2.1:** 用来自可信机构证书的安全 OAuth 2.1;处理请求前校验 access token;只接受专门发给你服务的 token。
**API Key:** 存环境变量、绝不进代码;启动时校验;鉴权失败给清晰错误。

### 输入校验
- 净化文件路径防目录穿越
- 校验 URL 与外部标识
- 检查参数大小与范围
- 防系统调用里的命令注入
- 所有输入用 schema 校验(Pydantic/Zod)

### 错误处理
- 别把内部错误暴露给客户端
- 服务端记录安全相关错误
- 错误信息有帮助但不泄露
- 出错后清理资源

### DNS 重绑定防护
本地跑的 streamable HTTP 服务:启用 DNS 重绑定防护;校验所有入站连接的 `Origin` 头;绑 `127.0.0.1` 而非 `0.0.0.0`。

---

## 工具注解

| 注解 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `readOnlyHint` | boolean | false | 工具不修改环境 |
| `destructiveHint` | boolean | true | 工具可能做破坏性更新 |
| `idempotentHint` | boolean | false | 同参重复调用无额外效果 |
| `openWorldHint` | boolean | true | 工具与外部实体交互 |

**重要:** 注解是提示,不是安全保证。客户端不应仅凭注解做安全关键决策。

---

## 错误处理

- 用标准 JSON-RPC 错误码
- 工具错误在 result 对象内上报(不是协议级错误)
- 给有帮助、具体、带下一步建议的错误信息
- 别暴露内部实现细节
- 出错时正确清理资源

示例:
```typescript
try {
  const result = performOperation();
  return { content: [{ type: "text", text: result }] };
} catch (error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: `Error: ${error.message}. Try using filter='active_only' to reduce results.`
    }]
  };
}
```

---

## 测试要求

全面测试应覆盖:
- **功能测试**:有效/无效输入下正确执行
- **集成测试**:与外部系统的交互
- **安全测试**:鉴权、输入净化、限流
- **性能测试**:负载、超时下的行为
- **错误处理**:正确的错误上报与清理

---

## 文档要求

- 清晰记录所有工具与能力
- 含可运行示例(每个主要功能至少 3 个)
- 记录安全考量
- 指明所需权限与访问级别
- 记录限流与性能特征

---
> 本文件完整翻译自 anthropics/skills `mcp-builder` 的 mcp_best_practices(见 LICENSE.txt);代码/表格保留原样。
