---
pubDatetime: 2026-03-12T15:22:00Z
title: NestJS 接入 Logger，并结合 Exception Filter 统一异常日志
slug: nestjs-logger-exception-filter
tags:
  - Node.js
  - NestJS
description: "本文基于当前 NestJS 项目实践，使用 `nest-winston` 接入 Winston 日志系统，再通过全局 `Exception Filter` 统一异常响应和异常日志。"
---


后端项目上线后，`console.log()` 很快会暴露三个问题：日志格式不稳定、线上文件留存困难、异常上下文不足。尤其是接口报错时，如果日志里只有一条错误消息，却没有请求路径、请求参数、用户 ID 和 `requestId`，排查问题会非常低效。

本文基于当前 NestJS 项目实践，使用 `nest-winston` 接入 Winston 日志系统，再通过全局 `Exception Filter` 统一异常响应和异常日志。最终目标是：

- 控制台日志保持 NestJS 风格，便于本地开发查看。
- 非开发环境自动写入按日期滚动的 JSON 日志文件。
- 所有异常都被统一分类、记录请求上下文，并返回稳定的错误响应结构。
- 响应中的 `requestId` 可以和服务端日志关联，便于前后端一起定位问题。

## 一、为什么 Logger 要和 Exception Filter 一起设计

日志模块解决的是“日志写到哪里、用什么格式写”；异常过滤器解决的是“发生异常时记录什么、返回什么”。

如果只接入 Logger，不处理异常，业务代码仍然可能散落大量重复的 `try/catch`。如果只写 Exception Filter，不配置日志传输方式，生产环境的异常记录又可能只停留在控制台，无法保留和检索。

更合理的职责边界是：

- `LoggerModule`：统一 NestJS 日志底座，配置控制台和文件 transport。
- `RequestContextMiddleware`：为每个请求生成 `requestId`。
- `GlobalExceptionFilter`：捕获异常、构造结构化日志、统一错误响应。
- Controller / Service：专注业务逻辑，失败时抛出有语义的异常。

一次异常请求的简化链路如下：

```text
Request
  -> RequestContextMiddleware 生成 requestId
  -> Guard / Pipe / Controller / Service
  -> 抛出 HttpException 或未知 Error
  -> GlobalExceptionFilter 捕获
  -> Logger 记录结构化异常日志
  -> Response 返回统一错误结构
```

## 二、安装日志依赖

项目中新增了三个依赖：

```bash
pnpm add nest-winston winston winston-daily-rotate-file
```

它们分别负责：

- `winston`：Node.js 通用日志库。
- `nest-winston`：把 Winston 接入 NestJS Logger 系统。
- `winston-daily-rotate-file`：按日期切分日志文件，并支持大小、保留时间等策略。

安装后，`package.json` 中会出现：

```json
{
  "dependencies": {
    "nest-winston": "^1.10.2",
    "winston": "^3.19.0",
    "winston-daily-rotate-file": "^5.0.0"
  }
}
```

## 三、准备日志环境变量

日志文件是否开启、写入目录、文件名和保留策略都应该交给环境变量控制。当前项目在环境配置中加入了以下字段：

```ts
export interface EnvironmentVariables {
  LOG_FILE_ENABLED: boolean
  LOG_DIRNAME: string
  LOG_FILENAME: string
  LOG_DATE_PATTERN: string
  LOG_MAX_SIZE: string
  LOG_MAX_FILES: string
}
```

并使用 Joi 做启动校验：

```ts
export const environmentValidationSchema = Joi.object<EnvironmentVariables>({
  LOG_FILE_ENABLED: Joi.boolean().default(false),
  LOG_DIRNAME: Joi.string().min(1).required(),
  LOG_FILENAME: Joi.string().min(1).required(),
  LOG_DATE_PATTERN: Joi.string().min(1).required(),
  LOG_MAX_SIZE: Joi.string().min(1).required(),
  LOG_MAX_FILES: Joi.string().min(1).required(),
})
```

本地 `.env` 可以这样配置：

```env
LOG_FILE_ENABLED=false
LOG_DIRNAME=logs
LOG_FILENAME=app-%DATE%.log
LOG_DATE_PATTERN=YYYY-MM-DD
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d
```

这里的策略是：开发环境默认不写文件，避免本地产生大量日志；测试和生产环境默认写文件，保证异常可追踪。

```ts
export const shouldSaveLogToFile = (
  environment: NodeEnvironment,
  logFileEnabled: boolean,
): boolean => environment !== 'development' || logFileEnabled
```

