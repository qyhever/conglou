---
pubDatetime: 2026-03-05T16:22:00Z
title: NestJS 在 Service 之外增加抽象类与 Repository 层
slug: nestjs-service-abstract-repository-layer
tags:
  - Node.js
  - NestJS
description: "在简单 CRUD 中，直接把 TypeORM 的 `Repository<User>` 注入 Service 完全可行。但随着重复检查、事务、缓存、查询策略和数据源切换不断增加，Service 很容易同时承担业务编排与数据库细节。增加 Repository 层的目的不是让目录更多，而是建立稳定的数据访问边界。"
---


在简单 CRUD 中，直接把 TypeORM 的 `Repository<User>` 注入 Service 完全可行。但随着重复检查、事务、缓存、查询策略和数据源切换不断增加，Service 很容易同时承担业务编排与数据库细节。增加 Repository 层的目的不是让目录更多，而是建立稳定的数据访问边界。

本文以用户创建流程为例，说明 NestJS 中 Controller、Service、抽象 Repository 和 TypeORM Repository 实现各自负责什么，以及为什么常用抽象类而不是 TypeScript interface 作为依赖注入 Token。

## 一、从直接注入 TypeORM Repository 开始

最直接的写法如下：

```ts
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findAll() {
    return this.repository.find()
  }
}
```

对于小型模块，这段代码清楚且成本最低。问题通常出现在业务变复杂之后：

```ts
const usernameExists = await this.repository.existsBy({ username })
const emailExists = await this.repository.existsBy({ email })
const user = this.repository.create(data)
return this.repository.save(user)
```

Service 开始知道 `existsBy`、`EntityManager`、查询构造器和 TypeORM 条件对象。此时业务层与 ORM API 紧密绑定，测试时也必须模拟庞大的 TypeORM Repository。

## 二、四层结构的职责

推荐的依赖方向是：

```text
Controller
  -> UserService
      -> UserRepository（抽象契约）
          -> TypeOrmUserRepository（基础设施实现）
              -> TypeORM Repository<User>
                  -> MySQL
```

每一层的职责不同：

- Controller：处理 HTTP 路由、DTO 和参数 Pipe，不编写数据库查询。
- Service：编排业务规则，例如检查唯一性、加密密码、决定保存时机。
- 抽象 Repository：描述业务层需要哪些数据能力。
- TypeORM Repository 实现：把抽象能力翻译成具体 ORM 调用。

Repository 不应替代 Service。它回答“怎样读取或保存数据”，Service 回答“业务什么时候允许这样做”。

## 三、定义抽象 Repository

```ts
import type { EntityManager } from 'typeorm'
import { User } from '../entities/user.entity'

export abstract class UserRepository {
  abstract findAll(): Promise<User[]>

  abstract existsByUsername(
    username: string,
    manager?: EntityManager,
  ): Promise<boolean>

  abstract existsByEmail(
    email: string,
    manager?: EntityManager,
  ): Promise<boolean>

  abstract create(data: Partial<User>, manager?: EntityManager): User

  abstract save(user: User, manager?: EntityManager): Promise<User>
}
```

这个抽象类不访问数据库，只定义调用方可以依赖的契约。Service 不再关心用户名检查最终使用 `existsBy()`、原生 SQL 还是缓存。

方法命名建议表达业务查询意图：

```ts
existsByUsername(username)
findActiveByEmail(email)
findPage(query)
save(user)
```

相比把 TypeORM 的通用方法全部原样暴露出去，这类接口更稳定，也能防止 ORM 细节重新泄漏到 Service。

## 四、为什么使用 abstract class，而不是 interface

从类型设计看，interface 也能描述契约：

```ts
export interface UserRepository {
  findAll(): Promise<User[]>
}
```

但 TypeScript interface 编译后会被移除，NestJS 运行时无法直接把它当作依赖注入 Token：

```ts
constructor(private readonly userRepository: UserRepository) {}
```

这里只剩类型信息，没有可供容器识别的运行时值。

抽象类同时具备两种身份：

- 编译阶段：约束实现类必须实现指定方法。
- 运行阶段：作为 NestJS providers 中可用的注入 Token。

