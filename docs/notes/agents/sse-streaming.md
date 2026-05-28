---
title: SSE 流式响应
sidebarTitle: SSE 流式响应
---

# SSE 流式响应

SSE（Server-Sent Events）适合做“**一次请求，服务端持续返回增量结果**”：

- LLM token 流式输出
- Agent 执行进度
- 工具调用日志
- 长任务阶段状态

如果客户端在流期间不需要频繁给服务端发消息，优先用 SSE；如果双方都要高频主动发送，再考虑 WebSocket。

## 先给实现结论

做聊天或 Agent 流式接口时，建议直接按这套落地：

1. 前端用 `fetch + ReadableStream` 发 `POST`，不要硬套 `EventSource`。
2. 后端返回 `Content-Type: text/event-stream; charset=utf-8`。
3. 每条消息按 `event + data + 空行` 输出，并且每次输出后 `flush`。
4. 事件协议一开始就拆成 `delta`、`status`、`tool_start`、`tool_result`、`error`、`done`。
5. 长任务加心跳，代理层关闭缓冲，结束时显式发送 `done`。

## SSE 数据格式

SSE 本质是服务端不断输出文本帧。最小帧长这样：

```text
data: hello
```

更推荐带事件名：

```text
event: delta
data: {"text":"Hel"}

event: delta
data: {"text":"lo"}

event: done
data: {}
```

关键规则：

- 一条事件用空行结束。
- `event:` 表示事件类型。
- `data:` 表示事件数据。
- 多行 `data:` 会被客户端拼成一个数据块。
- `: ping` 是注释帧，常用来做心跳。

## 推荐事件协议

Agent 产品不要只推一坨文本。前后端最好先约定事件类型：

| 事件 | 用途 |
| --- | --- |
| `message_start` | 创建一条 assistant 消息 |
| `delta` | 追加文本增量 |
| `status` | 展示阶段状态，例如 thinking、tool、finalizing |
| `tool_start` | 工具开始执行 |
| `tool_result` | 工具执行结果 |
| `error` | 流内错误 |
| `done` | 正常结束 |

对应的输出可以是：

```text
event: message_start
data: {"messageId":"msg_001"}

event: status
data: {"phase":"thinking"}

event: delta
data: {"text":"正在查询订单"}

event: tool_start
data: {"toolCallId":"tool_001","toolName":"queryOrder"}

event: tool_result
data: {"toolCallId":"tool_001","output":"订单已发货"}

event: done
data: {}

```

这样前端可以分别渲染文本、状态、工具时间线和错误提示。

## 前端实现：什么时候用 `EventSource`

`EventSource` 只适合简单 GET 流：

- 不需要 `POST` body
- 不需要自定义鉴权 header
- 鉴权可以靠 cookie
- 不需要自己控制底层 parser

```ts
const source = new EventSource('/api/chat/stream')

source.addEventListener('delta', (event) => {
  const data = JSON.parse(event.data)
  console.log(data.text)
})

source.addEventListener('done', () => {
  source.close()
})

source.onerror = () => {
  source.close()
}
```

聊天和 Agent 接口通常需要传 `message`、`sessionId`、历史消息、模型参数，所以更常见的是 `POST`。这时用 `fetch + ReadableStream`。

## 前端实现：`fetch + ReadableStream`

先定义前端收到的帧：

```ts
type StreamEvent =
  | { event: 'message_start'; data: { messageId: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'status'; data: { phase: 'thinking' | 'tool' | 'finalizing' } }
  | { event: 'tool_start'; data: { toolCallId: string; toolName: string } }
  | { event: 'tool_result'; data: { toolCallId: string; output: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done'; data: Record<string, never> }

type RawSseFrame = {
  event: string
  data: string
}
```

再写一个 SSE 帧解析器：

```ts
function parseSseFrame(frame: string): RawSseFrame | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of frame.replace(/\r\n/g, '\n').split('\n')) {
    if (!line || line.startsWith(':')) continue

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

    if (field === 'event') {
      event = value
    }

    if (field === 'data') {
      dataLines.push(value)
    }
  }

  if (dataLines.length === 0) return null

  return {
    event,
    data: dataLines.join('\n')
  }
}
```

最后封装请求、读流、解析和中断：

```ts
export async function streamChat(
  input: {
    sessionId: string
    message: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  },
  options: {
    token: string
    signal?: AbortSignal
    onEvent: (event: StreamEvent) => void
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

    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const parsed = parseSseFrame(frame)
      if (!parsed) continue

      const event = {
        event: parsed.event,
        data: JSON.parse(parsed.data)
      } as StreamEvent

      options.onEvent(event)

      if (event.event === 'error') {
        throw new Error(event.data.message)
      }

      if (event.event === 'done') {
        await reader.cancel()
        return
      }
    }
  }
}
```

