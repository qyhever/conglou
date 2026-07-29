---
pubDatetime: 2026-03-03T15:22:00Z
title: NestJS 优雅实现环境变量配置与校验
slug: nestjs-env-config
tags:
  - Node.js
  - NestJS
description: "在 NestJS 中基于 @nestjs/config 和 joi 实现优雅的环境变量配置与校验。"
---

在 NestJS 项目开发中，环境变量管理是项目规范化、可维护性、安全性的基础能力。混乱的配置、无校验的环境变量、多环境配置冲突，极易导致项目启动报错、线上环境异常、密钥泄露等问题。

本文将带来一套**企业级可直接复用的 NestJS 环境变量配置方案**，基于 `@nestjs/config` \+ `joi` 实现：多环境配置隔离、启动强制校验、完善类型推导、全局配置注入，支持快速迁移到任意 NestJS 项目。

## 一、方案核心优势

- **类型安全**：通过 TS 接口约束环境变量类型，配合 Joi 运行时双重校验

- **多环境隔离**：支持开发/测试/生产多环境配置文件，本地私有配置隔离

- **错误友好**：项目启动一次性输出所有配置错误，排查问题高效

- **全局复用**：配置模块全局注册，无需重复导入

- **高可拓展**：支持自定义变量、变量嵌套引用、兼容未知环境变量

- **安全规范**：区分私有配置与公共配置，规避密钥提交风险

## 二、安装核心依赖

安装 NestJS 配置核心模块与 Joi 校验工具：

```bash
pnpm add @nestjs/config joi
```

依赖说明：

- `@nestjs/config`：NestJS 官方配置模块，负责加载 env 文件、解析环境变量、提供全局配置服务

- `joi`：强大的表单与数据校验库，用于定义环境变量校验规则，启动时拦截非法/缺失配置

## 三、定义环境变量类型与校验规则

在项目 `src/config/` 目录下新建 `environment.validation.ts`，统一管理所有环境变量的**TS 类型定义**和**运行时校验规则**，实现类型与运行时双重约束。

```typescript
import * as Joi from 'joi'

// 环境枚举类型
export type NodeEnvironment = 'development' | 'test' | 'production'
// 数据库类型枚举
export type DatabaseType = 'mysql' | 'postgres'
// JWT 过期时间通用类型（支持 ms/s/m/h/d/w/y 单位）
export type JwtExpiration = `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`

/**
 * 环境变量 TS 类型接口
 * 为 ConfigService 提供全局类型推导
 */
export interface EnvironmentVariables {
  // 运行环境
  NODE_ENV: NodeEnvironment
  // 服务端口
  PORT: number

  // 数据库配置
  DB_TYPE: DatabaseType
  DB_DATABASE: string
  DB_HOST: string
  DB_PORT: number
  DB_USERNAME: string
  DB_PASSWORD: string
  DB_SYNC: boolean

  // JWT 鉴权配置
  JWT_SECRET: string
  JWT_ACCESS_EXPIRE: JwtExpiration
  JWT_REFRESH_EXPIRE: JwtExpiration
  JWT_ISSUER: string

  // 密码加密配置
  BCRYPT_ROUNDS: number

  // 日志文件配置
  LOG_FILE_ENABLED: boolean
  LOG_DIRNAME: string
  LOG_FILENAME: string
  LOG_DATE_PATTERN: string
  LOG_MAX_SIZE: string
  LOG_MAX_FILES: string
}

/**
 * 环境变量运行时校验规则
 * 项目启动时自动校验，不通过则直接终止启动
 */
export const environmentValidationSchema = Joi.object<EnvironmentVariables>({
  // 基础环境配置
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(8300),

  // 数据库配置（必填项，无默认值）
  DB_TYPE: Joi.string().valid('mysql', 'postgres').default('mysql'),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_PASSWORD: Joi.string().min(1).required(),
  DB_SYNC: Joi.boolean().default(false),

  // JWT 配置（必填项）
  JWT_SECRET: Joi.string().min(1).required(),
  JWT_ACCESS_EXPIRE: Joi.string()
    .pattern(/^\d+(ms|s|m|h|d|w|y)$/)
    .required(),
  JWT_REFRESH_EXPIRE: Joi.string()
    .pattern(/^\d+(ms|s|m|h|d|w|y)$/)
    .required(),
  JWT_ISSUER: Joi.string().min(1).required(),

  // 密码加密迭代次数
  BCRYPT_ROUNDS: Joi.number().integer().min(10).max(15).default(10),

  // 日志配置（必填项）
  LOG_FILE_ENABLED: Joi.boolean().default(false),
  LOG_DIRNAME: Joi.string().min(1).required(),
  LOG_FILENAME: Joi.string().min(1).required(),
  LOG_DATE_PATTERN: Joi.string().min(1).required(),
  LOG_MAX_SIZE: Joi.string().min(1).required(),
  LOG_MAX_FILES: Joi.string().min(1).required(),
})
```

核心配置说明：

- `required()`：标记为必填变量，缺失则项目启动报错

- `default()`：变量未配置时使用默认值，可选变量专用

- `valid()`：限制变量枚举值，避免非法环境、数据库类型

- `pattern()`：正则匹配格式，保证 JWT 过期时间格式统一

## 四、封装全局配置模块

新建全局配置模块 `src/config/config.module.ts`，统一封装配置加载规则，实现全局可访问、缓存优化、多文件加载优先级配置。

