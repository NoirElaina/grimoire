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
          text: 'Spring 地基',
          collapsed: true,
          items: [
            createDocItem(
              'notes/java-backend/spring-ioc-di.md',
              '/notes/java-backend/spring-ioc-di',
              'Spring IoC / DI'
            ),
            createDocItem(
              'notes/java-backend/spring-mvc-request-flow.md',
              '/notes/java-backend/spring-mvc-request-flow',
              'Spring MVC 请求链路'
            ),
            createDocItem(
              'notes/java-backend/config-profiles.md',
              '/notes/java-backend/config-profiles',
              '配置与 Profile'
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
              'notes/java-backend/layering-dto.md',
              '/notes/java-backend/layering-dto',
              '分层与 DTO'
            ),
            createDocItem(
              'notes/java-backend/api-design-template.md',
              '/notes/java-backend/api-design-template',
              '接口设计模板'
            ),
            createDocItem(
              'notes/java-backend/bean-validation.md',
              '/notes/java-backend/bean-validation',
              'Bean Validation'
            ),
            createDocItem(
              'notes/java-backend/exception-error-code.md',
              '/notes/java-backend/exception-error-code',
              '统一异常与错误码'
            ),
            createDocItem(
              'notes/java-backend/logging-trace-audit.md',
              '/notes/java-backend/logging-trace-audit',
              '日志 traceId 与审计'
            ),
            createDocItem(
              'notes/java-backend/maven-dependency-management.md',
              '/notes/java-backend/maven-dependency-management',
              'Maven 依赖管理'
            ),
            createDocItem(
              'notes/java-backend/filter-interceptor.md',
              '/notes/java-backend/filter-interceptor',
              '过滤器与拦截器'
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
              'notes/java-backend/mybatis-core.md',
              '/notes/java-backend/mybatis-core',
              'MyBatis 核心地基'
            ),
            createDocItem(
              'notes/java-backend/mybatis-xml-dynamic-sql.md',
              '/notes/java-backend/mybatis-xml-dynamic-sql',
              'MyBatis 动态 SQL'
            ),
            createDocItem(
              'notes/java-backend/mybatis-plus.md',
              '/notes/java-backend/mybatis-plus',
              'MyBatis-Plus'
            ),
            createDocItem(
              'notes/java-backend/flyway.md',
              '/notes/java-backend/flyway',
              'Flyway 数据库迁移'
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
            ),
            createDocItem(
              'notes/java-backend/transaction-propagation.md',
              '/notes/java-backend/transaction-propagation',
              '事务传播行为'
            ),
            createDocItem(
              'notes/java-backend/transaction-failure-scenarios.md',
              '/notes/java-backend/transaction-failure-scenarios',
              '事务失效场景'
            ),
            createDocItem(
              'notes/java-backend/transaction-outbox-side-effects.md',
              '/notes/java-backend/transaction-outbox-side-effects',
              '事务与外部副作用'
            )
          ]
        },
        {
          text: '项目案例',
          collapsed: true,
          items: [
            createDocItem(
              'notes/java-backend/product-detail-cache-case.md',
              '/notes/java-backend/product-detail-cache-case',
              '商品详情缓存案例'
            ),
            createDocItem(
              'notes/java-backend/user-login-auth-case.md',
              '/notes/java-backend/user-login-auth-case',
              '登录鉴权案例'
            ),
            createDocItem(
              'notes/java-backend/order-timeout-close.md',
              '/notes/java-backend/order-timeout-close',
              '订单支付超时关闭'
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
              '00 工程实践总览'
            ),
            createDocItem(
              'notes/mysql/mysql-basics.md',
              '/notes/mysql/mysql-basics',
              '01 基础模型'
            ),
            createDocItem(
              'notes/mysql/table-design.md',
              '/notes/mysql/table-design',
              '02 表设计'
            ),
            createDocItem(
              'notes/mysql/indexes-explain.md',
              '/notes/mysql/indexes-explain',
              '03 索引与 EXPLAIN'
            ),
            createDocItem(
              'notes/mysql/transactions-locks.md',
              '/notes/mysql/transactions-locks',
              '04 事务与锁'
            ),
            createDocItem(
              'notes/mysql/slow-query-troubleshooting.md',
              '/notes/mysql/slow-query-troubleshooting',
              '05 慢 SQL 排查'
            ),
            createDocItem(
              'notes/mysql/mysql-java-backend.md',
              '/notes/mysql/mysql-java-backend',
              '06 Java 后端接入'
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
              '00 缓存设计总览'
            ),
            createDocItem(
              'notes/redis/redis-basics.md',
              '/notes/redis/redis-basics',
              '01 基础模型'
            ),
            createDocItem(
              'notes/redis/data-structures.md',
              '/notes/redis/data-structures',
              '02 数据结构'
            ),
            createDocItem(
              'notes/redis/cache-problems.md',
              '/notes/redis/cache-problems',
              '03 缓存异常治理'
            ),
            createDocItem(
              'notes/redis/cache-consistency.md',
              '/notes/redis/cache-consistency',
              '04 缓存一致性'
            ),
            createDocItem(
              'notes/redis/distributed-lock.md',
              '/notes/redis/distributed-lock',
              '05 分布式锁'
            ),
            createDocItem(
              'notes/redis/redisson.md',
              '/notes/redis/redisson',
              '06 Redisson'
            ),
            createDocItem(
              'notes/redis/redis-template-json.md',
              '/notes/redis/redis-template-json',
              '07 RedisTemplate 配置'
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
            ),
            createDocItem(
              'notes/rabbitmq/install-spring.md',
              '/notes/rabbitmq/install-spring',
              '02 安装与 Spring 集成'
            ),
            createDocItem(
              'notes/rabbitmq/transaction-after-commit.md',
              '/notes/rabbitmq/transaction-after-commit',
              '03 事务同步与 MQ'
            ),
            createDocItem(
              'notes/rabbitmq/delay-queue.md',
              '/notes/rabbitmq/delay-queue',
              '04 延迟队列'
            ),
            createDocItem(
              'notes/rabbitmq/dead-letter-queue.md',
              '/notes/rabbitmq/dead-letter-queue',
              '05 死信队列'
            ),
            createDocItem(
              'notes/rabbitmq/message-idempotency.md',
              '/notes/rabbitmq/message-idempotency',
              '06 MQ 幂等'
            ),
            createDocItem(
              'notes/rabbitmq/delayed-message-plugin.md',
              '/notes/rabbitmq/delayed-message-plugin',
              '07 延迟消息插件'
            ),
            createDocItem(
              'notes/rabbitmq/reliability-overview.md',
              '/notes/rabbitmq/reliability-overview',
              '08 MQ 可靠性'
            ),
            createDocItem(
              'notes/rabbitmq/producer-reliability.md',
              '/notes/rabbitmq/producer-reliability',
              '09 生产者可靠性'
            ),
            createDocItem(
              'notes/rabbitmq/consumer-reliability.md',
              '/notes/rabbitmq/consumer-reliability',
              '10 消费者可靠性'
            )
          ]
        }
      ],
      '/notes/git/': [
        {
          text: '笔记',
          items: [
            { text: '笔记首页', link: '/notes/' }
          ]
        },
        {
          text: 'Git',
          items: [
            createDocItem('notes/git/index.md', '/notes/git/', '专题首页'),
            createDocItem(
              'notes/git/getting-started.md',
              '/notes/git/getting-started',
              '01 Git 入门'
            ),
            createDocItem(
              'notes/git/basic-commands.md',
              '/notes/git/basic-commands',
              '02 基础命令'
            ),
            createDocItem(
              'notes/git/feature-merge-workflow.md',
              '/notes/git/feature-merge-workflow',
              '03 功能分支合并'
            ),
            createDocItem(
              'notes/git/merge-strategies.md',
              '/notes/git/merge-strategies',
              '04 合并策略'
            ),
            createDocItem(
              'notes/git/branch-merged-check.md',
              '/notes/git/branch-merged-check',
              '05 分支合并判断'
            ),
            createDocItem(
              'notes/git/merge-verification.md',
              '/notes/git/merge-verification',
              '06 合并验证'
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
            { text: 'RabbitMQ', link: '/notes/rabbitmq/' },
            { text: 'Git', link: '/notes/git/' }
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
