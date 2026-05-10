---
title: SSE 流式响应
sidebarTitle: SSE 流式响应
---

# SSE 流式响应

SSE 很适合 Agent、聊天、日志推送这类“**服务端持续往前端吐增量内容**”的场景。  
它的价值不在“实时”这两个字本身，而在于：

- 前端不用等整段内容生成完再显示
- 后端可以边推边算
- 用户能更早看到系统在工作
- 长任务不需要一直假死转圈

如果你要做：

- LLM 对话流式输出
- Agent 执行进度日志
- 长任务阶段通知
- 实时增量文本

SSE 往往是第一选择。

## 先说结论

做 Agent 产品时，SSE 更稳的使用方式通常是：

1. 文本生成、日志流、阶段进度优先考虑 SSE。
2. 真正需要双向实时交互时再考虑 WebSocket。
3. 前端如果只读流而且是简单 GET，请优先 `EventSource`。
4. 如果要带 `POST` body、鉴权头、AbortController，请优先 `fetch + ReadableStream`。
5. 后端要认真处理 `text/event-stream`、心跳、代理缓冲和断线收尾。

一句话就是：

**SSE 适合“服务端持续推，前端持续收”；WebSocket 适合“双方都经常主动说话”。**

## SSE 和 WebSocket 到底差在哪

### SSE

特点是：

- 单向：服务端 -> 客户端
- 基于普通 HTTP
- 浏览器原生支持事件流
- 很适合文本流和状态通知

### WebSocket

特点是：

- 双向：客户端 <-> 服务端
- 建立独立长连接
- 双方都能随时主动发消息
- 更适合协同编辑、IM、双向游戏状态同步

## 怎么选

如果你的场景是：

- 用户发一个问题
- 服务端慢慢把 token、段落、日志推回来

那 SSE 通常比 WebSocket 更自然。  
因为客户端并不需要在流期间频繁主动发消息。

如果你的场景是：

- 客户端需要持续上报状态
- 双方都要频繁双向推送
- 一个连接上有很多交互指令

那才更像 WebSocket。

## 为什么聊天和 Agent 常常更适合 SSE

因为大多数 AI 产品的真正链路是：

1. 前端发一次请求
2. 后端开始跑模型 / 工具链
3. 后端持续把增量文本和阶段事件推回来
4. 前端渲染
5. 任务结束，连接关闭

这本质上不是“聊天室”，而是“**一次请求对应一条输出流**”。

SSE 和这个模型非常贴。

## SSE 的基本数据格式

SSE 返回的不是普通 JSON，而是事件流文本。

最简单的一条消息长这样：

```text
data: hello

```

如果带事件名：

```text
event: message
data: {"delta":"Hel"}

```

一条事件以空行结束。  
所以后端真正推送时，最关键的是：

- 每一行前缀正确
- 事件之间要有空行

## 前端怎么接：先分两种

### 1. 简单场景：`EventSource`

如果你满足下面这些条件：

- `GET` 请求就够
- 不需要复杂请求体
- 鉴权可以靠 cookie 或 URL 参数

那 `EventSource` 是最轻的接法。

```ts
const es = new EventSource('/api/chat/stream')

es.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log(data)
}

es.addEventListener('done', () => {
  es.close()
})

es.onerror = (err) => {
  console.error(err)
  es.close()
}
```

优点很明显：

- 简单
- 原生支持自动重连
- 不用自己解析底层 chunk

但它也有明显边界：

- 只能发 GET
- 不方便带自定义 header
- 不适合聊天接口那种需要 POST body 的场景

## 前端怎么接：更常用的一种是 `fetch + stream`

如果你要做的是 LLM 对话流，前端通常会发：

- 用户问题
- 会话 ID
- 历史消息
- 模型参数

这时候几乎一定要 `POST`。  
那就更适合：

- `fetch`
- `ReadableStream`
- 手动解析 SSE 帧

一个常见写法大致是：

```ts
const controller = new AbortController()

const response = await fetch('/api/chat/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({
    message,
    sessionId
  }),
  signal: controller.signal
})

const reader = response.body?.getReader()
const decoder = new TextDecoder('utf-8')

let buffer = ''

while (reader) {
  const { done, value } = await reader.read()
  if (done) break

  buffer += decoder.decode(value, { stream: true })

  const parts = buffer.split('\n\n')
  buffer = parts.pop() ?? ''

  for (const part of parts) {
    const lines = part.split('\n')
    let event = 'message'
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }

    const data = dataLines.join('\n')

    if (event === 'done') {
      reader.cancel()
      break
    }

    if (data) {
      console.log(event, JSON.parse(data))
    }
  }
}
```

