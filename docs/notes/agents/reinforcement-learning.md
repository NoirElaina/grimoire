---
title: 强化学习工程入门
sidebarTitle: 强化学习
---

# 强化学习工程入门

强化学习最容易被讲成一堆抽象名词：

- 状态
- 动作
- 奖励
- 策略
- 价值函数

这些概念当然重要，但如果只停在这里，基本还是不知道怎么写代码。  
所以这篇直接按工程实现来讲：**训练系统怎么分层、环境怎么抽象、loop 怎么跑、DQN 和 PPO 代码结构差在哪。**

## 先说结论

如果你要自己实现一个最小强化学习系统，先把它拆成这 5 层：

1. `Environment`
2. `Policy / Value Network`
3. `Buffer / Rollout Storage`
4. `Trainer`
5. `Evaluator`

一句话就是：

**强化学习不是“调一个模型”，而是持续地“采样 -> 计算目标 -> 更新参数 -> 再采样”的闭环系统。**

## 先建立最小心智模型

一轮最基础的强化学习循环，通常就是：

1. 环境给当前状态 `state`
2. 策略根据 `state` 选动作 `action`
3. 环境执行 `action`，返回：
   - `next_state`
   - `reward`
   - `done`
4. 把这条 transition 存起来
5. 用收集到的数据更新策略

也就是说，真正的核心不是“奖励函数很神秘”，而是：

- 你如何定义环境
- 你如何记录数据
- 你如何把这些数据喂回模型

## 工程上先别从算法名开始，先从接口开始

如果你想让后面能换 DQN、PPO、A2C，不要一开始把算法逻辑写死在一堆脚本里。  
先把环境和训练接口立住。

## 一版最小环境接口

```python
from typing import Protocol, Any


class Env(Protocol):
    def reset(self) -> Any:
        ...

    def step(self, action: Any) -> tuple[Any, float, bool, dict]:
        ...
```

这个接口背后的意思很简单：

- `reset()` 开一局
- `step(action)` 往前走一步

如果你做的是游戏、资源调度、Agent 决策模拟、LLM bandit，都能往这套接口上挂。

## 一个最小环境例子

先不要一上来接复杂环境，先从可控 toy env 开始。

```python
class CounterEnv:
    def __init__(self, target: int = 5, max_steps: int = 10):
        self.target = target
        self.max_steps = max_steps
        self.current = 0
        self.steps = 0

    def reset(self):
        self.current = 0
        self.steps = 0
        return self.current

    def step(self, action: int):
        # action: 0 -> -1, 1 -> +1
        self.current += -1 if action == 0 else 1
        self.steps += 1

        reward = 1.0 if self.current == self.target else -0.1
        done = self.current == self.target or self.steps >= self.max_steps
        info = {}
        return self.current, reward, done, info
```

这个环境虽然很小，但已经完整体现了：

- 状态
- 动作
- 奖励
- 终止条件

## 策略网络先只做“给状态，出动作”

如果用 PyTorch，一版最小策略网络可以是：

```python
import torch
import torch.nn as nn


class PolicyNet(nn.Module):
    def __init__(self, state_dim: int, action_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim),
        )

    def forward(self, x):
        return self.net(x)
```

对于离散动作空间，这个网络通常输出：

- 每个动作的 logits

然后再采样：

```python
import torch.distributions as D


def sample_action(policy: PolicyNet, state_tensor: torch.Tensor):
    logits = policy(state_tensor)
    dist = D.Categorical(logits=logits)
    action = dist.sample()
    log_prob = dist.log_prob(action)
    return action.item(), log_prob
```

## 如果你是 DQN，策略层会长得不一样

DQN 不是直接学一个随机策略分布，而是学：

- `Q(s, a)`

也就是在状态 `s` 下，每个动作 `a` 的价值。

所以 DQN 的 action 选择通常是：

```python
def select_action(q_net, state_tensor, epsilon: float):
    if torch.rand(1).item() < epsilon:
        return torch.randint(0, 2, (1,)).item()

    with torch.no_grad():
        q_values = q_net(state_tensor)
        return q_values.argmax(dim=-1).item()
```

这就是为什么：

