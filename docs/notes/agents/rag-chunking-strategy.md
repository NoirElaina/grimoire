---
title: RAG 长文档切片策略
sidebarTitle: RAG 长文档切片
---

# RAG 长文档切片策略

RAG 里的切片不是简单把文章按字数切开。

切片决定了三件事：

- **索引单元**：哪个文本片段会被 embedding。
- **召回单元**：用户问题会匹配到哪个片段。
- **生成上下文**：最终塞给 LLM 的证据有多完整。

切得太小，召回很准，但上下文可能断掉。

切得太大，信息完整，但 embedding 容易变成“主题混合”，召回结果看似相关，实际没有答案。

## 基本流程

```text
原始文档
  -> 文档解析
  -> 结构识别
  -> 切片
  -> 元数据补充
  -> embedding
  -> 向量库 / 混合索引
  -> query 检索
  -> rerank
  -> 上下文扩展
  -> prompt 组装
  -> LLM 回答
```

切片只在中间一步，但会影响后面所有步骤。

## 先区分四种 chunk

工程里不要只说“chunk”。

至少要区分这四种：

| 类型 | 作用 | 常见大小 |
| --- | --- | --- |
| `embedding_chunk` | 用来生成向量并参与召回 | 200-800 tokens |
| `parent_chunk` | 召回后补充上下文 | 800-2000 tokens |
| `display_chunk` | 展示引用来源 | 一段、一页或一个章节片段 |
| `prompt_context` | 最终放进 LLM 的证据 | 受模型上下文和回答任务限制 |

最常见的错误是：用同一个 chunk 同时做 embedding、召回、展示和最终上下文。

更稳的做法是：

```text
小块负责召回。
大块负责解释。
元数据负责定位。
rerank 负责排序。
```

## 切片粒度怎么选

没有万能大小。

粒度取决于文档类型、问题类型、embedding 模型限制、召回 topK、rerank 成本和最终上下文窗口。

可以先用下面的起步值：

| 场景 | 起步粒度 | overlap | 策略 |
| --- | --- | --- | --- |
| FAQ / 问答对 | 100-300 tokens | 0-10% | 一问一答优先，不强行合并 |
| 技术文档 | 300-700 tokens | 10-20% | 按标题、段落、列表切 |
| API 文档 | 200-500 tokens | 10-15% | endpoint / 方法级切片 |
| 法律合同 | 600-1200 tokens | 10-25% | 条款级 + 父子切片 |
| 论文 / 报告 | 500-1200 tokens | 10-20% | 章节级、段落级、图表独立处理 |
| 对话记录 | 400-1000 tokens | 15-25% | 按主题窗口或时间窗口切 |
| 代码 | 函数 / 类 / 文件片段 | 0-10% | AST 或语法结构优先 |
| 表格 | 不按普通文本硬切 | 视情况 | 表格摘要 + 行块 + 表头元数据 |

这些不是标准答案，只是第一轮实验参数。

真正上线前要用固定问题集评估。

## chunk 大小怎么取舍

chunk 大小本质是在召回精度和上下文完整性之间取舍。

| 方案 | 优点 | 缺点 | 适合 |
| --- | --- | --- | --- |
| 小 chunk | 查询匹配更精确，噪声少，适合事实问答 | 容易丢标题、定义、前置条件和跨段关系 | FAQ、API 参数、短知识点 |
| 中 chunk | 精度和上下文比较均衡 | 仍可能切断表格、列表、代码块 | 普通知识库、技术文档 |
| 大 chunk | 保留上下文，适合复杂问题 | embedding 表示被多个主题稀释，召回可能变差 | 合同条款、长报告、流程说明 |
| 父子 chunk | 小块召回，大块回答 | 需要额外 docstore、parentId、去重和上下文预算控制 | 生产 RAG、长文档、多段证据 |

一个实用判断：

```text
用户问题通常问“某个点是什么”：
  chunk 小一点，优先 precision。

用户问题通常问“流程怎么做 / 为什么 / 对比区别”：
  chunk 大一点，或使用父子切片。

用户问题经常需要跨段信息：
  不要只靠 overlap，优先父子切片或相邻扩展。
```

### 判断 chunk 太小

表现：