这个方案的好处是：

- 能带 `POST` body
- 能带鉴权头
- 能手动取消
- 能自己控制 parser 和事件类型

对 AI 产品来说，它通常比 `EventSource` 更实用。

## 一个更像工程代码的前端实现

如果你真的要在前端落地，我更推荐把“发请求、读流、解析事件、支持中断”收成一个独立方法，而不是散在组件里。

例如可以先约定一份事件协议：

```ts
type ChatStreamEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string }
  | { type: 'tool_result'; toolCallId: string; output: string }
  | { type: 'status'; phase: 'thinking' | 'tool' | 'finalizing' }
  | { type: 'error'; message: string }
  | { type: 'done' }
```

然后把读取逻辑封装成一个可复用函数：

```ts
export async function streamChat(
  input: {
    message: string
    sessionId: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  },
  options: {
    token: string
    onEvent: (event: ChatStreamEvent) => void
    signal?: AbortSignal
  }
) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`
    },
    body: JSON.stringify(input),
    signal: options.signal
  })

  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      let eventName = 'message'
      const dataLines: string[] = []

      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim())
        }
      }

      if (eventName === 'ping') continue

      const raw = dataLines.join('\n')
      if (!raw) continue

      const payload = JSON.parse(raw)
      options.onEvent(payload as ChatStreamEvent)

      if (payload.type === 'done') {
        await reader.cancel()
        return
      }
    }
  }
}
```

这个函数真正有价值的地方不是“能读流”，而是它把下面这些事情一次收口了：

- `POST` body
- 鉴权头
- 手动取消
- SSE frame 解析
- 自定义事件协议

## React 页面里通常怎么接

如果你用 React，更稳的写法一般是：

1. 页面状态只管消息列表和运行状态
2. `streamChat()` 这种底层读流逻辑单独放 service
3. 组件里只处理事件落到 UI

一个最小例子可以长这样：

```tsx
const [answer, setAnswer] = useState('')
const [running, setRunning] = useState(false)
const abortRef = useRef<AbortController | null>(null)

async function send(message: string) {
  const controller = new AbortController()
  abortRef.current = controller
  setAnswer('')
  setRunning(true)

  try {
    await streamChat(
      {
        message,
        sessionId: crypto.randomUUID(),
        messages: []
      },
      {
        token,
        signal: controller.signal,
        onEvent(event) {
          if (event.type === 'delta') {
            setAnswer(prev => prev + event.text)
          }
          if (event.type === 'error') {
            throw new Error(event.message)
          }
          if (event.type === 'done') {
            setRunning(false)
          }
        }
      }
    )
  } finally {
    setRunning(false)
    abortRef.current = null
  }
}

function stop() {
  abortRef.current?.abort()
}
```

这里最关键的是：  
**前端不要把“增量拼接答案”和“发请求读流”写在一个大组件里。**

## 后端别只写 Controller，最好拆成 3 层

如果你是 Java / Spring Boot，我更推荐这样拆：

1. `ChatController`
   只接请求、写响应头、把流交给 service。
2. `ChatStreamService`
   管事件推送、心跳、异常收尾。
3. `ModelGateway` / `AgentRunner`
   真正跑模型和工具链。

也就是说，Controller 不应该自己又调模型又写 SSE 帧。

## 一个更稳的 Spring Boot 版本

先定义统一事件写法：

```java
public record StreamEvent(
        String type,
        Object data
) {
}
```

再写一个专门负责 SSE 输出的 writer：

```java
@Component
public class SseWriter {

    private final ObjectMapper objectMapper;

    public SseWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void writeEvent(PrintWriter writer, StreamEvent event) throws IOException {
        writer.write("event: " + event.type() + "\n");
        writer.write("data: " + objectMapper.writeValueAsString(event) + "\n\n");
        writer.flush();
    }

    public void writeHeartbeat(PrintWriter writer) {
        writer.write(": ping\n\n");
        writer.flush();
    }
}
```

Controller 保持很薄：

```java
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private final ChatStreamService chatStreamService;

    public ChatController(ChatStreamService chatStreamService) {
        this.chatStreamService = chatStreamService;
    }

    @PostMapping(value = "/stream", produces = "text/event-stream")
    public void stream(@RequestBody ChatRequest request, HttpServletResponse response) throws IOException {
        response.setCharacterEncoding("UTF-8");
        response.setContentType("text/event-stream");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("X-Accel-Buffering", "no");

        chatStreamService.stream(request, response.getWriter());
    }
}
```

真正的主逻辑放到 service：

```java
@Service
public class ChatStreamService {