这段判断的效果是：

| NODE_ENV | LOG_FILE_ENABLED | 是否写入文件 |
| --- | --- | --- |
| development | false | 否 |
| development | true | 是 |
| test | false | 是 |
| production | false | 是 |

## 四、封装 LoggerModule

创建 `src/logger/logger.module.ts`，在模块内部使用 `WinstonModule.forRootAsync()`。这样可以通过 `ConfigService` 读取环境变量，而不是把日志配置写死。

```ts
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  WinstonModule,
  utilities as nestWinstonModuleUtilities,
} from 'nest-winston'
import * as winston from 'winston'
import 'winston-daily-rotate-file'
import { AppConfigModule } from '../config/config.module'
import type {
  EnvironmentVariables,
  NodeEnvironment,
} from '../config/environment.validation'

export const shouldSaveLogToFile = (
  environment: NodeEnvironment,
  logFileEnabled: boolean,
): boolean => environment !== 'development' || logFileEnabled

@Module({
  imports: [
    AppConfigModule,
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => {
        const environment = configService.get('NODE_ENV', { infer: true })
        const logFileEnabled = configService.get('LOG_FILE_ENABLED', {
          infer: true,
        })
        const saveLogToFile = shouldSaveLogToFile(environment, logFileEnabled)

        return {
          level: 'silly',
          transports: [
            new winston.transports.Console({
              format: nestWinstonModuleUtilities.format.nestLike('Neocrown', {
                colors: true,
                prettyPrint: true,
              }),
            }),
            ...(saveLogToFile
              ? [
                  new winston.transports.DailyRotateFile({
                    dirname: configService.get('LOG_DIRNAME', { infer: true }),
                    filename: configService.get('LOG_FILENAME', {
                      infer: true,
                    }),
                    datePattern: configService.get('LOG_DATE_PATTERN', {
                      infer: true,
                    }),
                    maxSize: configService.get('LOG_MAX_SIZE', { infer: true }),
                    maxFiles: configService.get('LOG_MAX_FILES', {
                      infer: true,
                    }),
                    format: winston.format.combine(
                      winston.format.errors({ stack: true }),
                      winston.format.timestamp({
                        format: 'YYYY-MM-DD HH:mm:ss.SSS',
                      }),
                      winston.format.json(),
                    ),
                  }),
                ]
              : []),
          ],
        }
      },
    }),
  ],
})
export class LoggerModule {}
```

这段配置里有两个 transport：

- `Console`：用于本地开发，采用 `nestLike()` 保持 NestJS 控制台日志风格。
- `DailyRotateFile`：用于日志文件，输出 JSON，包含时间戳和错误堆栈，方便后续接入日志采集系统。

文件日志使用 JSON 格式，而不是彩色文本格式，是因为生产环境通常更关注机器可解析能力。日志平台可以直接基于字段检索，例如 `requestId`、`statusCode`、`category`。

## 五、在 AppModule 中注册 LoggerModule

Logger 作为基础设施模块，应该尽早导入根模块：

```ts
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { LoggerModule } from './logger/logger.module'
import { GlobalExceptionFilter } from './common/filters/global-exception.filter'

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    LoggerModule,
    PostsModule,
    UserModule,
    AuthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
```

这里使用 `APP_FILTER` 注册全局异常过滤器，而不是在 `main.ts` 中调用 `app.useGlobalFilters(new GlobalExceptionFilter())`。这样做的好处是过滤器可以参与 NestJS 依赖注入，后续如果要注入配置、日志服务或告警服务，会更自然。

## 六、为每个请求生成 requestId

异常日志必须能和一次具体请求关联。当前项目通过中间件在请求进入时生成 `requestId`：

```ts
import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import type { RequestWithContext } from '../types/request-with-context'

export const REQUEST_ID_HEADER = 'X-Request-Id'

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: () => void): void {
    const requestId = randomUUID()

    request.requestId = requestId
    response.setHeader(REQUEST_ID_HEADER, requestId)
    next()
  }
}
```

然后在 `AppModule` 中让它作用于所有路由：

```ts
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL })
  }
}
```

返回头中的 `X-Request-Id` 可以提供给前端、测试人员或调用方。当接口报错时，客户端拿着这个 ID 就能在服务端日志中定位同一次请求。

## 七、实现全局 Exception Filter

`Exception Filter` 的核心职责不是简单把异常转成 JSON，而是同时完成三件事：

