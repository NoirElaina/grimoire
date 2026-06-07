---
title: RAG Rerank 与交叉编码器
sidebarTitle: RAG Rerank
---

# RAG Rerank 与交叉编码器

向量检索已经有相似度，为什么还要 rerank？

因为向量检索和 rerank 解决的是两个不同阶段的问题：

```text
向量检索：从海量文档里快速找候选。
Rerank：在少量候选里精细排序。
```

向量检索追求召回速度。

交叉编码器 rerank 追求排序精度。

## 两阶段检索

生产 RAG 常见链路：

```text
query
  -> query rewrite
  -> 向量检索 / BM25 / hybrid search
  -> 召回 top50
  -> cross-encoder rerank
  -> 保留 top5 / top8
  -> parent chunk / 相邻 chunk 扩展
  -> prompt context
  -> LLM answer
```

第一阶段要“宁可多召回一点”。

第二阶段要“把真正相关的排到前面”。

## Bi-Encoder 和 Cross-Encoder 的区别

向量检索通常是 bi-encoder。

```text
文档 -> encoder -> doc vector
问题 -> encoder -> query vector
相似度 = cosine(query vector, doc vector)
```

文档向量是提前算好的。

查询时只算 query vector，然后做向量相似度搜索。

优点：

- 快。
- 可预计算。
- 能处理百万、千万级文档。

缺点：

- 文档被压缩成一个向量。
- 文档向量生成时看不到用户问题。
- 对否定、条件、数字、表格、细粒度约束不够敏感。

交叉编码器是另一种方式：

```text
[query, document] -> transformer -> relevance score
```

它把 query 和 document 放在一起输入模型。

模型可以让 query token 和 document token 做交叉注意力。

优点：

- 能做更细粒度匹配。
- 能理解条件、限定词、否定和上下文关系。
- 排序质量通常比单纯向量相似度更好。

缺点：

- 慢。
- 不能提前为所有文档算分。
- 成本和候选数量、文档长度强相关。

所以它不能替代第一阶段检索。

它适合处理已经召回的一小批候选。

## 为什么向量相似度不够

### 1. 一个向量会压缩太多含义

一个 800 tokens 的 chunk 可能包含：

```text
订单创建
库存扣减
延迟队列
死信队列
支付状态
```

embedding 会把它压成一个向量。

这个向量可能对“订单超时取消”相关，也可能对“库存扣减”相关。

但用户真正问的是：

```text
订单超时后为什么要做幂等？
```

向量相似度只能给一个整体近似。

cross-encoder 可以逐 token 对齐 query 和 chunk，看 chunk 是否真的回答“幂等原因”。

### 2. 关键词和语义会错位

用户问：

```text
订单未支付多久会关闭？
```

文档写：

```text
订单创建后 30 分钟未完成支付，系统发送超时取消消息。
```

向量检索可能能召回。

但如果 topK 里还有很多“订单关闭”“支付状态”“取消订单”的片段，rerank 可以更精确地把含有“30 分钟 + 未支付 + 取消”的片段排前。

### 3. 否定和条件容易被弱化

用户问：

```text
已支付订单会被超时取消吗？
```

文档：

```text
消费者收到超时消息后必须查询订单状态，只有未支付订单才能取消，已支付订单直接忽略。
```

向量相似度可能把“订单超时取消”的所有片段都排很高。

cross-encoder 更容易关注“已支付”“不能取消”“直接忽略”这种条件关系。

### 4. 多路召回需要统一排序

很多 RAG 会混合：

```text
vector search
BM25
metadata filter
keyword boost
graph retrieval
```

不同检索器分数不可直接比较。

rerank 可以把多路候选统一按 query-document 相关性重新打分。

## Rerank 放在哪里

推荐位置：

```text
召回候选之后，进入 prompt 之前。
```

不要对全库 rerank。

也不要在已经裁剪到 top3 后才 rerank。

常见参数：

```text
retrieval_top_k = 30-100
rerank_top_n = 5-10
max_doc_tokens_for_rerank = 300-800
```

如果 chunk 很长，可以只给 reranker：

- chunk 标题。
- sectionPath。
- 命中文本。
- 关键前后文。

避免把 2000 tokens parent chunk 全量丢给 reranker，成本会很高。

## 什么时候值得上 Rerank

值得：

- topK 里经常有相关但不准确的结果。
- 用户问题有条件、否定、数字、时间、权限、范围。
- 使用 hybrid search，多路召回分数不好合并。
- 文档很多、同主题内容很多。
- RAG 答案经常“方向对，但证据不准”。
- 需要减少最终 prompt 里的噪声。

不一定值得：

- 文档规模很小。
- 问题都是简单 FAQ。
- top1 已经非常稳定。
- 延迟预算极低。
- 没有评测集，无法证明 rerank 变好。

## 如何评估 Rerank 是否有效

不要只看“感觉答案更好”。

要比较 rerank 前后同一批样本。

### 离线评测

评测数据：

