---
pubDatetime: 2026-03-05T15:22:00Z
title: NestJS 接入 MySQL 数据库
slug: nestjs-database-typeorm
tags:
  - Node.js
  - NestJS
description: "本文以 NestJS、TypeORM 和 MySQL 为例，演示如何完成一套基础数据库接入，并通过 `User` 模块实现一个简单的用户列表查询接口。"
---


在后端应用中，数据库接入通常不是简单地写一个连接字符串。更合理的做法是把数据库配置、实体定义、Repository 封装和业务调用链拆开，让项目在后续扩展时更容易维护。

本文以 NestJS、TypeORM 和 MySQL 为例，演示如何完成一套基础数据库接入，并通过 `User` 模块实现一个简单的用户列表查询接口。

## 技术选型

本文使用的核心依赖如下：

- `@nestjs/typeorm`：NestJS 官方 TypeORM 集成模块。
- `typeorm`：ORM 框架，用于实体映射、Repository 查询和连接管理。
- `mysql2`：MySQL 驱动，TypeORM 连接 MySQL 时需要使用。
- `@nestjs/config`：用于读取 `.env` 配置。
- `joi`：用于校验环境变量，避免应用启动后才暴露配置问题。

最终实现的调用链如下：

```text
HTTP request
  -> UserController
  -> UserService
  -> UserRepository
  -> TypeOrmUserRepository
  -> Repository<User>
  -> MySQL
```

## 1. 安装依赖

先安装 TypeORM 相关依赖：

```bash
pnpm add @nestjs/typeorm typeorm mysql2
```

如果项目还没有接入配置模块，也需要安装：

```bash
pnpm add @nestjs/config joi
```

命令说明：

- `@nestjs/typeorm` 负责把 TypeORM 接入 NestJS 依赖注入体系。
- `typeorm` 负责实体映射、查询构造和数据库连接管理。
- `mysql2` 是连接 MySQL 的底层驱动。
- `@nestjs/config` 负责加载 `.env` 文件。
- `joi` 负责在应用启动阶段校验配置。

## 2. 准备环境变量

数据库连接信息建议放在 `.env.development` 或 `.env.local` 中：

```dotenv
NODE_ENV=development
PORT=3000

DB_TYPE=mysql
DB_DATABASE=ne_app
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=password
DB_SYNC=false
```

其中：

- `DB_TYPE`：数据库类型，这里使用 `mysql`。
- `DB_DATABASE`：数据库名。
- `DB_HOST`：数据库地址。
- `DB_PORT`：数据库端口，MySQL 默认是 `3306`。
- `DB_USERNAME`：数据库用户名。
- `DB_PASSWORD`：数据库密码。
- `DB_SYNC`：是否让 TypeORM 根据实体自动同步表结构。

`DB_SYNC` 建议默认设置为 `false`。自动同步表结构虽然方便，但可能在生产环境造成不可预期的表结构变更。更稳妥的方式是使用 SQL 脚本或 migrations 管理数据库结构。

## 3. 定义环境变量类型与校验规则

可以创建 `src/config/environment.validation.ts`，集中维护环境变量类型和校验规则：

```ts
import * as Joi from 'joi'

export type NodeEnvironment = 'development' | 'test' | 'production'
export type DatabaseType = 'mysql' | 'postgres'

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment
  PORT: number
  DB_TYPE: DatabaseType
  DB_DATABASE: string
  DB_HOST: string
  DB_PORT: number
  DB_USERNAME: string
  DB_PASSWORD: string
  DB_SYNC: boolean
}

export const environmentValidationSchema = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_TYPE: Joi.string().valid('mysql', 'postgres').default('mysql'),
  DB_DATABASE: Joi.string().min(1).required(),
  DB_HOST: Joi.string().hostname().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_PASSWORD: Joi.string().min(1).required(),
  DB_SYNC: Joi.boolean().default(false),
})
```

这里有 2 个目的：

- 给 `ConfigService` 提供类型提示，减少配置项写错的概率。
- 应用启动时提前校验配置，避免数据库连接阶段才发现变量缺失。

## 4. 创建全局配置模块

创建 `src/config/config.module.ts`：

```ts
import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { environmentValidationSchema } from './environment.validation'

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: [
        '.env.local',
        `.env.${process.env.NODE_ENV ?? 'development'}`,
        '.env',
      ],
      validationSchema: environmentValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
```

