---
title: RAG 向量检索地基
sidebarTitle: RAG 向量检索
---

# RAG 向量检索地基

RAG 的检索层不要只理解成“存向量，然后相似度搜索”。

生产检索层至少包含：

```text
文档解析
  -> 切片
  -> embedding
  -> 向量索引
  -> metadata 过滤
  -> 关键词 / 向量 / 混合召回
  -> rerank
  -> 上下文组装
  -> 评测和回放
```

向量数据库和 embedding 模型只是其中两块。

## 常见向量数据库

向量数据库的核心能力：

- 存向量。
- 建 ANN 索引，例如 HNSW、IVF、DiskANN 等。
- 做相似度检索。
- 保存 payload / metadata。
- 支持过滤、分片、复制、备份、权限、监控。

常见选择：

| 类型 | 产品 | 特点 | 适合 |
| --- | --- | --- | --- |
| 托管向量库 | Pinecone | 托管服务，运维成本低，面向大规模向量检索 | 不想自运维、线上 RAG |
| 开源向量库 | Milvus / Zilliz | 分布式能力强，适合大规模向量 | 海量向量、独立检索集群 |
| 开源向量库 | Qdrant | payload filter 体验好，API 简洁 | 需要复杂 metadata 过滤 |
| 开源向量库 | Weaviate | 原生 keyword / vector / hybrid search 思路清晰 | 混合检索、知识库 |
| 搜索引擎 | Elasticsearch / OpenSearch | 倒排索引成熟，也支持向量检索 | 已有 ES 体系、需要 hybrid |
| PostgreSQL 扩展 | pgvector | 直接在 Postgres 里做向量检索 | 中小规模、业务数据和向量同库 |
| 本地库 | FAISS | 高性能向量检索库，不是完整数据库 | 离线实验、本地索引 |
| 轻量向量库 | Chroma / LanceDB | 上手简单，本地和实验友好 | demo、原型、单机知识库 |
| 多模态/搜索平台 | Vespa | 搜索、推荐、排序能力强 | 复杂排序和线上搜索系统 |
| Redis 生态 | Redis Vector / RedisVL | 低延迟、缓存生态 | 小规模低延迟检索、缓存型场景 |

不要只按“谁最火”选。

按这些问题选：

```text
数据量多大？
是否需要复杂过滤？
是否需要 hybrid search？
是否已经有 ES / PostgreSQL？
是否需要多租户权限？
是否要云托管？
是否要跨 region？
是否有增量更新和删除？
是否需要向量版本管理？
```

## 选型建议

### 已经有 PostgreSQL

先考虑 `pgvector`。

适合：

- 向量量级不大。
- 业务数据和文档 metadata 已经在 Postgres。
- 想减少系统组件。
- 可以接受数据库承担检索压力。

风险：

- 超大规模 ANN 性能要实测。
- 检索和业务写入会互相影响。
- 高并发 RAG 需要独立资源隔离。

### 已经有 Elasticsearch

不要急着全切向量库。

可以先做 hybrid：

```text
BM25 / keyword
  + dense vector
  + metadata filter
  + rerank
```

ES 的优势仍然很强：

- 精确关键词。
- 布尔查询。
- 过滤。
- 排序。
- 聚合。
- 高亮。
- 权限过滤。
- 运维体系成熟。

如果只是增加语义召回，可以先在 ES 里加向量字段和 kNN 检索。

### 文档规模很大

考虑 Milvus、Qdrant、Weaviate、Pinecone 这类专门向量系统。

关注：

- 索引构建速度。
- 增量写入。
- filter + vector 的性能。
- 多租户隔离。
- 备份恢复。
- 观测指标。
- SDK 和运维复杂度。

### 原型阶段

可以用 Chroma、FAISS、LanceDB。

但要知道：

```text
原型库能跑通 RAG，不等于能支撑生产权限、增量更新、备份和审计。
```

## 常见 Embedding 模型

Embedding 模型负责把文本转成向量。

选模型时不要只看排行榜。

要看：

- 语言：中文、英文、多语言。
- 领域：代码、法律、金融、医学、企业文档。
- 上下文长度。
- 维度。
- 成本。
- 延迟。
- 是否可私有化。
- 是否支持 query / document 不同 prompt。
- 是否支持 dense、sparse、multi-vector。

常见模型：