- 判断异常状态码。
- 记录结构化异常日志。
- 返回统一错误响应。

当前项目的过滤器定义为：

```ts
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common'
import type { Response } from 'express'
import { QueryFailedError } from 'typeorm'
import type { ApiResponse } from '../interceptors/response.interceptor'
import type { RequestWithContext } from '../types/request-with-context'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<RequestWithContext>()
    const response = http.getResponse<Response>()
    const statusCode = this.getStatusCode(exception)
    const clientMessage = this.getClientMessage(exception, statusCode)
    const log = this.createLog(exception, request, statusCode)

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(log, this.getStack(exception))
    } else {
      this.logger.warn(log)
    }

    if (response.headersSent) return

    const responseStatusCode = this.getResponseStatusCode(statusCode)
    const body: ApiResponse<null> & { requestId: string } = {
      success: false,
      data: null,
      message: clientMessage,
      requestId: request.requestId,
    }
    response.status(responseStatusCode).json(body)
  }
}
```

`@Catch()` 不传参数表示捕获所有异常，包括 NestJS 的 `HttpException` 和普通 `Error`。这样可以兜住未知错误，避免默认异常响应泄露实现细节。

过滤器内部使用的是 NestJS 标准 `Logger`：

```ts
private readonly logger = new Logger(GlobalExceptionFilter.name)
```

当 `LoggerModule` 接入 `nest-winston` 后，这些日志会通过统一的 Winston transport 输出。业务层不需要直接依赖 Winston。

## 八、设计结构化异常日志

异常日志不要只记录字符串。真正排查问题时，至少需要知道：谁、什么时候、访问了哪里、带了什么参数、系统怎样分类这个异常。

当前项目把异常日志整理成 `ExceptionLog`：

```ts
type ExceptionCategory =
  | 'authentication'
  | 'authorization'
  | 'conflict'
  | 'database'
  | 'http'
  | 'internal'
  | 'not_found'
  | 'validation'

interface ExceptionLog {
  category: ExceptionCategory
  exception: string
  ip?: string
  message: string
  method: string
  params: Record<string, string | string[]>
  path: string
  query: Record<string, unknown>
  requestId: string
  statusCode: number
  userAgent?: string
  userId?: string | number
}
```

构造日志时，从请求对象中提取上下文：

```ts
private createLog(
  exception: unknown,
  request: RequestWithContext,
  statusCode: HttpStatus,
): ExceptionLog {
  return {
    category: this.getCategory(exception, statusCode),
    exception:
      exception instanceof Error ? exception.constructor.name : 'Unknown',
    ip: request.ip,
    message: this.getExceptionMessage(exception),
    method: request.method,
    params: request.params,
    path: request.originalUrl,
    query: request.query,
    requestId: request.requestId,
    statusCode,
    userAgent: request.get('user-agent'),
    userId: request.user?.id,
  }
}
```

注意不要把密码、验证码、Token、身份证号等敏感字段直接写入日志。当前示例记录了 `query` 和 `params`，如果后续要记录 `body`，应先做字段脱敏。

## 九、按异常等级选择 warn 或 error

并不是所有异常都应该记为 `error`。例如参数校验失败、未登录、无权限、资源不存在，通常属于客户端请求不符合预期，应记录为 `warn`。未知异常、数据库异常、服务端内部错误才应该记录为 `error` 并附带堆栈。

```ts
if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
  this.logger.error(log, this.getStack(exception))
} else {
  this.logger.warn(log)
}
```

这样做有两个好处：

- 告警系统可以主要关注 `error`，减少噪声。
- 普通业务失败仍然有日志可查，但不会污染服务端故障指标。

异常分类逻辑可以按项目需要扩展：

```ts
private getCategory(
  exception: unknown,
  statusCode: HttpStatus,
): ExceptionCategory {
  if (exception instanceof QueryFailedError) return 'database'

  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'validation'
    case HttpStatus.UNAUTHORIZED:
      return 'authentication'
    case HttpStatus.FORBIDDEN:
      return 'authorization'
    case HttpStatus.NOT_FOUND:
      return 'not_found'
    case HttpStatus.CONFLICT:
      return 'conflict'
    default:
      return statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'internal'
        : 'http'
  }
}
```

`QueryFailedError` 被单独归类为 `database`，便于快速筛选数据库问题。

## 十、统一错误响应结构

项目已有 `ResponseInterceptor` 负责包装成功响应：

```json
{
  "success": true,
  "data": {},
  "message": "请求成功"
}
```