关键配置说明：

- `isGlobal: true`：让 `ConfigModule` 在全局可用。
- `cache: true`：缓存环境变量读取结果。
- `expandVariables: true`：支持环境变量互相引用。
- `envFilePath`：按优先级加载多个 env 文件。
- `abortEarly: false`：一次性输出所有配置错误。
- `allowUnknown: true`：允许存在未声明在 schema 中的环境变量。

## 5. 创建 DatabaseModule

数据库连接建议单独放到一个模块中，例如 `src/database/database.module.ts`：

```ts
import { Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { AppConfigModule } from '../config/config.module'
import type { EnvironmentVariables } from '../config/environment.validation'

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ): TypeOrmModuleOptions => {
        const type = configService.get('DB_TYPE', { infer: true })
        const host = configService.get('DB_HOST', { infer: true })
        const port = configService.get('DB_PORT', { infer: true })
        const username = configService.get('DB_USERNAME', { infer: true })
        const password = configService.get('DB_PASSWORD', { infer: true })
        const database = configService.get('DB_DATABASE', { infer: true })
        const synchronize = configService.get('DB_SYNC', { infer: true })
        const environment = configService.get('NODE_ENV', { infer: true })

        return {
          type,
          host,
          port,
          username,
          password,
          database,
          synchronize,
          autoLoadEntities: true,
          retryAttempts: 3,
          retryDelay: 3000,
          verboseRetryLog: true,
          logging: environment === 'development',
        }
      },
      dataSourceFactory: async (options) => {
        if (!options) {
          throw new Error('TypeORM 数据库配置不存在')
        }

        const dataSource = new DataSource(options)

        try {
          await dataSource.initialize()
          Logger.log('数据库连接成功', 'TypeORM')
          return dataSource
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const stack = error instanceof Error ? error.stack : undefined

          Logger.error(`数据库连接失败：${message}`, stack, 'TypeORM')
          throw error
        }
      },
    }),
  ],
})
export class DatabaseModule {}
```

这段代码有几个值得注意的点：

- `forRootAsync`：通过 `ConfigService` 异步读取数据库配置，避免硬编码。
- `autoLoadEntities: true`：自动加载通过 `TypeOrmModule.forFeature()` 注册的实体。
- `retryAttempts` 和 `retryDelay`：数据库暂时不可用时自动重试连接。
- `logging`：只在开发环境打印 SQL 日志。
- `dataSourceFactory`：自定义 `DataSource` 初始化流程，方便统一记录连接成功或失败日志。

## 6. 在 AppModule 中注册数据库模块

在根模块中导入配置模块、数据库模块和业务模块：

```ts
import { Module } from '@nestjs/common'
import { AppConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { UserModule } from './user/user.module'

@Module({
  imports: [AppConfigModule, DatabaseModule, UserModule],
})
export class AppModule {}
```

应用启动时，NestJS 会初始化 `DatabaseModule`，并完成 TypeORM 数据库连接。

## 7. 定义通用实体基类

大多数业务表都会有主键、创建时间、更新时间和软删除时间。可以抽出一个基础实体类：

```ts
import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export abstract class BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', comment: 'Unique identifier' })
  id!: number

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamp', nullable: true, comment: '删除时间' })
  deletedAt!: Date | null
}
```

字段说明：

- `id`：自增主键。
- `createdAt`：创建时间，由数据库自动维护。
- `updatedAt`：更新时间，更新记录时自动刷新。
- `deletedAt`：软删除时间，配合 TypeORM 软删除能力使用。

## 8. 定义 User 实体

创建 `src/user/entities/user.entity.ts`：

```ts
import { Column, Entity, Index } from 'typeorm'
import { BaseEntity } from '../../common/entities/base.entity'

@Entity({ name: 'user' })
@Index('uk_user_username', ['username'], { unique: true })
@Index('uk_user_email', ['email'], { unique: true })
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  username!: string

  @Column({ type: 'varchar', length: 50 })
  nickname!: string

  @Column({
    type: 'varchar',
    length: 255,
    comment: 'Hashed password',
    select: false,
  })
  password!: string

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '头像URL' })
  avatar!: string | null

  @Column({ type: 'boolean', default: true, comment: '启用/禁用' })
  isEnabled!: boolean

  @Column({ type: 'boolean', default: false, comment: '系统默认' })
  isSystemDefault!: boolean

  @Column({ type: 'varchar', length: 255 })
  email!: string
}
```

