<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loadScript } from '../utils/loadScript'

const gistRef = ref<HTMLElement | null>(null)
const gistStatus = ref('加载公开 Gist 中...')

onMounted(async () => {
  if (!gistRef.value) return
  try {
    await loadScript('https://gist.github.com/octocat/9257657.js')
    gistStatus.value = '如果下方为空，说明该 Gist 被 GitHub 限制或链接失效。'
  } catch {
    gistStatus.value = 'Gist 加载失败。把链接换成你自己的公开 Gist 就可以。'
  }
})
</script>

<template>
  <div class="demo-grid">
    <article class="demo-card">
      <h3>B 站嵌入</h3>
      <iframe
        class="embed-frame"
        src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1"
        loading="lazy"
        allowfullscreen
      ></iframe>
    </article>

    <article class="demo-card">
      <h3>YouTube 嵌入</h3>
      <iframe
        class="embed-frame"
        src="https://www.youtube.com/embed/dQw4w9WgXcQ"
        loading="lazy"
        allowfullscreen
      ></iframe>
    </article>

    <article class="demo-card">
      <h3>GitHub Gist</h3>
      <p class="embed-note">{{ gistStatus }}</p>
      <div ref="gistRef" class="gist-slot"></div>
    </article>

    <article class="demo-card">
      <h3>PDF 嵌入</h3>
      <iframe
        class="embed-frame"
        src="https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
        loading="lazy"
      ></iframe>
    </article>

    <article class="demo-card wide-card">
      <h3>外部页面</h3>
      <p class="embed-note">有些站点会禁止 iframe，这是浏览器安全策略导致的。</p>
      <iframe
        class="embed-frame large-frame"
        src="https://noirelaina.github.io/ashenwitch/"
        loading="lazy"
      ></iframe>
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

.embed-note {
  color: #5a7493;
}

.embed-frame {
  width: 100%;
  height: 240px;
  border: 1px solid rgba(118, 178, 245, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.7);
}

.large-frame {
  height: 360px;
}

.gist-slot {
  min-height: 160px;
  padding: 0.5rem;
  border-radius: 18px;
  background: rgba(243, 249, 255, 0.9);
  overflow: auto;
}

@media (max-width: 960px) {
  .demo-grid {
    grid-template-columns: 1fr;
  }
}
</style>