组件里只处理 UI 状态，不要把读流逻辑塞进页面组件：

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
        sessionId,
        message,
        messages
      },
      {
        token,
        signal: controller.signal,
        onEvent(event) {
          if (event.event === 'delta') {
            setAnswer((current) => current + event.data.text)
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

## 后端实现：Spring Boot 直接写响应流

后端可以用 `SseEmitter`，也可以直接写响应流。对接 LLM token 流时，直接写响应流更容易控制格式。

先定义请求和 writer：

```java
public record ChatRequest(
        String sessionId,
        String message
) {
}
```

```java
@Component
public class SseWriter {

    private final ObjectMapper objectMapper;

    public SseWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void writeEvent(PrintWriter writer, String event, Object data) throws IOException {
        writer.write("event: " + event + "\n");
        writer.write("data: " + objectMapper.writeValueAsString(data) + "\n\n");
        writer.flush();
    }

    public void writeHeartbeat(PrintWriter writer) {
        writer.write(": ping\n\n");
        writer.flush();
    }
}
```

Controller 只负责 HTTP 层：

```java
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private final ChatStreamService chatStreamService;

    public ChatController(ChatStreamService chatStreamService) {
        this.chatStreamService = chatStreamService;
    }

    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public void stream(@RequestBody ChatRequest request, HttpServletResponse response) throws IOException {
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType("text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("X-Accel-Buffering", "no");

        chatStreamService.stream(request, response.getWriter());
    }
}
```

Service 负责把模型或 Agent 回调转成 SSE：

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

        heartbeatExecutor.scheduleAtFixedRate(
                () -> sseWriter.writeHeartbeat(writer),
                15,
                15,
                TimeUnit.SECONDS
        );

        try {
            sseWriter.writeEvent(writer, "message_start", Map.of(
                    "messageId", UUID.randomUUID().toString()
            ));

            agentRunner.run(request, new AgentStreamListener() {
                @Override
                public void onToken(String token) {
                    safeWrite(writer, "delta", Map.of("text", token));
                }

                @Override
                public void onStatus(String phase) {
                    safeWrite(writer, "status", Map.of("phase", phase));
                }

                @Override
                public void onToolStart(String toolCallId, String toolName) {
                    safeWrite(writer, "tool_start", Map.of(
                            "toolCallId", toolCallId,
                            "toolName", toolName
                    ));
                }

                @Override
                public void onToolResult(String toolCallId, String output) {
                    safeWrite(writer, "tool_result", Map.of(
                            "toolCallId", toolCallId,
                            "output", output
                    ));
                }
            });

            sseWriter.writeEvent(writer, "done", Map.of());
        } catch (Exception exception) {
            sseWriter.writeEvent(writer, "error", Map.of(
                    "message", exception.getMessage()
            ));
        } finally {
            heartbeatExecutor.shutdownNow();
        }
    }

    private void safeWrite(PrintWriter writer, String event, Object data) {
        try {
            sseWriter.writeEvent(writer, event, data);
        } catch (IOException ignored) {
        }
    }
}
```

`AgentRunner` 不要依赖 HTTP，它只暴露流式回调：

```java
public interface AgentStreamListener {
    void onToken(String token);
    void onStatus(String phase);
    void onToolStart(String toolCallId, String toolName);
    void onToolResult(String toolCallId, String output);
}
```

```java
public interface AgentRunner {
    void run(ChatRequest request, AgentStreamListener listener);
}
```

这样模型层、Agent 层、Web 层是分开的：

- 模型 SDK 负责产生 token。
- `AgentRunner` 负责把 token、工具调用、状态变化转成回调。
- `ChatStreamService` 负责把回调写成 SSE。
- Controller 只负责请求和响应头。

## 如果用 `SseEmitter`

`SseEmitter` 更适合事件驱动式推送，代码会更像 Spring MVC：

```java
@PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter stream(@RequestBody ChatRequest request) {
    SseEmitter emitter = new SseEmitter(0L);

    taskExecutor.execute(() -> {
        try {
            emitter.send(SseEmitter.event()
                    .name("delta")
                    .data(Map.of("text", "hello")));
            emitter.send(SseEmitter.event()
                    .name("done")
                    .data(Map.of()));
            emitter.complete();
        } catch (Exception exception) {
            emitter.completeWithError(exception);
        }
    });

    return emitter;
}
```

它的优点是不用自己拼 `event:` 和 `data:`；缺点是遇到复杂心跳、代理问题、底层输出控制时没有直接写流直观。

## Nginx 配置

很多“不流式”的问题不是代码错，而是代理层缓冲了响应。

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

重点是：

- `proxy_buffering off`：不要让 Nginx 攒够一批再吐给前端。
- `proxy_read_timeout 3600s`：长任务不要被中途断开。
- 后端响应头加 `X-Accel-Buffering: no`。

## 常见坑

### 1. 忘记空行

SSE 事件必须用空行结束，否则前端会一直等这一帧结束。

### 2. 写了但没 `flush`

后端每次写完事件都要 `flush`，否则数据可能停在服务端缓冲区。

### 3. 只推文本，不推事件类型

只推 `data: xxx` 前期能跑，后面一加工具调用、状态、错误提示就会乱。

### 4. 没有心跳

长时间没有数据时，中间层可能断开连接。可以定期推：

```text
: ping

```

### 5. 没有 `done`

不要让前端靠连接关闭猜测是否成功。正常结束时显式推：

```text
event: done
data: {}

```

### 6. 错误只写日志

流内异常最好先推给前端：

```text
event: error
data: {"message":"模型服务暂时不可用"}

```

然后再关闭连接。

## 什么时候不用 SSE

下面这些更适合 WebSocket：

- 双向高频互动
- 客户端持续上报状态
- 房间广播
- 协同编辑
- 游戏或白板同步

SSE 不是 WebSocket 的替代品。它只是在“服务端持续向前端输出”这个场景里更简单。

## 最后记一句话

SSE 落地时不要只记住“流式输出”。真正要设计的是：

**事件协议、前端 parser、后端 flush、心跳、结束事件和代理缓冲。**