这里包含了几个常见写法：

- `@Entity({ name: 'user' })`：将实体映射到 `user` 表。
- `@Index(..., { unique: true })`：为 `username` 和 `email` 添加唯一索引。
- `select: false`：默认查询时不返回 `password` 字段，降低敏感信息泄露风险。
- `extends BaseEntity`：复用主键、时间和软删除字段。

## 9. 注册 UserModule

创建 `src/user/user.module.ts`：

```ts
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserService } from './user.service'
import { UserController } from './user.controller'
import { TypeOrmUserRepository } from './repositories/typeorm-user.repository'
import { UserRepository } from './repositories/user.repository'
import { User } from './entities/user.entity'

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [
    UserService,
    {
      provide: UserRepository,
      useClass: TypeOrmUserRepository,
    },
  ],
})
export class UserModule {}
```

`TypeOrmModule.forFeature([User])` 会在 `UserModule` 作用域内注册 `Repository<User>`。由于数据库配置中启用了 `autoLoadEntities: true`，这里注册的 `User` 实体也会自动加入 TypeORM 连接。

`UserRepository` 是一个抽象层。业务代码依赖它，而不是直接依赖 TypeORM 的 `Repository<User>`，这样后续替换 ORM、调整查询实现或编写单元测试都会更容易。

## 10. 封装 Repository

先定义抽象 Repository：

```ts
import { User } from '../entities/user.entity'

export abstract class UserRepository {
  abstract findAll(): Promise<User[]>
}
```

再创建 TypeORM 实现：

```ts
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { User } from '../entities/user.entity'
import { UserRepository } from './user.repository'

@Injectable()
export class TypeOrmUserRepository implements UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findAll(): Promise<User[]> {
    return this.repository.find()
  }
}
```

`@InjectRepository(User)` 会注入 TypeORM 为 `User` 实体创建的 `Repository<User>`。业务查询逻辑可以先从简单的 `find()` 开始，后续再逐步扩展为分页、筛选、排序或复杂查询。

## 11. 编写 Service 与 Controller

Service 层只依赖抽象 Repository：

```ts
import { Injectable } from '@nestjs/common'
import { UserRepository } from './repositories/user.repository'

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  findAll() {
    return this.userRepository.findAll()
  }
}
```

Controller 层暴露 HTTP 接口：

```ts
import { Controller, Get } from '@nestjs/common'
import { UserService } from './user.service'

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findAll() {
    return this.userService.findAll()
  }
}
```

这样就得到了一个最小可用的用户列表接口：

```http
GET /user
```

## 12. 初始化数据库表

如果没有启用 `DB_SYNC=true`，需要手动创建表结构。可以准备一个 `sql/init.sql`：

```sql
DROP TABLE IF EXISTS `user`;

CREATE TABLE `user` (
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `id` int NOT NULL AUTO_INCREMENT COMMENT 'Unique identifier',
  `username` varchar(50) NOT NULL,
  `nickname` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL COMMENT 'Hashed password',
  `deletedAt` timestamp NULL DEFAULT NULL COMMENT '删除时间',
  `avatar` varchar(255) DEFAULT NULL COMMENT '头像URL',
  `isEnabled` tinyint NOT NULL DEFAULT '1' COMMENT '启用/禁用',
  `isSystemDefault` tinyint NOT NULL DEFAULT '0' COMMENT '系统默认',
  `email` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_username` (`username`),
  UNIQUE KEY `uk_user_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

先创建数据库：

```bash
mysql -h localhost -P 3306 -u root -p -e "CREATE DATABASE IF NOT EXISTS ne_app DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

再创建表：

```bash
mysql -h localhost -P 3306 -u root -p ne_app < sql/init.sql
```

命令说明：

- `mysql`：使用 MySQL 客户端连接数据库。
- `-h localhost`：连接本机数据库。
- `-P 3306`：指定 MySQL 端口。
- `-u root`：指定用户名。
- `-p`：执行命令后输入密码。
- `ne_app`：目标数据库名，需要与 `DB_DATABASE` 保持一致。
- `< sql/init.sql`：把 SQL 文件内容输入给 MySQL 执行。