| 类型 | 模型 | 特点 |
| --- | --- | --- |
| API | OpenAI `text-embedding-3-small` / `text-embedding-3-large` | 通用、稳定，多语言表现好 |
| API | Cohere Embed 系列 | 检索场景成熟，提供 rerank 生态 |
| API | Voyage Embedding 系列 | 面向检索优化，常用于 RAG |
| 开源 | BAAI `bge-m3` | 多语言、多功能，支持 dense / sparse / multi-vector 思路 |
| 开源 | E5 / multilingual-e5 | 检索常用，需要 query/passsage 前缀习惯 |
| 开源 | GTE / Qwen3-Embedding | 中文和多语言场景常见 |
| 开源 | Jina Embeddings | 长文本、多语言、多模态方向活跃 |
| 开源 | Nomic Embed | 开源生态友好，适合本地部署 |
| 开源 | Snowflake Arctic Embed | 企业检索和开源部署常见 |
| 轻量 | `all-MiniLM` / `mpnet` | 轻量、便宜、适合小规模 baseline |

## Embedding 选型方法

不要直接说“用最好的 embedding”。

按这个流程选：

```text
1. 准备自己的评测集。
2. 固定切片策略。
3. 用多个 embedding 模型重建索引。
4. 比较 Recall@K、MRR、nDCG、延迟和成本。
5. 看失败样本，而不是只看平均分。
6. 决定是否需要混合检索和 rerank。
```

最少比较：

```text
便宜 API 模型
高质量 API 模型
一个中文/多语言开源模型
一个轻量本地模型
```

不要只看 MTEB。

MTEB 是参考，自己的文档、问题、切片、语言和业务约束才是最终标准。

## 从 ES 切到向量检索会提升什么

如果原来主要靠 ES 的关键词检索，切向量后会提升：

| 能力 | 为什么提升 |
| --- | --- |
| 语义召回 | 不要求用户问题和文档关键词完全一致 |
| 同义表达 | “退款多久到账”和“退费处理时长”可以匹配 |
| 口语化问题 | 用户不懂专业词也能搜到相关文档 |
| 多语言匹配 | 多语言 embedding 可以跨语言召回 |
| 长尾问题 | 不常见表达不一定需要人工配同义词 |
| 概念相似 | 能搜到主题相近的内容 |
| RAG 适配 | 检索结果更适合给 LLM 生成答案 |

例子：

```text
用户问：订单一直没发货怎么办？
文档写：超过承诺发货时间后，用户可发起履约异常工单。
```

纯关键词可能搜不到。

向量检索更可能召回。

## 从 ES 切到向量检索会下降什么

向量检索也会损失能力。

| 能力 | 为什么下降 |
| --- | --- |
| 精确关键词 | embedding 会做语义近似，不保证词面命中 |
| 布尔查询 | `A AND B NOT C` 这类精确逻辑不是向量强项 |
| 数字和枚举 | 金额、版本号、订单号、错误码容易被弱化 |
| 排序和聚合 | ES 的排序、聚合、高亮更成熟 |
| 可解释性 | BM25 命中词更容易解释，向量相似度不直观 |
| 权限和过滤 | 向量库 filter 能力差异很大，要实测 |
| 稳定性 | 相似度结果可能受模型和切片变化影响 |
| 精确否定 | “不支持”“不能”“除非”容易被语义检索冲淡 |

例子：

```text
用户问：ERR_40213 是什么？
```

关键词检索很强。

向量检索可能把它当成普通字符串，效果反而差。

## 不建议纯切向量

更推荐 hybrid。

```text
ES / BM25：负责精确词、错误码、术语、过滤。
Vector：负责语义、同义、口语化、跨语言。
Rerank：负责把候选统一精排。
```

典型链路：

```text
query
  -> BM25 top50
  -> vector top50
  -> 合并去重
  -> metadata filter
  -> rerank top10
  -> parent chunk / 相邻扩展
  -> LLM
```

如果必须从 ES 迁移，先做灰度：

```text
阶段 1：ES 原链路不动，旁路记录 vector 结果。
阶段 2：线上返回仍用 ES，但评估 hybrid 是否更好。
阶段 3：小流量切 hybrid。
阶段 4：保留 ES 兜底和精确查询通道。
```

## Recall@5 怎么做到 91.2%

先说清楚：`Recall@5 = 91.2%` 不是一个通用魔法数。

它通常表示：

```text
在评测集中，有 91.2% 的标准证据出现在检索结果前 5 个里。
```

如果报告里写这个数字，必须同时说明：

- 评测集多少条。
- 标准证据怎么标注。
- 是按 `goldChunkIds` 还是 `goldDocIds`。
- 是 dense search、hybrid search，还是 rerank 后 top5。
- 是否包含无答案样本。
- 是否按问题类型分桶。

提升到 90% 以上通常靠组合拳：