- 检索命中片段，但回答缺前因后果。
- chunk 里大量出现“它”“该配置”“上述流程”等指代词。
- 模型需要前一个段落才能解释当前段落。
- `Recall@K` 不低，但 `Faithfulness` 或答案完整性低。

处理：

- 增大 chunk。
- 给 chunk 加标题路径。
- 使用 parent chunk。
- 检索命中后拉前后相邻 chunk。

### 判断 chunk 太大

表现：

- 召回结果看起来“主题相关”，但没有具体答案。
- topK 里都是大段综合介绍。
- `Context Precision` 低。
- 模型回答绕，不直接命中问题。

处理：

- 减小 child chunk。
- 按标题、段落、列表重新切。
- 用 rerank 把真正回答问题的片段排前。
- 对大文档先做结构化解析。

## 为什么不能只按固定长度切

固定长度切片的优点是简单。

问题是它不理解结构：

```text
第一个 chunk：Redis 缓存击穿是指热点 key 过期后...
第二个 chunk：解决方式包括互斥锁、逻辑过期、热点预热...
```

如果用户问“缓存击穿怎么解决”，检索可能只召回第二个 chunk。

第二个 chunk 有“解决方式”，但缺少“这是缓存击穿”的上下文。

所以固定切片必须配合：

- overlap。
- 标题路径。
- 前后片段关系。
- 父子切片。
- rerank。

## 常见切片策略

### 固定大小切片

按字符数或 token 数切。

```text
chunk_size = 512 tokens
chunk_overlap = 128 tokens
```

优点：

- 实现简单。
- 可控。
- 适合先做 baseline。

缺点：

- 容易切断句子、列表、表格和代码。
- 对结构化文档不友好。
- overlap 多了会增加索引体积和重复召回。

适合：

- 文本比较均匀的知识库。
- 快速验证 RAG 是否能跑通。
- 没有明显标题结构的纯文本。

### 递归切片

递归切片会按优先级尝试分隔符。

常见顺序：

```text
"\n\n"  段落
"\n"    行
"。"    中文句号
"."     英文句号
" "     空格
""      字符
```

逻辑是：

```text
先按大结构切。
如果块太大，再按小结构切。
直到满足 chunk_size。
```

它比固定长度更适合 Markdown、普通文章和技术文档。

LangChain 的 `RecursiveCharacterTextSplitter` 就是这种思路：指定分隔符列表和 `chunk_size`，再递归拆分。

### 结构化切片

结构化切片按文档本身的组织方式切。

例如：

```text
Markdown：按 # / ## / ### 标题
HTML：按 h1 / h2 / section / article
PDF：按标题、段落、页码、表格
代码：按 class / function / method
合同：按章、节、条、款
API 文档：按 endpoint / operationId
```

结构化切片的关键不是“切得整齐”，而是保留结构路径。

```json
{
  "docId": "spring-transaction-note",
  "title": "Spring 事务",
  "sectionPath": ["事务传播行为", "REQUIRES_NEW"],
  "page": 12,
  "chunkIndex": 8,
  "text": "REQUIRES_NEW 会挂起当前事务..."
}
```

用户问“REQUIRES_NEW 有什么坑”，标题路径也能帮助召回和生成。

### 语义切片

语义切片先把文本拆成句子，再根据句子之间的语义相似度决定边界。

基本思路：

```text
句子 1
句子 2
句子 3
  -> 计算相邻句子 embedding 距离
  -> 距离突然变大，认为话题切换
  -> 在话题切换处断开
```

优点：

- 能减少“同一个主题被切开”的问题。
- 适合长段落、论文、报告、知识库文章。

缺点：

- 切片成本更高。
- 需要 embedding 模型参与切片。
- 对短文本、FAQ、代码不一定划算。

LlamaIndex 的 `SemanticSplitterNodeParser` 就是典型语义切片：按句子拆分，并用 embedding 判断语义断点。

### 父子切片

父子切片是生产 RAG 里很实用的策略。

```text
parent_chunk：较大的章节片段，保留完整上下文
child_chunk：较小的检索片段，用于 embedding 和召回
```

检索时：

```text
用户问题
  -> 匹配 child_chunk
  -> 找到 child_chunk.parent_id
  -> 返回 parent_chunk 给 LLM
```

