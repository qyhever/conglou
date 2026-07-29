---
pubDatetime: 2026-03-01T15:22:00Z
title: Nest CLI 常用命令速查
slug: nestjs-cli-common-commands
tags:
  - Node.js
  - NestJS
description: "Nest CLI 是 NestJS 官方提供的命令行工具，用来创建项目、生成模块文件、启动开发服务和维护项目结构。对于刚开始学习 NestJS 的项目来说，熟悉 CLI 命令可以减少手动创建文件时的路径错误，也能让 `Module`、`Controller`、`Service` 的组织方式更统一。"
---


Nest CLI 是 NestJS 官方提供的命令行工具，用来创建项目、生成模块文件、启动开发服务和维护项目结构。对于刚开始学习 NestJS 的项目来说，熟悉 CLI 命令可以减少手动创建文件时的路径错误，也能让 `Module`、`Controller`、`Service` 的组织方式更统一。

本文整理 Nest CLI 在日常开发中最常用的命令，重点覆盖项目初始化、单个文件生成、REST API 资源模块生成，以及使用时容易踩坑的地方。

## 一、安装 Nest CLI

全局安装 Nest CLI：

```bash
npm install -g @nestjs/cli
```

命令说明：

- `npm install -g`：表示全局安装 npm 包，安装后可以在任意目录使用对应命令。
- `@nestjs/cli`：NestJS 官方 CLI 工具包。

安装完成后，可以检查版本：

```bash
nest --version
```

如果终端能输出版本号，说明 `nest` 命令已经可以正常使用。

## 二、创建 NestJS 项目

使用 `nest new` 创建一个新项目：

```bash
nest new my-nest-project
```

命令执行后，CLI 会让你选择包管理器，例如 npm、yarn 或 pnpm。选择完成后，Nest CLI 会自动生成基础项目结构并安装依赖。

常见生成结构如下：

```text
my-nest-project
  src
    app.controller.ts
    app.module.ts
    app.service.ts
    main.ts
  package.json
  tsconfig.json
```

其中：

- `main.ts`：应用启动入口。
- `app.module.ts`：根模块，负责组织应用的依赖关系。
- `app.controller.ts`：默认控制器，负责处理 HTTP 请求。
- `app.service.ts`：默认服务，负责处理业务逻辑。

进入项目目录后，可以启动开发服务：

```bash
cd my-nest-project
npm run start:dev
```

## 三、文件生成命令格式

Nest CLI 的文件生成命令格式如下：

```bash
nest g [文件类型] [文件名] [文件目录]
```

也可以写完整形式：

```bash
nest generate [文件类型] [文件名] [文件目录]
```

参数说明：

- `g`：`generate` 的缩写，表示生成文件。
- `[文件类型]`：要生成的文件类型，例如 `module`、`controller`、`service`。
- `[文件名]`：生成文件的业务名称，例如 `posts`、`users`、`auth`。
- `[文件目录]`：可选参数，用来指定文件生成目录。

例如：

```bash
nest g module posts
```

上面的命令会生成 `posts` 模块文件，通常路径为：

```text
src/posts/posts.module.ts
```

## 四、生成 Module、Controller 和 Service

开发一个普通业务模块时，最常见的是分别生成 `Module`、`Controller` 和 `Service`。

### 1. 生成 Module

```bash
nest g module posts
```

简写形式：

```bash
nest g mo posts
```

作用：

- 创建 `posts.module.ts`。
- 自动把 `PostsModule` 注册到上级模块中，通常是 `AppModule`。

建议先创建 `Module`，再创建同名业务下的 `Controller` 和 `Service`。这样后续生成的控制器和服务更容易被 CLI 自动挂载到对应模块中。

### 2. 生成 Controller

```bash
nest g controller posts
```

简写形式：

```bash
nest g co posts
```

作用：

- 创建 `posts.controller.ts`。
- 默认创建对应测试文件 `posts.controller.spec.ts`。
- 自动把 `PostsController` 注册到 `PostsModule` 的 `controllers` 中。

如果不想生成测试文件，可以加上 `--no-spec`：

```bash
nest g co posts --no-spec
```

### 3. 生成 Service

```bash
nest g service posts
```

简写形式：

```bash
nest g s posts
```

作用：

- 创建 `posts.service.ts`。
- 默认创建对应测试文件 `posts.service.spec.ts`。
- 自动把 `PostsService` 注册到 `PostsModule` 的 `providers` 中。

如果不想生成测试文件，也可以使用：

```bash
nest g s posts --no-spec
```

## 五、推荐生成顺序

