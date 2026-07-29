---
pubDatetime: 2026-03-06T15:22:00Z
title: NestJS 使用 class-transformer 统一格式化响应字段
slug: nestjs-class-transformer-response-serialization
tags:
  - Node.js
  - NestJS
description: "本文介绍如何在 NestJS 中使用 class-transformer 统一格式化响应字段，包括删除敏感字段、格式化日期、枚举和关联对象等。"
---


接口开发到一定阶段后，返回值中通常会出现两类重复代码：一类用于删除 `password`、`token` 等敏感字段，另一类用于格式化日期、枚举和关联对象。把这些逻辑散落在 Controller 或 Service 中，不仅难以复用，也很容易在新增接口时漏掉。

NestJS 内置的 `ClassSerializerInterceptor` 基于 `class-transformer`，可以在响应发出前把类实例转换为普通对象，并执行声明在实体类或响应 DTO 上的序列化规则。本文结合一个 TypeORM 项目中的实际改造，介绍如何统一输出 `YYYY-MM-DD HH:mm:ss` 格式的时间，并进一步说明字段隐藏、字段重命名、派生字段、分组、版本控制和嵌套对象等进阶用法。

> 本文示例基于 NestJS 11、`class-transformer` 0.5.x 和 TypeScript 5。核心思路同样适用于其他近期版本。

## 一、先理解完整的响应序列化链路

NestJS 的响应序列化发生在 Controller 返回结果之后、HTTP 响应发送之前：

```text
TypeORM 查询
  -> 返回实体实例
  -> Controller 返回结果
  -> ClassSerializerInterceptor
  -> class-transformer.instanceToPlain()
  -> JSON 响应
```

其中各部分职责不同：

- TypeORM 装饰器负责实体与数据库字段之间的映射。
- `class-transformer` 装饰器描述类实例如何转换成普通对象。
- `ClassSerializerInterceptor` 在 NestJS 响应阶段自动触发转换。
- `JSON.stringify()` 最终把转换后的普通对象编码为 JSON。

只添加 `@Transform()` 并不会自动修改 HTTP 响应，必须同时确保序列化拦截器生效。反过来，只注册拦截器而没有声明转换规则，响应字段也不会凭空改变。

## 二、安装与 TypeScript 配置

安装依赖：

```bash
pnpm add class-transformer reflect-metadata
```

如果需要像本文一样格式化日期，可以同时安装 `dayjs`：

```bash
pnpm add dayjs
```

命令说明：

- `class-transformer` 提供实例转换函数以及 `@Transform()`、`@Exclude()`、`@Expose()` 等装饰器。
- `reflect-metadata` 为装饰器元数据提供运行时支持，NestJS 项目通常已经安装。
- `dayjs` 用于日期格式化，也可以换成项目已有的日期库或原生实现。

确认 `tsconfig.json` 已启用装饰器：

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Nest CLI 创建的标准项目通常已经包含这两项配置。

## 三、全局启用 ClassSerializerInterceptor

如果多数接口都需要统一序列化，建议在根模块中通过 `APP_INTERCEPTOR` 注册全局拦截器：

```ts
import { ClassSerializerInterceptor, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AppController } from './app.controller'
import { AppService } from './app.service'

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
  ],
})
export class AppModule {}
```

使用 `APP_INTERCEPTOR` 的好处是拦截器仍由 NestJS 依赖注入容器管理，并且不需要在每个 Controller 上重复添加装饰器。

如果只有少量接口需要序列化，也可以缩小作用范围：

```ts
import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  UseInterceptors,
} from '@nestjs/common'

@Controller('users')
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {
  @Get()
  findAll() {
    return []
  }
}
```

全局注册和局部注册选择一种即可，通常不需要重复使用。

## 四、使用 @Transform 统一格式化日期

项目中的 TypeORM 实体都继承同一个 `BaseEntity`，因此把时间转换规则放在基类中，可以一次覆盖所有业务实体：

```ts
import { Transform, type TransformFnParams } from 'class-transformer'
import dayjs from 'dayjs'
import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

const transformDate = ({ value }: TransformFnParams): string => {
  if (value instanceof Date) {
    return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
  }

  return ''
}

export abstract class BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', comment: 'Unique identifier' })
  id!: number

  @Transform(transformDate, { toPlainOnly: true })
  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date

  @Transform(transformDate, { toPlainOnly: true })
  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt!: Date | null
}
```

