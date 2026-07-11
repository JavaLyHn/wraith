# 测试反模式(Testing Anti-Patterns)

**何时加载本参考:** 写/改测试、加 mock、或想给生产代码加「只给测试用的方法」时。

## 概述

测试必须验证**真实行为**,不是 mock 行为。mock 是隔离的手段,不是被测的对象。

**核心原则:测代码做什么,不是测 mock 做什么。**

**严格遵循 TDD 能预防这些反模式。**

## 铁律

```
1. 永不测 mock 行为
2. 永不给生产类加只给测试用的方法
3. 永不在不理解依赖的情况下 mock
```

## 反模式 1:测 mock 行为

**违规:**
```typescript
// ❌ 坏:测的是 mock 存在
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
});
```

**为什么错:**
- 你在验证 mock 工作,不是组件工作
- mock 在时测试过、不在时失败
- 关于真实行为什么都没告诉你

**搭档的纠正:**「我们是在测一个 mock 的行为吗?」

**修法:**
```typescript
// ✅ 好:测真实组件,或干脆别 mock 它
test('renders sidebar', () => {
  render(<Page />);  // 不 mock sidebar
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});

// 或者如果为隔离必须 mock sidebar:
// 别断言 mock —— 测 Page 在 sidebar 存在时的行为
```

### 关卡函数

```
在断言任何 mock 元素之前:
  问:「我在测真实组件行为,还是只测 mock 存在?」

  若测 mock 存在:
    停 —— 删掉断言,或取消 mock

  改测真实行为
```

## 反模式 2:生产代码里的「只测试用」方法

**违规:**
```typescript
// ❌ 坏:destroy() 只在测试里用
class Session {
  async destroy() {  // 看着像生产 API!
    await this._workspaceManager?.destroyWorkspace(this.id);
    // ... cleanup
  }
}

// 测试里
afterEach(() => session.destroy());
```

**为什么错:**
- 生产类被只测试用的代码污染
- 生产里误调很危险
- 违反 YAGNI 和关注点分离
- 混淆「对象生命周期」和「实体生命周期」

**修法:**
```typescript
// ✅ 好:测试工具处理测试清理
// Session 没有 destroy() —— 它在生产里是无状态的

// 在 test-utils/ 里
export async function cleanupSession(session: Session) {
  const workspace = session.getWorkspaceInfo();
  if (workspace) {
    await workspaceManager.destroyWorkspace(workspace.id);
  }
}

// 测试里
afterEach(() => cleanupSession(session));
```

### 关卡函数

```
给生产类加任何方法之前:
  问:「这只被测试用吗?」
  若是:停 —— 别加,放进测试工具里

  问:「这个类拥有这个资源的生命周期吗?」
  若否:停 —— 方法放错类了
```

## 反模式 3:不理解就 mock

**违规:**
```typescript
// ❌ 坏:mock 破坏了测试逻辑
test('detects duplicate server', () => {
  // mock 阻止了测试依赖的配置写入!
  vi.mock('ToolCatalog', () => ({
    discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
  }));

  await addServer(config);
  await addServer(config);  // 本应抛错 —— 但不会!
});
```

**为什么错:**
- 被 mock 的方法有测试依赖的副作用(写配置)
- 为「保险」过度 mock,破坏了真实行为
- 测试因错误原因通过,或神秘失败

**修法:**
```typescript
// ✅ 好:在正确层级 mock
test('detects duplicate server', () => {
  // 只 mock 慢的部分,保留测试需要的行为
  vi.mock('MCPServerManager'); // 只 mock 慢的 server 启动

  await addServer(config);  // 配置已写
  await addServer(config);  // 重复被检出 ✓
});
```

### 关卡函数