普通业务模块推荐按下面顺序生成：

```bash
nest g mo posts
nest g co posts
nest g s posts
```

原因是 NestJS 项目以 `Module` 作为组织单元。先生成 `Module` 后，CLI 能更准确地把 `Controller` 和 `Service` 注册到对应业务模块中。

生成后的模块关系通常类似：

```ts
import { Module } from '@nestjs/common'
import { PostsController } from './posts.controller'
import { PostsService } from './posts.service'

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
```

如果先生成 `Controller` 或 `Service`，CLI 可能会把它们注册到 `AppModule` 中，后续还需要手动调整模块归属。

## 六、快速生成 REST API 资源模块

如果希望一次性生成一个基础 CRUD 模块，可以使用 `resource` 命令：

```bash
nest g resource user
```

注意：命令是 `resource`，不是 `resouce`。

执行后，CLI 会进入交互式流程，通常会询问：

- 使用哪种传输层，例如 REST API、GraphQL、Microservice 或 WebSockets。
- 是否生成 CRUD 入口代码。

如果选择 REST API 并生成 CRUD，CLI 会自动创建类似下面的文件：

```text
src/user
  dto
    create-user.dto.ts
    update-user.dto.ts
  entities
    user.entity.ts
  user.controller.ts
  user.controller.spec.ts
  user.module.ts
  user.service.ts
  user.service.spec.ts
```

生成的 `Controller` 中会包含基础 CRUD 路由，例如：

```text
POST /user
GET /user
GET /user/:id
PATCH /user/:id
DELETE /user/:id
```

`resource` 命令适合快速搭建模块骨架，但生成的 CRUD 代码只是基础模板。真实业务中通常还需要继续补充参数校验、数据库操作、异常处理、权限控制和响应格式处理。

## 七、常用生成类型速查

| 生成目标 | 完整命令 | 常用简写 | 说明 |
| --- | --- | --- | --- |
| Module | `nest g module posts` | `nest g mo posts` | 生成业务模块 |
| Controller | `nest g controller posts` | `nest g co posts` | 生成控制器 |
| Service | `nest g service posts` | `nest g s posts` | 生成服务 |
| Resource | `nest g resource user` | 无常用简写 | 生成完整资源模块 |
| Guard | `nest g guard auth` | `nest g gu auth` | 生成路由守卫 |
| Interceptor | `nest g interceptor transform` | `nest g in transform` | 生成拦截器 |
| Pipe | `nest g pipe validation` | `nest g pi validation` | 生成管道 |
| Filter | `nest g filter http-exception` | `nest g f http-exception` | 生成异常过滤器 |
| Middleware | `nest g middleware logger` | `nest g mi logger` | 生成中间件 |

## 八、常用参数

### 1. 不生成测试文件

```bash
nest g co posts --no-spec
nest g s posts --no-spec
```

`--no-spec` 用来跳过 `.spec.ts` 测试文件生成。学习阶段或快速验证功能时可以使用，但正式项目中建议保留关键业务的测试文件。

### 2. 指定生成目录

```bash
nest g co modules/posts
nest g s modules/posts
```

这类命令会把文件生成到 `src/modules/posts` 目录下，适合项目采用 `src/modules` 统一管理业务模块的结构。

### 3. 预览命令结果

```bash
nest g resource user --dry-run
```

`--dry-run` 表示只预览将要创建或修改的文件，不真正写入项目。对不熟悉的生成命令，可以先用这个参数确认影响范围。

## 九、实践建议

- 新业务模块优先使用 `nest g mo` 创建模块，再生成 `Controller` 和 `Service`。
- 简单 CRUD 原型可以使用 `nest g resource` 快速生成，再根据业务逐步改造。
- 对正式项目，建议保留关键业务的 `.spec.ts` 测试文件，不要无差别使用 `--no-spec`。
- 生成文件后要检查对应模块的 `controllers` 和 `providers` 是否注册正确。
- CLI 负责生成结构，不负责业务设计。数据库实体、DTO 校验、权限控制和异常处理仍然需要根据项目规范手动完善。

## 十、常用命令汇总

```bash
# 安装 Nest CLI
npm install -g @nestjs/cli

# 创建新项目
nest new my-nest-project

# 启动开发服务
npm run start:dev

# 生成 posts 模块
nest g mo posts

# 生成 posts 控制器
nest g co posts

# 生成 posts 服务
nest g s posts

# 快速生成 user REST API 资源模块
nest g resource user

# 不生成测试文件
nest g co posts --no-spec

# 预览生成结果，不写入文件
nest g resource user --dry-run
```
