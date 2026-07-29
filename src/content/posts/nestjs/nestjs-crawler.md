---
pubDatetime: 2026-03-16T15:22:00Z
title: NestJS 如何优雅地实现爬虫功能
slug: nestjs-crawler
featured: true
tags:
  - Node.js
  - NestJS
  - 爬虫
description: "使用 NestJS + 原生 fetch + cheerio 实现爬虫功能。"
---

在后端项目中，爬虫不应只是一个临时脚本。只要它需要被接口调用、被权限控制、被测试覆盖，或者需要保存抓取结果，就应该按照正常业务模块来设计。

本文介绍一种通用的 NestJS 爬虫实现方式：使用 Node.js 原生 `fetch` 请求页面，使用 `cheerio` 解析 HTML，通过 Service 封装抓取逻辑，再由 Controller 暴露 API。这个方案适合低频、目标明确、页面结构相对稳定的小型爬虫场景，例如抓取公开页面的榜单、公告、文章列表或商品摘要。

## 一、设计思路

一个可维护的 NestJS 爬虫模块，建议拆成三层：

- `Controller`：负责暴露 HTTP 接口、声明 Swagger 文档、控制访问权限
- `Service`：负责请求页面、解析 HTML、处理异常、保存或读取结果
- `DTO`：负责定义接口返回结构，避免直接暴露临时解析对象

推荐目录结构：

```text
src/crawler/
├── crawler.controller.ts
├── crawler.module.ts
├── crawler.service.ts
└── dto/
    └── crawl-result.dto.ts
```

这种结构的核心原则是：控制器只做编排，真正的不稳定逻辑都封装在 Service 里。外部页面可能超时、返回异常、HTML 结构变化，但这些细节不应该污染接口层。

## 二、安装依赖

Node.js 18 之后已经内置 `fetch`，一般不需要额外安装 HTTP 客户端。如果只是解析静态 HTML，可以使用 `cheerio`：

```bash
pnpm add cheerio
```

`cheerio` 的 API 接近 jQuery，适合在服务端用 CSS Selector 提取页面元素：

```typescript
import * as cheerio from 'cheerio'

const $ = cheerio.load(html)
const title = $('h1').text().trim()
```

如果目标页面依赖浏览器执行 JavaScript 才能渲染内容，则 `cheerio` 不够用，需要考虑 Playwright、Puppeteer 等浏览器自动化方案。但对普通服务端渲染页面或静态 HTML，`fetch + cheerio` 更轻量。

## 三、定义返回 DTO

爬虫结果应当被整理成稳定的数据结构。不要把原始 HTML、CSS Selector 的中间结果或第三方页面字段直接透传给前端。

示例 DTO：

```typescript
import { ApiProperty } from '@nestjs/swagger'

export class CrawledItemDto {
  @ApiProperty({ description: '排序位置', example: 1 })
  rank: number

  @ApiProperty({ description: '标题', example: '示例文章标题' })
  title: string

  @ApiProperty({
    description: '详情页地址',
    example: 'https://example.com/posts/1',
  })
  url: string

  @ApiProperty({
    description: '来源页面地址',
    example: 'https://example.com',
  })
  sourceUrl: string

  @ApiProperty({
    description: '抓取完成时间',
    example: '2026-07-25T10:00:00.000Z',
  })
  crawledAt: string
}

export class CrawlResultDto {
  @ApiProperty({ description: '抓取结果列表', type: [CrawledItemDto] })
  list: CrawledItemDto[]
}
```

常见字段建议：

- `rank`：记录页面中的排序
- `title`：记录展示标题
- `url`：统一保存绝对地址
- `sourceUrl`：记录来源页面
- `crawledAt`：记录服务端抓取完成时间

如果需要去重，可以额外增加 `id`、`hash` 或 `externalId` 字段。

## 四、封装 Service

Service 是爬虫模块的核心。它应该完成请求、解析、异常转换和结果保存。

示例：

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import * as cheerio from 'cheerio'
import type { CrawledItemDto, CrawlResultDto } from './dto/crawl-result.dto'

const SOURCE_URL = 'https://example.com'
const REQUEST_TIMEOUT_MS = 10_000
const ITEM_SELECTOR = '.article-list a'
const RESULT_FILE = join(process.cwd(), 'public', 'crawler', 'latest.json')

@Injectable()
export class CrawlerService {
  async crawl(): Promise<CrawlResultDto> {
    const html = await this.fetchHtml()
    const crawledAt = new Date().toISOString()
    const list = this.parseItems(html, crawledAt)

    if (list.length === 0) {
      throw new ServiceUnavailableException('页面解析失败')
    }

    const result = { list }
    await this.writeResult(result)

    return result
  }

