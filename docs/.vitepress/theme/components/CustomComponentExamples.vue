<script setup lang="ts">
import { ref } from 'vue'

const activeTab = ref('design')
</script>

<template>
  <div class="demo-grid">
    <article class="demo-card">
      <h3>时间线</h3>
      <div class="timeline">
        <div class="timeline-item">
          <span class="dot"></span>
          <div><strong>08:30</strong><p>晨间阅读 Java 并发</p></div>
        </div>
        <div class="timeline-item">
          <span class="dot"></span>
          <div><strong>10:00</strong><p>整理 Agent System Prompt</p></div>
        </div>
        <div class="timeline-item">
          <span class="dot"></span>
          <div><strong>14:00</strong><p>复盘 Redis 缓存穿透</p></div>
        </div>
      </div>
    </article>

    <article class="demo-card">
      <h3>卡片</h3>
      <div class="note-cards">
        <div class="note-card">
          <span>Java</span>
          <strong>Spring Boot 启动流程</strong>
        </div>
        <div class="note-card">
          <span>Agents</span>
          <strong>多 Agent 路由器设计</strong>
        </div>
      </div>
    </article>

    <article class="demo-card wide-card">
      <h3>代码对比</h3>
      <div class="compare-grid">
        <div>
          <div class="compare-label">Before</div>
          <pre><code>if (obj != null) {
  return obj.getName();
}
return "unknown";</code></pre>
        </div>
        <div>
          <div class="compare-label after">After</div>
          <pre><code>return Optional.ofNullable(obj)
  .map(User::getName)
  .orElse("unknown");</code></pre>
        </div>
      </div>
    </article>

    <article class="demo-card wide-card">
      <h3>标签页</h3>
      <div class="tabs">
        <button :class="{ active: activeTab === 'design' }" @click="activeTab = 'design'">设计</button>
        <button :class="{ active: activeTab === 'code' }" @click="activeTab = 'code'">代码</button>
        <button :class="{ active: activeTab === 'review' }" @click="activeTab = 'review'">复盘</button>
      </div>
      <div class="tab-panel">
        <p v-if="activeTab === 'design'">适合放需求拆解、职责边界、接口草图。</p>
        <p v-else-if="activeTab === 'code'">适合放关键实现、核心类、测试片段。</p>
        <p v-else>适合放问题复盘、踩坑记录和后续优化。</p>
      </div>
    </article>

    <article class="demo-card">
      <h3>提示框</h3>
      <p>
        Hover
        <span class="tooltip">
          traceId
          <span class="tooltip-bubble">用于串联一次请求的日志链路。</span>
        </span>
        查看说明。
      </p>
    </article>

    <article class="demo-card">
      <h3>目录增强</h3>
      <nav class="mini-toc">
        <a href="#capability-charts">图表</a>
        <a href="#capability-animations">动画</a>
        <a href="#capability-components">组件</a>
        <a href="#capability-interactions">交互</a>
        <a href="#capability-embeds">嵌入</a>
      </nav>
      <p class="mini-toc-note">可以把长文目录做成胶囊导航、浮动目录或阅读进度。</p>
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

.wide-card {
  grid-column: 1 / -1;
}

.timeline {
  position: relative;
  margin-left: 0.6rem;
  padding-left: 1rem;
  border-left: 2px solid rgba(118, 178, 245, 0.2);
}

.timeline-item {
  position: relative;
  padding: 0 0 1rem 0.6rem;
}

.dot {
  position: absolute;
  left: -1.45rem;
  top: 0.25rem;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #4b8fff;
  box-shadow: 0 0 0 5px rgba(75, 143, 255, 0.15);
}

.note-cards {
  display: grid;
  gap: 0.75rem;
}

.note-card {
  padding: 1rem;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(242, 248, 255, 0.95), rgba(231, 242, 255, 0.82));
}

.note-card span {
  display: inline-block;
  margin-bottom: 0.35rem;
  color: #5a7493;
  font-size: 0.82rem;
}

.compare-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.compare-label {
  margin-bottom: 0.4rem;
  font-size: 0.82rem;
  color: #5a7493;
}

.compare-label.after {
  color: #2159b9;
}

pre {
  margin: 0;
  padding: 1rem;
  border-radius: 18px;
  background: rgba(12, 27, 46, 0.92);
  color: #e6f2ff;
  overflow: auto;
}

.tabs {
  display: flex;
  gap: 0.5rem;
}

.tabs button {
  padding: 0.55rem 0.9rem;
  border: 1px solid rgba(118, 178, 245, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  color: #4d6481;
  cursor: pointer;
}

.tabs button.active {
  background: #2c71ea;
  color: white;
}

.tab-panel {
  margin-top: 0.8rem;
  padding: 1rem;
  border-radius: 18px;
  background: rgba(240, 247, 255, 0.9);
}

.tooltip {
  position: relative;
  color: #2159b9;
  border-bottom: 1px dashed rgba(33, 89, 185, 0.5);
  cursor: help;
}

.tooltip-bubble {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%);
  width: 220px;
  padding: 0.7rem 0.8rem;
  border-radius: 14px;
  background: rgba(16, 42, 70, 0.92);
  color: #f1f7ff;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.tooltip:hover .tooltip-bubble {
  opacity: 1;
}

.mini-toc {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.mini-toc a {
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  background: rgba(99, 164, 255, 0.12);
  text-decoration: none;
}

.mini-toc-note {
  margin-top: 0.8rem;
}

@media (max-width: 960px) {
  .demo-grid,
  .compare-grid {
    grid-template-columns: 1fr;
  }
}
</style>