```text
1. 文档解析正确：表格、标题、代码块没有被切坏。
2. chunk 粒度合理：child chunk 精准，parent chunk 保上下文。
3. metadata 完整：docId、sectionPath、版本、权限、产品线。
4. query rewrite：把口语问题改写成检索友好表达。
5. hybrid search：BM25 + dense vector。
6. rerank：把真正回答问题的片段排到前 5。
7. embedding 模型适配：中文、领域术语、长文本都测过。
8. 失败样本复盘：每次只针对明确失败类型修。
```

不要只调 topK。

topK 变大可以提高 Recall@K，但不等于 Recall@5 变好。

Recall@5 要靠排序质量。

## 怎么防止检索评测过拟合

RAG 评测也会过拟合。

常见过拟合：

- 只优化固定 100 条问题。
- 把评测问题原文写进文档或 query rewrite 规则。
- 针对某些问题手工调 boost。
- 切片策略只适合当前样本。
- reranker prompt 针对测试集答案写。
- 每次失败都加特例规则。

防止方法：

```text
训练集 / 调参集 / 验收集分开。
不要用验收集调参数。
每类问题都分桶统计。
保留线上真实问题回放集。
定期加入新文档和新问法。
记录每次参数变更和指标变化。
评估新策略时看全量指标，不只看 Recall@5。
```

推荐数据集结构：

```text
dev set：日常调参。
validation set：每次改策略后看是否提升。
holdout set：上线前才跑，不参与调参。
online sample set：线上抽样，定期人工复核。
```

## 评测集要不要更新

要更新，但不能随便覆盖旧集。

正确做法：

```text
旧评测集：保留，用来防回归。
新增评测集：来自线上失败、新文档、新产品、新问题类型。
废弃样本：只标记 inactive，不直接删除。
版本记录：每次评测集变化都记录原因。
```

评测集版本示例：

```json
{
  "datasetVersion": "rag-eval-v2026-06-07",
  "added": [
    "新增 30 条 Rerank 失败样本",
    "新增 20 条权限过滤样本"
  ],
  "deprecated": [
    "旧支付流程文档已下线，相关 8 条样本标记 inactive"
  ],
  "holdoutChanged": false
}
```

注意：

```text
可以更新评测集。
不能一边看验收集结果一边调到刚好过。
```

## 还有哪些优化策略

按优先级：

### 1. 数据治理

- 删除重复文档。
- 标记旧版本文档。
- 修正错误标题。
- 表格结构化。
- 文档加产品线、权限、版本 metadata。

很多 RAG 问题不是模型问题，是数据脏。

### 2. 切片优化

- 标题结构切片。
- 父子切片。
- 表格单独处理。
- 代码按函数切。
- overlap 控制在合理范围。

### 3. 检索优化

- BM25 + vector hybrid。
- query rewrite。
- query expansion。
- metadata filter。
- 多路召回合并。
- rerank。

### 4. 上下文优化

- parent chunk / 相邻扩展。
- 去重。
- 证据排序。
- 控制 token budget。
- 防 Lost in the Middle。

### 5. 生成优化

- 要求基于证据回答。
- 无证据拒答。
- 输出引用。
- 结构化答案。
- 限制模型补充常识。

### 6. 评测优化

- 分桶评测。
- 保存 trace。
- 失败归因。
- A/B 对比。
- 线上抽样复核。

## 去空话检查

- [ ] 是否区分向量库、embedding、检索策略和 rerank。
- [ ] 是否知道 ES 的精确检索能力不能被向量完全替代。
- [ ] 是否知道 hybrid 比纯向量更稳。
- [ ] 是否按自己的评测集选 embedding。
- [ ] 是否说明 Recall@5 的分母和 gold evidence。
- [ ] 是否有 dev / validation / holdout 分离。
- [ ] 是否记录评测集版本。
- [ ] 是否用失败归因驱动优化。

## 参考

- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [Elasticsearch Vector Search](https://www.elastic.co/docs/solutions/search/vector)
- [Weaviate Hybrid Search](https://weaviate.io/developers/weaviate/search/hybrid)
- [Qdrant Overview](https://qdrant.tech/documentation/overview/what-is-qdrant/)
- [Milvus Overview](https://milvus.io/docs/overview.md)
- [pgvector](https://github.com/pgvector/pgvector)
- [BGE-M3](https://huggingface.co/BAAI/bge-m3)
- [Qwen3 Embedding](https://huggingface.co/Qwen/Qwen3-Embedding-8B)
- [RAG 系统评测指标](/notes/agents/rag-evaluation-metrics)
- [RAG Rerank](/notes/agents/rag-rerank-cross-encoder)