这里最关键的是：

- `value` 是当前字段在转换时的值。
- `value instanceof Date` 避免对异常值直接调用日期格式化逻辑。
- `{ toPlainOnly: true }` 表示规则只在“类实例转普通对象”时执行，不影响“普通对象转类实例”的入参转换。
- TypeORM Repository 的 `find()`、`findOne()` 等方法通常返回实体实例，因此能够直接触发实体上的装饰器。

接口返回结果会由：

```json
{
  "createdAt": "2026-07-20T02:30:00.000Z",
  "updatedAt": "2026-07-20T03:00:00.000Z"
}
```

转换为：

```json
{
  "createdAt": "2026-07-20 10:30:00",
  "updatedAt": "2026-07-20 11:00:00"
}
```

### 日期格式化中的时区问题

`dayjs(value).format()` 会按照 Node.js 进程的本地时区输出。数据库时区、数据库驱动时区、服务器时区不一致时，即使格式看起来正确，时间仍可能相差数小时。

生产项目应先确定接口时间规范，常见选择有两种：

- 统一返回 ISO 8601 UTC，例如 `2026-07-20T02:30:00.000Z`，由客户端按用户时区显示。
- 统一返回约定时区的字符串，并在接口文档中明确时区，例如 `Asia/Shanghai`。

单纯把 ISO 字符串改为 `YYYY-MM-DD HH:mm:ss` 会丢失时区信息，适合时区约定明确的内部系统，不建议在跨地区系统中含糊使用。

对于可空时间字段，更稳妥的转换方式是保留 `null`，避免客户端把空字符串误判为有效时间：

```ts
const transformNullableDate = ({ value }: TransformFnParams): string | null => {
  if (value === null || value === undefined) {
    return null
  }

  return value instanceof Date
    ? dayjs(value).format('YYYY-MM-DD HH:mm:ss')
    : null
}
```

## 五、类实例与普通对象：最常见的失效原因

`class-transformer` 的装饰器元数据声明在类上。下面两段代码在 TypeScript 类型层面看起来接近，运行时却不同：

```ts
const instance = new UserResponseDto()
instance.id = 1

const plainObject = {
  id: 1,
}
```

前者是 `UserResponseDto` 实例，后者只是普通 JavaScript 对象。TypeScript 的类型断言不会改变运行时对象：

```ts
// 这仍然是普通对象，不会因为 as 而拥有类的装饰器元数据
return data as UserResponseDto
```

当查询结果来自原生 SQL、TypeORM `getRawMany()`、外部 HTTP 接口或手工对象拼装时，可以显式转换：

```ts
import { plainToInstance } from 'class-transformer'

const users = await this.repository
  .createQueryBuilder('user')
  .select(['user.id AS id', 'user.username AS username'])
  .getRawMany()

return plainToInstance(UserResponseDto, users)
```

NestJS 新版也支持通过 `@SerializeOptions({ type })` 指定响应类型，让普通对象先转换为目标类：

```ts
import { Controller, Get, SerializeOptions } from '@nestjs/common'

@Controller('users')
export class UserController {
  @Get(':id')
  @SerializeOptions({ type: UserResponseDto })
  findOne(): UserResponseDto {
    return {
      id: 1,
      username: 'admin',
      password: 'should-not-be-returned',
    }
  }
}
```

如果响应有统一包装层，例如 `{ code, message, data }`，不要只依赖 TypeScript 接口描述它。可为包装结构建立响应类，并用 `@Type()` 标注嵌套数据；或者在进入包装层之前完成 `plainToInstance()`。尤其应对实际接口做集成测试，确认嵌套对象上的 `@Exclude()` 确实执行。

## 六、隐藏敏感字段：@Exclude

`@Exclude()` 可以在序列化时移除字段。建议显式添加 `{ toPlainOnly: true }`，避免它同时影响反序列化：

```ts
import { Exclude } from 'class-transformer'

export class UserResponseDto {
  id!: number
  username!: string

  @Exclude({ toPlainOnly: true })
  password!: string
}
```