- PPO 常用 `policy + value`
- DQN 更像 `q_network + target_network`

## Buffer 是强化学习实现里最容易被低估的层

很多教程会把重点全放在公式，但工程上数据存储层其实非常关键。

### 对 DQN 来说

通常要有 Replay Buffer：

```python
from collections import deque
import random


class ReplayBuffer:
    def __init__(self, capacity: int):
        self.buffer = deque(maxlen=capacity)

    def push(self, state, action, reward, next_state, done):
        self.buffer.append((state, action, reward, next_state, done))

    def sample(self, batch_size: int):
        batch = random.sample(self.buffer, batch_size)
        states, actions, rewards, next_states, dones = zip(*batch)
        return states, actions, rewards, next_states, dones

    def __len__(self):
        return len(self.buffer)
```

Replay Buffer 的作用不是“存一下数据”，而是打破时序相关性，让训练更稳定。

### 对 PPO 来说

更常见的是 Rollout Buffer：

- 存一整段轨迹
- 后面算 `advantage`
- 再做多轮 update

也就是说：

- DQN 偏“离策略 + replay”
- PPO 偏“同策略附近 + rollout”

## 训练 loop 一定要单独成类

不要把采样、更新、评估全写在一个 notebook cell 或一个大脚本里。  
更稳的做法是收成 Trainer。

## 一个最小 DQN Trainer 骨架

```python
import torch
import torch.nn.functional as F


class DQNTrainer:
    def __init__(self, q_net, target_net, optimizer, gamma: float = 0.99):
        self.q_net = q_net
        self.target_net = target_net
        self.optimizer = optimizer
        self.gamma = gamma

    def train_step(self, batch):
        states, actions, rewards, next_states, dones = batch

        states = torch.tensor(states, dtype=torch.float32).unsqueeze(-1)
        actions = torch.tensor(actions, dtype=torch.long).unsqueeze(-1)
        rewards = torch.tensor(rewards, dtype=torch.float32).unsqueeze(-1)
        next_states = torch.tensor(next_states, dtype=torch.float32).unsqueeze(-1)
        dones = torch.tensor(dones, dtype=torch.float32).unsqueeze(-1)

        q_values = self.q_net(states).gather(1, actions)

        with torch.no_grad():
            next_q = self.target_net(next_states).max(dim=1, keepdim=True)[0]
            target = rewards + self.gamma * next_q * (1 - dones)

        loss = F.mse_loss(q_values, target)

        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()

        return loss.item()
```

这个类干的事情非常明确：

- 从 batch 算训练目标
- 算 loss
- 反向传播

## 一版最小训练主循环

```python
env = CounterEnv()
buffer = ReplayBuffer(capacity=10000)

state = env.reset()

for step in range(2000):
    state_tensor = torch.tensor([[state]], dtype=torch.float32)
    action = select_action(q_net, state_tensor, epsilon=0.1)

    next_state, reward, done, _ = env.step(action)
    buffer.push(state, action, reward, next_state, done)

    state = next_state
    if done:
        state = env.reset()

    if len(buffer) >= 64:
        batch = buffer.sample(64)
        loss = trainer.train_step(batch)

    if step % 200 == 0:
        target_net.load_state_dict(q_net.state_dict())
```

这段代码其实已经把强化学习最核心的闭环跑起来了。

## PPO 的代码结构为什么不一样

PPO 更常见的结构是：

1. 用当前策略采样一批 rollout
2. 记录：
   - state
   - action
   - reward
   - log_prob
   - value
3. 计算：
   - return
   - advantage
4. 对同一批数据训练多个 epoch

所以 PPO 通常至少要多出：

- `ValueNet`
- `compute_gae()`
- `ppo_loss()`

## 一个最小 PPO 结构骨架

```python
class ActorCritic(nn.Module):
    def __init__(self, state_dim: int, action_dim: int):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(state_dim, 64),
            nn.Tanh(),
        )
        self.policy_head = nn.Linear(64, action_dim)
        self.value_head = nn.Linear(64, 1)

    def forward(self, x):
        hidden = self.shared(x)
        return self.policy_head(hidden), self.value_head(hidden)
```

### GAE 计算骨架