这样可以兼顾：

- 小块召回更精准。
- 大块回答更完整。

示例参数：

```text
child_chunk_size = 300-500 tokens
parent_chunk_size = 1000-2000 tokens
child_overlap = 50-100 tokens
parent_overlap = 100-200 tokens
```

LangChain 的 `ParentDocumentRetriever` / `MultiVectorRetriever` 就是这种模式：索引小块，返回父文档或父片段。

### 句子窗口切片

句子窗口适合问答型知识库。

做法：

```text
索引：单句或短句组
返回：命中的句子 + 前后 N 句
```

例如命中第 10 句，最终给模型：

```text
第 7-13 句
```

优点：

- 召回粒度细。
- 生成时上下文不容易断。

缺点：

- 需要保存 `prev` / `next` 关系。
- 多个命中句子可能扩展出重复上下文。

LlamaIndex 的 `SentenceWindowNodeParser` 支持这种思路：节点是句子，但元数据里保存周围窗口。

### Late Chunking

传统流程是：

```text
先切片 -> 再 embedding
```

Late Chunking 的思路是：

```text
先让长上下文 embedding 模型读完整文档
再在 token 表示上做切片池化
```

它想解决的问题是：传统切片会让每个 chunk 在 embedding 时丢失周围上下文。

这个方法更偏高级检索系统，普通业务不一定需要先上。

适合关注：

- 长文档检索。
- embedding 模型支持长上下文。
- 普通切片召回经常缺上下文。
- 有能力评估检索质量变化。

## overlap 怎么设计

overlap 用来解决边界问题。

例如答案刚好跨两个 chunk：

```text
chunk A：什么是消息死信...
chunk B：死信队列的处理流程...
```

没有 overlap 时，模型可能只看到半截。

但 overlap 不是越多越好。

overlap 太大会导致：

- 索引量变大。
- 相似 chunk 重复召回。
- topK 被重复内容占满。
- token 成本变高。

可以这样起步：

| chunk 大小 | overlap 起步 |
| --- | --- |
| 200 tokens | 20-40 tokens |
| 500 tokens | 50-100 tokens |
| 1000 tokens | 100-200 tokens |

Azure AI Search 文档给过一个实用起点：512 tokens 的 chunk，128 tokens overlap，也就是约 25%。

实际项目里常用 10%-20% 起步，如果是叙事文本、对话、法律条款，可以提高到 20%-25%。

## 元数据比 overlap 更重要

很多 RAG 效果差，不是切片大小问题，而是元数据不够。

每个 chunk 至少保存：

```json
{
  "chunkId": "doc-001:0008",
  "docId": "doc-001",
  "sourceType": "markdown",
  "title": "RabbitMQ 死信队列",
  "sectionPath": ["RabbitMQ", "死信队列", "TTL + DLX"],
  "page": 3,
  "startOffset": 1820,
  "endOffset": 2460,
  "prevChunkId": "doc-001:0007",
  "nextChunkId": "doc-001:0009",
  "createdAt": "2026-06-07T12:00:00+08:00"
}
```

有了这些信息，才能做：

- 引用来源。
- 相邻片段扩展。
- 父子切片。
- 按文档、章节、权限过滤。
- 检索结果去重。
- 错误召回复盘。

## 不同文档怎么切

### Markdown / 技术文档

优先按标题结构切：

```text
# 一级标题
## 二级标题
### 三级标题
段落
列表
代码块
```

规则：

- 标题路径写入 metadata。
- 代码块不要从中间切开。
- 列表项尽量保持完整。
- chunk 过大时再按段落递归切。
- 每个 chunk 前可以拼一个短 header。

示例：

```text
[文档: RabbitMQ]
[章节: 延迟队列 > TTL + DLX]

x-message-ttl 表示消息在队列里的存活时间...
```

这个 header 会增加 token，但能显著减少“片段脱离语境”的问题。

### PDF / Word

PDF 难点是页面不等于语义结构。

处理顺序：

```text
PDF / Word
  -> 提取元素
  -> 标题识别
  -> 段落识别
  -> 表格识别
  -> 页码 metadata
  -> 按标题或元素组合切片
```

不要直接把 PDF 提取出来的纯文本按 500 字切。

否则很容易出现：

