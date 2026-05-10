import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Grimoire",
  description: "灰之魔女的魔导书",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索',
            buttonAriaLabel: '搜索'
          },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },

    nav: [
      { text: '首页', link: '/' },
      { text: '进入笔记', link: '/notes/' },
      { text: '博客', link: 'https://noirelaina.github.io/ashenwitch/' },
      { text: 'GitHub', link: 'https://github.com/NoirElaina' },
      { text: '关于', link: '/about' }
    ],

    sidebar: [
      {
        text: '总览',
        items: [
          { text: '笔记首页', link: '/notes/' },
          { text: '写作与发布', link: '/markdown-examples' },
          { text: '技术摘记', link: '/api-examples' }
        ]
      },
      {
        text: 'Agents',
        items: [
          { text: 'Agents 总览', link: '/notes/agents/' },
          { text: 'Agent 设计模板', link: '/notes/agents/agent-design-template' },
          { text: 'System Prompt 模板', link: '/notes/agents/system-prompt-template' },
          { text: '工具调用模板', link: '/notes/agents/tooling-template' }
        ]
      },
      {
        text: 'Java 后端',
        items: [
          { text: 'Java 后端总览', link: '/notes/java-backend/' },
          { text: 'Spring Boot 项目模板', link: '/notes/java-backend/spring-boot-template' },
          { text: '接口设计模板', link: '/notes/java-backend/api-design-template' },
          { text: '问题排查模板', link: '/notes/java-backend/troubleshooting-template' }
        ]
      }
    ]
  }
})
