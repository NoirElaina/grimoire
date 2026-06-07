---
title: RAG 系统评测指标
sidebarTitle: RAG 系统评测
---

# RAG 系统评测指标

RAG 评测不能只看“答案对不对”。

因为一个 RAG 系统至少由这些环节组成：

```text
用户问题
  -> query rewrite / query expansion
  -> retrieval
  -> rerank
  -> context packing
  -> generation
  -> citation
  -> refusal / safety
```

最终答案错了，可能是：

- 没检索到正确证据。
- 检索到了，但排在太后面。
- 检索到了，但上下文拼装时被裁掉。
- 证据在上下文里，但模型没用。
- 模型用了证据，但引用错了。
- 问题本来无答案，但模型硬答了。

所以 RAG 评测要分层设计。

## 评测维度总览

| 层级 | 评测问题 | 常用指标 |
| --- | --- | --- |
| 检索覆盖 | 正确证据有没有被找回来 | `Recall@K`、`Hit@K`、`MRR`、`nDCG`、`Context Recall` |
| 检索精度 | 找回来的内容是不是相关 | `Precision@K`、`Context Precision`、`Context Relevance`、噪声率 |
| 重排质量 | rerank 后正确证据是否更靠前 | rerank 前后 `MRR`、`nDCG`、Top1 命中率 |
| 上下文组装 | 放进 prompt 的证据是否完整且不过载 | context token cost、重复率、证据覆盖率、裁剪丢失率 |
| 答案质量 | 回答是否正确、完整、直接回答问题 | answer accuracy、answer relevancy、completeness、key point recall |
| 忠实度 | 回答是否被检索证据支持 | faithfulness、groundedness、unsupported claim rate |
| 引用质量 | 引用是否指向真实证据 | citation precision、citation recall、source accuracy |
| 拒答能力 | 无答案时是否拒答 | refusal accuracy、over-refusal rate、hallucination on unknown |
| 鲁棒性 | 改写、长问题、多跳、表格是否稳定 | paraphrase consistency、multi-hop success、table QA accuracy |
| 线上质量 | 生产环境是否稳定 | p95 latency、cost/query、empty retrieval rate、低分召回率、用户反馈 |

一个指标不能说明系统好坏。

要用指标组合定位问题。

## 评测数据怎么设计

没有评测集，就没有 RAG 优化。

每条评测样本建议保存：

```json
{
  "id": "rabbitmq-delay-001",
  "question": "x-message-ttl 是什么？",
  "queryType": "fact",
  "referenceAnswer": "x-message-ttl 表示消息在队列中的存活时间，超过后消息会过期。",
  "goldChunkIds": [
    "rabbitmq-delay:ttl-dlx:003"
  ],
  "goldDocIds": [
    "rabbitmq-delay"
  ],
  "keyPoints": [
    "x-message-ttl 是消息 TTL",
    "单位通常是毫秒",
    "超过 TTL 后消息过期",
    "过期后可进入死信交换机"
  ],
  "allowedSources": [
    "docs/notes/rabbitmq/delay-queue.md"
  ],
  "shouldRefuse": false
}
```

如果是无答案问题：

```json
{
  "id": "unknown-001",
  "question": "这个系统支持比特币提现吗？",
  "referenceAnswer": "知识库没有相关信息，应该拒答。",
  "goldChunkIds": [],
  "shouldRefuse": true
}
```

评测集至少覆盖这些问题类型：

| 类型 | 目的 |
| --- | --- |
| 事实型 | 检查单点事实能否召回 |
| 步骤型 | 检查流程完整性 |
| 对比型 | 检查多个概念是否能区分 |
| 多跳型 | 检查多个 chunk / 多文档组合 |
| 约束型 | 检查“不能做什么”“边界条件” |
| 表格型 | 检查结构化信息 |
| 长答案型 | 检查关键点覆盖 |
| 无答案型 | 检查拒答和幻觉 |
| 权限型 | 检查 metadata filter |
| 改写型 | 检查同义表达稳定性 |

不要只放简单 FAQ。