```python
def compute_gae(rewards, values, dones, gamma=0.99, lam=0.95):
    advantages = []
    gae = 0.0
    next_value = 0.0

    for t in reversed(range(len(rewards))):
        delta = rewards[t] + gamma * next_value * (1 - dones[t]) - values[t]
        gae = delta + gamma * lam * (1 - dones[t]) * gae
        advantages.insert(0, gae)
        next_value = values[t]

    returns = [adv + val for adv, val in zip(advantages, values)]
    return advantages, returns
```

你会发现 PPO 的工程实现比 DQN 更像“采一批轨迹再统一训练”，而不是每来一条 transition 就抽样更新。

## 一个真正能维护的 RL 项目，目录应该怎么拆

比较推荐这样：

```text
rl_project/
├─ envs/
│  └─ counter_env.py
├─ models/
│  ├─ policy_net.py
│  └─ actor_critic.py
├─ buffers/
│  ├─ replay_buffer.py
│  └─ rollout_buffer.py
├─ trainers/
│  ├─ dqn_trainer.py
│  └─ ppo_trainer.py
├─ runners/
│  └─ train_dqn.py
├─ eval/
│  └─ evaluator.py
└─ configs/
   └─ dqn.yaml
```

也就是说：

- 环境单独放
- 模型单独放
- 数据缓存单独放
- 算法更新单独放
- 训练脚本只负责组装

不要所有代码全堆进一个 `train.py`。

## 评估层不要缺

强化学习里很容易出现一种假象：

- loss 在降
- 但策略并没有真的更好

所以最好单独写一个 evaluator：

```python
def evaluate_policy(env, policy, episodes: int = 10):
    total_reward = 0.0

    for _ in range(episodes):
        state = env.reset()
        done = False
        while not done:
            state_tensor = torch.tensor([[state]], dtype=torch.float32)
            with torch.no_grad():
                logits = policy(state_tensor)
                action = logits.argmax(dim=-1).item()
            state, reward, done, _ = env.step(action)
            total_reward += reward

    return total_reward / episodes
```

训练时至少定期看：

- average episode reward
- episode length
- success rate

不要只盯 loss。

## 强化学习最常见的 5 个工程坑

### 1. 奖励函数写得太随意

奖励是训练目标的一部分，不是调参时随手拍的魔法常数。  
如果奖励设计错了，模型会非常认真地学错。

### 2. 没有把 `done` 处理清楚

很多 bug 都出在：

- episode 结束了还继续 bootstrap
- next value 用错

### 3. 训练和评估共用同一套探索策略

例如 DQN 训练时用 epsilon-greedy，评估时也忘了关探索。  
最后指标会飘。

### 4. Buffer 太小或采样方式不对

数据多样性不够，训练会非常不稳定。

### 5. 日志和 checkpoint 不完整

RL 很难一次跑通，最好一开始就记录：

- reward
- loss
- success rate
- checkpoint

## 如果你是做 LLM / Agent，这和 RL 有什么关系

对 LLM/Agent 来说，强化学习最常见的几个映射是：

- RLHF
- RLAIF
- PPO / GRPO 这类策略优化
- bandit 式在线反馈优化

但工程结构其实还是同一个套路：

1. 定义环境或反馈来源
2. 让策略生成动作
3. 收到奖励或偏好信号
4. 更新策略

只是这里的：

- `state`
  可能是 prompt / 上下文
- `action`
  可能是输出文本或工具决策
- `reward`
  可能来自 reward model、人工偏好或任务成败

也就是说，LLM 场景只是把 RL 的环境换了，不是把工程骨架完全推翻。

## 一种比较推荐的学习/实现顺序

如果你真的准备自己写强化学习，我建议顺序是：

1. 先写最小环境
2. 再跑通 DQN
3. 再理解 rollout 和 advantage
4. 再实现 PPO
5. 最后再去碰 LLM 场景下的 RLHF / GRPO

不要一上来直接看大模型强化学习，那样很容易只记住术语，不知道系统在干什么。

## 最后记一句话

**强化学习工程的核心，不是背公式，而是把“环境、采样、缓存、更新、评估”这条闭环系统真正写出来。**

只要这条闭环跑顺了，算法细节才有地方落。