因此可以直接写：

```ts
{
  provide: UserRepository,
  useClass: TypeOrmUserRepository,
}
```

这不意味着抽象类一定优于 interface。另一种常见方案是 interface 配合 Symbol Token：

```ts
export const USER_REPOSITORY = Symbol('USER_REPOSITORY')

export interface UserRepository {
  findAll(): Promise<User[]>
}
```

注入时显式标记：

```ts
constructor(
  @Inject(USER_REPOSITORY)
  private readonly userRepository: UserRepository,
) {}
```

两种方式都可以。抽象类写法更简洁，Symbol + interface 则让类型契约和运行时 Token 完全分离。

## 五、实现 TypeORM Repository

```ts
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'
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

  existsByUsername(
    username: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.getRepository(manager).existsBy({ username })
  }

  existsByEmail(email: string, manager?: EntityManager): Promise<boolean> {
    return this.getRepository(manager).existsBy({ email })
  }

  create(data: Partial<User>, manager?: EntityManager): User {
    return this.getRepository(manager).create(data)
  }

  save(user: User, manager?: EntityManager): Promise<User> {
    return this.getRepository(manager).save(user)
  }

  private getRepository(manager?: EntityManager): Repository<User> {
    return manager?.getRepository(User) ?? this.repository
  }
}
```

实现类集中处理 TypeORM 细节。调用方只知道 `existsByUsername()`，不知道它内部使用的是 `existsBy()`。

可选的 `EntityManager` 允许同一实现参与事务：传入 manager 时使用事务内 Repository，否则使用默认 Repository。

## 六、在 Module 中绑定抽象与实现