异常过滤器返回相同风格的失败结构：

```json
{
  "success": false,
  "data": null,
  "message": "用户名已存在",
  "requestId": "b2a4e7f2-9f27-4a28-b2e0-77bdbf25c623"
}
```

`message` 的获取逻辑兼容了 NestJS 常见异常响应：

```ts
private getClientMessage(exception: unknown, statusCode: HttpStatus): string {
  if (!(exception instanceof HttpException)) return '服务器内部错误'

  const response = exception.getResponse()
  if (typeof response === 'string') return response

  const { message } = response as HttpExceptionResponse
  if (Array.isArray(message)) return message.join('；')
  if (typeof message === 'string') return message

  return HttpStatus[statusCode] ?? '请求处理失败'
}
```

这段逻辑尤其适合配合 `ValidationPipe`。当参数校验失败时，NestJS 可能返回数组形式的错误消息，过滤器会把它拼成一个字符串，保证前端拿到稳定的 `message` 字段。

对于未知异常，不把原始错误消息返回给客户端：

```ts
if (!(exception instanceof HttpException)) return '服务器内部错误'
```

这是生产项目里非常重要的安全边界。真实错误会进入服务端日志，客户端只拿到安全提示。

## 十一、HTTP 状态码策略

当前过滤器里还有一个比较特殊的设计：

```ts
private getResponseStatusCode(statusCode: HttpStatus): HttpStatus {
  if (
    statusCode === HttpStatus.BAD_REQUEST ||
    statusCode === HttpStatus.UNPROCESSABLE_ENTITY
  ) {
    return HttpStatus.OK
  }

  return statusCode
}
```

这意味着参数校验类异常在响应体中仍然是：

```json
{
  "success": false,
  "data": null,
  "message": "email must be an email"
}
```

但 HTTP 状态码会返回 `200`。这种策略常见于部分前后端约定固定使用业务字段判断成功失败的项目。

如果项目希望严格遵循 HTTP 语义，可以去掉这段转换，让 `400` 和 `422` 原样返回。两种方式都可以成立，但必须在团队内统一，否则前端、网关、监控和测试都会出现判断分歧。

推荐原则是：

- 对外开放 API：优先保留真实 HTTP 状态码。
- 内部管理后台：可以按团队约定把校验失败转成 `200 + success: false`。
- 服务端错误：不要转成 `200`，必须保留 `500`，方便监控识别故障。

## 十二、在 Service 中使用 this.logger

全局异常过滤器负责记录“已经抛出来的异常”，但 Service 层仍然需要记录一些业务过程日志。例如：第三方接口调用结果、关键任务开始和结束、异步任务重试、批量导入统计、业务状态流转等。

在 Service 中使用 NestJS 内置 `Logger` 即可。接入 `nest-winston` 后，这些日志同样会走统一的 Winston transport，不需要在每个 Service 中直接依赖 Winston。

```ts
import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name)

  async create(dto: CreateUserDto) {
    this.logger.log({
      action: 'user.create.start',
      username: dto.username,
    })

    const user = await this.userRepository.create(dto)

    this.logger.log({
      action: 'user.create.success',
      userId: user.id,
      username: user.username,
    })

    return user
  }
}
```

`new Logger(UserService.name)` 中的 `UserService.name` 会成为日志上下文。控制台中可以直观看到日志来自哪个类，文件日志中也能基于上下文筛选。

### 1. 日志级别怎么选

Service 中常用的日志级别可以这样划分：

| 方法 | 使用场景 |
| --- | --- |
| `this.logger.log()` | 正常业务流程，例如任务开始、任务完成、关键状态变更 |
| `this.logger.warn()` | 可恢复或可预期的问题，例如库存不足、重复请求、第三方接口临时失败 |
| `this.logger.error()` | 当前流程失败且需要排查的问题，例如任务最终失败、外部服务异常、数据不一致 |
| `this.logger.debug()` | 调试信息，适合本地或排查问题时打开 |
| `this.logger.verbose()` | 更细粒度的过程信息，通常不建议在核心链路大量输出 |

例如第三方接口失败但会继续重试，可以先记录 `warn`：

```ts
this.logger.warn({
  action: 'sms.send.retry',
  phone,
  attempt,
  reason: error instanceof Error ? error.message : 'Unknown error',
})
```

如果重试结束仍然失败，再记录 `error` 并抛出异常：