真实 RAG 最容易翻车的是跨段、多跳、表格、旧版本、无答案和权限过滤。

## 检索覆盖指标

检索覆盖看的是：正确证据有没有被找回来。

这一步最好用 `goldChunkIds` 或 `goldDocIds` 评估。

### Hit@K

只看前 K 个结果里是否至少有一个正确证据。

```text
Hit@K = 1 if topK 中存在 gold chunk else 0
```

适合快速判断“有没有召回到答案”。

缺点是太粗：命中一个正确 chunk 和命中全部正确 chunk 都算 1。

### Recall@K

看前 K 个结果覆盖了多少标准证据。

```text
Recall@K = topK 中命中的 gold chunks 数 / gold chunks 总数
```

例如标准证据有 4 个，top5 命中 3 个：

```text
Recall@5 = 3 / 4 = 0.75
```

适合多证据问题。

如果 `Recall@K` 低，优先查：

- chunk 是否切坏。
- embedding 是否适合领域。
- query rewrite 是否丢关键词。
- 是否需要 hybrid search。
- metadata filter 是否误过滤。
- topK 是否太小。

### MRR

`MRR` 看第一个正确证据排第几。

```text
MRR = 1 / 第一个相关结果的排名
```

如果正确证据排第 1：

```text
MRR = 1
```

如果排第 5：

```text
MRR = 0.2
```

MRR 适合评估“正确结果是否靠前”。

如果 `Recall@K` 高但 `MRR` 低，说明正确证据能召回，但排序差，需要 rerank 或改检索融合。

### nDCG@K

`nDCG` 适合有分级相关性的场景。

例如：

```text
3 = 直接回答问题的证据
2 = 部分相关
1 = 背景相关
0 = 无关
```

`nDCG@K` 会同时考虑：

- 相关性等级。
- 结果排序位置。

适合合同、论文、技术文档、多段证据这种场景。

如果只用二元相关 / 不相关，`Recall@K` 和 `MRR` 就够起步。

### Context Recall

`Context Recall` 是 RAGAS 常用指标。

它看的是：生成正确答案所需的信息，有多少出现在检索上下文里。

可以理解为：

```text
Context Recall = 被检索上下文覆盖的标准答案要点 / 标准答案全部要点
```

它比 `Recall@K` 更靠近最终回答，因为它关心“答案要点”而不是单纯 chunk id。

## 检索精度指标

检索精度看的是：召回来的内容是不是有用。

### Precision@K

```text
Precision@K = topK 中相关结果数 / K
```

如果 top5 有 3 个相关：

```text
Precision@5 = 3 / 5 = 0.6
```

如果 `Recall@K` 高但 `Precision@K` 低，说明召回很宽，噪声多。

处理方向：

- 加 rerank。
- 降低 topK。
- 加 metadata filter。
- 改 chunk 粒度。
- 用 hybrid search 平衡语义和关键词。

### Context Precision

`Context Precision` 评估检索上下文里相关内容是否排在前面。

它比 `Precision@K` 更适合 RAG，因为 RAG 通常会把多个 chunk 塞进 prompt，而越靠前的 chunk 越容易影响模型。

如果 `Context Precision` 低，常见表现是：

```text
模型拿到很多看似相关但不回答问题的片段。
```

这会导致回答绕、答偏，甚至把噪声编进答案。

### Context Relevance

TruLens 的 RAG triad 里有 `Context Relevance`。

它问的是：检索到的上下文是否和用户问题相关。

它适合线上抽样评测，因为不一定要求标准答案，只需要判断 query 和 context 的相关性。

### Duplicate Rate

重复率是很实用的工程指标。

```text
Duplicate Rate = topK 中重复或近重复 chunk 数 / K
```

重复通常来自：

- overlap 太大。
- 同一段内容多版本入库。
- child chunk 命中后没有按 parent 去重。
- 向量库里有重复文档。

重复率高会浪费 topK 和上下文窗口。

## 重排指标

rerank 不应该凭感觉加。

要比较 rerank 前后：