返回 `UserResponseDto` 实例时，最终 JSON 中不会出现 `password`。

对于 TypeORM 密码字段，还可以同时使用 `select: false`：

```ts
@Exclude({ toPlainOnly: true })
@Column({ type: 'varchar', length: 255, select: false })
password!: string
```

两者不是重复配置，而是两道不同防线：

- `select: false` 尽量不从数据库读取敏感字段。
- `@Exclude()` 防止字段已被显式查询或手工赋值后意外进入响应。

安全边界较高的项目更推荐单独定义 Response DTO，而不是直接向外暴露数据库实体。

## 七、字段重命名与派生字段：@Expose

### 重命名响应字段

```ts
import { Expose } from 'class-transformer'

export class UserResponseDto {
  @Expose({ name: 'userId' })
  id!: number
}
```

响应结果为：

```json
{
  "userId": 1
}
```

### 输出 getter 计算结果

```ts
export class UserResponseDto {
  firstName!: string
  lastName!: string

  @Expose()
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`
  }
}
```

`fullName` 不需要保存到数据库，也能作为派生字段进入响应。getter 中应避免数据库查询、网络请求或修改状态，因为它可能在序列化过程中被调用多次。

## 八、@Transform 的更多用法

`@Transform()` 的回调参数除了 `value`，还包括当前对象 `obj`、属性名 `key`、转换方向 `type` 和本次转换配置 `options`。

### 压缩关联对象

```ts
@Transform(({ value }) => value?.name ?? null, { toPlainOnly: true })
role!: RoleEntity | null
```

原本的关联对象：

```json
{
  "role": {
    "id": 2,
    "name": "editor",
    "permissions": []
  }
}
```

会被转换为：

```json
{
  "role": "editor"
}
```

### 组合当前对象中的多个字段

```ts
@Transform(({ obj }) => `${obj.firstName} ${obj.lastName}`, {
  toPlainOnly: true,
})
displayName!: string
```

如果 `displayName` 本身不存在，优先考虑 `@Expose()` 配合 getter，语义通常更清晰。

### 分清两个转换方向

```ts
@Transform(({ value }) => String(value).trim(), { toClassOnly: true })
title!: string
```

- `toPlainOnly`：实例转普通对象，主要用于格式化响应。
- `toClassOnly`：普通对象转实例，主要用于清洗输入。

不要在响应格式化装饰器中省略方向限制，否则同一规则可能在请求 DTO 转换时也执行，产生难以发现的副作用。

## 九、白名单输出：excludeAll 策略

当响应包含敏感信息时，与其逐个排除不允许返回的字段，不如只暴露明确允许返回的字段：

```ts
import { Expose } from 'class-transformer'

export class UserResponseDto {
  @Expose()
  id!: number

  @Expose()
  username!: string

  password!: string
  resetToken!: string
}
```

在接口上启用白名单策略：

```ts
@Get(':id')
@SerializeOptions({
  type: UserResponseDto,
  strategy: 'excludeAll',
})
findOne() {
  return this.userService.findOne()
}
```

最终只有带 `@Expose()` 的字段会输出。新增实体字段时不会自动泄漏到 API，更适合公开接口和权限敏感接口。

## 十、按用户角色输出字段：Groups

同一个响应 DTO 可以通过 groups 为不同调用方输出不同字段：

```ts
import { Expose } from 'class-transformer'

export class UserResponseDto {
  @Expose()
  id!: number

  @Expose()
  username!: string

  @Expose({ groups: ['admin'] })
  email!: string

  @Expose({ groups: ['admin'] })
  lastLoginIp!: string
}
```

管理员接口指定 `admin` 分组：

```ts
@Get(':id')
@SerializeOptions({
  type: UserResponseDto,
  groups: ['admin'],
})
findOneForAdmin() {
  return this.userService.findOne()
}
```

groups 适用于少量、稳定的展示差异。如果规则取决于资源归属、租户、动态权限或当前用户上下文，建议在授权层或专门的响应映射层处理，不要把复杂权限系统全部塞进装饰器。

## 十一、按 API 版本控制字段

`@Expose()` 支持 `since` 和 `until`，可以结合 `@SerializeOptions({ version })` 控制字段在哪个序列化版本出现：

```ts
export class UserResponseDto {
  @Expose({ until: 2 })
  name!: string

