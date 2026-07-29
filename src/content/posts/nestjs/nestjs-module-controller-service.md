---
pubDatetime: 2026-03-02T15:22:00Z
title: NestJS 中 Module、Controller 和 Service 的直接关系
slug: nestjs-module-controller-service
tags:
  - Node.js
  - NestJS
description: "NestJS 项目通常从 `Module`、`Controller` 和 `Service` 三类文件开始。本文以 NestJS 默认生成的 `AppModule`、`AppController` 和 `AppService` 为例，说明三者的职责边界、依赖关系和一次 HTTP 请求在它们之间的流转过程。"
---


NestJS 项目通常从 `Module`、`Controller` 和 `Service` 三类文件开始。很多初学者能照着模板写出代码，但不一定清楚它们之间到底谁管理谁、谁调用谁，以及为什么 Controller 中可以直接使用 Service 而不需要手动 `new`。

本文以 NestJS 默认生成的 `AppModule`、`AppController` 和 `AppService` 为例，说明三者的职责边界、依赖关系和一次 HTTP 请求在它们之间的流转过程。

## 一、三者分别负责什么

可以先把三者理解成一条清晰的调用链：

```text
HTTP request
  -> Controller
  -> Service
  -> return response
```

而 `Module` 负责把这条调用链组织起来：

```text
Module
  -> 注册 Controller
  -> 注册 Service
  -> 声明当前模块依赖哪些其他模块
  -> 声明哪些 Provider 可以被其他模块复用
```

它们的职责可以概括为：

- `Module`：应用结构的组织单元，负责声明模块内有哪些控制器、服务和外部依赖。
- `Controller`：处理 HTTP 请求，定义路由入口，接收参数，并把具体业务逻辑交给 Service。
- `Service`：承载业务逻辑，例如查询数据、计算结果、调用 Repository 或其他服务。

Controller 不应该堆复杂业务逻辑，Service 也不应该直接关心 HTTP 路由。把职责拆开后，代码更容易测试、复用和维护。

## 二、Module：组织代码和管理依赖

`app.module.ts` 是应用的根模块，常见写法如下：

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

`@Module()` 装饰器用来告诉 NestJS：当前类是一个模块。装饰器中的几个配置项含义如下：

- `imports`：导入其他模块。如果当前模块需要使用其他模块导出的服务，就需要在这里导入对应模块。
- `controllers`：注册当前模块的控制器。控制器负责暴露 HTTP 路由。
- `providers`：注册当前模块的服务提供者。Service、Repository、Factory 等都可以作为 Provider 注册。
- `exports`：导出当前模块中的 Provider，供其他模块导入后使用。

在上面的例子中，`AppModule` 注册了 `AppController` 和 `AppService`。NestJS 启动时会读取模块元数据，并通过依赖注入容器创建和管理这些类的实例。

如果一个模块中的服务需要被其他模块使用，需要显式导出：

```ts
@Module({
  providers: [AppService],
  exports: [AppService],
})
export class AppModule {}
```

其他模块再通过 `imports` 引入这个模块，才能注入它导出的服务。

## 三、Controller：定义 HTTP 请求入口

`app.controller.ts` 负责接收请求：

```ts
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
```

`@Controller()` 用来声明控制器。它可以接收一个路由前缀：

```ts
@Controller('users')
export class UserController {}
```

上面表示这个控制器下的接口统一以 `/users` 开头。

`@Get()` 是 HTTP 请求方法装饰器，表示被修饰的方法会处理 `GET` 请求：

```ts
@Get()
getHello(): string {
  return this.appService.getHello();
}
```

如果 `@Controller()` 和 `@Get()` 都没有设置路径，那么这个方法会处理根路径的 `GET /` 请求。

Controller 的核心职责是：

- 定义路由，例如 `GET /users`、`POST /users`。
- 接收请求参数，例如 path、query、body。
- 调用 Service 完成业务处理。
- 返回响应结果。

它不应该承担大量业务判断。比如用户注册时检查邮箱是否重复、密码如何加密、数据如何保存，这些都更适合放在 Service 中。

## 四、Service：处理业务逻辑

