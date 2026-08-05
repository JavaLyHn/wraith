---
name: security-review
description: |
  代码安全审查与漏洞识别：注入攻击、认证绕过、敏感信息泄露、路径穿越、不安全的反序列化、SSRF、依赖漏洞。当用户关心代码安全性、需要安全审计、或处理安全相关问题时使用。
  触发场景：用户说「帮我审查安全 / 这段代码安全吗 / 有没有安全漏洞 / 检查注入风险 / 密钥泄露 / 路径穿越 / XSS / CSRF / 权限检查 / 依赖有 CVE / 安全加固 / 怎么防止 SQL 注入」。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [security, review, audit]
---

# 安全审查（Security Review）

## 概述

安全漏洞的修复成本随发现时间指数增长。**代码阶段发现 = 最低成本。**

**核心原则：假设所有外部输入都是恶意的。防御要纵深，不要依赖单一屏障。**

## 审查清单

### 1. 输入校验

```
所有外部输入（用户提交、API 参数、文件内容、环境变量）：
□ 是否做了类型/格式/长度校验？
□ 是否用了白名单而非黑名单？
□ 是否在使用点校验（不只是入口）？
□ 是否做了编码/转义（HTML/SQL/Shell/Path）？
```

**常见漏洞：**

| 输入类型 | 风险 | 防护 |
|----------|------|------|
| SQL 查询参数 | SQL 注入 | 参数化查询（PreparedStatement） |
| HTML 内容 | XSS | 输出编码 / CSP |
| 文件路径 | 路径穿越 | 规范化 + 白名单目录检查 |
| Shell 命令参数 | 命令注入 | 避免拼接；用参数列表调用 |
| 反序列化输入 | RCE | 白名单类型 / 不反序列化不可信数据 |
| URL 参数 | SSRF | 白名单域名/IP 范围 |

### 2. 认证与授权

```
□ 是否每个端点都有认证检查？
□ 是否做了授权（不只是认证）：用户能否访问此资源？
□ 密码是否用了强哈希（bcrypt/scrypt/argon2）？
□ JWT/token 是否验签、检查过期？
□ 是否有速率限制防暴力破解？
```

### 3. 敏感信息

```
□ 密钥/token 是否硬编码在代码里？
  grep -rn 'api[_-]?key\|secret\|password\|token\|sk-' src/
□ 日志里是否打印了敏感信息？
□ 错误信息是否泄露了内部结构（堆栈、路径、版本）？
□ .gitignore 是否排除了 .env / *.pem / config.json？
□ 前端代码是否暴露了后端密钥？
```

### 4. 依赖安全

```bash
# Java
mvn dependency:tree
# 检查已知漏洞
mvn org.owasp:dependency-check-maven:check

# Node.js
npm audit
npx better-npm-audit audit

# Python
pip-audit
safety check
```

### 5. 文件操作

```
□ 文件路径是否做了规范化（resolve + 检查是否在允许目录内）？
□ 上传文件是否检查了类型/大小/内容（不只看扩展名）？
□ 临时文件是否及时清理？
□ 是否防了 Zip Slip（解压时检查路径）？
□ 是否防了符号链接逃逸？
```

### 6. 网络与 API

```
□ HTTPS 是否强制（不接受 HTTP）？
□ CORS 是否限制了来源（不是 *）？
□ API 是否有速率限制？
□ 是否验证了重定向目标（防 open redirect）？
□ WebSocket 是否验证了 Origin？
```

## 严重程度分级

| 级别 | 定义 | 处理 |
|------|------|------|
| **Critical** | 可远程执行代码 / 完全绕过认证 | 立即修复，阻止发布 |
| **High** | 数据泄露 / 权限提升 / 注入 | 本迭代内修复 |
| **Medium** | 信息泄露 / 缺少防护层 | 计划修复 |
| **Low** | 最佳实践缺失 / 可改进项 | 按优先级排期 |

## 报告格式

```markdown
### [严重程度] 漏洞标题

**位置：** `file.java:123`
**类型：** SQL 注入 / XSS / 路径穿越 / ...
**描述：** 一句话说明问题
**影响：** 攻击者可以做什么
**复现：** 具体步骤或 payload
**修复建议：** 具体代码级修复方案
```

## 不要做的事

- ❌ 只扫描不分析（工具报的不一定是真漏洞）
- ❌ 只看 OWASP Top 10（业务逻辑漏洞往往不在列表里）
- ❌ 用安全作为理由阻止所有变更（要评估风险 vs 收益）
- ❌ 假设内网就安全（零信任）
- ❌ 把安全审查只放在发布前（应贯穿开发全程）

## wraith 说明

- Wraith 的 PathGuard 强制路径限定在项目根内
- CommandGuard 是辅助黑名单（POSIX + Windows 双套规则全平台跑）
- CommandSandbox 只在 app-server / gateway / automation 注入，交互 CLI 不用
- HITL 拦截链：HitlToolRegistry → ToolRegistry → PathGuard/CommandGuard → CommandSandbox
- 密钥红线检查：`git diff --cached | grep -iE 'api[_-]?key|secret|sk-|Bearer'`
- 微信 iLink 通道走非交互式默认拒绝策略