## 13. 插入测试数据

准备一个 `sql/add_test_users.sql`：

```sql
INSERT INTO `user` (
  `username`,
  `nickname`,
  `password`,
  `deletedAt`,
  `avatar`,
  `isEnabled`,
  `isSystemDefault`,
  `email`
) VALUES (
  'user001',
  '测试用户01',
  '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  NULL,
  '/avatar/001.jpg',
  1,
  0,
  'user001@test.com'
);
```

执行插入：

```bash
mysql -h localhost -P 3306 -u root -p ne_app < sql/add_test_users.sql
```

也可以直接查询确认数据是否存在：

```bash
mysql -h localhost -P 3306 -u root -p ne_app -e "SELECT id, username, nickname, email FROM user;"
```

## 14. 启动服务并测试接口

启动 NestJS 服务：

```bash
pnpm start:dev
```

使用 `curl` 请求用户列表：

```bash
curl http://localhost:3000/user
```

如果服务连接数据库正常，会返回类似结果：

```json
[
  {
    "id": 1,
    "createdAt": "2026-07-19T12:00:00.000Z",
    "updatedAt": "2026-07-19T12:00:00.000Z",
    "deletedAt": null,
    "username": "user001",
    "nickname": "测试用户01",
    "avatar": "/avatar/001.jpg",
    "isEnabled": true,
    "isSystemDefault": false,
    "email": "user001@test.com"
  }
]
```

注意，返回结果中没有 `password` 字段，因为实体中设置了：

```ts
select: false
```

这是一个很实用的默认保护。除非显式指定查询密码字段，否则普通查询不会把密码带出来。

## 常见问题

### 启动时报环境变量缺失

优先检查 `.env.development` 或 `.env.local` 是否包含所有必填数据库变量：

```dotenv
DB_TYPE=mysql
DB_DATABASE=ne_app
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=password
DB_SYNC=false
```

如果使用了 `Joi.required()`，缺少任意必填项都会导致应用启动失败。这是预期行为，目的是尽早暴露配置问题。

### 启动时报数据库连接失败

按顺序检查：

- MySQL 服务是否已经启动。
- `DB_HOST` 和 `DB_PORT` 是否正确。
- `DB_USERNAME` 和 `DB_PASSWORD` 是否正确。
- `DB_DATABASE` 对应的数据库是否存在。
- 数据库用户是否有访问目标数据库的权限。

### 请求 `/user` 返回空数组

先确认表中是否有数据：

```bash
mysql -h localhost -P 3306 -u root -p ne_app -e "SELECT id, username, nickname, email FROM user;"
```

如果没有数据，执行测试数据脚本：

```bash
mysql -h localhost -P 3306 -u root -p ne_app < sql/add_test_users.sql
```

### 表结构没有自动生成

如果配置为：

```dotenv
DB_SYNC=false
```

TypeORM 不会自动创建或修改表结构。此时需要手动执行建表 SQL，或者使用 TypeORM migrations 管理表结构变更。

如果只是本地临时验证，可以短暂使用：

```dotenv
DB_SYNC=true
```

验证结束后建议改回 `false`。

## 小结

通过以上步骤，我们完成了 NestJS 接入 MySQL 的基础闭环：

- 使用 `ConfigModule` 和 `Joi` 管理数据库配置。
- 使用 `TypeOrmModule.forRootAsync()` 初始化数据库连接。
- 使用实体类描述数据库表结构。
- 使用 `TypeOrmModule.forFeature()` 注册实体 Repository。
- 通过自定义 Repository 抽象隔离业务层和 ORM 实现。
- 暴露 `GET /user` 接口完成一次真实数据库查询。

这套结构虽然比直接在 Service 中注入 `Repository<User>` 多了一层封装，但它能让业务代码更稳定。后续无论是增加分页查询、软删除、事务处理，还是替换底层数据访问实现，都可以在 Repository 层集中处理。

下一步可以继续补齐用户模块的完整 CRUD，例如：

- `POST /user`：创建用户。
- `GET /user/:id`：按主键查询用户。
- `PATCH /user/:id`：更新用户信息。
- `DELETE /user/:id`：结合 `deletedAt` 做软删除。
- TypeORM migrations：用迁移脚本替代手写建表 SQL。