```json
{
  "question": "已支付订单会被超时取消吗？",
  "goldChunkIds": ["order-timeout:status-check:002"],
  "goldDocIds": ["order-timeout"],
  "referenceAnswer": "不会。消费者收到超时消息后需要查询订单状态，只有未支付订单才取消，已支付订单忽略。"
}
```

对比：

```text
baseline：vector / hybrid topK
experiment：vector / hybrid topK -> rerank topN
```

### 检索排序指标

| 指标 | 看什么 |
| --- | --- |
| `MRR@K` | 第一个正确证据是否更靠前 |
| `nDCG@K` | 分级相关结果整体排序是否变好 |
| `Hit@K` | 前 K 个是否有正确证据 |
| `Recall@K` | 正确证据是否仍被保留 |
| `Precision@K` | 前 K 个噪声是否减少 |
| `Top1 Accuracy` | 第一条是否就是正确证据 |

重点看：

```text
MRR@5
nDCG@5
Precision@5
Top1 Accuracy
```

因为 rerank 的目标不是扩大召回，而是把正确证据排前。

### Rerank Drop Rate

这是很重要但经常漏掉的指标。

```text
Rerank Drop Rate =
  召回阶段命中的 gold chunk 被 rerank 排除出 topN 的样本数
  / 召回阶段命中 gold chunk 的样本数
```

如果这个值高，说明 reranker 在伤害结果。

常见原因：

- reranker 不适合语言或领域。
- chunk 太长，关键句被淹没。
- reranker 输入没有带标题路径。
- 召回候选里正确证据太弱。
- query rewrite 改坏了原问题。

### 生成指标

rerank 最终服务于回答，所以还要看：

| 指标 | 看什么 |
| --- | --- |
| `Answer Accuracy` | 最终答案是否更对 |
| `Faithfulness` | 回答是否更依赖证据 |
| `Citation Precision` | 引用是否更准 |
| `Context Token Cost` | prompt 是否更短 |
| `Latency` | 延迟是否可接受 |
| `Cost/query` | 单次成本是否可接受 |

如果 rerank 让 `MRR` 提高，但 `Answer Accuracy` 没提高，要检查：

- prompt 是否没有用排序结果。
- parent chunk 扩展是否引入噪声。
- LLM 是否忽略靠前证据。
- 答案格式是否限制不足。

### A/B 表

```text
配置 A：hybrid top8 直接进 prompt
配置 B：hybrid top50 -> rerank top8
```

| 指标 | A | B | 判断 |
| --- | --- | --- | --- |
| `Recall@50` | 0.86 | 0.86 | 召回池相同 |
| `MRR@8` | 0.42 | 0.71 | B 排序明显更好 |
| `Precision@8` | 0.38 | 0.62 | B 噪声更少 |
| `Answer Accuracy` | 0.68 | 0.77 | B 回答更好 |
| `Faithfulness` | 0.74 | 0.84 | B 更接地 |
| `p95 latency` | 900ms | 1700ms | B 成本更高 |
| `cost/query` | 低 | 中 | 看业务能否接受 |

是否上线不是只看质量。

要看质量提升是否值得额外延迟和成本。

## Rerank 的输入怎么设计

不要只把正文丢进去。

推荐输入：

```text
标题：Spring 事务
章节：事务传播行为 > REQUIRES_NEW
正文：REQUIRES_NEW 会挂起当前事务，并开启一个新事务...
来源：spring-transaction.md
```

标题路径能帮助 reranker 判断上下文。

但也不要塞太多 metadata。

无关 metadata 会变成噪声。

## 常见坑

### 候选池太小

```text
vector top5 -> rerank top5
```

这基本没意义。

rerank 只能重排候选，不能找回没召回的文档。

候选池一般要比最终 topN 大很多。

### rerank 后没去重

同一 parent 下多个 child 都排前，会浪费上下文。

处理：

```text
rerank child chunks
  -> 按 parentId 去重
  -> 拉 parent chunk
```

### 只看 rerank score

rerank score 不一定有跨 query 可比性。

更可靠的是看排序指标和端到端答案指标。

### 模型语言不匹配

英文训练的 reranker 对中文、代码、表格、行业术语可能不稳定。

必须用自己的评测集测。

## 去空话检查

- [ ] 是否区分 bi-encoder 召回和 cross-encoder rerank。
- [ ] 是否明确 rerank 只处理候选集，不负责全库召回。
- [ ] 是否比较 rerank 前后的 `MRR`、`nDCG`、`Precision@K`。
- [ ] 是否统计 `Rerank Drop Rate`。
- [ ] 是否同时看答案质量、引用、延迟和成本。
- [ ] 是否确认 reranker 适合语言、领域和文档格式。
- [ ] 是否避免候选池太小。
- [ ] 是否按 `parentId` 去重后再进 prompt。

## 参考

- [Pinecone: Rerankers and Two-Stage Retrieval](https://www.pinecone.io/learn/series/rag/rerankers/)
- [Cohere Rerank Overview](https://docs.cohere.com/docs/reranking)
- [RAG 系统评测指标](/notes/agents/rag-evaluation-metrics)
