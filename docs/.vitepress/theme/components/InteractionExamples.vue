<script setup lang="ts">
import { computed, ref } from 'vue'

const query = ref('')
const activeTag = ref<'all' | 'agent' | 'java' | 'infra'>('all')
const activeCollapse = ref<number | null>(0)
const darkDemo = ref(false)
const copied = ref(false)

const notes = [
  { title: 'Spring Boot 异常处理', tag: 'java' },
  { title: 'Agent 工具路由策略', tag: 'agent' },
  { title: 'Redis 缓存一致性', tag: 'infra' },
  { title: '多 Agent 协作协议', tag: 'agent' }
]

const searchedNotes = computed(() =>
  notes.filter((item) => item.title.toLowerCase().includes(query.value.toLowerCase()))
)

const filteredNotes = computed(() =>
  activeTag.value === 'all' ? notes : notes.filter((item) => item.tag === activeTag.value)
)

async function copySnippet() {
  await navigator.clipboard.writeText('pnpm run docs:build')
  copied.value = true
  setTimeout(() => { copied.value = false }, 1200)
}
</script>

<template>
  <div class="demo-grid">
    <article class="demo-card">
      <h3>搜索</h3>
      <input v-model="query" class="demo-input" placeholder="搜索示例笔记..." />
      <ul class="demo-list">
        <li v-for="item in searchedNotes" :key="item.title">{{ item.title }}</li>
      </ul>
    </article>

    <article class="demo-card">
      <h3>筛选</h3>
      <div class="pill-row">
        <button v-for="tag in ['all', 'agent', 'java', 'infra']" :key="tag" :class="{ active: activeTag === tag }" @click="activeTag = tag as any">
          {{ tag }}
        </button>
      </div>
      <ul class="demo-list">
        <li v-for="item in filteredNotes" :key="item.title">{{ item.title }}</li>
      </ul>
    </article>

    <article class="demo-card">
      <h3>折叠</h3>
      <div class="accordion">
        <button class="accordion-item" @click="activeCollapse = activeCollapse === 0 ? null : 0">
          什么情况下用 Agent？
        </button>
        <p v-if="activeCollapse === 0">当任务需要拆步骤、接工具或保留角色边界时。</p>
        <button class="accordion-item" @click="activeCollapse = activeCollapse === 1 ? null : 1">
          什么情况下做专题页？
        </button>
        <p v-if="activeCollapse === 1">当笔记开始反复补充，值得沉淀成可持续维护内容时。</p>
      </div>
    </article>

    <article class="demo-card">
      <h3>主题切换</h3>
      <button class="mini-button" @click="darkDemo = !darkDemo">切换示例主题</button>
      <div class="theme-preview" :data-mode="darkDemo ? 'dark' : 'light'">
        <strong>{{ darkDemo ? 'Dark Demo' : 'Light Demo' }}</strong>
        <span>这个例子演示局部主题区域切换。</span>
      </div>
    </article>

    <article class="demo-card">
      <h3>复制按钮</h3>
      <div class="copy-box">
        <code>pnpm run docs:build</code>
        <button class="mini-button" @click="copySnippet">{{ copied ? '已复制' : '复制' }}</button>
      </div>
    </article>

    <article class="demo-card">
      <h3>数据展示面板</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <span>Notes</span>
          <strong>128</strong>
        </div>
        <div class="stat-card">
          <span>Agents</span>
          <strong>12</strong>
        </div>
        <div class="stat-card">
          <span>Deploys</span>
          <strong>34</strong>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.demo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.demo-card {
  padding: 1rem;
  border: 1px solid rgba(118, 178, 245, 0.18);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 18px 40px rgba(92, 146, 214, 0.08);
}

.demo-input {
  width: 100%;
  margin-top: 0.4rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(118, 178, 245, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.85);
}

.demo-list {
  margin: 0.75rem 0 0;
}

.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.pill-row button,
.mini-button,
.accordion-item {
  padding: 0.55rem 0.9rem;
  border: 0;
  border-radius: 999px;
  background: rgba(99, 164, 255, 0.12);
  color: #2159b9;
  cursor: pointer;
}

.pill-row button.active {
  background: #2c71ea;
  color: white;
}

.accordion {
  display: grid;
  gap: 0.6rem;
}

.accordion p {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 14px;
  background: rgba(240, 247, 255, 0.86);
}

.theme-preview {
  margin-top: 0.8rem;
  padding: 1rem;
  border-radius: 18px;
  display: grid;
  gap: 0.35rem;
}

.theme-preview[data-mode='light'] {
  background: rgba(244, 249, 255, 0.94);
  color: #18324d;
}

.theme-preview[data-mode='dark'] {
  background: #11253d;
  color: #e9f4ff;
}

.copy-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-radius: 18px;
  background: rgba(240, 247, 255, 0.86);
}

.copy-box code {
  white-space: nowrap;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.stat-card {
  padding: 0.9rem;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(243, 249, 255, 0.96), rgba(228, 241, 255, 0.88));
}

.stat-card span {
  display: block;
  color: #5a7493;
  font-size: 0.85rem;
}

.stat-card strong {
  display: block;
  margin-top: 0.3rem;
  font-size: 1.6rem;
}

@media (max-width: 960px) {
  .demo-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .copy-box {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