- 页眉页脚混入正文。
- 表格顺序错乱。
- 标题和正文断开。
- 跨页段落被切断。

Unstructured 的 chunking 思路是先 partition 成元素，再把元素组合成可管理的 chunk，并支持 by title、by page、by similarity 等策略。

### 表格

表格不要当普通段落切。

常见做法：

```text
表格摘要 chunk：
  表名、含义、列说明、统计范围

行块 chunk：
  表头 + 若干行

关键列 metadata：
  年份、地区、产品、指标
```

如果表格很大：

- 不要一次塞整张表。
- 保留表头。
- 按业务主键或时间范围切。
- 生成表格摘要用于粗召回。
- 命中后再拉具体行块。

### 代码

代码切片要按语法结构。

优先级：

```text
class
  -> method / function
  -> block
  -> line window
```

metadata 要保存：

```json
{
  "language": "java",
  "filePath": "src/main/java/.../OrderService.java",
  "className": "OrderService",
  "methodName": "createOrder",
  "startLine": 42,
  "endLine": 118
}
```

不要把函数签名和函数体切到不同 chunk。

也不要把注释和被注释代码分开。

## 检索时怎么扩展上下文

切片策略不能只看入库。

还要看查询时怎么取上下文。

常见方式：

```text
1. 召回 topK child chunks
2. 按 docId + parentId 去重
3. 拉取 parent_chunk 或相邻 chunk
4. rerank
5. 按 token budget 装入 prompt
```

伪代码：

```python
def retrieve_context(query: str):
    child_hits = vector_search(query, top_k=20)
    parent_ids = dedupe([hit.metadata["parent_id"] for hit in child_hits])
    parents = load_parent_chunks(parent_ids)
    ranked = rerank(query, parents)
    return pack_context(ranked, max_tokens=6000)
```

如果不用父子切片，也至少做相邻扩展：

```text
命中 chunk_008
  -> 拉 chunk_007
  -> 拉 chunk_008
  -> 拉 chunk_009
```

然后再根据 token budget 去重和裁剪。

## 避免 Lost in the Middle

长上下文模型并不代表可以把很多 chunk 随便塞进去。

“Lost in the Middle” 论文指出：相关信息放在长上下文中间时，模型使用效果可能下降；信息在开头或结尾时表现往往更好。

对 RAG 的启发：

- 不要盲目塞很多 chunk。
- 召回结果要 rerank。
- 关键证据放在 prompt 更靠前的位置。
- 相互依赖的证据尽量相邻放。
- 对多个证据块做“重排/压缩/摘要”。

如果检索出 20 个 chunk，但只有 3 个真正有用，塞 20 个反而可能伤害回答质量。

## chunk_size、topK、上下文窗口的关系

这三个参数必须一起调：

```text
最终 token = 系统提示词 + 用户问题 + 指令 + 检索上下文 + 输出预算
```

假设：

```text
模型上下文 = 16000 tokens
回答预算 = 2000 tokens
系统与指令 = 1000 tokens
安全余量 = 1000 tokens
可用检索上下文 = 12000 tokens
```

如果每个 parent_chunk 约 1500 tokens：

```text
最多放 8 个 parent_chunk
```

但不代表 topK 就应该是 8。

常见做法：

```text
向量召回 topK = 20-50
rerank 后保留 = 5-10
最终塞入 prompt = 3-8
```

召回阶段要宽一点，生成阶段要窄一点。

## 推荐工程方案

如果是普通知识库，推荐先这样做：

```text
1. 文档解析
   - Markdown 按标题解析
   - PDF / Word 先转结构化元素

2. 切片
   - child_chunk：300-500 tokens
   - parent_chunk：1000-1500 tokens
   - overlap：10%-20%

3. 元数据
   - docId
   - title
   - sectionPath
   - page
   - parentId
   - prevChunkId / nextChunkId

4. 索引
   - child_chunk 做 embedding
   - parent_chunk 存 docstore
   - metadata 支持过滤

5. 查询
   - hybrid search 或 vector search
   - topK 先取 20
   - rerank 后保留 5
   - 返回 parent_chunk 或相邻扩展

6. 生成
   - 按 relevance 排序
   - 同一文档相邻证据合并
   - 控制总 token
   - 输出引用来源
```