  @Expose({ since: 2 })
  displayName!: string
}
```

```ts
@Get(':id')
@SerializeOptions({
  type: UserResponseDto,
  version: 2,
})
findOneV2() {
  return this.userService.findOne()
}
```

这里的 `version` 是 `class-transformer` 的序列化选项，并不会自动读取 NestJS URI 版本 `v1`、`v2`。如果项目使用 NestJS API Versioning，需要自行保证路由版本与序列化版本一致。

## 十二、嵌套对象与数组：@Type

当普通对象被转换为类实例时，运行时无法仅凭 TypeScript 类型推断嵌套属性的构造函数，需要使用 `@Type()`：

```ts
import { Exclude, Expose, Type } from 'class-transformer'

class ProfileResponseDto {
  @Expose()
  nickname!: string

  @Exclude({ toPlainOnly: true })
  internalRemark!: string
}

export class UserResponseDto {
  @Expose()
  id!: number

  @Expose()
  @Type(() => ProfileResponseDto)
  profile!: ProfileResponseDto

  @Expose()
  @Type(() => ProfileResponseDto)
  histories!: ProfileResponseDto[]
}
```

然后转换原始数据：

```ts
return plainToInstance(UserResponseDto, rawUser, {
  excludeExtraneousValues: true,
})
```

`excludeExtraneousValues: true` 会只保留带 `@Expose()` 的属性，适合把不可信或字段过多的普通对象映射为严格的响应 DTO。它依赖 `@Expose()` 白名单，开启后漏加装饰器的字段也会被删除。

## 十三、接口级覆盖配置：@SerializeOptions

`@SerializeOptions()` 接收的配置会传给底层转换过程，常见选项包括：

```ts
@SerializeOptions({
  type: UserResponseDto,
  groups: ['admin'],
  version: 2,
  strategy: 'excludeAll',
  excludePrefixes: ['_'],
  exposeUnsetFields: false,
})
```

- `type`：把普通返回值转换为指定类，NestJS 项目中非常实用。
- `groups`：启用指定字段分组。
- `version`：启用指定序列化版本。
- `strategy`：可设为 `excludeAll`，只输出显式暴露的字段。
- `excludePrefixes`：排除指定前缀，例如 `_internalId`。
- `exposeUnsetFields: false`：不输出值为 `undefined` 的字段。

这些选项可以标注在方法或 Controller 类上。通用规则放到类级别，少量例外放到方法级别，能避免配置散落。

## 十四、直接暴露 Entity，还是建立 Response DTO

小型内部项目可以直接在 TypeORM Entity 上添加序列化装饰器，优点是代码少，本文的基础时间格式化就属于这种方式。

随着项目变复杂，建议把数据库实体与 API 响应模型分开：

```ts
export class UserResponseDto {
  @Expose()
  id!: number

  @Expose()
  username!: string

