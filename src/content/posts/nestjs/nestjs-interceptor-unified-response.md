---
pubDatetime: 2026-03-08T15:22:00Z
title: NestJS 使用 Interceptor 统一响应，并通过装饰器自定义 message
slug: nestjs-interceptor-unified-response
tags:
  - Node.js
  - NestJS
description: "本文介绍如何在 NestJS 中使用 Interceptor 统一响应，并通过装饰器自定义 message，包括统一响应结构、Interceptor 位置、实现全局响应拦截器、用 SetMetadata 声明接口消息、使用 Reflector 读取元数据、注册为全局拦截器、默认 message 的两种策略、错误响应应该怎样处理、避免重复包装、单元测试、常见误区等。"
---


当接口数量增加后，如果每个 Controller 都手工返回 `{ success, data, message }`，很快就会出现结构不一致、提示语重复和业务数据被包装多次等问题。NestJS Interceptor 位于 Controller 返回结果与 HTTP 响应之间，非常适合集中处理成功响应。

本文实现一个全局 `ResponseInterceptor`，将返回值统一包装为 `{ success, data, message }`，再使用 `SetMetadata` 和自定义装饰器为特定接口声明成功提示语。

> 本文聚焦正常响应转换。异常状态码和错误响应应主要交给 Exception Filter，不建议用成功拦截器吞掉异常。

## 一、统一响应结构

先定义接口返回格式：

```ts
export interface ApiResponse<T> {
  success: boolean
  data: T | null
  message: string
}
```

创建用户成功时，响应可以是：

```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "testuser2"
  },
  "message": "新增成功"
}
```

统一结构让前端、日志系统和接口文档拥有稳定约定。但统一包装应该发生在基础设施层，Controller 仍然只返回业务数据：

```ts
@Post()
create(@Body() dto: CreateUserDto) {
  return this.userService.create(dto)
}
```

## 二、理解 Interceptor 的位置

一次普通请求的简化链路是：

```text
Request
  -> Middleware
  -> Guard
  -> Pipe
  -> Controller / Service
  -> Interceptor RxJS 管道
  -> Response
```

`next.handle()` 返回一个 `Observable`。通过 RxJS 的 `map()` 可以修改 Controller 的正常返回值：

```ts
return next.handle().pipe(
  map((data) => ({
    success: true,
    data,
    message: '请求成功',
  })),
)
```

如果 Controller 返回 Promise，NestJS 也会把它接入同一条响应流，因此拦截器不需要分别处理同步值和 Promise。

## 三、实现全局响应拦截器

创建 `src/common/interceptors/response.interceptor.ts`：

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, map } from 'rxjs'
import { SUCCESS_MESSAGE_KEY } from '../decorators/success-message.decorator'

export interface ApiResponse<T> {
  success: boolean
  data: T | null
  message: string
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor<
  unknown,
  ApiResponse<unknown>
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<ApiResponse<unknown>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data: data ?? null,
        message: this.getSuccessMessage(context),
      })),
    )
  }

  private getSuccessMessage(context: ExecutionContext): string {
    return (
      this.reflector.get<string>(SUCCESS_MESSAGE_KEY, context.getHandler()) ??
      '请求成功'
    )
  }
}
```

这里有三个关键点：

- `next.handle()` 获取后续处理器的响应流。
- `map()` 只转换正常返回值，不会自动处理抛出的异常。
- `data ?? null` 把 `undefined` 和 `null` 统一为 `null`，同时保留 `0`、`false` 和空字符串等合法值。

不要使用 `data || null`，否则 `0` 和 `false` 会被错误转换为 `null`。

## 四、用 SetMetadata 声明接口消息

不同操作需要不同提示语，例如新增成功、更新成功、删除成功。可以直接在 Controller 上调用 `SetMetadata`：

```ts
import { SetMetadata } from '@nestjs/common'