这个方案比“500 字一个块直接入库”更适合生产。

## 参数优化流程

不要靠感觉调切片。

用固定评估集。

### 1. 准备问题集

每类文档准备问题：

```text
事实型：某个配置项是什么意思？
步骤型：如何完成某个流程？
比较型：A 和 B 有什么区别？
约束型：哪些情况不能这么做？
跨段型：需要结合两个段落才能回答的问题。
```

每个问题保存标准答案和证据位置：

```json
{
  "question": "x-message-ttl 是什么？",
  "answer": "消息在队列中的存活时间，超过后会过期。",
  "goldChunks": ["rabbitmq-delay:ttl-dlx:003"]
}
```

### 2. 对比切片方案

至少比较：

```text
方案 A：固定 500 tokens + 10% overlap
方案 B：递归 500 tokens + 15% overlap
方案 C：结构化标题切片 + 父子切片
方案 D：语义切片
```

### 3. 看检索指标

不要只看最终回答。

先看检索：

| 指标 | 含义 |
| --- | --- |
| Recall@K | 标准证据是否进入前 K 个结果 |
| Precision@K | 前 K 个结果里有多少真相关 |
| MRR | 第一个正确证据排第几 |
| nDCG | 排序质量 |
| Context Token Cost | 最终上下文 token 成本 |
| Duplicate Rate | topK 里重复或近重复比例 |

### 4. 看生成指标

再看最终回答：

| 指标 | 含义 |
| --- | --- |
| Answer Correctness | 回答是否正确 |
| Faithfulness | 是否只基于证据回答 |
| Citation Accuracy | 引用来源是否正确 |
| Refusal Accuracy | 没有资料时是否拒答 |
| Latency | 检索 + rerank + 生成耗时 |
| Cost | embedding、rerank、生成成本 |

### 5. 复盘失败样本

失败通常分四类：

| 失败类型 | 表现 | 处理 |
| --- | --- | --- |
| 证据没入库 | chunk 根本没有答案 | 解析或切片错误 |
| 证据入库但没召回 | 正确 chunk 排名太低 | 调整 embedding、hybrid、metadata |
| 召回了但上下文不完整 | chunk 缺前后文 | 父子切片或相邻扩展 |
| 上下文有但回答错 | LLM 没用对证据 | rerank、重排、提示词、压缩 |

## 自适应切片

近期研究也在强调：不要用单一切片策略处理所有文档。

`Adaptive Chunking` 论文提出用文档自身指标来选择策略，例如：

- 引用完整性。
- chunk 内聚性。
- 上下文连贯性。
- 块完整性。
- 大小合规性。

工程上可以简化为：

```text
FAQ：按问答对。
Markdown：按标题。
PDF：按元素 + 标题。
表格：按表结构。
代码：按 AST。
长报告：结构化切片 + 父子切片。
```

这就是业务版自适应切片。

## 常见坑

### 坑 1：只调 chunk_size，不看召回内容

应该把每次召回的 chunk 打印出来。

```text
query
score
chunkId
sectionPath
text
```

很多问题一看召回内容就知道：

- 答案被切到下一个 chunk。
- 标题没带上。
- topK 被重复内容占满。
- 表格被拆坏。

### 坑 2：没有 metadata 过滤

企业知识库通常有权限、部门、项目、版本。

没有 metadata 过滤，可能出现：

- 用户看到无权限文档。
- 召回旧版本文档。
- 不同产品线内容混在一起。

metadata 不是附属品，是检索条件。

### 坑 3：切片时丢标题

正文里经常有这种句子：

```text
它适用于以下情况...
```

如果没有标题路径，AI 不知道“它”是谁。

解决：

```text
chunk_text = 标题路径 + 正文
metadata.sectionPath = 标题路径数组
```

### 坑 4：表格被当成普通文本

表格被切坏后，embedding 可能失去列含义。

解决：

- 保留表头。
- 行块带表名。
- 重要表生成摘要。
- 大表按主键或时间段拆。

### 坑 5：topK 太大

topK 变大能提高 recall，但也会带来噪声。

正确做法：

```text
召回 topK 大一点。
rerank 后再缩小。
最终 prompt 只放高质量证据。
```

## 实现示例

下面是一个简化的父子切片流程。

