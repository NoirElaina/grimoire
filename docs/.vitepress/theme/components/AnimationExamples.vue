<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue'

const showToast = ref(false)
const revealRefs = ref<HTMLElement[]>([])
const particleRef = ref<HTMLCanvasElement | null>(null)
const tiltCardRef = ref<HTMLElement | null>(null)

let revealObserver: IntersectionObserver | undefined
let animationFrame = 0
let removeTiltListeners: (() => void) | undefined

function setRevealRef(el: HTMLElement | null) {
  if (el && !revealRefs.value.includes(el)) {
    revealRefs.value.push(el)
  }
}

function toggleToast() {
  showToast.value = !showToast.value
}

function mountParticles() {
  const canvas = particleRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return

  const width = canvas.width = 320
  const height = canvas.height = 180
  const particles = Array.from({ length: 26 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.8,
    vy: (Math.random() - 0.5) * 0.8,
    r: Math.random() * 2 + 1
  }))

  const render = () => {
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#dff0ff'
    context.fillRect(0, 0, width, height)

    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      if (p.x < 0 || p.x > width) p.vx *= -1
      if (p.y < 0 || p.y > height) p.vy *= -1

      context.beginPath()
      context.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      context.fillStyle = '#4b8fff'
      context.fill()
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i]
        const b = particles[j]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (distance < 56) {
          context.strokeStyle = `rgba(75, 143, 255, ${1 - distance / 56})`
          context.beginPath()
          context.moveTo(a.x, a.y)
          context.lineTo(b.x, b.y)
          context.stroke()
        }
      }
    }

    animationFrame = requestAnimationFrame(render)
  }

  render()
}

function mountTiltCard() {
  const card = tiltCardRef.value
  if (!card) return
  const onMove = (event: MouseEvent) => {
    const rect = card.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const rotateX = ((y / rect.height) - 0.5) * -10
    const rotateY = ((x / rect.width) - 0.5) * 10
    card.style.setProperty('--tilt-x', `${rotateX}deg`)
    card.style.setProperty('--tilt-y', `${rotateY}deg`)
  }
  const onLeave = () => {
    card.style.setProperty('--tilt-x', '0deg')
    card.style.setProperty('--tilt-y', '0deg')
  }
  card.addEventListener('mousemove', onMove)
  card.addEventListener('mouseleave', onLeave)
  removeTiltListeners = () => {
    card.removeEventListener('mousemove', onMove)
    card.removeEventListener('mouseleave', onLeave)
  }
}

onMounted(async () => {
  mountParticles()
  mountTiltCard()

  await nextTick()
  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed')
      }
    }
  }, { threshold: 0.2 })
  revealRefs.value.forEach((el) => revealObserver?.observe(el))
})

onBeforeUnmount(() => {
  revealObserver?.disconnect()
  cancelAnimationFrame(animationFrame)
  removeTiltListeners?.()
})
</script>

<template>
  <div class="demo-grid">
    <article class="demo-card">
      <h3>CSS 动画</h3>
      <p>使用纯 CSS 做漂浮与脉冲效果。</p>
      <div class="orb-stage">
        <span class="orb orb-a"></span>
        <span class="orb orb-b"></span>
        <span class="orb orb-c"></span>
      </div>
    </article>

    <article class="demo-card">
      <h3>Vue 过渡</h3>
      <p>按钮触发消息卡片的进入和退出。</p>
      <button class="mini-button" @click="toggleToast">切换提示</button>
      <transition name="toast">
        <div v-if="showToast" class="toast-panel">部署完成，文档已更新。</div>
      </transition>
    </article>

    <article class="demo-card">
      <h3>滚动动效</h3>
      <p>卡片进入视口时渐显上移。</p>
      <div class="reveal-list">
        <div v-for="item in ['Agent', 'Prompt', 'Redis']" :key="item" :ref="setRevealRef" class="reveal-card">
          {{ item }} 笔记卡片
        </div>
      </div>
    </article>

    <article class="demo-card">
      <h3>粒子背景</h3>
      <p>常见于英雄区或专题封面。</p>
      <canvas ref="particleRef" class="particle-canvas"></canvas>
    </article>

    <article ref="tiltCardRef" class="demo-card tilt-card wide-card">
      <h3>卡片交互</h3>
      <p>鼠标移动时轻微倾斜，强化卡片质感。</p>
      <div class="tilt-inner">
        <strong>Spring Boot Service Layer</strong>
        <span>hover me</span>
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

.wide-card {
  grid-column: 1 / -1;
}

.orb-stage {
  position: relative;
  height: 180px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(239, 246, 255, 0.72));
  overflow: hidden;
}

.orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(1px);
  animation: float 5s ease-in-out infinite;
}

.orb-a {
  width: 64px;
  height: 64px;
  left: 18%;
  top: 30%;
  background: rgba(75, 143, 255, 0.45);
}

.orb-b {
  width: 88px;
  height: 88px;
  right: 18%;
  top: 22%;
  background: rgba(119, 176, 255, 0.35);
  animation-delay: 1s;
}

.orb-c {
  width: 40px;
  height: 40px;
  left: 46%;
  bottom: 22%;
  background: rgba(31, 66, 112, 0.3);
  animation-delay: 1.8s;
}

.mini-button {
  margin-top: 0.4rem;
  padding: 0.55rem 0.9rem;
  border: 0;
  border-radius: 999px;
  color: white;
  background: linear-gradient(135deg, #5aa4ff, #2c71ea);
  cursor: pointer;
}

.toast-panel {
  margin-top: 0.8rem;
  padding: 0.85rem 1rem;
  border-radius: 16px;
  background: rgba(225, 240, 255, 0.9);
  border: 1px solid rgba(118, 178, 245, 0.2);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.28s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.reveal-list {
  display: grid;
  gap: 0.75rem;
}

.reveal-card {
  padding: 0.85rem 1rem;
  border-radius: 16px;
  background: rgba(240, 247, 255, 0.9);
  transform: translateY(22px);
  opacity: 0;
  transition: transform 0.45s ease, opacity 0.45s ease;
}

.reveal-card.revealed {
  transform: translateY(0);
  opacity: 1;
}

.particle-canvas {
  width: 100%;
  max-width: 320px;
  border-radius: 18px;
  display: block;
}

.tilt-card {
  transform: perspective(900px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
  transition: transform 0.18s ease;
}

.tilt-inner {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 1.25rem;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(77, 143, 255, 0.18), rgba(255, 255, 255, 0.7));
}

@keyframes float {
  0%, 100% { transform: translateY(0px) scale(1); }
  50% { transform: translateY(-14px) scale(1.04); }
}

@media (max-width: 960px) {
  .demo-grid {
    grid-template-columns: 1fr;
  }
}
</style>
