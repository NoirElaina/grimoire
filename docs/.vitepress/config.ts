import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type DefaultTheme } from 'vitepress'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const isUserSite = repoName?.toLowerCase() === 'noirelaina.github.io'
const base =
  process.env.GITHUB_ACTIONS && repoName && !isUserSite ? `/${repoName}/` : '/'
const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const overviewItems = [
  { text: '笔记首页', link: '/notes/' },
  { text: '能力示例', link: '/capabilities-examples' },
  { text: '写作与发布', link: '/markdown-examples' },
  { text: '技术摘记', link: '/api-examples' }
]

function normalizeFrontmatterValue(value?: string) {
  return value?.trim().replace(/^['"](.*)['"]$/, '$1')
}

function resolveSidebarText(docPath: string, fallbackText: string) {
  try {
    const source = readFileSync(resolve(docsRoot, docPath), 'utf8')
    const frontmatterBlock = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
    const sidebarTitle = normalizeFrontmatterValue(
      frontmatterBlock?.match(/^sidebarTitle:\s*(.+)$/m)?.[1]
    )
    const title = normalizeFrontmatterValue(
      frontmatterBlock?.match(/^title:\s*(.+)$/m)?.[1]
    )
    const h1 = source.match(/^#\s+(.+)$/m)?.[1]?.trim()

    return sidebarTitle || title || h1 || fallbackText
  } catch {
    return fallbackText
  }
}

function createDocItem(
  docPath: string,
  link: string,
  fallbackText: string
): DefaultTheme.SidebarItem {
  return {
    text: resolveSidebarText(docPath, fallbackText),
    link
  }
}

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
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'Agents',
          items: [
            createDocItem('notes/agents/index.md', '/notes/agents/', '专题首页'),
            createDocItem(
              'notes/agents/tooling-template.md',
              '/notes/agents/tooling-template',
              '工具调用'
            ),
            createDocItem(
              'notes/agents/sse-streaming.md',
              '/notes/agents/sse-streaming',
              'SSE 流式响应'
            ),
            createDocItem(
              'notes/agents/mcp-protocol.md',
              '/notes/agents/mcp-protocol',
              'MCP 协议'
            )
          ]
        },
        {
          text: 'Claude 源码解析',
          items: [
            createDocItem(
              'notes/agents/claude-code-analysis/index.md',
              '/notes/agents/claude-code-analysis/',
              '专题说明'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/first-look.md',
              '/notes/agents/claude-code-analysis/first-look',
              '01 Claude Code 泄露事件与架构启示'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/query-engine-main-loop.md',
              '/notes/agents/claude-code-analysis/query-engine-main-loop',
              '02 QueryEngine 主循环'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/context-system.md',
              '/notes/agents/claude-code-analysis/context-system',
              '03 上下文系统'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/permission-system.md',
              '/notes/agents/claude-code-analysis/permission-system',
              '04 权限系统'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/coordinator-and-workers.md',
              '/notes/agents/claude-code-analysis/coordinator-and-workers',
              '05 多 worker 编排'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/platformization.md',
              '/notes/agents/claude-code-analysis/platformization',
              '06 平台化'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/agent-runtime-os.md',
              '/notes/agents/claude-code-analysis/agent-runtime-os',
              '07 Agent Runtime 总结'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/compaction-mechanics.md',
              '/notes/agents/claude-code-analysis/compaction-mechanics',
              '08 上下文压缩机制'
            ),
            createDocItem(
              'notes/agents/claude-code-analysis/tool-system.md',
              '/notes/agents/claude-code-analysis/tool-system',
              '09 工具系统'
            )
          ]
        }
      ],
      '/notes/java-backend/': [
        {
          text: '笔记',
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'Java 后端',
          items: [
            createDocItem('notes/java-backend/index.md', '/notes/java-backend/', '专题首页')
          ]
        },
        {
          text: 'Java 基础',
          collapsed: true,
          items: [
            createDocItem(
              'notes/java-backend/java-stream.md',
              '/notes/java-backend/java-stream',
              'Java Stream'
            )
          ]
        },
        {
          text: '基础工程',
          collapsed: true,
          items: [
            createDocItem(
              'notes/java-backend/spring-boot-template.md',
              '/notes/java-backend/spring-boot-template',
              'Spring Boot 项目模板'
            ),
            createDocItem(
              'notes/java-backend/api-design-template.md',
              '/notes/java-backend/api-design-template',
              '接口设计模板'
            ),
            createDocItem(
              'notes/java-backend/troubleshooting-template.md',
              '/notes/java-backend/troubleshooting-template',
              '问题排查模板'
            ),
            createDocItem(
              'notes/java-backend/jwt-auth.md',
              '/notes/java-backend/jwt-auth',
              'JWT 鉴权'
            )
          ]
        },
        {
          text: '数据访问',
          collapsed: true,
          items: [
            createDocItem(
              'notes/java-backend/mybatis-plus.md',
              '/notes/java-backend/mybatis-plus',
              'MyBatis-Plus'
            )
          ]
        },
        {
          text: '事务与一致性',
          collapsed: true,
          items: [
            createDocItem(
              'notes/java-backend/transactional-rollback.md',
              '/notes/java-backend/transactional-rollback',
              'Spring 事务回滚'
            )
          ]
        },
        {
          text: '微服务组件',
          collapsed: true,
          items: [
            createDocItem(
              'notes/java-backend/openfeign.md',
              '/notes/java-backend/openfeign',
              'OpenFeign'
            ),
            createDocItem(
              'notes/java-backend/nacos.md',
              '/notes/java-backend/nacos',
              'Nacos'
            ),
            createDocItem(
              'notes/java-backend/sentinel.md',
              '/notes/java-backend/sentinel',
              'Sentinel'
            )
          ]
        }
      ],
      '/notes/mysql/': [
        {
          text: '笔记',
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'MySQL',
          items: [
            createDocItem('notes/mysql/index.md', '/notes/mysql/', '专题首页'),
            createDocItem(
              'notes/mysql/mysql-engineering.md',
              '/notes/mysql/mysql-engineering',
              '01 工程实践'
            )
          ]
        }
      ],
      '/notes/redis/': [
        {
          text: '笔记',
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'Redis',
          items: [
            createDocItem('notes/redis/index.md', '/notes/redis/', '专题首页'),
            createDocItem(
              'notes/redis/cache-design.md',
              '/notes/redis/cache-design',
              '01 缓存设计'
            )
          ]
        }
      ],
      '/notes/rabbitmq/': [
        {
          text: '笔记',
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'RabbitMQ',
          items: [
            createDocItem('notes/rabbitmq/index.md', '/notes/rabbitmq/', '专题首页'),
            createDocItem(
              'notes/rabbitmq/message-model.md',
              '/notes/rabbitmq/message-model',
              '01 消息模型'
            )
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
            { text: 'Java 后端', link: '/notes/java-backend/' },
            { text: 'MySQL', link: '/notes/mysql/' },
            { text: 'Redis', link: '/notes/redis/' },
            { text: 'RabbitMQ', link: '/notes/rabbitmq/' }
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
