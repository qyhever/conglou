---
pubDatetime: 2026-03-04T15:22:00Z
title: NestJS 中使用 Middleware 中间件
slug: nestjs-middleware
tags:
  - Node.js
  - NestJS
description: "在 NestJS 中使用 Middleware 中间件，实现一个简单的请求ID中间件，用于追踪请求链路。"
---

NestJS 的 Middleware 会在路由处理器之前执行，可以修改 `request`、`response`，处理完成后需要调用 `next()`。Node.js 的 `crypto.randomUUID()` 会生成 UUID v4。

## 1. 扩展 Express Request 类型

创建 `src/types/express.d.ts`：

```ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export {};
```

这样后面使用 `req.requestId` 时不会出现 TypeScript 类型错误。

## 2. 定义 RequestIdMiddleware

创建 `src/common/middleware/request-id.middleware.ts`：

```ts
import {
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  NextFunction,
  Request,
  Response,
} from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id'

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const requestId = randomUUID();

    // 保存到当前请求对象中
    req.requestId = requestId;

    // 同时返回给调用方，方便排查问题
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
```

也可以新建一个自定义类型，req 使用这个类型
```ts
import type { Request } from 'express'

interface RequestUser {
  id: number
}

export interface RequestWithContext extends Request {
  requestId: string
}
```
`req: Request` 改成 `req: RequestWithContext`

## 3. 注册 Middleware

在 `app.module.ts` 中注册到所有路由：

```ts
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({
        path: '{*path}',
        method: RequestMethod.ALL,
      });
  }
}
```

当前 NestJS 的通配路径支持命名通配符；使用 `{*path}` 可以覆盖根路径及其他路由。

也可以仅应用到某个 Controller：

```ts
consumer
  .apply(RequestIdMiddleware)
  .forRoutes(UserController);
```

NestJS 官方支持通过 `MiddlewareConsumer.apply().forRoutes()` 注册类 Middleware。

## 4. 在 Controller 中使用

```ts
import {
  Controller,
  Get,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

@Controller('users')
export class UserController {
  @Get()
  findAll(@Req() req: Request) {
    console.log('requestId:', req.requestId);

    return {
      requestId: req.requestId,
      data: [],
    };
  }
}
```

请求：

```http
GET /users
```

响应头中会包含：

```http
X-Request-Id: 8f036fbb-b443-4e83-bcf4-295a60ca1a78
```

响应体示例：

```json
{
  "requestId": "8f036fbb-b443-4e83-bcf4-295a60ca1a78",
  "data": []
}
```

在日志中直接关联请求：

```ts
console.log(`[${req.requestId}] querying users`);
```

如果服务位于网关之后，希望保留网关传来的 request ID，可以改成：

```ts
const requestId =
  req.header('x-request-id') || randomUUID();
```

这样没有请求头时才生成新的 UUID。

[1]: https://docs.nestjs.com/middleware "Middleware | NestJS - A progressive Node.js framework"