```
mock 任何方法之前:
  停 —— 先别 mock

  1. 问:「真实方法有哪些副作用?」
  2. 问:「本测试依赖其中任何副作用吗?」
  3. 问:「我完全理解这个测试需要什么吗?」

  若依赖副作用:
    在更低层 mock(实际的慢/外部操作)
    或用保留必要行为的 test double
    不要 mock 测试依赖的高层方法

  若不确定测试依赖什么:
    先用真实实现跑测试
    观察实际需要发生什么
    再在正确层级加最小 mock

  红旗:
    - "我 mock 一下保险"
    - "这可能慢,最好 mock"
    - 不理解依赖链就 mock
```

## 反模式 4:不完整的 mock

**违规:**
```typescript
// ❌ 坏:部分 mock —— 只放你以为需要的字段
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' }
  // 缺:下游代码用到的 metadata
};

// 之后:代码访问 response.metadata.requestId 时崩
```

**为什么错:**
- **部分 mock 隐藏结构假设** —— 你只 mock 了你知道的字段
- **下游代码可能依赖你没包含的字段** —— 静默失败
- **测试过但集成挂** —— mock 不全、真实 API 全
- **虚假信心** —— 测试证明不了真实行为

**铁规:mock 现实中存在的完整数据结构,不只是你当前测试用到的字段。**

**修法:**
```typescript
// ✅ 好:镜像真实 API 的完整性
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 }
  // 真实 API 返回的所有字段
};
```

### 关卡函数

```
创建 mock 响应之前:
  查:「真实 API 响应包含哪些字段?」

  动作:
    1. 从文档/示例看实际 API 响应
    2. 包含系统下游可能消费的所有字段
    3. 核实 mock 完整匹配真实响应 schema

  关键:
    要造 mock,就必须理解整个结构
    部分 mock 在代码依赖被省略字段时静默失败

  不确定:包含所有文档化字段
```

## 反模式 5:集成测试作为事后补充

**违规:**
```
✅ 实现完成
❌ 没写测试
"可以测了"
```

**为什么错:**
- 测试是实现的一部分,不是可选后续
- TDD 本会抓到这个
- 没测试不能声称完成

**修法:**
```
TDD 循环:
1. 写会失败的测试
2. 实现使其通过
3. 重构
4. 然后才声称完成
```

## 当 mock 变得太复杂

**警告信号:**
- mock setup 比测试逻辑还长
- 为让测试过而 mock 一切
- mock 缺真实组件有的方法
- mock 一变测试就碎

**搭档的问题:**「这里需要用 mock 吗?」

**考虑:** 用真实组件的集成测试往往比复杂 mock 更简单

## TDD 预防这些反模式

**为什么 TDD 有帮助:**
1. **先写测试** → 逼你想清楚到底在测什么
2. **看它失败** → 确认测试测的是真实行为,不是 mock
3. **最小实现** → 没有只测试用的方法混进来
4. **真实依赖** → mock 之前你先看清测试真正需要什么

**如果你在测 mock 行为,你违反了 TDD** —— 你在没先对真实代码看着测试失败的情况下加了 mock。

## 速查

| 反模式 | 修法 |
|--------|------|
| 断言 mock 元素 | 测真实组件或取消 mock |
| 生产里的只测试方法 | 移到测试工具 |
| 不理解就 mock | 先懂依赖,最小 mock |
| 不完整 mock | 完整镜像真实 API |
| 测试作为事后 | TDD —— 测试先行 |
| 过复杂 mock | 考虑集成测试 |

## 红旗

- 断言检查 `*-mock` 的 test id
- 只在测试文件里被调的方法
- mock setup 占测试 >50%
- 移除 mock 测试就挂
- 说不出为什么要 mock
- "保险起见"就 mock

## 底线

**mock 是隔离的工具,不是被测的东西。**

如果 TDD 揭示你在测 mock 行为,你就走偏了。修法:测真实行为,或质问你到底为什么要 mock。

---
> 本文件完整翻译自 obra/superpowers(MIT)`test-driven-development` 的 testing-anti-patterns;代码示例保留原样。