```ts
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

容器解析 `UserService` 时，发现它依赖 `UserRepository` Token，便创建并注入 `TypeOrmUserRepository`。

这也是依赖倒置原则在 NestJS 中的实际落地：高层业务依赖抽象，基础设施实现抽象，再由 Module 决定具体绑定关系。

如果 Repository 需要被其他模块使用，还要导出 Token：

```ts
@Module({
  providers: [
    {
      provide: UserRepository,
      useClass: TypeOrmUserRepository,
    },
  ],
  exports: [UserRepository],
})
export class UserModule {}
```

## 七、Service 只编排业务流程

```ts
@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const [usernameExists, emailExists] = await Promise.all([
      this.userRepository.existsByUsername(createUserDto.username),
      this.userRepository.existsByEmail(createUserDto.email),
    ])

    if (usernameExists) {
      throw new ConflictException('用户名已存在')
    }

    if (emailExists) {
      throw new ConflictException('邮箱已存在')
    }

    const rounds = this.configService.get('BCRYPT_ROUNDS', { infer: true })
    const password = await hash(createUserDto.password, rounds)
    const user = this.userRepository.create({
      ...createUserDto,
      password,
    })

    return this.userRepository.save(user)
  }
}
```

这里的业务流程一目了然：检查重复、生成密码哈希、创建实体、保存实体。TypeORM 的查询 API 被隔离在 Repository 实现中。

### 并行检查不是数据库唯一性的替代品

`Promise.all()` 可以减少两次独立查询的等待时间，但“先检查、后插入”存在并发窗口：两个请求可能同时检查通过，然后同时写入。

数据库必须继续设置唯一索引：

```ts
@Index({ unique: true })
@Column({ type: 'varchar', length: 50 })
username!: string
```

应用层检查用于提供友好提示，数据库唯一约束才是最终一致性防线。Repository 或异常过滤层还需要把数据库的唯一键冲突转换为稳定的业务错误。

## 八、Repository 与事务

创建用户如果还要写入角色关系、审计日志或初始化设置，应放在同一个事务中：

```ts
await this.dataSource.transaction(async (manager) => {
  const user = this.userRepository.create(userData, manager)
  await this.userRepository.save(user, manager)
  await this.profileRepository.save(profile, manager)
})
```

但把 TypeORM 的 `EntityManager` 暴露在抽象 Repository 参数中，也意味着抽象层仍然依赖 TypeORM。对于已经确定使用 TypeORM 的应用，这是务实方案；如果目标是彻底隔离基础设施，可以改用工作单元抽象：

```ts
export abstract class UnitOfWork {
  abstract run<T>(work: () => Promise<T>): Promise<T>
}
```

或由专门的事务服务提供事务范围内的 Repository。选择标准不是“层数越多越好”，而是项目是否真的需要替换 ORM、跨数据源或进行高度隔离的测试。

## 九、Repository 层带来的收益

### 1. 隔离 ORM 细节

Service 不依赖 `FindOptionsWhere`、QueryBuilder 或数据库列名。底层查询调整时，影响集中在实现类。

### 2. 提升单元测试可读性

测试 Service 时，只需提供业务关注的方法：

```ts
const userRepositoryMock: jest.Mocked<UserRepository> = {
  findAll: jest.fn(),
  existsByUsername: jest.fn().mockResolvedValue(false),
  existsByEmail: jest.fn().mockResolvedValue(false),
  create: jest.fn((data) => data as User),
  save: jest.fn(async (user) => ({ ...user, id: 1 }) as User),
}
```

测试不需要了解 TypeORM Repository 的其他几十个方法。

### 3. 便于替换实现

模块绑定可以换成内存实现、缓存实现或远程服务适配器：

```ts
{
  provide: UserRepository,
  useClass: InMemoryUserRepository,
}
```

Service 无需修改。

### 4. 集中查询规则

软删除过滤、租户隔离、固定排序和关联加载可以集中在 Repository 中，避免不同 Service 写出略有差异的查询。

## 十、Repository 层的代价

额外抽象并非免费：

- 需要维护契约与实现两份代码。
- 简单 CRUD 可能只是机械转发。
- 设计过度时会出现大量只有一个方法的类。
- 抽象方法如果直接暴露 ORM 类型，隔离效果有限。
- 通用 `BaseRepository<T>` 容易再次膨胀成 ORM API 的复制品。

下面这种无语义封装价值不高：

```ts
find(options: FindManyOptions<User>) {
  return this.repository.find(options)
}
```

它只是换了调用入口，Service 仍然依赖 TypeORM 类型。更有价值的接口应表达领域需求：

```ts
findEnabledUsersCreatedAfter(date: Date): Promise<User[]>
```

## 十一、什么时候值得增加 Repository 层

适合增加：

- 模块有复杂查询、事务或数据访问规则。
- 多个 Service 需要复用相同查询语义。
- 希望对 Service 做快速、隔离的单元测试。
- 需要隐藏 ORM 或外部数据源细节。
- 项目已经按领域或模块划分清晰边界。

可以暂缓：

- 项目只是原型或少量简单 CRUD。
- Repository 只会逐个转发 TypeORM 方法。
- 团队尚未形成稳定的数据访问约定。

实践中可以从直接注入开始，当 Service 明显出现重复查询、事务代码或 ORM 类型扩散时再提取，而不是为了套用架构提前创建空层。

## 十二、推荐目录结构

```text
src/user/
├─ dto/
│  ├─ create-user.dto.ts
│  └─ update-user.dto.ts
├─ entities/
│  └─ user.entity.ts
├─ repositories/
│  ├─ user.repository.ts
│  └─ typeorm-user.repository.ts
├─ user.controller.ts
├─ user.service.ts
└─ user.module.ts
```

当模块继续增大，可以把 TypeORM 实现移入 `infrastructure/`，把抽象契约放入 `domain/` 或 `application/ports/`。目录名称不是重点，稳定、单向的依赖关系才是重点。

## 小结

Service 之上增加抽象 Repository 与具体仓储实现，核心价值是把“业务决策”和“数据访问方式”分开：

- Service 编排唯一性检查、密码加密和保存流程。
- `UserRepository` 用抽象类定义业务需要的数据能力，同时充当 NestJS 注入 Token。
- `TypeOrmUserRepository` 负责把这些能力实现为 TypeORM 调用。
- Module 负责绑定抽象与实现。

这套结构能提高可测试性和可维护性，但应按复杂度引入。真正有效的 Repository 应隐藏基础设施并表达业务查询语义，而不是简单复制 ORM 的全部 API。
