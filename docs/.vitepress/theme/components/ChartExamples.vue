<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { loadScript } from '../utils/loadScript'

declare global {
  interface Window {
    echarts?: any
    Chart?: any
    mermaid?: any
    d3?: any
  }
}

const echartsRef = ref<HTMLElement | null>(null)
const chartJsRef = ref<HTMLCanvasElement | null>(null)
const mermaidRef = ref<HTMLElement | null>(null)
const d3Ref = ref<HTMLElement | null>(null)

let echartsInstance: any
let chartJsInstance: any

async function mountEcharts() {
  await loadScript('https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js', () => window.echarts)
  if (!echartsRef.value || !window.echarts) return
  echartsInstance = window.echarts.init(echartsRef.value)
  echartsInstance.setOption({
    tooltip: {},
    xAxis: {
      type: 'category',
      data: ['Agent', 'Prompt', 'Tool', 'Java', 'Cache', 'MQ']
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        data: [8, 12, 9, 15, 6, 10],
        itemStyle: {
          borderRadius: [8, 8, 0, 0],
          color: '#4b8fff'
        }
      }
    ]
  })
}

async function mountChartJs() {
  await loadScript(
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
    () => window.Chart
  )
  if (!chartJsRef.value || !window.Chart) return
  chartJsInstance = new window.Chart(chartJsRef.value, {
    type: 'line',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      datasets: [
        {
          label: 'Study Hours',
          data: [1, 2.5, 1.5, 3, 2.2, 4],
          borderColor: '#2c71ea',
          backgroundColor: 'rgba(44, 113, 234, 0.16)',
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  })
}

async function mountMermaid() {
  await loadScript('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js', () => window.mermaid)
  if (!mermaidRef.value || !window.mermaid) return
  const definition = `
flowchart LR
  A[User Request] --> B[Router Agent]
  B --> C[Tool Agent]
  B --> D[Writer Agent]
  C --> E[(Search / DB)]
  D --> F[Final Answer]
`
  window.mermaid.initialize({ startOnLoad: false, theme: 'base' })
  const { svg } = await window.mermaid.render('mermaid-demo', definition)
  mermaidRef.value.innerHTML = svg
}

async function mountD3() {
  await loadScript('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js', () => window.d3)
  if (!d3Ref.value || !window.d3) return
  const d3 = window.d3
  const data = [
    { name: 'API', value: 24 },
    { name: 'Redis', value: 18 },
    { name: 'JVM', value: 12 },
    { name: 'MQ', value: 16 }
  ]
  const width = 320
  const height = 180
  const margin = { top: 20, right: 20, bottom: 32, left: 36 }

  const svg = d3
    .select(d3Ref.value)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '180')

  const x = d3
    .scaleBand()
    .domain(data.map((d: any) => d.name))
    .range([margin.left, width - margin.right])
    .padding(0.28)

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d: any) => d.value) || 0])
    .nice()
    .range([height - margin.bottom, margin.top])

  svg
    .append('g')
    .attr('fill', '#77b0ff')
    .selectAll('rect')
    .data(data)
    .join('rect')
    .attr('x', (d: any) => x(d.name))
    .attr('y', (d: any) => y(d.value))
    .attr('height', (d: any) => y(0) - y(d.value))
    .attr('width', x.bandwidth())
    .attr('rx', 10)

  svg
    .append('g')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x))

  svg
    .append('g')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4))
}

onMounted(async () => {
  await Promise.all([mountEcharts(), mountChartJs(), mountMermaid(), mountD3()])
})

onBeforeUnmount(() => {
  echartsInstance?.dispose?.()
  chartJsInstance?.destroy?.()
})
</script>

<template>
  <div class="demo-grid">
    <article class="demo-card">
      <header>
        <h3>ECharts</h3>
        <p>适合管理后台、指标看板和业务图表。</p>
      </header>
      <div ref="echartsRef" class="chart-surface"></div>
    </article>

    <article class="demo-card">
      <header>
        <h3>Chart.js</h3>
        <p>上手轻，适合简洁统计图与趋势图。</p>
      </header>
      <div class="chart-surface">
        <canvas ref="chartJsRef"></canvas>
      </div>
    </article>

    <article class="demo-card">
      <header>
        <h3>Mermaid</h3>
        <p>适合流程图、架构图、时序图等文档配图。</p>
      </header>
      <div ref="mermaidRef" class="chart-surface mermaid-surface"></div>
    </article>

    <article class="demo-card">
      <header>
        <h3>D3</h3>
        <p>适合需要强定制交互和可视化表达的场景。</p>
      </header>
      <div ref="d3Ref" class="chart-surface"></div>
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

.demo-card h3 {
  margin: 0 0 0.25rem;
}

.demo-card p {
  margin: 0 0 0.9rem;
  color: #5a7493;
}

.chart-surface {
  min-height: 220px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(239, 246, 255, 0.72));
  border: 1px solid rgba(118, 178, 245, 0.12);
  padding: 0.75rem;
}

.mermaid-surface :deep(svg) {
  width: 100%;
  height: auto;
}

@media (max-width: 960px) {
  .demo-grid {
    grid-template-columns: 1fr;
  }
}
</style>
