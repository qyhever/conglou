---
pubDatetime: 2026-03-07T15:22:00Z
title: NestJS 使用 class-validator 做字段参数校验
slug: nestjs-class-validator-request-validation
tags:
  - Node.js
  - NestJS
description: "本文介绍如何在 NestJS 中使用 class-validator 做字段参数校验，包括必填项、字符串、邮箱、布尔值、可选字段和额外字段校验等。"
---


接口接收请求参数时，仅在 TypeScript 中声明类型并不能保证运行时数据安全。`username: string` 只会约束编译阶段，客户端依然可以传入数字、空字符串或额外字段。NestJS 可以通过 `ValidationPipe`、`class-validator` 和 DTO，把参数规则放到请求进入业务代码之前统一执行。

本文结合用户创建接口，完成必填项、字符串、邮箱、布尔值、可选字段和额外字段校验，并解释全局校验配置、更新 DTO、路径参数校验及常见误区。

> 本文示例基于 NestJS 11、`class-validator` 0.15.x 和 TypeScript 5。

## 一、为什么 TypeScript 类型不等于参数校验

下面的 DTO 看起来已经声明了字段类型：

```ts
export class CreateUserDto {
  username!: string
  email!: string
  isEnabled!: boolean
}
```

但 TypeScript 类型会在编译后被移除。下面这些请求仍可能到达 Controller：

```json
{
  "username": 100,
  "email": "not-an-email",
  "isEnabled": "true",
  "role": "admin"
}
```

参数校验需要解决三个问题：

- 字段是否存在，例如 `username` 不能为空。
- 字段格式是否正确，例如 `email` 必须是邮箱。
- 是否允许未声明字段，例如客户端不能自行提交 `role`。

## 二、安装依赖

```bash
pnpm add class-validator class-transformer
```

命令说明：

- `class-validator` 提供 `@IsString()`、`@IsEmail()` 等校验装饰器。
- `class-transformer` 支持把普通请求对象转换为 DTO 实例，也是 NestJS 参数转换能力的基础依赖。

Nest CLI 项目通常已经启用装饰器。如果是自行搭建的 TypeScript 项目，需要确认 `tsconfig.json` 包含：

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## 三、用 DTO 声明字段规则

创建用户 DTO：

```ts
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'

export class CreateUserDto {
  @IsOptional()
  @IsString()
  avatar?: string

  @IsString()
  @IsNotEmpty()
  username!: string

  @IsString()
  @IsNotEmpty()
  nickname!: string

  @IsEmail()
  @IsNotEmpty()
  email!: string

  @IsString()
  @IsNotEmpty()
  password!: string

  @IsBoolean()
  isEnabled!: boolean
}
```

这些装饰器的职责分别是：

- `@IsOptional()`：字段缺失或值为 `null`、`undefined` 时跳过后续校验。
- `@IsString()`：值必须是字符串。
- `@IsNotEmpty()`：字符串不能是空字符串。
- `@IsEmail()`：值必须符合邮箱格式。
- `@IsBoolean()`：值必须是布尔值 `true` 或 `false`，字符串 `"true"` 不会自动通过。

装饰器可以组合使用。比如 `@IsEmail()` 负责格式，`@IsNotEmpty()` 明确表达字段不能为空。

### 让规则更贴近业务

实际项目通常还会限制长度和密码强度：

```ts
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator'

export class CreateUserDto {
  @IsString()
  @Length(3, 50)
  username!: string

  @IsString()
  @MaxLength(50)
  nickname!: string

  @IsEmail()
  @MaxLength(100)
  email!: string

  @IsString()
  @Length(8, 64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain letters and numbers',
  })
  password!: string
}
```

DTO 校验应负责输入形态和基础格式。用户名是否重复、邮箱是否已注册等需要访问数据库的业务规则，仍应放在 Service 中处理。

## 四、全局启用 ValidationPipe

只写装饰器不会自动校验，必须注册 `ValidationPipe`。在 `main.ts` 中全局启用：

```ts
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )

  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
```

两个配置项需要配合理解：

- `whitelist: true`：只保留 DTO 中声明过校验装饰器的属性。
- `forbidNonWhitelisted: true`：发现额外属性时直接返回 `400 Bad Request`，而不是静默删除。

例如 DTO 没有 `role` 字段，客户端提交 `role` 时会被拒绝。这可以降低批量赋值漏洞的风险，避免用户通过额外字段修改权限或内部状态。

### 是否需要 transform

