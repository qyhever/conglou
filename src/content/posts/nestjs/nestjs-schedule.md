---
pubDatetime: 2026-03-18T15:22:00Z
title: NestJS 优雅实现定时任务
slug: nestjs-schedule
featured: true
tags:
  - Node.js
  - NestJS
description: "在 NestJS 中基于 @nestjs/schedule 实现优雅的定时任务。"
---

在后端系统中，定时任务是很常见的能力。比如每天同步数据、定期刷新缓存、轮询第三方接口、清理过期文件、生成报表等。这类逻辑如果写成临时脚本，短期看很快，长期看会逐渐失控：缺少依赖注入、缺少日志、缺少测试，也很难复用已有业务 Service。

NestJS 推荐使用 `@nestjs/schedule` 实现定时任务。它把定时任务纳入 NestJS 的模块体系中，可以正常使用依赖注入、配置管理、日志系统和测试工具。本文结合 V2EX 热贴爬虫定时任务，介绍一套可直接复用的实现方式。

## 一、适用场景

定时任务适合处理「不需要用户立即触发，但需要按固定时间自动执行」的业务逻辑。

常见场景包括：

- 每天 08:00 抓取热点榜单
- 每 5 分钟同步第三方状态
- 每小时刷新缓存数据
- 每天凌晨清理过期 Token 或临时文件
- 每月生成统计报表

在 NestJS 中，定时任务最好不要写在 Controller 里。Controller 的职责是处理 HTTP 请求，调度逻辑应该放到独立的 Provider 中，例如 `CrawlerSchedulerService`。这样可以让接口调用和定时执行共享同一个业务 Service，但保持职责边界清晰。

## 二、安装依赖

先安装 NestJS 官方定时任务模块：

```bash
pnpm add @nestjs/schedule
```

安装的版本是：

```json
{
  "dependencies": {
    "@nestjs/schedule": "^6.1.3"
  }
}
```

`@nestjs/schedule` 底层使用 `cron` 包，支持 Cron 表达式、固定间隔和延迟任务。本文重点讲最常用的 Cron 定时任务。

## 三、在根模块启用 ScheduleModule

安装依赖后，需要在应用根模块中注册 `ScheduleModule.forRoot()`。

示例：

```typescript
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { CrawlerModule } from './crawler/crawler.module'

@Module({
  imports: [ScheduleModule.forRoot(), CrawlerModule],
})
export class AppModule {}
```

注册位置是 `src/app.module.ts`：

```typescript
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    LoggerModule,
    ScheduleModule.forRoot(),
    UserModule,
    AuthModule,
    CrawlerModule,
  ],
})
export class AppModule implements NestModule {}
```

这一步非常关键。没有注册 `ScheduleModule.forRoot()`，`@Cron()` 装饰器不会被调度器扫描和执行。

## 四、创建独立的 Scheduler Service

定时任务建议放在业务模块内部的独立 Service 中，而不是塞进 Controller 或原有业务 Service。

目录结构如下：

```text
src/crawler/
├── crawler.controller.ts
├── crawler.module.ts
├── crawler.scheduler.service.ts
├── crawler.scheduler.service.spec.ts
└── crawler.service.ts
```

其中：

- `CrawlerController`：处理手动触发和查询结果的 HTTP 接口
- `CrawlerService`：负责真正的爬虫业务逻辑
- `CrawlerSchedulerService`：负责定时触发、重试和记录调度日志

这种拆分的好处是，手动接口和定时任务可以复用同一个业务方法：

```typescript
await this.crawlerService.crawlV2exHotTop10()
```

也就是说，定时任务不会改变原有手动接口的行为，只是增加了一个自动执行入口。

## 五、使用 @Cron 定义执行时间

`@Cron()` 用于声明一个 Cron 定时任务。

需求是：每天北京时间早上 08:00 自动抓取 V2EX 热贴 Top 10。实现如下：

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CrawlerService } from './crawler.service'

const V2EX_HOT_TOP10_CRON = '0 8 * * *'
const V2EX_HOT_TOP10_TIME_ZONE = 'Asia/Shanghai'

@Injectable()
export class CrawlerSchedulerService {
  private readonly logger = new Logger(CrawlerSchedulerService.name)

  constructor(private readonly crawlerService: CrawlerService) {}

  @Cron(V2EX_HOT_TOP10_CRON, { timeZone: V2EX_HOT_TOP10_TIME_ZONE })
  async crawlV2exHotTop10Daily(): Promise<void> {
    await this.crawlerService.crawlV2exHotTop10()
    this.logger.log('V2EX 热贴定时抓取成功')
  }
}
```

表达式 `0 8 * * *` 的含义是：

```text
分钟 小时 日期 月份 星期
 0   8   *   *   *
