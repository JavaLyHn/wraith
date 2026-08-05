---
name: performance-optimization
description: |
  性能问题的诊断与优化：慢查询、高内存占用、CPU 瓶颈、启动慢、响应延迟、大文件处理慢、并发瓶颈。当用户说「太慢了 / 性能不行 / 内存溢出 / OOM / 卡顿 / 优化性能 / 为什么这么慢 / CPU 占用高 / GC 太频繁」时使用。
  触发场景：用户报告性能问题、请求优化、或遇到资源瓶颈（内存/CPU/IO/网络延迟）时。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [process, performance, optimization]
---

# 性能优化（Performance Optimization）

## 概述

优化的第一条规则：**先测量，后优化。** 没有 profiling 数据的优化是猜测。

**核心原则：找到瓶颈再动手，不要凭直觉优化「看起来慢」的代码。**

## 铁律

```
没有基准测量，就没有优化
```

## 四个阶段

### 阶段一：定义问题

1. **量化「慢」** —— 多慢？期望多快？当前 P50/P99 是多少？
2. **确认瓶颈类型** —— CPU 密集？IO 等待？内存不足？网络延迟？
3. **确认复现路径** —— 什么操作触发？什么规模的数据？

### 阶段二：测量

**Java 侧：**
```bash
# 简单计时
long start = System.nanoTime();
// ... 操作
long elapsed = (System.nanoTime() - start) / 1_000_000;
System.out.println("耗时: " + elapsed + "ms");

# JVM 参数观察 GC
java -Xlog:gc*:stdout -jar target/wraith-1.0-SNAPSHOT.jar

# Flight Recorder（生产安全）
java -XX:StartFlightRecording=duration=60s,filename=rec.jfr -jar app.jar

# 堆分析
jmap -dump:live,format=b,file=heap.hprof <pid>
jhat heap.hprof  # 或用 VisualVM / MAT
```

**TypeScript/Node 侧：**
```typescript
// 简单计时
console.time("operation");
await heavyWork();
console.timeEnd("operation");

// Chrome DevTools Performance tab 录制
// Node.js: --prof / --inspect + Chrome DevTools
```

**通用原则：**
- 在真实数据规模下测量，不是小样本
- 测多次取中位数，不取单次
- 区分冷启动和热运行

### 阶段三：分析与优化

**按影响从大到小的常见优化：**

| 层次 | 手段 | 典型收益 |
|------|------|----------|
| **算法** | O(n²) → O(n log n) | 10x-1000x |
| **IO** | 批量读写、连接池、缓存 | 5x-100x |
| **并发** | 并行处理、异步 IO | 2x-Nx |
| **内存** | 对象池、避免大临时对象、流式处理 | 2x-10x |
| **JIT/编译** | 热路径内联、避免反射 | 1.2x-3x |
| **微优化** | StringBuilder、数组替代链表 | 1.1x-1.5x |

**优先级：先优化高层（算法/IO），微优化放最后。**

### 常见场景速查

**大文件处理慢：**
- 流式读取替代一次性读入内存
- 分块处理（chunk by chunk）
- NIO / memory-mapped file

**启动慢：**
- 延迟加载（lazy init）
- 并行初始化无依赖模块
- 减少类扫描范围

**内存溢出 (OOM)：**
- 堆转储分析找最大对象
- 检查集合只增不减（内存泄漏）
- 弱引用 / 软引用用于缓存
- 流式替代大列表

**高 CPU：**
- 线程转储找忙循环：`jstack <pid>`
- 检查不必要的正则回溯
- 缓存重复计算结果

**数据库慢查询：**
- EXPLAIN 看执行计划
- 加索引（但别过度索引）
- 批量操作替代逐条
- N+1 问题：用 JOIN 或批量预加载

### 阶段四：验证

1. **对比基准** —— 同条件再测，对比优化前后
2. **无回归** —— 全量测试通过
3. **边界情况** —— 空输入、超大输入、并发极限
4. **不要过度优化** —— 达到目标就停

## 常见误区

| 误区 | 真相 |
|------|------|
| 「用了 StringBuilder 就快了」 | 单次拼接没区别，循环内才有意义 |
| 「缓存一切」 | 缓存引入一致性问题，只缓存热路径 |
| 「多线程一定快」 | 线程切换有开销，IO 密集用异步更好 |
| 「HashMap 最快」 | 小集合 ArrayList + 线性搜索可能更快 |
| 「先优化再测」 | 先测再优化，否则在猜 |

## 不要做的事

- ❌ 没测量就优化
- ❌ 优化不在热路径上的代码
- ❌ 用可读性换微不足道的性能提升
- ❌ 过早优化（功能没做完就优化）
- ❌ 忽略 GC 影响（Java 里 GC 暂停可能是最大延迟源）

## wraith 说明

- `CodeIndex` 索引大项目可能慢 → 检查分块策略和 embedding 批量大小
- MCP server 启动超时 → 检查 `WRAITH_MCP_STARTUP_WAIT_SECONDS` 配置
- 上下文窗口接近上限时自动压缩可能引入延迟 → 检查压缩阈值设置
- `grep_code` 优先用 ripgrep（比 Java 扫描快 5-10x）

---
> 本技能综合性能工程最佳实践编写。