```typescript
import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { environmentValidationSchema } from './environment.validation'

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      // 全局注册，所有模块可直接使用 ConfigService
      isGlobal: true,
      // 缓存环境变量，避免重复解析文件
      cache: true,
      // 支持 env 变量嵌套引用（如 LOG_PATH=${LOG_DIRNAME}/app.log）
      expandVariables: true,
      // 多环境文件加载优先级
      envFilePath: [
        '.env.local',
        `.env.${process.env.NODE_ENV ?? 'development'}`,
        '.env',
      ],
      // 绑定校验规则
      validationSchema: environmentValidationSchema,
      validationOptions: {
        // 一次性输出所有校验错误，不中断校验
        abortEarly: false,
        // 允许存在未定义的额外环境变量
        allowUnknown: true,
      },
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}

```

关键参数详解：

- **isGlobal**：开启全局模块，无需在业务模块重复导入

- **cache**：缓存解析结果，提升项目启动与运行性能

- **expandVariables**：支持环境变量相互引用，提升配置灵活性

- **abortEarly**：关闭提前终止校验，方便一次性排查所有配置问题

## 五、根模块接入配置

在项目根模块中引入自定义配置模块，全局生效。修改 `src/app.module.ts`：

```typescript
import { Module } from '@nestjs/common'
import { AppConfigModule } from './config/config.module'

@Module({
  // 保留原有业务模块，新增配置模块即可
  imports: [AppConfigModule],
})
export class AppModule {}

```

## 六、多环境配置文件规范

### 6\.1 配置文件层级

推荐项目统一配置文件规范，区分公共配置、环境配置、本地私有配置：

```Plain Text
.env.local        # 本地私有配置（最高优先级，不提交 Git）
.env.development  # 开发环境配置
.env.test         # 测试环境配置
.env.production   # 生产环境配置
.env              # 全局通用兜底配置（最低优先级）

```

### 6\.2 加载优先级规则

加载顺序：`.env.local > .env.[NODE_ENV] > .env`，**先加载的文件优先级更高**，会覆盖后加载的同名配置。

### 6\.3 开发环境配置示例

新建 `.env.development` 开发环境配置文件，补齐所有必填变量：

```dotenv
# 基础环境
NODE_ENV=development
PORT=3000

# 数据库配置
DB_TYPE=mysql
DB_DATABASE=app
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=password
DB_SYNC=false

# JWT 鉴权配置
JWT_SECRET=dev-secret-key-2026
JWT_ACCESS_EXPIRE=15m
JWT_REFRESH_EXPIRE=7d
JWT_ISSUER=nest-app

# 密码加密
BCRYPT_ROUNDS=10

# 日志配置
LOG_FILE_ENABLED=false
LOG_DIRNAME=logs
LOG_FILENAME=app-%DATE%.log
LOG_DATE_PATTERN=YYYY-MM-DD
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d

```

> **注意**：Schema 中标记为 `required()` 的变量必须在环境文件中配置，否则项目启动直接报错，可有效避免线上配置缺失问题。
> 
> 

## 七、业务代码读取环境变量

通过 `ConfigService` 读取配置，结合 TS 类型推导，实现全类型提示、类型校验。

```typescript
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvironmentVariables } from './config/environment.validation'

@Injectable()
export class AppService {
  // 绑定全局类型，实现完整类型推导
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  getEnvConfig() {
    // infer: true 自动推断变量类型
    const port = this.configService.get('PORT', { infer: true })
    const jwtExpire = this.configService.get('JWT_ACCESS_EXPIRE', { infer: true })
    const dbHost = this.configService.get('DB_HOST', { infer: true })

    console.log('服务端口：', port)
    console.log('JWT过期时间：', jwtExpire)
    console.log('数据库地址：', dbHost)

    return { port, jwtExpire, dbHost }
  }
}
```

## 八、添加测试接口验证配置

新增测试接口，验证配置加载、读取是否正常。修改 `app.controller.ts`：

```typescript
import { Controller, Get } from '@nestjs/common'
import { AppService } from './app.service'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('test-config')
  testConfig() {
    return this.appService.getEnvConfig()
  }
}

```

启动项目后访问接口：

```bash
curl http://localhost:3000/test-config
```

控制台打印对应配置信息即代表配置接入成功。

## 九、多环境启动命令

通过 `NODE_ENV` 指定运行环境，自动加载对应环境配置文件：

```bash
# 开发环境启动
NODE_ENV=development pnpm start

# 测试环境启动
NODE_ENV=test pnpm start

# 生产环境启动
NODE_ENV=production pnpm start:prod

```

未指定 `NODE_ENV` 时，默认加载 `.env.development` 配置。

## 十、跨项目快速迁移最小步骤

该方案可无缝迁移至任意 NestJS 新项目，仅需 6 步：

1. 安装依赖：`pnpm add @nestjs/config joi`

2. 复制 `src/config/environment.validation.ts` 类型与校验文件

3. 复制 `src/config/config.module.ts` 全局配置模块

4. 在根模块 `app.module.ts` 导入 `AppConfigModule`

5. 根据项目业务需求，增删改环境变量类型与校验规则

6. 创建对应多环境 env 配置文件，补齐必填变量

## 十一、最佳实践与注意事项

- **安全规范**：`.env.local`、密钥、数据库密码、JWT 密钥严禁提交 Git，需加入 `.gitignore`

- **类型同步**：新增环境变量时，必须同时更新 `EnvironmentVariables` 接口和 Joi 校验规则，保证类型与运行时一致

- **环境隔离**：公共通用配置放 `.env`，环境独有配置放对应环境文件，本地个性化覆盖放 `.env.local`

- **生产优化**：生产环境不依赖本地 `.env.production` 文件，优先使用服务器/部署平台环境变量注入

- **必填校验**：核心业务配置（数据库、密钥、权限）务必设置 `required()`，避免线上配置缺失