  @Expose()
  @Transform(transformNullableDate, { toPlainOnly: true })
  createdAt!: Date
}
```

```ts
@Get()
@SerializeOptions({ type: UserResponseDto })
findAll(): Promise<UserResponseDto[]> {
  return this.userService.findAll()
}
```

独立 Response DTO 的优势是：

- 数据库字段变化不会直接改变外部 API。
- 可以针对创建、更新、详情、列表分别设计模型。
- 敏感字段采用白名单输出，默认更安全。
- Swagger 文档、类型声明和真实响应更容易保持一致。

代价是需要维护映射和更多类型。通常可以先在实体基类处理真正全局的格式，例如时间；对外接口再逐步迁移到专用 Response DTO。

## 十五、不会生效或容易踩坑的场景

### 1. 返回的是普通对象

`as UserResponseDto` 只影响编译期，不会创建实例。使用 `@SerializeOptions({ type: UserResponseDto })`、构造函数或 `plainToInstance()`。

### 2. 使用 `@Res()` 手工发送响应

下面的代码绕过了 NestJS 标准响应处理链：

```ts
@Get()
findAll(@Res() response: Response) {
  response.json(this.userService.findAll())
}
```

拦截器无法按常规方式处理这个返回值。优先直接 `return` 数据；确实需要操作原生响应时，可以考虑 `@Res({ passthrough: true })`，并让方法仍然返回数据。

### 3. 返回 StreamableFile

文件流响应不适用常规类序列化，也没有格式化业务字段的必要，应与 JSON 响应分开处理。

### 4. 只修改数据库列类型

TypeORM 的 `timestamp`、`datetime` 决定数据库如何保存和读取数据，不等于 HTTP 响应格式。响应格式属于 API 序列化层。

### 5. 把格式化逻辑写进每个 Controller

手工 `map()` 能短期解决问题，但重复代码会迅速增加。通用规则放到基类或 Response DTO，特殊展示需求再在具体 DTO 中声明。

### 6. 使用箭头属性充当 @Transform 目标但未暴露

转换通常依附于已有字段。如果目标字段不存在于原始对象，又希望凭空生成字段，应使用 `@Expose()` 配合 getter，或同时明确配置暴露策略并编写测试。

### 7. 忽略序列化成本

序列化会遍历对象。返回超大列表、深层关联或包含大量 getter 时会增加 CPU 和内存开销。应先做好分页、限制关联深度，并避免在 getter 和转换函数中执行重逻辑。

## 十六、如何测试序列化结果

单元测试可以直接验证 `class-transformer` 规则：

```ts
import { instanceToPlain } from 'class-transformer'

describe('UserResponseDto serialization', () => {
  it('should hide password and format createdAt', () => {
    const user = Object.assign(new UserResponseDto(), {
      id: 1,
      username: 'admin',
      password: 'secret',
      createdAt: new Date('2026-07-20T02:30:00.000Z'),
    })

    expect(instanceToPlain(user)).toMatchObject({
      id: 1,
      username: 'admin',
    })
    expect(instanceToPlain(user)).not.toHaveProperty('password')
  })
})
```

更重要的是增加 e2e 测试，因为它能够同时验证全局拦截器、Controller 返回类型和 JSON 响应：

```ts
it('GET /user should serialize response', () => {
  return request(app.getHttpServer())
    .get('/user')
    .expect(200)
    .expect((response) => {
      expect(response.body[0].createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      )
      expect(response.body[0]).not.toHaveProperty('password')
    })
})
```

测试日期时要固定时区或使用明确时区的预期值，否则本地和 CI 环境可能得到不同结果。

## 十七、推荐落地方案

对于使用 NestJS 和 TypeORM 的常规项目，可以按以下顺序落地：

1. 在根模块全局注册 `ClassSerializerInterceptor`。
2. 在通用实体基类中处理 `createdAt`、`updatedAt` 等全局一致字段。
3. 对 `password`、密钥、内部备注等字段使用 `@Exclude({ toPlainOnly: true })`，同时从查询层避免读取。
4. 对原生 SQL 和外部数据使用 `@SerializeOptions({ type })` 或 `plainToInstance()` 创建真实实例。
5. 对公开或复杂接口建立独立 Response DTO，并采用 `excludeAll` 或 `excludeExtraneousValues` 白名单策略。
6. 用 e2e 测试锁定最终 JSON，而不只测试 Service 返回值。
7. 明确全局日期与时区规范，避免只统一“外观”却没有统一时间语义。

## 小结

`class-transformer` 的价值不只是把日期换一种字符串格式，而是让响应规则从命令式的手工删改，变为集中、声明式、可测试的 API 契约。

本文的基础改造只需要两步：全局注册 `ClassSerializerInterceptor`，然后在实体字段上添加带有 `toPlainOnly` 的 `@Transform()`。在此基础上，还可以使用 `@Exclude()` 保护敏感字段、用 `@Expose()` 重命名或生成字段、用 groups 和 version 管理差异，并通过 Response DTO 与白名单策略建立更稳定的接口边界。

最后要始终记住：装饰器声明在类上，能否正确序列化取决于运行时返回值是不是对应的类实例。遇到规则不生效时，优先检查返回对象的构造函数、拦截器是否注册，以及是否使用原生响应对象绕过了 NestJS 响应链。

## 参考资料

- [NestJS 官方文档：Serialization](https://docs.nestjs.com/techniques/serialization)
- [class-transformer 官方仓库与使用文档](https://github.com/typestack/class-transformer)