如果希望自动转换路径参数、查询参数或嵌套 DTO，可以增加：

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
})
```

`transform: true` 会尝试依据元数据做类型转换，但不应把它理解为宽松校验。对于关键参数，更明确的方式仍是使用内置 Pipe：

```ts
@Get(':id')
findOne(@Param('id', ParseIntPipe) id: number) {
  return this.userService.findOne(id)
}
```

此时请求 `/user/abc` 会直接得到 `400 Bad Request`，不会进入 Service。

## 五、Controller 保持简洁

```ts
@Post()
create(@Body() createUserDto: CreateUserDto) {
  return this.userService.create(createUserDto)
}
```

请求处理链路如下：

```text
HTTP JSON
  -> JSON 解析
  -> ValidationPipe
  -> DTO 字段校验与白名单检查
  -> Controller
  -> Service
```

校验失败时，NestJS 会抛出 `BadRequestException` 并终止链路，因此 Controller 和 Service 可以默认收到结构正确的数据。

## 六、创建与更新 DTO 的规则复用

创建用户时多数属性是必填项，更新用户时通常允许只提交部分字段。可以使用 `PartialType` 复用规则：

```ts
import { PartialType } from '@nestjs/mapped-types'
import { CreateUserDto } from './create-user.dto'

export class UpdateUserDto extends PartialType(CreateUserDto) {}
```

`PartialType()` 会继承原 DTO 的校验元数据，并把所有字段变为可选。这样无需复制一套规则，也能避免创建与更新接口的字段约束逐渐不一致。

需要注意：如果更新接口不允许修改某些字段，例如用户名或启用状态，应该建立专用 DTO，而不是为了复用而暴露不该修改的属性。

## 七、验证接口行为

合法请求：

```http
POST http://localhost:3000/user HTTP/1.1
Content-Type: application/json

{
  "username": "testuser2",
  "email": "testuser2@example.com",
  "password": "testpassword1",
  "nickname": "Test User",
  "isEnabled": true
}
```

邮箱格式错误：

```http
POST http://localhost:3000/user HTTP/1.1
Content-Type: application/json

{
  "username": "testuser2",
  "email": "wrong-email",
  "password": "testpassword1",
  "nickname": "Test User",
  "isEnabled": true
}
```

响应状态码为 `400`，默认错误体会包含类似信息：

```json
{
  "message": ["email must be an email"],
  "error": "Bad Request",
  "statusCode": 400
}
```

提交额外字段：

```json
{
  "username": "testuser2",
  "email": "testuser2@example.com",
  "password": "testpassword1",
  "nickname": "Test User",
  "isEnabled": true,
  "role": "admin"
}
```

在 `forbidNonWhitelisted: true` 下会返回 `property role should not exist`。

## 八、自定义错误消息

装饰器支持配置消息：

```ts
@IsEmail({}, { message: '邮箱格式不正确' })
email!: string

@Length(8, 64, { message: '密码长度必须为 8 到 64 个字符' })
password!: string
```

如果项目要求统一错误结构，可以通过 `exceptionFactory` 生成自定义异常：

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors) =>
    new BadRequestException({
      success: false,
      message: '参数校验失败',
      errors,
    }),
})
```

生产项目中通常还会把嵌套的 `ValidationError` 转成稳定的字段错误列表，避免直接暴露复杂的内部对象。

## 九、常见误区

### 1. DTO 使用 interface

```ts
interface CreateUserDto {
  username: string
}
```

接口在运行时不存在，无法承载装饰器元数据。请求 DTO 应使用 `class`。

### 2. 只安装 class-validator，没有注册 ValidationPipe

装饰器只是规则声明，Pipe 才是执行入口。没有 Pipe，非法数据仍会进入 Controller。

### 3. 认为 @IsOptional() 允许任意值

`@IsOptional()` 只是在字段缺失时跳过校验。字段一旦存在，仍必须满足后续规则。

### 4. 把数据库查询写进 DTO 装饰器

唯一性、权限、状态流转等属于业务规则。把它们全部塞入异步自定义 Validator 会让依赖注入、事务和错误处理变复杂，应优先由 Service 协调。

### 5. 直接相信 transform 的隐式转换

客户端传入 `"false"` 时，隐式布尔转换很容易产生违背直觉的结果。重要字段建议要求客户端提交正确 JSON 类型，或编写显式转换规则并配套测试。

## 十、推荐实践

- 全局开启 `whitelist`，对外接口同时开启 `forbidNonWhitelisted`。
- DTO 只负责传输结构和基础格式，业务校验交给 Service。
- 创建、更新、查询分别使用职责明确的 DTO。
- 路径参数使用 `ParseIntPipe`、`ParseUUIDPipe` 等显式 Pipe。
- 为非法邮箱、缺少字段、类型错误和额外字段编写端到端测试。
- 不在 DTO 中接收 `id`、`role`、`createdAt` 等应由服务端控制的字段。

## 小结

`class-validator` 的价值不只是减少 `if` 判断，而是建立清晰的输入边界：DTO 声明规则，`ValidationPipe` 统一执行，Controller 接收可信结构，Service 专注业务逻辑。配合白名单、禁止额外属性和内置参数 Pipe，可以在请求进入核心业务之前拦截大部分格式错误和越权字段。