```ts
import { InternalServerErrorException } from '@nestjs/common'

this.logger.error(
  {
    action: 'sms.send.failed',
    phone,
    attempts,
    reason: error instanceof Error ? error.message : 'Unknown error',
  },
  error instanceof Error ? error.stack : undefined,
)

throw new InternalServerErrorException('短信发送失败')
```

### 2. 不要重复记录同一个异常

Service 中最容易出现的问题是“记录一次错误，然后继续把异常抛出去”，最终全局异常过滤器又记录一次，导致同一个异常在日志中出现两条。

```ts
try {
  return await this.userRepository.findById(id)
} catch (error) {
  this.logger.error(
    { action: 'user.find.failed', id },
    error instanceof Error ? error.stack : undefined,
  )
  throw error
}
```

这段代码通常不推荐。因为 `throw error` 后，`GlobalExceptionFilter` 仍然会记录异常，并补充请求路径、参数、`requestId`、用户 ID 等上下文。

更推荐的做法是：如果只是向上抛出异常，就交给全局过滤器记录；如果 Service 捕获异常是为了补充业务语义、降级、重试或转换异常，再记录必要日志。

```ts
import { ServiceUnavailableException } from '@nestjs/common'

try {
  return await this.paymentClient.pay(payload)
} catch (error) {
  this.logger.warn({
    action: 'payment.pay.fallback',
    orderId: payload.orderId,
    reason: error instanceof Error ? error.message : 'Unknown error',
  })

  await this.markOrderPending(payload.orderId)
  throw new ServiceUnavailableException('支付服务暂不可用')
}
```

### 3. 日志内容要结构化

既然文件日志已经使用 JSON 格式，Service 中也应该尽量传对象，而不是拼接字符串：

```ts
// 不推荐
this.logger.log(`create user success, id=${user.id}, username=${user.username}`)

// 推荐
this.logger.log({
  action: 'user.create.success',
  userId: user.id,
  username: user.username,
})
```

结构化日志更适合检索、聚合和告警。例如后续可以直接查询 `action = user.create.success`，或统计某个业务动作的失败次数。

### 4. 不要记录敏感字段

Service 最接近业务数据，也最容易误把敏感信息打进日志。下面这些字段不应该直接记录：

- 密码、密码哈希、验证码。
- Access Token、Refresh Token、Cookie。
- 身份证号、银行卡号、手机号完整明文。
- 支付密钥、邮箱授权码、第三方服务密钥。

如果确实需要定位问题，可以记录脱敏后的摘要：

```ts
this.logger.log({
  action: 'auth.login.failed',
  username,
  ip,
})
```

登录失败时不要记录用户提交的密码。日志是排查工具，不应该变成敏感数据副本。

## 十三、在业务代码中抛出有语义的异常

接入全局异常过滤器后，业务代码不需要手动组装错误响应。Service 中直接抛出 NestJS 异常即可：

```ts
import { ConflictException, NotFoundException } from '@nestjs/common'

if (usernameExists) {
  throw new ConflictException('用户名已存在')
}

if (!user) {
  throw new NotFoundException('用户不存在')
}
```

过滤器会自动完成：

- `ConflictException` 分类为 `conflict`。
- `NotFoundException` 分类为 `not_found`。
- 日志记录对应的请求方法、路径、查询参数和 `requestId`。
- 响应返回 `{ success: false, data: null, message, requestId }`。

不要在 Service 中返回类似这样的结构：

```ts
return {
  success: false,
  data: null,
  message: '用户不存在',
}
```

这会绕过异常处理链路，也会让错误日志丢失上下文。业务失败应该优先用异常表达，正常数据才通过返回值表达。

## 十四、和统一响应 Interceptor 的关系

当前项目同时使用了：

- `ResponseInterceptor`：包装正常响应。
- `ClassSerializerInterceptor`：处理实体序列化。
- `GlobalExceptionFilter`：包装异常响应。

它们的边界要保持清晰：

| 组件 | 处理对象 | 主要职责 |
| --- | --- | --- |
| ResponseInterceptor | Controller 正常返回值 | 包装 `{ success, data, message }` |
| ClassSerializerInterceptor | 正常返回值中的实体对象 | 应用 `@Exclude()`、`@Expose()`、`@Transform()` |
| GlobalExceptionFilter | 抛出的异常 | 记录日志并返回失败结构 |

异常不会进入 `ResponseInterceptor` 的 `map()` 分支，而是交给 `Exception Filter`。因此不要试图在成功响应拦截器里统一吞掉所有错误。

## 十五、补充 Swagger 错误响应 DTO