```python
from dataclasses import dataclass


@dataclass
class Chunk:
    chunk_id: str
    parent_id: str
    doc_id: str
    text: str
    metadata: dict


def split_by_section(document: dict) -> list[dict]:
    """
    先按标题、页码、段落等结构拆成 section。
    document: {"doc_id": "...", "title": "...", "sections": [...]}
    """
    return document["sections"]


def recursive_token_split(text: str, max_tokens: int, overlap: int) -> list[str]:
    """
    真实项目里要用 tokenizer 计算 token。
    这里省略 tokenizer，只表达流程。
    """
    chunks = []
    start = 0
    step = max_tokens - overlap
    while start < len(text):
        chunks.append(text[start:start + max_tokens])
        start += step
    return chunks


def build_chunks(document: dict) -> tuple[list[Chunk], list[Chunk]]:
    parent_chunks = []
    child_chunks = []

    for section_index, section in enumerate(split_by_section(document)):
        section_path = section["section_path"]
        section_text = section["text"]

        parents = recursive_token_split(
            text=section_text,
            max_tokens=1500,
            overlap=150,
        )

        for parent_index, parent_text in enumerate(parents):
            parent_id = f"{document['doc_id']}:p:{section_index}:{parent_index}"
            parent = Chunk(
                chunk_id=parent_id,
                parent_id=parent_id,
                doc_id=document["doc_id"],
                text=parent_text,
                metadata={
                    "title": document["title"],
                    "sectionPath": section_path,
                    "page": section.get("page"),
                    "type": "parent",
                },
            )
            parent_chunks.append(parent)

            child_texts = recursive_token_split(
                text=parent_text,
                max_tokens=400,
                overlap=60,
            )

            for child_index, child_text in enumerate(child_texts):
                child_id = f"{parent_id}:c:{child_index}"
                child_chunks.append(
                    Chunk(
                        chunk_id=child_id,
                        parent_id=parent_id,
                        doc_id=document["doc_id"],
                        text=f"[章节: {' > '.join(section_path)}]\n{child_text}",
                        metadata={
                            "title": document["title"],
                            "sectionPath": section_path,
                            "page": section.get("page"),
                            "type": "child",
                        },
                    )
                )

    return parent_chunks, child_chunks
```

真实项目要补上：

- tokenizer。
- 精确 start/end offset。
- prev/next 关系。
- 表格和代码特殊处理。
- chunk hash 去重。
- 文档版本号。
- 权限 metadata。

## 生产检查清单

- [ ] 是否区分 `embedding_chunk` 和 `prompt_context`。
- [ ] 是否按文档类型选择切片策略。
- [ ] 是否保存 `docId`、`sectionPath`、页码、offset。
- [ ] 是否保存 `parentId`、`prevChunkId`、`nextChunkId`。
- [ ] 是否避免切断标题、列表、表格、代码块。
- [ ] 是否为 chunk 添加必要的标题上下文。
- [ ] 是否控制 overlap，避免重复召回占满 topK。
- [ ] 是否支持 metadata 过滤权限、版本和文档类型。
- [ ] 是否有 rerank。
- [ ] 是否有固定评估问题集。
- [ ] 是否统计 Recall@K、MRR、回答正确率和引用准确率。
- [ ] 是否复盘失败样本，而不是只调参数。

## 参考

- [LangChain RecursiveCharacterTextSplitter](https://docs.langchain.com/oss/python/integrations/splitters/recursive_text_splitter)
- [LlamaIndex SemanticSplitterNodeParser](https://developers.llamaindex.ai/python/framework-api-reference/node_parsers/semantic_splitter/)
- [Unstructured Chunking](https://docs.unstructured.io/concepts/chunking)
- [Azure AI Search: Chunk large documents for RAG and vector search](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-chunk-documents)
- [OpenAI Retrieval API](https://platform.openai.com/docs/guides/retrieval)
- [LangChain MultiVectorRetriever](https://reference.langchain.com/python/langchain-classic/retrievers/multi_vector/MultiVectorRetriever)
- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)
- [Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models](https://arxiv.org/abs/2409.04701)
- [Adaptive Chunking: Optimizing Chunking-Method Selection for RAG](https://arxiv.org/abs/2603.25333)
