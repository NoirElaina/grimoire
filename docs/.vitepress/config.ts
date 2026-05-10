import { defineConfig } from 'vitepress'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const isUserSite = repoName?.toLowerCase() === 'noirelaina.github.io'
const base =
  process.env.GITHUB_ACTIONS && repoName && !isUserSite ? `/${repoName}/` : '/'

const overviewItems = [
  { text: '笔记首页', link: '/notes/' },
  { text: '能力示例', link: '/capabilities-examples' },
  { text: '写作与发布', link: '/markdown-examples' },
  { text: '技术摘记', link: '/api-examples' }
]

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Grimoire",
  description: "灰之魔女的魔导书",
  base,
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
      { text: '能力示例', link: '/capabilities-examples' },
      { text: '博客', link: 'https://noirelaina.github.io/ashenwitch/' },
      { text: 'GitHub', link: 'https://github.com/NoirElaina' },
      { text: '关于', link: '/about' }
    ],

    sidebar: {
      '/notes/agents/': [
        {
          text: '笔记',
          collapsed: true,
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'Agents',
          items: [
            { text: '专题首页', link: '/notes/agents/' },
            { text: 'Agent 设计', link: '/notes/agents/agent-design-template' },
            { text: 'System Prompt', link: '/notes/agents/system-prompt-template' },
            { text: '工具调用', link: '/notes/agents/tooling-template' }
          ]
        },
        {
          text: 'Claude 源码解析',
          items: [
            { text: '专题说明', link: '/notes/agents/claude-code-analysis/' },
            { text: '01 Claude Code 泄露事件与架构启示', link: '/notes/agents/claude-code-analysis/first-look' }
          ]
        }
      ],
      '/notes/java-backend/': [
        {
          text: '笔记',
          collapsed: true,
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'Java 后端',
          items: [
            { text: '专题首页', link: '/notes/java-backend/' },
            { text: 'Spring Boot 项目模板', link: '/notes/java-backend/spring-boot-template' },
            { text: '接口设计模板', link: '/notes/java-backend/api-design-template' },
            { text: '问题排查模板', link: '/notes/java-backend/troubleshooting-template' }
          ]
        }
      ],
      '/notes/': [
        {
          text: '笔记',
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: '专题入口',
          items: [
            { text: 'Agents', link: '/notes/agents/' },
            { text: 'Java 后端', link: '/notes/java-backend/' }
          ]
        }
      ],
      '/capabilities-examples': [
        {
          text: '总览',
          items: overviewItems
        }
      ],
      '/markdown-examples': [
        {
          text: '总览',
          items: overviewItems
        }
      ],
      '/api-examples': [
        {
          text: '总览',
          items: overviewItems
        }
      ]
    }
  }
})
