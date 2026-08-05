# CONTEXT.md 格式

## 结构

```md
# {上下文名}

{一两句：这个上下文是什么、为什么存在。}

## 语言

**Order**:
{一两句描述}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## 规则

- **有主见。**同一概念有多个词时，选最好的那个，其余列在 `_Avoid_` 下。
- **定义要紧。**一两句。定义它*是*什么，不是它*做*什么。
- **只放本上下文特有的术语。**通用编程概念（超时、错误类型、工具模式）不该出现，哪怕项目大量用它们。加词前问：这是本上下文独有的概念，还是通用编程概念？只前者属于。
- 术语自然成簇时**按子标题分组**。若都属单一连贯区域，平铺也行。

## 单上下文 vs 多上下文仓库

**单上下文（大多数仓库）：**仓库根一个 `CONTEXT.md`。

**多上下文：**仓库根一个 `CONTEXT-MAP.md`，列出上下文、在哪、彼此关系：

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — 接收并跟踪客户订单
- [Billing](./src/billing/CONTEXT.md) — 生成发票并处理付款
- [Fulfillment](./src/fulfillment/CONTEXT.md) — 管理仓库拣货发货

## Relationships

- **Ordering → Fulfillment**: Ordering 发 `OrderPlaced` 事件；Fulfillment 消费以开始拣货
- **Fulfillment → Billing**: Fulfillment 发 `ShipmentDispatched` 事件；Billing 消费以生成发票
- **Ordering ↔ Billing**: 共享 `CustomerId` 与 `Money` 类型
```

技能据此推断适用哪种结构：

- 有 `CONTEXT-MAP.md` → 读它找上下文
- 只有根 `CONTEXT.md` → 单上下文
- 都没有 → 第一个术语敲定时懒建根 `CONTEXT.md`

多上下文时，推断当前话题属于哪个上下文。不清楚就问。