  async getLatestResult(): Promise<CrawlResultDto> {
    try {
      const content = await readFile(RESULT_FILE, 'utf8')
      return JSON.parse(content) as CrawlResultDto
    } catch (error) {
      if (this.isFileNotFoundError(error)) {
        throw new NotFoundException('抓取结果不存在')
      }

      throw error
    }
  }

  private async fetchHtml(): Promise<string> {
    const abortController = new AbortController()
    const timeout = setTimeout(
      () => abortController.abort(),
      REQUEST_TIMEOUT_MS,
    )

    try {
      const response = await fetch(SOURCE_URL, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new ServiceUnavailableException('页面请求失败')
      }

      return await response.text()
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error
      throw new ServiceUnavailableException('页面请求失败')
    } finally {
      clearTimeout(timeout)
    }
  }

  private parseItems(html: string, crawledAt: string): CrawledItemDto[] {
    const $ = cheerio.load(html)

    return $(ITEM_SELECTOR)
      .slice(0, 10)
      .map((index, element) => {
        const anchor = $(element)
        const href = anchor.attr('href')?.trim()
        const title = anchor.text().trim()

        if (!href || !title) return null

        return {
          rank: index + 1,
          title,
          url: new URL(href, SOURCE_URL).toString(),
          sourceUrl: SOURCE_URL,
          crawledAt,
        }
      })
      .get()
      .filter((item): item is CrawledItemDto => item !== null)
  }

  private async writeResult(result: CrawlResultDto): Promise<void> {
    await mkdir(dirname(RESULT_FILE), { recursive: true })
    await writeFile(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }

  private isFileNotFoundError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
  }
}
```

这段 Service 代码包含几个通用实践。

## 五、设置请求超时

爬虫接口不能无限等待远端页面响应。推荐使用 `AbortController` 控制超时：

```typescript
const abortController = new AbortController()
const timeout = setTimeout(() => abortController.abort(), 10_000)

try {
  const response = await fetch(url, {
    signal: abortController.signal,
  })

  return await response.text()
} finally {
  clearTimeout(timeout)
}
```

这样可以避免目标站点卡住时拖垮当前 API 请求。超时时间没有统一答案，低频抓取一般可以从 5 到 15 秒开始。

## 六、统一异常表达

外部站点的不稳定性不能直接暴露给调用方。推荐在 Service 中把底层异常转换成明确的 NestJS HTTP 异常：

- 网络失败：`ServiceUnavailableException`
- 远端返回非 2xx：`ServiceUnavailableException`
- 页面结构变化导致解析为空：`ServiceUnavailableException`
- 本地结果不存在：`NotFoundException`

示例：

```typescript
if (!response.ok) {
  throw new ServiceUnavailableException('页面请求失败')
}

