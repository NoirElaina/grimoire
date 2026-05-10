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

const agentsItems = [
  { text: 'Agents 总览', link: '/notes/agents/' },
  { text: 'Agent 设计模板', link: '/notes/agents/agent-design-template' },
  { text: 'System Prompt 模板', link: '/notes/agents/system-prompt-template' },
  { text: '工具调用模板', link: '/notes/agents/tooling-template' }
]

const javaBackendItems = [
  { text: 'Java 后端总览', link: '/notes/java-backend/' },
  { text: 'Spring Boot 项目模板', link: '/notes/java-backend/spring-boot-template' },
  { text: '接口设计模板', link: '/notes/java-backend/api-design-template' },
  { text: '问题排查模板', link: '/notes/java-backend/troubleshooting-template' }
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
          text: '总览',
          items: overviewItems
        },
        {
          text: 'Agents',
          items: agentsItems
        }
      ],
      '/notes/java-backend/': [
        {
          text: '总览',
          items: overviewItems
        },
        {
          text: 'Java 后端',
          items: javaBackendItems
        }
      ],
      '/notes/': [
        {
          text: '总览',
          items: overviewItems
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
