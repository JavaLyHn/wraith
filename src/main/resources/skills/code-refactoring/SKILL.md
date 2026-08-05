---
name: code-refactoring
description: |
  重构、清理、改善现有代码质量时使用：当代码能跑但存在坏味道（过长函数、重复逻辑、命名不清、耦合过重、职责混乱）、或用户明确要求「重构 / 优化结构 / 减少重复 / 提取接口 / 拆分文件 / 简化逻辑」时。
  触发场景：用户说「帮我重构这段代码 / 这个文件太大了 / 这段逻辑能简化吗 / 提取公共方法 / 减少耦合 / clean up / DRY / 代码太乱了」。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [process, quality, refactoring]
---

# 代码重构（Code Refactoring）

## 概述

重构是在**不改变外部行为**的前提下，改善代码内部结构。

**核心原则：每一步都保持绿灯（测试通过），绝不大爆炸式重写。**

## 铁律

```
没有测试覆盖的代码，先补测试再重构
```

## 何时用

- 代码能跑但可读性差、维护成本高
- 添加新功能前需要先理顺结构
- 代码审查发现坏味道
- 文件过大、职责不清
- 重复代码散落多处
- 用户明确要求 clean up / 重构 / 简化

## 四个阶段

### 阶段一：理解现状

**重构前必须回答：**

1. **这段代码做什么？** —— 读代码、读测试、读调用方。不懂就别动。
2. **有测试吗？** —— `grep_code` 找对应测试文件。没有 → 先用 test-driven-development 补。
3. **谁依赖它？** —— `grep_code` 搜类名/函数名/接口名，画出依赖图。
4. **改动半径多大？** —— 内部重构（不改公开接口）= 安全；改接口 = 要连带改调用方。

### 阶段二：识别坏味道

**常见坏味道（按危害排序）：**

| 坏味道 | 信号 | 典型手法 |
|--------|------|----------|
| **过长方法** | > 30 行、多层缩进、多个职责 | 提取方法 |
| **重复代码** | 两处以上相同/相似逻辑 | 提取公共方法/模板方法 |
| **过大类** | > 500 行、字段过多、方法分群 | 拆分类、提取接口 |
| **特性依恋** | 方法频繁访问其他类的数据 | 搬移方法 |
| **数据泥团** | 多个参数总是一起出现 | 引入参数对象 |
| **过长参数列表** | > 4 个参数 | 参数对象/Builder |
| **Switch/if 链** | 每加一个变体要改多处 | 多态/策略模式 |
| **平行继承层次** | 加一个子类要在两个层次同时加 | 合并或委托 |
| **注释补偿** | 大段注释解释「为什么这么绕」 | 重命名+简化让代码自解释 |
| **死代码** | 从未被调用的方法/分支 | 直接删除 |

### 阶段三：计划与执行

**每个重构手法是一个微提交：**

1. **选一个坏味道** —— 从最高危害开始
2. **确认测试绿灯** —— `mvn test` / `vitest run`
3. **做最小一步** —— 只做一个重构手法（提取/搬移/重命名/内联）
4. **跑测试** —— 绿灯继续；红灯立即 revert 本步
5. **提交** —— `git commit -m "refactor: <做了什么>"`
6. **重复** —— 直到坏味道消除

**纪律：**
- 一步只做一件事：不要「提取方法的同时改参数类型」
- 重构和功能变更分开提交：不要偷偷加行为
- IDE 自动重构优先：rename / extract 用工具做更安全
- 不确定就 revert：已提交的步骤永远是安全点

### 阶段四：验证

1. **全量测试** —— 不只是被改文件的测试
2. **diff 审阅** —— `git diff --stat` 确认改动范围符合预期
3. **行为不变** —— 从外部看，输入输出完全一致
4. **可读性提升** —— 让第三方读，是否比之前更容易理解

## 常见重构手法速查

### 提取方法（Extract Method）

```java
// Before
void processOrder(Order order) {
    // validate
    if (order.items().isEmpty()) throw new IllegalArgumentException("empty");
    if (order.total() < 0) throw new IllegalArgumentException("negative");
    // calculate
    double discount = order.isVip() ? 0.1 : 0;
    double finalPrice = order.total() * (1 - discount);
    // save
    db.save(order.withPrice(finalPrice));
}

// After
void processOrder(Order order) {
    validateOrder(order);
    double finalPrice = calculatePrice(order);
    db.save(order.withPrice(finalPrice));
}
```

### 提取接口（Extract Interface）

当调用方只用一个类的部分方法时，提取接口减少耦合。

### 搬移方法（Move Method）

方法频繁访问另一个类的字段 → 搬到那个类里去。

### 以多态替代条件式

```java
// Before: switch on type
double area(Shape s) {
    return switch (s.type()) {
        case "circle" -> Math.PI * s.radius() * s.radius();
        case "rect" -> s.width() * s.height();
        default -> 0;
    };
}

// After: 每个 Shape 子类自己实现 area()
```

## 危险信号——停

- 想「大重写」—— 停。先确认能分成多个安全步骤。
- 「重构顺便修个 bug」—— 停。分开做，分开提交。
- 「先重构完再补测试」—— 停。没测试保护就是盲人开车。
- 「这次改动太大不好拆」—— 停。重新想拆法。

## 与其他 skill 的关系

- **test-driven-development**：重构前补测试用 TDD
- **systematic-debugging**：重构中测试红了按调试流程走
- **verification-before-completion**：重构完跑全量验证

## wraith 说明

- 后端 Java 重构验证：`mvn compile` 确认编译 → `mvn test -Pquick` 回归
- 桌面 TS 重构验证：`tsc --noEmit` typecheck → `npx vitest run`
- `grep_code` + `glob_files` 快速定位调用方与依赖
- 大文件拆分后记得更新 `AGENTS.md` 仓库结构段

---
> 本技能综合 Martin Fowler《重构》与社区最佳实践编写。