```

也就是每天 08:00 执行一次。

这里显式配置了时区：

```typescript
{
  timeZone: 'Asia/Shanghai'
}
```

如果不配置时区，执行时间会依赖服务器运行环境的本地时区。生产环境部署到容器或云服务器时，本地时区可能不是北京时间，所以与业务时间相关的任务应显式指定 `timeZone`。

## 六、加入失败重试

实际业务中的定时任务不能只考虑成功路径。网络抖动、第三方接口异常、数据库短暂不可用，都可能导致一次任务失败。

采用的策略是：

- 第 1 次立即执行
- 失败后最多额外重试 3 次
- 总计最多执行 4 次
- 每次失败记录 `warn`
- 最终成功记录 `log`
- 连续失败 4 次后记录 `error`，并带上最后一次异常栈

完整实现如下：

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CrawlerService } from './crawler.service'

const V2EX_HOT_TOP10_CRON = '0 8 * * *'
const V2EX_HOT_TOP10_TIME_ZONE = 'Asia/Shanghai'
const MAX_ATTEMPTS = 4

@Injectable()
export class CrawlerSchedulerService {
  private readonly logger = new Logger(CrawlerSchedulerService.name)

  constructor(private readonly crawlerService: CrawlerService) {}

  @Cron(V2EX_HOT_TOP10_CRON, { timeZone: V2EX_HOT_TOP10_TIME_ZONE })
  async crawlV2exHotTop10Daily(): Promise<void> {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.crawlerService.crawlV2exHotTop10()
        this.logger.log(`V2EX 热贴定时抓取成功，尝试次数：${attempt}`)
        return
      } catch (error) {
        lastError = error
        this.logger.warn(
          `V2EX 热贴定时抓取失败，尝试次数：${attempt}/${MAX_ATTEMPTS}`,
          this.getErrorStack(error),
        )
      }
    }

    this.logger.error(
      `V2EX 热贴定时抓取最终失败，总尝试次数：${MAX_ATTEMPTS}`,
      this.getErrorStack(lastError),
    )
  }

  private getErrorStack(error: unknown): string | undefined {
    if (error instanceof Error) return error.stack

    return undefined
  }
}
```

这里有几个细节值得注意。

第一，失败过程使用 `warn`，最终失败使用 `error`。这样日志等级能表达任务生命周期的状态：中途失败不一定代表任务失败，只有所有尝试都失败才是最终失败。

第二，最终成功日志要记录实际尝试次数。比如第 3 次成功，日志中应该明确写出「尝试次数：3」，方便后续排查远端服务是否不稳定。

第三，最终失败时记录最后一次异常栈。每一次失败都会记录 `warn`，但真正需要告警或排查时，最后一次失败通常最接近最终状态。

## 七、注册 Scheduler Provider

写完 `CrawlerSchedulerService` 后，还需要把它注册到模块的 `providers` 中。

示例：

```typescript
import { Module } from '@nestjs/common'
import { CrawlerController } from './crawler.controller'
import { CrawlerSchedulerService } from './crawler.scheduler.service'
import { CrawlerService } from './crawler.service'

@Module({
  controllers: [CrawlerController],
  providers: [CrawlerService, CrawlerSchedulerService],
})
export class CrawlerModule {}
```

如果忘记注册 Provider，NestJS 不会实例化这个类，定时任务自然也不会执行。

## 八、测试定时任务

定时任务也应该写单元测试。不要只依赖「等到 08:00 看它是否执行」这种人工验证方式。

测试了 4 类行为：

- 成功时只调用爬虫服务 1 次，并记录成功日志
- 前几次失败、后续成功时会重试，并记录最终成功日志
- 连续失败 4 次时停止重试，并记录最终失败日志
- 校验 Cron metadata：表达式为 `0 8 * * *`，时区为 `Asia/Shanghai`

核心测试示例：

```typescript
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants'
import { CrawlerSchedulerService } from './crawler.scheduler.service'
import { CrawlerService } from './crawler.service'

describe('CrawlerSchedulerService', () => {
  let service: CrawlerSchedulerService
  let crawlerService: {
    crawlV2exHotTop10: jest.MockedFunction<CrawlerService['crawlV2exHotTop10']>
  }
  let logger: {
    log: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }

  beforeEach(() => {
    crawlerService = {
      crawlV2exHotTop10: jest.fn(),
    }
    service = new CrawlerSchedulerService(crawlerService as CrawlerService)
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    Object.defineProperty(service, 'logger', {
      value: logger,
    })
  })

  it('成功时应该只调用爬虫服务 1 次，并记录成功日志', async () => {
    crawlerService.crawlV2exHotTop10.mockResolvedValue({ list: [] })

    await service.crawlV2exHotTop10Daily()

    expect(crawlerService.crawlV2exHotTop10).toHaveBeenCalledTimes(1)
    expect(logger.log).toHaveBeenCalledWith(
      'V2EX 热贴定时抓取成功，尝试次数：1',
    )
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('连续失败 4 次时应该停止重试，并记录最终失败日志', async () => {
    const lastError = new Error('last failed')
    crawlerService.crawlV2exHotTop10
      .mockRejectedValueOnce(new Error('first failed'))
      .mockRejectedValueOnce(new Error('second failed'))
      .mockRejectedValueOnce(new Error('third failed'))
      .mockRejectedValueOnce(lastError)

    await service.crawlV2exHotTop10Daily()

    expect(crawlerService.crawlV2exHotTop10).toHaveBeenCalledTimes(4)
    expect(logger.warn).toHaveBeenCalledTimes(4)
    expect(logger.log).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      'V2EX 热贴定时抓取最终失败，总尝试次数：4',
      lastError.stack,
    )
  })

  it('应该配置每天 Asia/Shanghai 早上 08:00 执行的 cron metadata', () => {
    const handler = Reflect.get(
      CrawlerSchedulerService.prototype,
      'crawlV2exHotTop10Daily',
    )

    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, handler)).toMatchObject({
      cronTime: '0 8 * * *',
      timeZone: 'Asia/Shanghai',
    })
  })
})
```

