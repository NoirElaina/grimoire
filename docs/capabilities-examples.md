---
outline: deep
---

<script setup>
import ChartExamples from './.vitepress/theme/components/ChartExamples.vue'
import AnimationExamples from './.vitepress/theme/components/AnimationExamples.vue'
import CustomComponentExamples from './.vitepress/theme/components/CustomComponentExamples.vue'
import InteractionExamples from './.vitepress/theme/components/InteractionExamples.vue'
import EmbedExamples from './.vitepress/theme/components/EmbedExamples.vue'
</script>

# 能力示例

这一页把你刚才提到的能力各做了一个最小可用例子，方便你后面直接抄到自己的笔记站里继续改。

## 图表 {#capability-charts}

支持的方向：

- ECharts
- Chart.js
- Mermaid
- D3

<ClientOnly>
  <ChartExamples />
</ClientOnly>

## 动画 {#capability-animations}

支持的方向：

- CSS 动画
- Vue 过渡
- 滚动动效
- 粒子背景
- 卡片交互

<ClientOnly>
  <AnimationExamples />
</ClientOnly>

## 自定义组件 {#capability-components}

支持的方向：

- 时间线
- 卡片
- 代码对比
- 标签页
- 提示框
- 目录增强

<ClientOnly>
  <CustomComponentExamples />
</ClientOnly>

## 交互内容 {#capability-interactions}

支持的方向：

- 搜索
- 筛选
- 折叠
- 主题切换
- 复制按钮
- 数据展示面板

<ClientOnly>
  <InteractionExamples />
</ClientOnly>

## 嵌入内容 {#capability-embeds}

支持的方向：

- B 站
- YouTube
- GitHub Gist
- PDF
- 外部页面

<ClientOnly>
  <EmbedExamples />
</ClientOnly>

## 说明

- 有些外部内容可能会被对方站点限制 iframe 或脚本嵌入，这属于正常现象。
- 图表库示例使用的是运行时 CDN 方式，方便你先看效果；如果以后要长期使用，建议再正式安装依赖。