@SetMetadata('successMessage', '新增成功')
@Post()
create() {
  // ...
}
```

但字符串 Key 和调用细节会散落在业务代码中。更好的方式是封装语义明确的自定义装饰器：

```ts
import { SetMetadata } from '@nestjs/common'

export const SUCCESS_MESSAGE_KEY = 'successMessage'

export const SuccessMessage = (message: string) =>
  SetMetadata(SUCCESS_MESSAGE_KEY, message)
```

使用时只需要：

```ts
@SuccessMessage('新增成功')
@Post()
create(@Body() createUserDto: CreateUserDto) {
  return this.userService.create(createUserDto)
}
```

自定义装饰器没有修改方法返回值，它只是把元数据附加到路由处理器上。真正读取并应用消息的是 `ResponseInterceptor`。

## 五、使用 Reflector 读取元数据

`ExecutionContext` 能获取当前 Controller 类和处理方法：

```ts
context.getClass()
context.getHandler()
```

如果装饰器只允许写在方法上，可以使用：

```ts
this.reflector.get<string>(SUCCESS_MESSAGE_KEY, context.getHandler())
```

如果希望 Controller 级默认值能被方法级配置覆盖，推荐：

```ts
private getSuccessMessage(context: ExecutionContext): string {
  return (
    this.reflector.getAllAndOverride<string>(SUCCESS_MESSAGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? '请求成功'
  )
}
```

然后可以这样使用：

```ts
@SuccessMessage('用户操作成功')
@Controller('user')
export class UserController {
  @SuccessMessage('新增成功')
  @Post()
  create() {}

  @Get()
  findAll() {}
}
```

`create()` 返回“新增成功”，`findAll()` 继承“用户操作成功”。

元数据 Key 还可以用 `Symbol` 避免字符串冲突：

```ts
export const SUCCESS_MESSAGE_KEY = Symbol('SUCCESS_MESSAGE_KEY')
```

## 六、注册为全局拦截器

在根模块中使用 `APP_INTERCEPTOR`：

```ts
import { ClassSerializerInterceptor, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ResponseInterceptor } from './common/interceptors/response.interceptor'

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
  ],
})
export class AppModule {}
```

通过依赖注入注册后，拦截器可以正常注入 `Reflector` 等依赖，也无需在每个 Controller 上重复添加 `@UseInterceptors()`。

### 多个拦截器的顺序

多个拦截器会形成嵌套调用，响应阶段按相反方向执行。统一响应包装与 `ClassSerializerInterceptor` 同时存在时，必须通过接口测试确认最终结果，尤其要检查：

- `@Exclude()` 是否仍能隐藏密码。
- 日期 `@Transform()` 是否仍然生效。
- 包装对象是否被重复序列化。

不要只依赖对 providers 数组顺序的直觉，测试最终 JSON 才是可靠约束。

## 七、默认 message 的两种策略

最简单的策略是所有未声明接口都返回“请求成功”：

```ts
return customMessage ?? '请求成功'
```

也可以根据 HTTP 方法提供默认消息：

```ts
const DEFAULT_MESSAGES: Record<string, string> = {
  GET: '查询成功',
  POST: '新增成功',
  PATCH: '更新成功',
  PUT: '更新成功',
  DELETE: '删除成功',
}