这类测试的重点不是测试 `@nestjs/schedule` 本身，而是测试自己的业务约定：

- 是否调用了正确的业务 Service
- 失败后是否按预期重试
- 达到最大次数后是否停止
- 是否记录了成功或失败结果日志
- Cron 表达式和时区是否被误改

## 九、常见 Cron 表达式

`@Cron()` 常用 5 位 Cron 表达式：

```text
* * * * *
分钟 小时 日期 月份 星期
```

常见写法：

| 表达式        | 含义                  |
| ------------- | --------------------- |
| `* * * * *`   | 每分钟执行一次        |
| `*/5 * * * *` | 每 5 分钟执行一次     |
| `0 * * * *`   | 每小时整点执行一次    |
| `0 8 * * *`   | 每天 08:00 执行一次   |
| `0 2 * * 1`   | 每周一 02:00 执行一次 |
| `30 23 * * *` | 每天 23:30 执行一次   |

如果任务与业务日期有关，建议始终设置时区：

```typescript
@Cron('0 8 * * *', { timeZone: 'Asia/Shanghai' })
```

## 十、生产环境注意事项

定时任务上线前，需要重点关注以下问题。

### 1. 多实例重复执行

如果服务部署了多个实例，每个实例都会注册并执行同一个定时任务。比如部署 3 个副本，`@Cron('0 8 * * *')` 就会在每天 08:00 执行 3 次。

解决方式通常有几种：

- 只在一个专门的 worker 实例中启用定时任务
- 使用分布式锁，例如 Redis Lock 或数据库锁
- 把任务交给外部调度系统，例如 Kubernetes CronJob、CI 定时任务或云厂商调度器

单实例项目可以直接使用 `@nestjs/schedule`。多实例项目需要先明确是否允许重复执行。

### 2. 任务执行时间过长

如果任务执行时间可能超过下一次调度时间，需要避免并发重入。`@nestjs/schedule` 支持 `waitForCompletion` 选项：

```typescript
@Cron('*/5 * * * *', {
  timeZone: 'Asia/Shanghai',
  waitForCompletion: true,
})
async syncData(): Promise<void> {
  await this.syncService.sync()
}
```

开启后，如果上一次任务还没执行完，新的调度会被跳过。对数据同步、文件处理、爬虫抓取这类任务，这个选项通常很有用。

### 3. 日志必须能定位任务生命周期

定时任务没有 HTTP 请求上下文，失败时不能依赖接口响应排查问题。因此日志至少要包含：

- 任务名称
- 执行结果
- 尝试次数
- 关键业务参数
- 异常 stack

最终成功和最终失败都会记录明确日志，这能保证一次定时任务生命周期一定有最终结果。

### 4. 不要吞掉所有异常却没有结果日志

定时任务可以捕获异常，避免进程因为任务失败而退出。但捕获异常后必须记录日志，否则线上会出现「任务没生效，但日志里也看不出原因」的问题。

推荐结构如下：

```typescript
try {
  await this.jobService.run()
  this.logger.log('任务执行成功')
} catch (error) {
  this.logger.error(
    '任务执行失败',
    error instanceof Error ? error.stack : undefined,
  )
}
```

## 十一、验证命令

开发完成后，可以运行相关测试：

```bash
pnpm test src/crawler
```

如果新增了依赖或修改了根模块，建议再运行构建：

```bash
pnpm build
```

这两条命令分别验证：

- `pnpm test src/crawler`：验证 crawler 模块的单元测试
- `pnpm build`：验证项目依赖、类型和编译是否正常

## 总结

在 NestJS 中使用定时任务，核心步骤并不复杂：

1. 安装 `@nestjs/schedule`
2. 在 `AppModule` 中注册 `ScheduleModule.forRoot()`
3. 新建独立的 Scheduler Service
4. 使用 `@Cron()` 声明执行时间和时区
5. 在业务模块中注册 Scheduler Provider
6. 为成功、重试、最终失败和 Cron metadata 编写测试

真正需要认真设计的是任务边界：调度逻辑只负责「什么时候执行」和「失败如何处理」，业务 Service 负责「具体做什么」。这样写出来的定时任务既容易测试，也方便后续迁移到 worker、队列或外部调度平台。