| 指标 | 看什么 |
| --- | --- |
| `MRR_before` / `MRR_after` | 第一个正确证据是否提前 |
| `nDCG_before` / `nDCG_after` | 排序整体是否更合理 |
| `Top1 Accuracy` | 第一条是否就是正确证据 |
| `Rerank Drop Rate` | rerank 是否把正确证据降出最终上下文 |
| `Latency Delta` | rerank 增加多少耗时 |
| `Cost Delta` | rerank 增加多少成本 |

如果 rerank 提高了 MRR，但延迟从 500ms 变成 3s，要看业务是否接受。

生产里常见策略：

```text
向量 / hybrid 召回 top50
  -> rerank top50
  -> 取 top5/top8 进上下文
```

## 上下文组装指标

RAG 不是召回完就结束。

还要看最终进入 prompt 的上下文。

### Context Token Cost

```text
Context Token Cost = 检索上下文 token 数
```

它影响：

- LLM 调用成本。
- 响应延迟。
- Lost in the Middle 风险。
- 噪声量。

不要只看答案质量，也要看每个正确答案花了多少 token。

### Evidence Coverage

```text
Evidence Coverage = prompt 中覆盖的 gold evidence 数 / gold evidence 总数
```

注意它和 `Recall@K` 不一样。

`Recall@K` 是检索到了。

`Evidence Coverage` 是最终放进 prompt 了。

如果 `Recall@K` 高但 `Evidence Coverage` 低，说明 context packing 或裁剪策略有问题。

### Context Utilization

看模型最终答案用了多少上下文。

可以用 LLM judge 或 claim matching：

```text
Context Utilization = 被答案使用的证据块数 / prompt 中证据块数
```

如果利用率很低，说明 prompt 塞太多，或者排序差。

### Lost Evidence Rate

```text
Lost Evidence Rate = 检索命中但被裁剪掉的 gold evidence 数 / 检索命中的 gold evidence 数
```

这个指标能抓到一个常见问题：

```text
检索阶段是好的，但组装 prompt 时把关键证据裁掉了。
```

## 生成质量指标

生成质量看的是最终回答。

### Answer Accuracy

答案是否和参考答案一致。

可以人工打分，也可以用 LLM judge：

```text
0 = 错误
0.5 = 部分正确
1 = 正确
```

适合有标准答案的评测集。

不要把 `Answer Accuracy` 当唯一指标。

因为答案错了时，你还需要知道是检索错、上下文错，还是生成错。

### Answer Relevancy

回答是否真正回答了用户问题。

例如用户问：

```text
RabbitMQ 的死信队列怎么配置？
```

模型回答：

```text
RabbitMQ 是一个消息队列系统...
```

这可能是事实正确，但 relevance 低。

RAGAS 里有 `Response Relevancy`，TruLens 里有 `Answer Relevance`，都是看回答和问题是否匹配。

### Completeness

回答是否覆盖标准答案中的必要点。

例如标准答案有 4 个点：

```text
1. 声明 TTL 队列
2. 配置 x-message-ttl
3. 配置 x-dead-letter-exchange
4. 配置 x-dead-letter-routing-key
```

模型只答了前 2 个，正确但不完整。

可以定义：

```text
Completeness = 命中的 key points 数 / key points 总数
```

### Key Point Recall

长答案评测不要只用一句 reference answer。

可以把参考答案拆成 key points。

`Long²RAG` 提出的 `Key Point Recall` 就是这个思路：评估长答案是否覆盖关键要点。

工程上可以这样做：

```json
{
  "question": "订单超时取消链路怎么设计？",
  "keyPoints": [
    "订单创建后发送延迟消息",
    "延迟队列 TTL 到期进入死信交换机",
    "消费者查询订单状态",
    "只有未支付订单才能取消",
    "释放库存必须幂等"
  ]
}
```

评测时看答案覆盖了几个点。

## 忠实度指标

忠实度看的是：答案是否被检索上下文支持。

这和答案正确性不同。

一个答案可能事实正确，但不是来自检索证据。

