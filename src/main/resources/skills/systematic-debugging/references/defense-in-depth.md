# 纵深防御校验(Defense-in-Depth Validation)

## 概述

当你修好一个由非法数据引起的 bug,只在一处加校验感觉够了。但那单点检查会被不同代码路径、重构或 mock 绕过。

**核心原则:在数据经过的【每一层】都校验。让 bug 在结构上不可能发生。**

## 为什么要多层

单点校验:「我们修了这个 bug」
多层:「我们让这个 bug 不可能」

不同层抓不同情况:
- 入口校验抓大多数 bug
- 业务逻辑抓边界情况
- 环境守卫防上下文特定的危险
- 调试日志在其它层失手时帮忙

## 四层

### 第 1 层:入口校验
**目的:** 在 API 边界拒绝明显非法的输入
```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory || workingDirectory.trim() === '') {
    throw new Error('workingDirectory cannot be empty');
  }
  if (!existsSync(workingDirectory)) {
    throw new Error(`workingDirectory does not exist: ${workingDirectory}`);
  }
  if (!statSync(workingDirectory).isDirectory()) {
    throw new Error(`workingDirectory is not a directory: ${workingDirectory}`);
  }
  // ... proceed
}
```

### 第 2 层:业务逻辑校验
**目的:** 确保数据对这个操作说得通
```typescript
function initializeWorkspace(projectDir: string, sessionId: string) {
  if (!projectDir) {
    throw new Error('projectDir required for workspace initialization');
  }
  // ... proceed
}
```

### 第 3 层:环境守卫
**目的:** 在特定上下文里阻止危险操作
```typescript
async function gitInit(directory: string) {
  // 测试里,拒绝在临时目录外 git init
  if (process.env.NODE_ENV === 'test') {
    const normalized = normalize(resolve(directory));
    const tmpDir = normalize(resolve(tmpdir()));

    if (!normalized.startsWith(tmpDir)) {
      throw new Error(
        `Refusing git init outside temp dir during tests: ${directory}`
      );
    }
  }
  // ... proceed
}
```

### 第 4 层:调试埋点
**目的:** 为事后取证捕获上下文
```typescript
async function gitInit(directory: string) {
  const stack = new Error().stack;
  logger.debug('About to git init', {
    directory,
    cwd: process.cwd(),
    stack,
  });
  // ... proceed
}
```

## 应用模式

发现 bug 时:
1. **追数据流** —— 坏值从哪来?在哪用?
2. **列出所有检查点** —— 数据经过的每个点
3. **每层加校验** —— 入口、业务、环境、调试
4. **测每一层** —— 试着绕过第 1 层,验证第 2 层能接住

## 会话中的例子

Bug:空 `projectDir` 导致 `git init` 跑进源码

**数据流:**
1. 测试 setup → 空串
2. `Project.create(name, '')`
3. `WorkspaceManager.createWorkspace('')`
4. `git init` 在 `process.cwd()` 跑

**加的四层:**
- 第 1 层:`Project.create()` 校验非空/存在/可写
- 第 2 层:`WorkspaceManager` 校验 projectDir 非空
- 第 3 层:`WorktreeManager` 测试里拒绝在 tmpdir 外 git init
- 第 4 层:git init 前记录栈追踪

**结果:** 1847 个测试全过,bug 无法复现

## 关键洞察

四层都必要。测试期间每层都接住了别层漏掉的 bug:
- 不同代码路径绕过入口校验
- mock 绕过业务逻辑检查
- 不同平台的边界需要环境守卫
- 调试日志识别出结构性误用

**别停在一个校验点。** 在每一层都加检查。

---
> 本文件完整翻译自 obra/superpowers(MIT)`systematic-debugging` 的 defense-in-depth;代码保留原样。