`app.service.ts` 是具体业务逻辑所在的位置：

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
```

`@Injectable()` 表示这个类可以被 NestJS 依赖注入系统管理。它本身不会自动生效，还需要在模块的 `providers` 中注册：

```ts
@Module({
  providers: [AppService],
})
export class AppModule {}
```

注册之后，NestJS 会负责实例化 `AppService`，并在其他类声明依赖时自动注入：

```ts
constructor(private readonly appService: AppService) {}
```

因此在 Controller 中不需要这样写：

```ts
const appService = new AppService();
```

手动 `new` 会绕过 NestJS 的依赖注入容器。随着 Service 自己也依赖数据库、配置服务或其他 Provider，手动实例化会让依赖管理变得混乱。

## 五、一次请求如何流转

以上面代码为例，请求 `GET /` 时，执行过程可以理解为：

```text
1. 客户端发送 GET /
2. NestJS 根据路由匹配到 AppController.getHello()
3. AppController 调用 this.appService.getHello()
4. AppService 返回 'Hello World!'
5. AppController 将结果交给 NestJS
6. NestJS 把结果转换为 HTTP 响应返回给客户端
```

对应代码关系如下：

```text
AppModule
  controllers: [AppController]
  providers: [AppService]

AppController
  constructor(appService: AppService)
  getHello() -> appService.getHello()

AppService
  getHello() -> 'Hello World!'
```

这里最关键的一点是：`AppController` 依赖 `AppService`，但它不负责创建 `AppService`。`AppService` 的创建和生命周期由 NestJS 注入器负责。

## 六、imports 和 exports 如何支持模块共享

真实项目通常会按业务拆分模块，例如 `UserModule`、`AuthModule`、`PostsModule`。模块之间共享服务时，需要通过 `exports` 和 `imports` 建立关系。

例如 `UserModule` 提供 `UserService`：

```ts
@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

`AuthModule` 如果需要使用 `UserService`，就导入 `UserModule`：

```ts
@Module({
  imports: [UserModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
```

然后在 `AuthService` 中注入：

```ts
@Injectable()
export class AuthService {
  constructor(private readonly userService: UserService) {}
}
```

这说明：

- `providers` 只表示 Provider 在当前模块内注册。
- `exports` 表示哪些 Provider 允许被其他模块使用。
- `imports` 表示当前模块引入其他模块导出的能力。

如果只在 `UserModule` 的 `providers` 中注册了 `UserService`，但没有 `exports`，其他模块即使导入 `UserModule`，也不能直接注入 `UserService`。

## 七、常见误区

### 1. Controller 里直接写业务逻辑

Controller 可以做请求参数接收和简单转换，但复杂逻辑应该交给 Service。例如下面这种写法不推荐：

```ts
@Post()
async create(@Body() dto: CreateUserDto) {
  const exists = await this.userRepository.existsBy({ email: dto.email });

  if (exists) {
    throw new ConflictException('email already exists');
  }

  return this.userRepository.save(dto);
}
```

更合理的方式是让 Controller 调用 Service：

```ts
@Post()
create(@Body() dto: CreateUserDto) {
  return this.userService.create(dto);
}
```

业务判断放在 `UserService.create()` 中，Controller 保持轻量。

### 2. 忘记在 providers 中注册 Service

只有加了 `@Injectable()` 还不够。Provider 必须被模块注册，NestJS 才知道如何创建它：

```ts
@Module({
  providers: [UserService],
})
export class UserModule {}
```

否则在注入时会出现依赖无法解析的错误。

### 3. 误以为 imports 可以直接导入 Service

`imports` 导入的是模块，不是普通 Service：

```ts
@Module({
  imports: [UserModule],
})
export class AuthModule {}
```

如果想跨模块使用某个 Service，应该由它所在模块 `exports` 出去，再由使用方模块 `imports` 对应模块。

## 八、总结

NestJS 中 `Module`、`Controller` 和 `Service` 的关系可以用一句话概括：

```text
Module 负责组织和注册，Controller 负责接收请求，Service 负责处理业务。
```

更具体地说：

- `Module` 是依赖和结构边界。
- `Controller` 是 HTTP 入口。
- `Service` 是业务逻辑入口。
- `providers` 注册服务，供当前模块内部注入使用。
- `exports` 暴露服务，供其他模块导入后使用。
- `imports` 引入其他模块导出的能力。

理解这套关系后，再学习依赖注入、管道、守卫、拦截器、Repository 分层时，会更容易判断代码应该放在哪一层。