在企业知识库里，这仍然有问题，因为系统要求“基于资料回答”。

### Faithfulness

RAGAS 的 `Faithfulness` 关注回答是否能从检索上下文推出。

常见做法：

```text
1. 把答案拆成多个 claim。
2. 对每个 claim 判断是否被 context 支持。
3. 计算被支持 claim 的比例。
```

公式可以理解为：

```text
Faithfulness = supported claims / all claims
```

### Groundedness

TruLens 的 `Groundedness` 也类似。

它问的是：答案中的声明是否能在检索上下文中找到证据。

如果 groundedness 低，常见原因：

- prompt 没要求只基于资料回答。
- 模型补充了常识。
- 检索上下文不足。
- 用户问了无答案问题但模型硬答。

### Unsupported Claim Rate

```text
Unsupported Claim Rate = 无证据支持的 claim 数 / 总 claim 数
```

这个指标比“幻觉率”更工程化。

因为它能定位到具体哪句话没证据。

## 引用指标

RAG 如果要给来源，就必须评估引用。

### Citation Precision

引用的来源是否真的支持答案。

```text
Citation Precision = 正确引用数 / 总引用数
```

如果模型随便贴来源，precision 会低。

### Citation Recall

答案中的关键声明是否都有引用。

```text
Citation Recall = 有正确引用支持的关键声明数 / 关键声明总数
```

如果答案对但没引用，recall 低。

### Source Accuracy

看引用是否指向正确文档、章节、页码或 chunk。

```text
Source Accuracy = 引用 sourceId 命中 gold sourceId 的比例
```

这对法律、财务、医疗、内部制度尤其重要。

## 拒答与安全指标

RAG 不应该什么都答。

### Refusal Accuracy

无答案时是否正确拒答。

```text
Refusal Accuracy = 正确拒答数 / 应拒答样本数
```

无答案样本要包含：

- 知识库没有的信息。
- 超出权限的信息。
- 旧版本已经废弃的信息。
- 用户诱导模型编造的问题。

### Over-refusal Rate

有答案时却拒答。

```text
Over-refusal Rate = 错误拒答数 / 可回答样本数
```

过高说明系统太保守，可能是：

- score threshold 太高。
- rerank 太严格。
- prompt 要求过度谨慎。
- 检索上下文被裁剪。

### Permission Leakage Rate

企业 RAG 必须测权限。

```text
Permission Leakage Rate = 返回无权限内容的次数 / 权限测试次数
```

权限测试不能只看最终答案。

还要看：

- retriever 是否过滤。
- reranker 是否接触了无权限 chunk。
- trace 里是否记录了敏感内容。
- 引用来源是否暴露了标题或路径。

## 线上指标

离线评测通过，不代表线上稳定。

线上至少记录：

| 指标 | 用途 |
| --- | --- |
| `empty_retrieval_rate` | 检索不到内容的比例 |
| `low_score_rate` | 召回分数低于阈值的比例 |
| `avg_context_tokens` | 平均上下文成本 |
| `p95_latency` | 用户感知延迟 |
| `cost_per_query` | 单次查询成本 |
| `fallback_rate` | 触发兜底回答或人工转接比例 |
| `user_negative_feedback_rate` | 用户差评率 |
| `citation_click_rate` | 用户是否点击来源 |
| `doc_version_miss_rate` | 是否召回旧版本文档 |
| `permission_filter_hit_rate` | 权限过滤是否生效 |

线上还要做抽样评测：

```text
每天抽样 1%-10% 查询
  -> 自动打分
  -> 人工复核低分样本
  -> 归因到 retrieval / rerank / generation / permission / data freshness
```

## 指标怎么组合诊断问题

