---
name: typescript-patterns
description: |
  TypeScript 编码时的类型设计、模式选择与常见陷阱规避。当用户在写 TypeScript 代码、处理类型问题、设计接口/泛型、或遇到 TS 类型错误时使用。
  触发场景：用户说「帮我写 TS 类型 / 这个泛型怎么写 / TypeScript 类型报错 / 怎么用 infer / 联合类型怎么收窄 / type 还是 interface / 类型体操 / zod schema / 怎么让类型更安全 / 这个 any 怎么去掉 / React 组件 props 类型」。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [typescript, patterns, types]
---

# TypeScript 模式与最佳实践

> 灵感来自 Matt Pocock 的 TypeScript 教学与社区最佳实践。

## 核心理念

**类型是文档，也是护栏。好的类型让非法状态不可表示。**

## 基础纪律

### 严格模式永远开

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 避免 `any`，用精确类型

```typescript
// ❌
function parse(input: any): any { ... }

// ✅
function parse<T extends Record<string, unknown>>(input: string): T { ... }

// 实在不知道类型时用 unknown + 类型守卫
function handle(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "number") return String(input);
  throw new Error("unsupported type");
}
```

### `type` vs `interface` 选择

| 用 `interface` | 用 `type` |
|---|---|
| 对象形状（可被继承/实现） | 联合类型、交叉类型 |
| 第三方库需要 declaration merging | 工具类型 / 映射类型 |
| React 组件 props | 条件类型 / infer |

**经验法则：** 默认用 `type`（更灵活），只在需要继承/merging 时用 `interface`。

## 泛型模式

### 约束泛型（Constrained Generics）

```typescript
// 确保 T 有 id 字段
function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find(item => item.id === id);
}
```

### 泛型推断（让调用方不写类型参数）

```typescript
// ❌ 强迫调用方手写类型
function createStore<T>(): Store<T> { ... }
const store = createStore<User>(); // 必须手写

// ✅ 从参数推断
function createStore<T>(initial: T): Store<T> { ... }
const store = createStore({ name: "", age: 0 }); // 自动推断
```

### 条件类型 + infer

```typescript
// 提取 Promise 内部类型
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T;

// 提取函数返回类型
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;

// 提取数组元素类型
type ElementOf<T> = T extends (infer E)[] ? E : never;
```

## 联合类型与收窄

### 可辨识联合（Discriminated Unions）

```typescript
// ✅ 用一个公共字面量字段区分
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

function handle(result: Result<User>) {
  if (result.success) {
    // TypeScript 知道这里是 { success: true; data: User }
    console.log(result.data.name);
  } else {
    // 这里是 { success: false; error: Error }
    console.error(result.error.message);
  }
}
```

### 穷举检查（Exhaustive Check）

```typescript
type Shape = "circle" | "rect" | "triangle";

function area(shape: Shape): number {
  switch (shape) {
    case "circle": return /* ... */;
    case "rect": return /* ... */;
    case "triangle": return /* ... */;
    default:
      // 编译期保证不会到这里；如果新增了 Shape 变体会报错
      const _exhaustive: never = shape;
      throw new Error(`Unknown shape: ${_exhaustive}`);
  }
}
```

## 实用工具类型

### 深度只读

```typescript
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
```

### 必填部分字段

```typescript
type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

// 用法：id 和 name 必填，其余可选
type CreateUser = RequireKeys<Partial<User>, "id" | "name">;
```

### 路径类型（用于深层访问）

```typescript
type PathOf<T, Prefix extends string = ""> = T extends object
  ? { [K in keyof T & string]:
      | `${Prefix}${K}`
      | PathOf<T[K], `${Prefix}${K}.`>
    }[keyof T & string]
  : never;
```

## Zod 与运行时校验

```typescript
import { z } from "zod";

// schema 既是验证器也是类型来源
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.coerce.date(),
});

// 从 schema 导出类型——DRY
type User = z.infer<typeof UserSchema>;

// 运行时校验
function createUser(input: unknown): User {
  return UserSchema.parse(input); // 失败抛 ZodError
}
```

## React + TypeScript 模式

### 组件 Props

```typescript
// 用 type，不用 interface（除非需要 merging）
type ButtonProps = {
  variant: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

// 扩展原生元素 props
type InputProps = Omit<React.ComponentPropsWithoutRef<"input">, "size"> & {
  size?: "sm" | "md" | "lg";
  error?: string;
};
```

### 泛型组件

```typescript
type ListProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string;
};

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return <>{items.map((item, i) => (
    <div key={keyExtractor(item)}>{renderItem(item, i)}</div>
  ))}</>;
}

// 使用时自动推断 T
<List items={users} renderItem={u => u.name} keyExtractor={u => u.id} />
```

## 常见陷阱

| 陷阱 | 正解 |
|------|------|
| `Object` / `{}` 当类型用 | `Record<string, unknown>` 或具体类型 |
| `as` 强转 | 用类型守卫或泛型约束 |
| `!` 非空断言到处用 | 用可选链 `?.` + nullish 合并 `??` |
| 枚举（`enum`） | `as const` 对象或联合字面量 |
| 返回 `Promise<any>` | 精确标注 `Promise<具体类型>` |
| 索引签名 `[key: string]: any` | 用 `Map<K, V>` 或精确键 |

## `as const` 替代 enum

```typescript
// ❌ enum（运行时有开销、tree-shake 不掉、扩展不便）
enum Status { Active, Inactive }

// ✅ as const + 类型推导
const STATUS = { Active: "active", Inactive: "inactive" } as const;
type Status = (typeof STATUS)[keyof typeof STATUS]; // "active" | "inactive"
```

## 错误处理模式

```typescript
// 用 Result 类型替代 try-catch 纷飞
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) return { ok: false, error: new Error(`HTTP ${res.status}`) };
    return { ok: true, value: await res.json() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
```

## wraith 说明

- 桌面端 TypeScript 代码在 `desktop/src/`，用 Electron + React + Zustand
- 类型定义集中在 `desktop/src/shared/types.ts`
- IPC 类型桥在 `desktop/src/preload/index.ts`
- 改类型时注意 main/preload/renderer 三进程边界的一致性
- `tsc --noEmit` 快速 typecheck，`npx vitest run` 跑测试

---
> 本技能灵感来自 Matt Pocock 的 TypeScript 教学、Total TypeScript 与社区最佳实践。