private getSuccessMessage(context: ExecutionContext): string {
  const customMessage = this.reflector.getAllAndOverride<string>(
    SUCCESS_MESSAGE_KEY,
    [context.getHandler(), context.getClass()],
  )

  const request = context.switchToHttp().getRequest<Request>()
  return customMessage ?? DEFAULT_MESSAGES[request.method] ?? '请求成功'
}
```

HTTP 方法默认值适合 REST 风格稳定的项目；显式装饰器更准确，适合登录、导入、审核等无法由方法名推断语义的操作。

## 八、错误响应应该怎样处理

有些项目让 Service 返回特殊对象：

```ts
export interface ServiceErrorResult {
  error: true
  message: string
}
```

再由响应拦截器识别：

```ts
if (isServiceErrorResult(data)) {
  return {
    success: false,
    data: null,
    message: data.message,
  }
}
```

这种方式可以统一 JSON 外形，但它仍然是一次正常返回，HTTP 状态码通常还是 `200`。监控系统、网关和客户端无法准确区分冲突、未授权与服务器错误。

更符合 HTTP 语义的做法是在 Service 中抛出 NestJS 异常：

```ts
if (usernameExists) {
  throw new ConflictException('用户名已存在')
}
```

再由全局 Exception Filter 统一错误结构：

```json
{
  "success": false,
  "data": null,
  "message": "用户名已存在"
}
```

职责边界可以概括为：

- Interceptor：包装正常结果、增加响应元数据、记录耗时。
- Exception Filter：转换异常、保留正确 HTTP 状态码、统一错误格式。
- Service：执行业务规则，失败时抛出有语义的异常。

## 九、避免重复包装

统一响应后，Controller 不应再返回完整 envelope：

```ts
// 不推荐
return {
  success: true,
  data: user,
  message: '新增成功',
}
```

否则拦截器会得到：

```json
{
  "success": true,
  "data": {
    "success": true,
    "data": {},
    "message": "新增成功"
  },
  "message": "请求成功"
}
```

如果文件下载、SSE 或第三方回调不适合包装，可以增加跳过元数据：

```ts
export const SKIP_RESPONSE_WRAP_KEY = Symbol('SKIP_RESPONSE_WRAP_KEY')
export const SkipResponseWrap = () => SetMetadata(SKIP_RESPONSE_WRAP_KEY, true)
```

拦截器读取该标记后直接 `return next.handle()`。

## 十、单元测试

拦截器属于横切逻辑，一处错误会影响全部接口，应至少测试默认消息、自定义消息和空返回值：

```ts
import { CallHandler, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { lastValueFrom, of } from 'rxjs'

it('使用处理器声明的成功消息', async () => {
  const reflector = new Reflector()
  const interceptor = new ResponseInterceptor(reflector)
  const handler = () => undefined

  Reflect.defineMetadata(SUCCESS_MESSAGE_KEY, '新增成功', handler)

  const context = {
    getHandler: () => handler,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext

  const next: CallHandler = {
    handle: () => of({ id: 1 }),
  }

  await expect(
    lastValueFrom(interceptor.intercept(context, next)),
  ).resolves.toEqual({
    success: true,
    data: { id: 1 },
    message: '新增成功',
  })
})
```

还应增加端到端测试，确认真实 HTTP 状态码、异常格式以及序列化拦截器共同工作时的最终响应。

## 十一、常见误区

### 1. 在 map 中捕获所有错误

`map()` 处理的是正常值。若要观测错误可以使用 `catchError()`，但不要无条件把异常转成 `200` 正常响应。

### 2. 直接使用 Reflect.getMetadata

原生 Reflect API 可以读取元数据，但 NestJS 的 `Reflector` 对方法级、类级覆盖和依赖注入更友好。

### 3. 使用 @Res() 手工返回

Controller 注入 `@Res()` 并调用 `res.json()` 后，通常绕过 Nest 标准响应处理链路，统一包装可能不再生效。

### 4. 文件流也统一包装

`StreamableFile`、SSE 和原始响应不是普通 JSON 数据，应提供明确的跳过机制。

## 小结

响应拦截器解决“所有正常接口怎样返回”，`SetMetadata` 解决“单个路由需要携带什么声明”，自定义装饰器则把底层元数据封装成清晰的业务语义。三者结合后，Controller 只返回业务数据，同时仍能用一行 `@SuccessMessage('新增成功')` 精确控制提示语。

在生产项目中，应继续用 Exception Filter 处理失败响应，并用端到端测试锁定状态码、响应结构和多个拦截器的执行效果。