| 现象 | 可能原因 | 优先检查 |
| --- | --- | --- |
| `Recall@K` 低 | 正确证据没召回 | 切片、embedding、hybrid search、metadata filter |
| `Recall@K` 高但 `MRR` 低 | 正确证据靠后 | rerank、query rewrite、向量/关键词融合权重 |
| `Context Precision` 低 | 噪声太多 | topK、rerank、chunk 粒度、重复文档 |
| `Evidence Coverage` 低 | 证据被裁掉 | context packing、token budget、去重逻辑 |
| `Faithfulness` 低 | 答案没按证据来 | prompt、无答案拒答、模型温度、证据不足 |
| `Answer Relevancy` 低 | 答非所问 | query 理解、prompt、答案格式 |
| `Citation Precision` 低 | 引用乱贴 | citation 生成方式、sourceId 映射 |
| `Refusal Accuracy` 低 | 无答案硬答 | 阈值、拒答策略、prompt |
| `Over-refusal` 高 | 有答案也拒答 | threshold、rerank、召回数量 |
| 延迟高 | 链路太重 | rerank、topK、LLM 上下文、并发和缓存 |

这个表比单纯看总分更重要。

总分只能告诉你“坏了”。

分层指标能告诉你“坏在哪”。

## 最小可用评测方案

如果刚开始做 RAG，不要一上来搭复杂平台。

先做这个最小闭环：

```text
1. 准备 100 条问题
   - 60 条事实 / 步骤 / 对比
   - 20 条多跳 / 长答案
   - 10 条无答案
   - 10 条权限 / 版本 / 表格

2. 为每条问题标注
   - referenceAnswer
   - goldChunkIds
   - keyPoints
   - shouldRefuse

3. 每次改 RAG 参数后跑
   - Recall@5
   - MRR
   - Context Precision
   - Faithfulness
   - Answer Accuracy
   - Refusal Accuracy
   - p95 latency
   - cost/query

4. 输出失败样本
   - 问题
   - 检索结果
   - 最终上下文
   - 答案
   - 分数
   - 失败归因
```

这套已经能支撑大部分工程调参。

## 评测脚本数据结构

建议把一次运行结果存下来。

```json
{
  "runId": "rag-eval-2026-06-07-001",
  "config": {
    "chunkSize": 500,
    "chunkOverlap": 80,
    "retriever": "hybrid",
    "topK": 30,
    "rerankTopN": 8,
    "model": "gpt-4.1-mini"
  },
  "results": [
    {
      "caseId": "rabbitmq-delay-001",
      "question": "x-message-ttl 是什么？",
      "retrievedChunkIds": [
        "rabbitmq-delay:ttl-dlx:003",
        "rabbitmq-delay:dead-letter:004"
      ],
      "promptChunkIds": [
        "rabbitmq-delay:ttl-dlx:003"
      ],
      "answer": "x-message-ttl 是消息在队列中的存活时间...",
      "metrics": {
        "hitAt5": 1,
        "recallAt5": 1,
        "mrr": 1,
        "contextPrecision": 1,
        "faithfulness": 1,
        "answerAccuracy": 1,
        "citationPrecision": 1
      },
      "latencyMs": 1280,
      "inputTokens": 4200,
      "outputTokens": 360,
      "failureType": null
    }
  ]
}
```

这个结构能让你回放和对比不同配置。

## LLM Judge 怎么设计

LLM Judge 可以用，但不能完全迷信。

适合让 Judge 做：

- 判断答案是否回答问题。
- 判断 claim 是否被 context 支持。
- 判断引用是否支持声明。
- 给长答案 key point 覆盖打分。

不适合只让 Judge 输出一个“总分”。

更好的 grader 输出结构：

```json
{
  "score": 0.75,
  "verdict": "partial",
  "supportedClaims": [
    "x-message-ttl 是消息 TTL",
    "单位是毫秒"
  ],
  "unsupportedClaims": [
    "所有消息都会进入死信队列"
  ],
  "missingKeyPoints": [
    "需要配置 x-dead-letter-exchange"
  ],
  "reason": "回答解释了 TTL，但把过期后的行为说得过于绝对。"
}
```

Judge 设计要注意：

- Judge 不能看到不该看的标准答案，除非是在评估 answer accuracy。
- 评估 faithfulness 时，只给 question、context、answer，不给 reference answer。
- 评估 correctness 时，可以给 reference answer。
- 评估 retrieval 时，不要让 Judge 看最终答案。
- 对关键样本保留人工复核。