错误响应也应该体现在接口文档里。当前项目调整了 `BusinessErrorResponseDto` 的 `data` 字段声明：

```ts
export class BusinessErrorResponseDto {
  @ApiProperty({ description: '请求是否成功', example: false })
  success!: boolean

  @ApiProperty({
    description: '响应数据，业务失败时为 null',
    type: Object,
    nullable: true,
    example: null,
  })
  data!: null

  @ApiProperty({ description: '响应消息', example: '用户不存在' })
  message!: string
}
```

`type: Object` 和 `nullable: true` 可以让 Swagger / Knife4j 更准确地展示 `data` 在失败时为 `null` 的约定。

如果错误响应已经包含 `requestId`，也可以继续扩展 DTO：

```ts
@ApiProperty({
  description: '请求追踪 ID',
  example: 'b2a4e7f2-9f27-4a28-b2e0-77bdbf25c623',
})
requestId!: string
```

## 十六、单元测试

日志策略和异常过滤器属于全局基础设施，建议至少覆盖两个层面。

第一类是纯函数测试，例如日志文件开关：

```ts
import { shouldSaveLogToFile } from './logger.module'

describe('shouldSaveLogToFile', () => {
  it.each([
    ['development', true, true],
    ['development', false, false],
    ['test', false, true],
    ['production', false, true],
  ] as const)(
    'should return %s/%s as %s',
    (environment, logFileEnabled, expected) => {
      expect(shouldSaveLogToFile(environment, logFileEnabled)).toBe(expected)
    },
  )
})
```

第二类是异常过滤器行为测试。参数校验异常应该记录为 `warn`，并返回统一结构：

```ts
it('应该将参数校验异常记录为 validation 警告', () => {
  const exception = new BadRequestException({
    message: ['email must be an email', 'password is too short'],
  })

  filter.catch(exception, host)

  expect(warnSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'validation',
      exception: 'BadRequestException',
      method: 'POST',
      path: '/api/auth/register?source=test',
      requestId: 'request-id',
      statusCode: 400,
      userId: 7,
    }),
  )
  expect(response.status).toHaveBeenCalledWith(200)
  expect(response.json).toHaveBeenCalledWith({
    success: false,
    data: null,
    message: 'email must be an email；password is too short',
    requestId: 'request-id',
  })
})
```

未知异常应该记录为 `error`，附带堆栈，并返回安全消息：

```ts
it('应该记录未知异常堆栈并返回安全消息', () => {
  const exception = new Error('Unexpected failure')

  filter.catch(exception, host)

  expect(errorSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'internal',
      exception: 'Error',
      message: 'Unexpected failure',
      requestId: 'request-id',
      statusCode: 500,
    }),
    exception.stack,
  )
  expect(response.status).toHaveBeenCalledWith(500)
  expect(response.json).toHaveBeenCalledWith({
    success: false,
    data: null,
    message: '服务器内部错误',
    requestId: 'request-id',
  })
})
```

这些测试锁定的是全局契约：日志级别、异常分类、响应状态码、响应体结构。后续重构时，只要这些契约不变，业务层就不会被基础设施调整影响。

## 十七、生产环境建议

接入日志与异常过滤器后，还应注意以下实践：

- 日志目录应加入部署平台的持久化或采集范围，容器环境下不要只写到临时磁盘。
- 文件日志保留策略要结合磁盘容量设置，避免 `maxFiles` 过长。
- 生产日志中避免记录明文密码、Token、验证码、银行卡号等敏感信息。
- `requestId` 最好支持读取上游网关传入的请求 ID；如果没有，再由应用生成。
- 业务异常使用明确的 NestJS 异常类型，不要统一抛 `Error`。
- 服务端未知异常必须保留真实 HTTP `500`，方便监控系统识别故障。
- 端到端测试应覆盖校验失败、未登录、资源不存在、数据库异常和未知异常。

## 小结

NestJS 接入 Logger 的关键，不只是把日志从控制台写到文件，而是建立一套稳定的异常观测链路。当前项目通过 `nest-winston` 配置控制台和滚动文件日志，再用 `GlobalExceptionFilter` 统一记录异常上下文和返回错误响应。

这套方案的核心价值在于：业务代码只需要抛出语义明确的异常，基础设施层负责日志、分类、状态码和响应格式。当前端拿到 `requestId`，后端就能在结构化日志中快速定位同一次请求，从而把“接口报错了”变成可以追踪、可以检索、可以复盘的问题。