    private final SseWriter sseWriter;
    private final AgentRunner agentRunner;

    public ChatStreamService(SseWriter sseWriter, AgentRunner agentRunner) {
        this.sseWriter = sseWriter;
        this.agentRunner = agentRunner;
    }

    public void stream(ChatRequest request, PrintWriter writer) throws IOException {
        ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();

        heartbeatExecutor.scheduleAtFixedRate(() -> {
            try {
                sseWriter.writeHeartbeat(writer);
            } catch (Exception ignored) {
            }
        }, 15, 15, TimeUnit.SECONDS);

        try {
            sseWriter.writeEvent(writer, new StreamEvent("message", Map.of("type", "message_start")));

            agentRunner.run(
                    request,
                    delta -> safeWrite(writer, new StreamEvent("message", Map.of("type", "delta", "text", delta))),
                    toolStart -> safeWrite(writer, new StreamEvent("message", Map.of(
                            "type", "tool_start",
                            "toolCallId", toolStart.toolCallId(),
                            "toolName", toolStart.toolName()
                    ))),
                    toolResult -> safeWrite(writer, new StreamEvent("message", Map.of(
                            "type", "tool_result",
                            "toolCallId", toolResult.toolCallId(),
                            "output", toolResult.output()
                    )))
            );

            sseWriter.writeEvent(writer, new StreamEvent("message", Map.of("type", "done")));
        } catch (Exception e) {
            sseWriter.writeEvent(writer, new StreamEvent("message", Map.of(
                    "type", "error",
                    "message", e.getMessage()
            )));
        } finally {
            heartbeatExecutor.shutdownNow();
        }
    }

    private void safeWrite(PrintWriter writer, StreamEvent event) {
        try {
            sseWriter.writeEvent(writer, event);
        } catch (IOException ignored) {
        }
    }
}
```

这个结构比“Controller 里一把梭”稳很多，因为：

- SSE 写法集中
- 心跳集中
- 事件协议集中
- Agent 逻辑和 HTTP 层解耦

## 如果是对接 LLM SDK，真正要接在哪

关键不是“怎么开流”，而是“模型 token 回调怎么映射成事件”。

例如你的模型层通常会有这种回调：

```java
public interface ModelStreamListener {
    void onToken(String token);
    void onToolStart(String toolCallId, String toolName);
    void onToolResult(String toolCallId, String output);
    void onComplete();
    void onError(Throwable throwable);
}
```

那 `AgentRunner` 就只负责把模型 SDK 的回调转成上面的监听器，而 `ChatStreamService` 再把监听器事件转成 SSE。

这层分开后，后面你想从：

- OpenAI
- Anthropic
- 本地模型

切换时，不用重写整个 Web 层。

## Nginx 这一层也要配对

很多人代码写对了，最后还是“不流”，问题在代理层。

Nginx 至少要注意：

```nginx
location /api/chat/stream {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    chunked_transfer_encoding on;
    proxy_read_timeout 3600s;
}
```

这里最重要的是：

- `proxy_buffering off`
- 足够长的 `proxy_read_timeout`

## 一个更像产品的事件协议建议

如果你现在就在做 Agent，我建议别只定义 `delta`。

比较稳的一版至少有：

```text
message_start
delta
tool_start
tool_result
status
error
done
```

因为后面你几乎一定会遇到这几类 UI：

- 文本输出
- 工具执行时间线
- 阶段状态
- 错误提示

一开始事件协议没分开，后面前后端都要返工。

## 前端渲染时要分两类事件

做聊天或 Agent 时，不要把所有 SSE 消息都当一类。

更稳的做法通常是分：

- `delta`
  文本增量
- `tool_start`
  工具开始调用
- `tool_result`
  工具返回
- `status`
  阶段说明
- `done`
  流结束
- `error`
  流内错误

这样前端才能分别渲染：

- 文本区域
- 日志区域
- 工具执行时间线

否则你后面很快会发现：  
同样是“消息流”，其实有好几种语义混在一起。

## 后端怎么推：最基础的要求

后端返回 SSE 时，至少要保证这些 header：

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

这里 `X-Accel-Buffering: no` 很关键，尤其你前面挂了 Nginx 时。  
否则你以为在流式推，代理可能先帮你攒一坨再一起吐给前端。

## 后端每条事件要怎么写

一个比较标准的输出长这样：

```text
event: delta
data: {"text":"Hel"}