if (list.length === 0) {
  throw new ServiceUnavailableException('页面解析失败')
}
```

这样接口调用方不需要理解 `fetch`、`AbortError`、`ENOENT` 等底层细节，只需要处理稳定的 HTTP 语义。

## 七、保存抓取结果

低频爬虫可以先把结果保存成 JSON 文件：

```typescript
await mkdir(dirname(RESULT_FILE), { recursive: true })
await writeFile(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
```

如果使用本地文件保存结果，建议将运行产物加入 `.gitignore`：

```gitignore
/public/crawler/*.json
```

JSON 文件适合快速验证和轻量场景。如果后续需要历史记录、去重、分页、统计或多实例部署，应改用数据库保存。

## 八、暴露 Controller

控制器只负责把 Service 能力暴露成接口：

```typescript
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CrawlerService } from './crawler.service'
import { CrawlResultDto } from './dto/crawl-result.dto'

@ApiTags('爬虫')
@ApiBearerAuth()
@Controller('crawler')
export class CrawlerController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Post('crawl')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '抓取并保存最新数据' })
  crawl(): Promise<CrawlResultDto> {
    return this.crawlerService.crawl()
  }

  @Get('latest')
  @ApiOperation({ summary: '读取最近一次抓取结果' })
  getLatestResult(): Promise<CrawlResultDto> {
    return this.crawlerService.getLatestResult()
  }
}
```

抓取接口推荐使用 `POST`，因为它会访问外部站点并更新本地数据，不是纯查询操作。

爬虫接口也不建议默认公开。即使只是抓取公开页面，接口本身仍然会消耗服务器资源，还可能对目标站点造成请求压力。生产环境建议配合登录态、管理员权限或限流使用。

## 九、注册模块

定义模块：

```typescript
import { Module } from '@nestjs/common'
import { CrawlerController } from './crawler.controller'
import { CrawlerService } from './crawler.service'

@Module({
  controllers: [CrawlerController],
  providers: [CrawlerService],
})
export class CrawlerModule {}
```

在根模块中引入：

```typescript
import { Module } from '@nestjs/common'
import { CrawlerModule } from './crawler/crawler.module'

@Module({
  imports: [CrawlerModule],
})
export class AppModule {}
```

完成后即可通过接口触发抓取。

## 十、接口调试

可以使用 HTTP 文件或 curl 调试。

HTTP 文件示例：

```http
@host = localhost:3000
@token = your_access_token

### crawl
post http://{{host}}/api/crawler/crawl
Authorization: Bearer {{token}}

### latest result
get http://{{host}}/api/crawler/latest
Authorization: Bearer {{token}}
```

curl 示例：

```bash
curl -X POST http://localhost:3000/api/crawler/crawl \
  -H 'Authorization: Bearer your_access_token'

curl http://localhost:3000/api/crawler/latest \
  -H 'Authorization: Bearer your_access_token'
```

## 十一、单元测试建议

爬虫功能一定要测试失败路径，因为外部页面和网络状态都不可控。

Service 建议覆盖：

- 请求成功并正确解析列表
- 相对 URL 能转换为绝对 URL
- 远端返回非 2xx 时抛出异常
- `fetch` reject 时抛出异常
- 请求超时时抛出异常
- 页面结构变化导致解析为空时抛出异常
- 本地结果不存在时抛出 `NotFoundException`
- 读取本地结果时不会访问远端页面

测试时可以 mock `fetch`：

```typescript
const fetchMock = jest.spyOn(globalThis, 'fetch')

fetchMock.mockResolvedValue({
  ok: true,
  text: () => Promise.resolve('<html>...</html>'),
} as Response)
```

也可以 mock 文件系统，避免单元测试产生真实文件：

```typescript
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
}))
```

Controller 建议覆盖：

- 控制器方法是否调用对应 Service
- 路由路径是否正确
- HTTP Method 是否正确
- 抓取接口是否返回 `200 OK`
- 是否误加了公开访问装饰器

运行测试：

```bash
pnpm test
```

## 十二、生产环境注意事项

爬虫功能上线前，应重点检查以下问题。

### 1. 控制抓取频率

不要让爬虫接口被无限制调用。可以增加：

- 登录鉴权
- 管理员权限
- IP 限流
- 用户限流
- 定时任务
- 最近抓取时间缓存

### 2. 尊重目标站点规则

抓取前应确认目标站点是否允许抓取相关页面。不要高频请求，不要绕过登录、验证码、付费墙或访问控制，也不要抓取隐私数据。

### 3. 增加可观测性

生产环境建议记录：

- 目标 URL
- HTTP 状态码
- 请求耗时
- 解析数量
- 保存结果路径或数据 ID
- 失败原因

解析为空时最好触发告警，因为这通常意味着目标页面结构已经变化。

### 4. 根据规模选择存储方式

本地 JSON 适合低频和单实例应用。以下场景建议切换到数据库：

- 需要保存历史记录
- 需要分页查询
- 需要去重
- 需要统计趋势
- 服务会部署多个实例
- 抓取结果会被其他业务模块引用

### 5. 区分静态页面和动态页面

如果页面源代码中已经包含目标内容，使用 `fetch + cheerio` 即可。如果页面需要浏览器执行 JavaScript 才能看到内容，则需要使用 Playwright 或 Puppeteer。

判断方式很简单：在浏览器中查看页面源代码，如果能搜到目标文本，通常可以用 `cheerio`；如果搜不到，可能需要浏览器自动化。

## 十三、总结

在 NestJS 中实现爬虫，关键不是把页面抓下来，而是把不稳定的外部依赖封装成稳定的业务能力。

推荐链路如下：

```text
Controller 接收请求
  -> Service 请求页面
  -> cheerio 解析 HTML
  -> DTO 规范化结果
  -> 文件或数据库保存
  -> API 返回统一响应
```

对于低频、公开、结构稳定的页面，`fetch + cheerio + NestJS Service` 是一个简单可靠的方案。等业务规模扩大后，再逐步引入定时任务、队列、数据库、限流和监控即可。