OpenAI graders 的思路也是把评测拆成可配置 grader，例如字符串检查、文本相似度、模型打分和代码执行。

## 离线评测和线上评测

### 离线评测

用于上线前和改参数时。

适合测：

- 切片策略。
- embedding 模型。
- topK。
- reranker。
- prompt。
- 模型版本。

要求：

- 固定数据集。
- 固定评测脚本。
- 每次运行保存配置。
- 每次变更能做 A/B 对比。

### 线上评测

用于发现真实用户问题。

适合看：

- 文档漂移。
- 新问题类型。
- 用户反馈。
- 延迟和成本。
- 权限过滤。
- 低置信度召回。

线上不能只看平均分。

要看分桶：

```text
按文档类型
按用户角色
按问题类型
按产品线
按语言
按新旧文档版本
```

很多 RAG 问题只在某个桶里爆炸。

## 不要犯的错误

### 只看最终答案

最终答案错，不知道为什么错。

要同时保存：

```text
query
retrieved chunks
reranked chunks
prompt context
answer
citations
metrics
trace
```

### 只看平均分

平均分会掩盖关键失败。

例如：

```text
普通 FAQ 95 分
权限问题 20 分
平均 87 分
```

看起来不错，但实际上不能上线。

### 用生产用户反馈代替评测集

用户反馈有用，但它不是完整评测。

因为：

- 用户不一定反馈。
- 用户不知道答案是否正确。
- 低频高风险问题很少出现。

### 只用 LLM Judge，不抽查

LLM Judge 会误判。

尤其是：

- 表格数字。
- 法律条款。
- 多跳推理。
- 引用准确性。
- 细粒度权限。

关键场景必须人工抽查。

## 推荐指标组合

### 开发阶段

```text
Recall@5
MRR
Context Precision
Answer Accuracy
Faithfulness
失败归因
```

目标：快速知道改动有没有变好。

### 上线前

```text
Recall@10
nDCG@10
Context Recall
Context Precision
Answer Accuracy
Answer Relevancy
Faithfulness
Citation Precision
Citation Recall
Refusal Accuracy
Permission Leakage Rate
p95 Latency
Cost/query
```

目标：确认质量、安全和成本都可接受。

### 上线后

```text
empty_retrieval_rate
low_score_rate
negative_feedback_rate
faithfulness_sample_score
permission_leakage_incidents
p95 / p99 latency
cost/query
doc_freshness_miss
top failure categories
```

目标：发现漂移和线上事故。

## 去空话检查

- [ ] 是否区分检索、重排、上下文、生成、引用、拒答。
- [ ] 是否有带 `goldChunkIds` 的评测集。
- [ ] 是否统计 `Recall@K`、`MRR`、`Context Precision`。
- [ ] 是否评估 `Faithfulness` / `Groundedness`。
- [ ] 是否单独测无答案拒答。
- [ ] 是否单独测权限过滤。
- [ ] 是否记录 token、延迟和成本。
- [ ] 是否保存失败样本和 trace。
- [ ] 是否能根据指标定位是哪个环节坏了。
- [ ] 是否避免只看一个平均总分。

## 参考

- [RAGAS Metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)
- [LangSmith: Evaluate a RAG application](https://docs.langchain.com/langsmith/evaluate-rag-tutorial)
- [TruLens RAG Triad](https://www.trulens.org/getting_started/core_concepts/rag_triad/)
- [OpenAI Graders](https://platform.openai.com/docs/guides/graders/)
- [RAGAS: Automated Evaluation of Retrieval Augmented Generation](https://arxiv.org/abs/2309.15217)
- [ARES: An Automated Evaluation Framework for RAG Systems](https://arxiv.org/abs/2311.09476)
- [Long²RAG: Key Point Recall](https://arxiv.org/abs/2410.23000)
- [RAGSmith](https://arxiv.org/abs/2511.01386)