event: delta
data: {"text":"lo"}

event: done
data: {}

```

也就是说，不是直接 `write(JSON.stringify(obj))`，而是要按 SSE 协议包一层。

## Spring Boot 怎么推

如果你是 Java 后端，最常见的两种做法是：

- `SseEmitter`
- 直接写响应流

### 用 `SseEmitter`

适合：

- 事件驱动式推送
- 代码可读性更好

```java
@GetMapping("/stream")
public SseEmitter stream() {
    SseEmitter emitter = new SseEmitter(0L);

    Executors.newSingleThreadExecutor().submit(() -> {
        try {
            emitter.send(SseEmitter.event()
                    .name("delta")
                    .data(Map.of("text", "Hel")));

            emitter.send(SseEmitter.event()
                    .name("delta")
                    .data(Map.of("text", "lo")));

            emitter.send(SseEmitter.event()
                    .name("done")
                    .data(Map.of()));

            emitter.complete();
        } catch (Exception e) {
            emitter.completeWithError(e);
        }
    });

    return emitter;
}
```

### 直接写响应流

适合：

- 你要完全控制输出格式
- 你本来就在对接模型 token 流

这种方式更贴近底层：

```java
@PostMapping(value = "/chat/stream", produces = "text/event-stream")
public void stream(@RequestBody ChatRequest request, HttpServletResponse response) throws IOException {
    response.setCharacterEncoding("UTF-8");
    response.setContentType("text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");

    PrintWriter writer = response.getWriter();

    writer.write("event: delta\n");
    writer.write("data: {\"text\":\"Hel\"}\n\n");
    writer.flush();

    writer.write("event: delta\n");
    writer.write("data: {\"text\":\"lo\"}\n\n");
    writer.flush();

    writer.write("event: done\n");
    writer.write("data: {}\n\n");
    writer.flush();
}
```

## 做 LLM 流时，后端不要只推文本

这是很多实现一开始会偷懒的地方。

如果你后面准备做：

- 工具调用可视化
- Agent 阶段状态
- 重试提示
- 思考中 / 执行中 UI

那后端最好从第一天就把事件类型拆开，而不是只推：

- 一坨文本

一个更像产品的流通常至少有：

- `message_start`
- `delta`
- `tool_start`
- `tool_delta`
- `tool_end`
- `message_end`
- `done`

## SSE 最大的几个坑

### 1. 代理缓冲

最常见。  
本地看起来正常，上了 Nginx / CDN 后突然“不流了”，其实是被缓冲了。

### 2. 心跳缺失

连接太久没有数据，中间层可能会断。  
所以长任务最好定期发心跳，例如：

```text
: ping

```

这是一条 SSE 注释行，很多实现会拿它保活。

### 3. 没有结束事件

前端很难判断：

- 是正常完成
- 还是中途断了

所以最好显式发一个 `done` 事件，再关闭连接。

### 4. 错误只写日志，不进流

如果后端异常了但前端只看到连接断开，体验会很差。  
更稳的做法是：

- 先推一条 `error` 事件
- 再收尾关闭

### 5. 把大 JSON 一次性塞进 `data`

这样虽然“形式上是流”，但体验上并没有增量。  
真正的流要推增量，而不是最后一次性吐全量。

## 什么时候不要用 SSE

下面这些场景更偏向 WebSocket：

- 双向高频互动
- 客户端也要持续主动上报
- 房间广播
- 协同编辑
- 游戏或白板同步

也就是说，SSE 不是 WebSocket 的上位替代，它只是更适合“服务端单向流出”的那一类产品形态。

## 一种比较推荐的 Agent 产品实践

如果是聊天 / Agent 系统，我会这样拆：

1. 前端发 `POST /chat/stream`
2. 后端返回 `text/event-stream`
3. 事件分成：
   - `delta`
   - `status`
   - `tool_start`
   - `tool_result`
   - `done`
4. 前端分别渲染文本、状态和工具时间线
5. 长任务每隔一段时间发心跳
6. 显式结束，不靠浏览器自己猜

## 最后记一句话

**SSE 的核心价值，不是“能实时”，而是它让一次长任务可以变成一条可观察、可渲染、可中断的输出流。**

做 Agent 产品时，这一点非常重要。
