---
pubDatetime: 2026-03-09T15:22:00Z
title: NestJS 实现 JWT 登录、令牌刷新与全局路由守卫
slug: nestjs-jwt-login-and-route-guard
tags:
  - Node.js
  - NestJS
description: "本文介绍如何在 NestJS 中实现 JWT 登录、令牌刷新与全局路由守卫，包括登录参数校验、密码哈希比对、访问令牌与刷新令牌签发、受保护路由鉴权、公开路由声明，以及把当前用户身份传递给后续业务代码。"
---


登录认证不只是“校验密码后返回一个 token”。一套完整且边界清晰的实现，至少需要处理登录参数校验、密码哈希比对、访问令牌与刷新令牌签发、受保护路由鉴权、公开路由声明，以及把当前用户身份传递给后续业务代码。

本文基于一个 NestJS 11 + TypeORM 项目的实际改造，使用 `@nestjs/jwt` 和 `bcryptjs` 实现登录认证，不依赖 Passport。最终采用“默认全部鉴权，显式声明公开路由”的策略：`AccessTokenGuard` 注册为全局守卫，只有标记了 `@Public()` 的 Controller 或路由可以匿名访问。

## 一、最终效果与请求链路

实现完成后，主要接口如下：

| 方法 | 路径 | 是否公开 | 作用 |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | 是 | 校验邮箱和密码，签发两种令牌 |
| `POST` | `/auth/refresh` | 是 | 使用 refresh token 换取一对新令牌 |
| `GET` | `/user/me` | 否 | 根据 access token 查询当前用户 |

一次受保护请求的执行链路可以概括为：

```text
Client
  -> Authorization: Bearer <accessToken>
  -> AccessTokenGuard
      -> 检查 @Public() 元数据
      -> 提取 Bearer Token
      -> 验证签名、签发方和有效期
      -> 校验 payload.type 与 payload.sub
      -> 写入 request.user
  -> UserController
  -> UserService
  -> UserRepository
```

这种方案的关键设计是区分两类令牌：

- access token：有效期较短，用于访问业务接口。
- refresh token：有效期较长，只用于刷新令牌，不能直接访问业务接口。

两类令牌使用同一个签名密钥，但通过 payload 中的 `type` 字段严格区分用途。守卫只接受 `type: 'access'`，刷新接口只接受 `type: 'refresh'`，避免 refresh token 被当成访问凭证。

## 二、安装依赖并配置环境变量

安装 JWT 模块：

```bash
pnpm add @nestjs/jwt
```

项目已经使用 `bcryptjs` 处理密码哈希。如果是新项目，可一并安装：

```bash
pnpm add @nestjs/jwt bcryptjs
```

在环境变量中增加 JWT 配置：

```dotenv
JWT_SECRET=replace-with-a-long-random-secret
JWT_ACCESS_EXPIRE=2h
JWT_REFRESH_EXPIRE=7d
JWT_ISSUER=neapp
BCRYPT_ROUNDS=10
```

生产环境中的 `JWT_SECRET` 应使用密码学安全的随机值，并通过密钥管理服务或部署平台注入，不能提交到仓库。access token 应保持较短有效期；refresh token 可以更长，但需要配合服务端撤销机制降低泄漏风险。

项目使用 Joi 在启动时验证配置：

```ts
export type JwtExpiration =
  `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`

export interface EnvironmentVariables {
  JWT_SECRET: string
  JWT_ACCESS_EXPIRE: JwtExpiration
  JWT_REFRESH_EXPIRE: JwtExpiration
  JWT_ISSUER: string
  BCRYPT_ROUNDS: number
}

export const environmentValidationSchema = Joi.object<EnvironmentVariables>({
  JWT_SECRET: Joi.string().min(1).required(),
  JWT_ACCESS_EXPIRE: Joi.string()
    .pattern(/^\d+(ms|s|m|h|d|w|y)$/)
    .required(),
  JWT_REFRESH_EXPIRE: Joi.string()
    .pattern(/^\d+(ms|s|m|h|d|w|y)$/)
    .required(),
  JWT_ISSUER: Joi.string().min(1).required(),
  BCRYPT_ROUNDS: Joi.number().integer().min(10).max(15).default(10),
})
```

配置校验能把缺少密钥、过期时间格式错误等问题提前到应用启动阶段，而不是等到第一次登录时才暴露。

## 三、登录查询必须显式读取密码字段

用户实体中的密码字段应默认禁止查询和序列化：

```ts
@Exclude({ toPlainOnly: true })
@Column({
  type: 'varchar',
  length: 255,
  comment: 'Hashed password',
  select: false,
})
password!: string
```

`select: false` 能避免普通用户查询意外读取密码哈希。因此，登录场景需要一个用途明确的 Repository 方法，只取认证所需字段：

```ts
findLoginUserByEmail(email: string): Promise<User | null> {
  return this.repository.findOne({
    where: { email },
    select: { id: true, isEnabled: true, password: true },
  })
}
```

抽象 Repository 同步声明契约：

```ts
export abstract class UserRepository {
  abstract findLoginUserByEmail(email: string): Promise<User | null>
  abstract findById(id: number): Promise<User | null>
}
```

再由 `UserService` 暴露给认证模块：

```ts
findLoginUserByEmail(email: string): Promise<User | null> {
  return this.userRepository.findLoginUserByEmail(email)
}
```

`AuthModule` 需要使用 `UserService`，所以 `UserModule` 必须导出它：

```ts
@Module({
  // imports、controllers、providers 省略
  exports: [UserService, UserRepository],
})
export class UserModule {}
```

只为登录查询 `id`、`isEnabled` 和 `password`，既满足密码比对，又减少用户资料在认证链路中的传播。

## 四、使用 DTO 校验并规范化登录参数

登录 DTO 负责验证输入，并在校验前统一邮箱格式：

```ts
import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString } from 'class-validator'

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @IsNotEmpty()
  email!: string

  @IsString()
  @IsNotEmpty()
  password!: string
}
```

邮箱执行 `trim()` 和 `toLowerCase()` 后，`Test@Example.com` 与 `test@example.com` 会按同一种格式查询。密码不能做相同转换，因为大小写和空格都可能是密码本身的一部分。

刷新接口只接收非空字符串：

```ts
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string
}
```

这些 DTO 依赖全局 `ValidationPipe`：

```ts
app.useGlobalPipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    whitelist: true,
  }),
)
```

`whitelist` 会移除 DTO 未声明的字段，`forbidNonWhitelisted` 则直接拒绝额外字段，让认证接口拥有更明确的输入边界。

## 五、注册 JwtModule

在认证模块中异步读取配置并注册 `JwtModule`：

```ts
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        secret: configService.get('JWT_SECRET', { infer: true }),
        signOptions: {
          issuer: configService.get('JWT_ISSUER', { infer: true }),
        },
      }),
    }),
    UserModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
```

这里为所有签名设置统一 `secret` 和 `issuer`。过期时间不放在全局 `signOptions` 中，因为 access token 与 refresh token 的有效期不同，签发时需要分别指定。

## 六、实现登录并签发两种令牌

登录服务依次完成用户查询、账号状态检查和密码比对：

```ts
async login(dto: LoginDto) {
  const user = await this.userService.findLoginUserByEmail(dto.email)

  if (!user) {
    return {
      error: true,
      message: ResponseMessageEnum.USER_NOT_FOUND,
    }
  }

  if (!user.isEnabled) {
    throw new ForbiddenException(ResponseMessageEnum.USER_DISABLED)
  }

  if (!(await compare(dto.password, user.password))) {
    return {
      error: true,
      message: ResponseMessageEnum.PASSWORD_INCORRECT,
    }
  }

  return this.issueTokens(user.id)
}
```

注册时使用 `hash()` 保存密码哈希，登录时必须使用 `compare()` 比较明文密码与哈希值，不能再次 hash 后比较字符串。bcrypt 每次生成的盐不同，即使明文相同，哈希结果也通常不同。

令牌签发逻辑集中在一个私有方法中，供登录与刷新复用：

```ts
private async issueTokens(userId: number) {
  const accessExpiresIn = this.configService.get('JWT_ACCESS_EXPIRE', {
    infer: true,
  })
  const refreshExpiresIn = this.configService.get('JWT_REFRESH_EXPIRE', {
    infer: true,
  })

  const [accessToken, refreshToken] = await Promise.all([
    this.jwtService.signAsync(
      { sub: userId, type: 'access', jti: randomUUID() },
      { expiresIn: accessExpiresIn },
    ),
    this.jwtService.signAsync(
      { sub: userId, type: 'refresh', jti: randomUUID() },
      { expiresIn: refreshExpiresIn },
    ),
  ])

  return { accessToken, refreshToken }
}
```

payload 中三个自定义字段的作用是：

- `sub`：JWT 标准 Subject，保存用户 ID。
- `type`：区分 access token 和 refresh token。
- `jti`：JWT 唯一标识，为后续令牌撤销、刷新令牌轮换和审计预留能力。

`signAsync()` 还会生成 `iat`，并根据 `expiresIn` 生成 `exp`；模块配置中的 `issuer` 会写入 `iss`。

Controller 只负责 HTTP 语义：

```ts
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @SuccessMessage(ResponseMessageEnum.LOGIN_SUCCESS)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }
}
```

NestJS 的 `POST` 默认返回 `201`，登录并没有创建服务端资源，因此使用 `@HttpCode(HttpStatus.OK)` 返回 `200` 更符合语义。

## 七、实现 refresh token 刷新

刷新令牌时，不能只验证签名，还要验证 payload 的用途和用户当前状态：

```ts
async refresh(refreshToken: string) {
  let payload: unknown

  try {
    payload = await this.jwtService.verifyAsync(refreshToken, {
      issuer: this.configService.get('JWT_ISSUER', { infer: true }),
    })
  } catch {
    throw new UnauthorizedException(
      ResponseMessageEnum.REFRESH_TOKEN_INVALID_OR_EXPIRED,
    )
  }

  if (!this.isRefreshTokenPayload(payload)) {
    throw new UnauthorizedException(
      ResponseMessageEnum.REFRESH_TOKEN_INVALID_OR_EXPIRED,
    )
  }

  const user = await this.userService.findOne(payload.sub)

  if ('error' in user) {
    throw new UnauthorizedException(
      ResponseMessageEnum.REFRESH_TOKEN_INVALID_OR_EXPIRED,
    )
  }

  if (!user.isEnabled) {
    throw new ForbiddenException(ResponseMessageEnum.USER_DISABLED)
  }

  return this.issueTokens(user.id)
}
```

`verifyAsync()` 会验证签名和 `exp`，传入 `issuer` 后还会校验 `iss`。验证结果仍然是外部输入，不能直接断言类型，需要运行时类型守卫：

```ts
private isRefreshTokenPayload(
  payload: unknown,
): payload is { sub: number; type: 'refresh' } {
  if (typeof payload !== 'object' || payload === null) return false

  const tokenPayload = payload as Record<string, unknown>

  return (
    tokenPayload.type === 'refresh' &&
    typeof tokenPayload.sub === 'number' &&
    Number.isSafeInteger(tokenPayload.sub) &&
    tokenPayload.sub > 0
  )
}
```

刷新接口本身必须公开，否则过期的 access token 会先被全局守卫拒绝，客户端永远无法进入刷新逻辑：

```ts
@Post('refresh')
@Public()
@HttpCode(HttpStatus.OK)
@SuccessMessage(ResponseMessageEnum.REFRESH_TOKEN_SUCCESS)
refresh(@Body() dto: RefreshTokenDto) {
  return this.authService.refresh(dto.refreshToken)
}
```

注意实际路由是 `/auth/refresh`。接口调试文件、前端请求地址和文档必须保持一致，不能写成 `/auth/refresh-token`。

## 八、用 @Public() 声明匿名路由

先创建一个只负责写入元数据的装饰器：

```ts
import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
```

它既可以标记单个方法，也可以标记整个 Controller：

```ts
@Controller()
@Public()
export class AppController {
  // 该 Controller 下的路由都允许匿名访问
}
```

`@Public()` 本身不会跳过守卫。它只保存元数据，真正决定是否放行的是守卫中的 `Reflector`。

## 九、实现 AccessTokenGuard

全局守卫的完整职责包括：读取公开标记、解析请求头、验证 JWT、校验 payload，并把用户身份写入请求对象。

```ts
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<RequestWithContext>()
    const token = this.extractBearerToken(request.headers.authorization)

    if (!token) this.throwUnauthorized()

    let payload: unknown
    try {
      payload = await this.jwtService.verifyAsync(token, {
        issuer: this.configService.get('JWT_ISSUER', { infer: true }),
      })
    } catch {
      this.throwUnauthorized()
    }

    if (!this.isAccessTokenPayload(payload)) this.throwUnauthorized()

    request.user = { id: payload.sub }
    return true
  }
}
```

### 1. 方法级配置覆盖类级配置

`getAllAndOverride()` 按数组顺序查找元数据：

```ts
[
  context.getHandler(),
  context.getClass(),
]
```

因此方法级声明优先于 Controller 级声明。当前 `@Public()` 只会写入 `true`，已经能满足公开路由需求；如果未来需要在公开 Controller 中恢复某个私有路由，可以再设计 `@Protected()` 或更通用的认证策略元数据。

### 2. 严格解析 Bearer Token

```ts
private extractBearerToken(
  authorization: string | undefined,
): string | undefined {
  const match = authorization?.match(/^Bearer ([^\s]+)$/)
  return match?.[1]
}
```

该正则只接受标准格式：

```http
Authorization: Bearer eyJhbGciOi...
```

缺少 token、Scheme 错误、包含额外空白或 token 内出现空白都会被拒绝。严格解析能避免客户端和服务端对请求格式产生不同理解。

### 3. 不能只相信 TypeScript 类型断言

```ts
private isAccessTokenPayload(
  payload: unknown,
): payload is { sub: number; type: 'access' } {
  if (typeof payload !== 'object' || payload === null) return false

  const tokenPayload = payload as Record<string, unknown>

  return (
    tokenPayload.type === 'access' &&
    typeof tokenPayload.sub === 'number' &&
    Number.isSafeInteger(tokenPayload.sub) &&
    tokenPayload.sub > 0
  )
}
```

即使签名有效，payload 也不一定符合应用约定。显式检查 `type` 可以阻止 refresh token 访问业务路由，检查 `sub` 则避免把非法用户 ID 传入数据库层。

### 4. 统一抛出 401

```ts
private throwUnauthorized(): never {
  throw new UnauthorizedException(
    ResponseMessageEnum.ACCESS_TOKEN_INVALID_OR_EXPIRED,
  )
}
```

对客户端而言，未携带 token、token 过期、签名错误和 payload 非法都属于“当前凭证不可用”。统一返回 401 可以减少认证细节泄漏，也让客户端只维护一套重新登录或刷新逻辑。

## 十、注册全局守卫

在 `AuthModule` 中通过 `APP_GUARD` 注册：

```ts
import { APP_GUARD } from '@nestjs/core'

@Module({
  // imports、controllers 省略
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
  ],
})
export class AuthModule {}
```

然后在根模块导入认证模块：

```ts
@Module({
  imports: [
    AppConfigModule,
    UserModule,
    DatabaseModule,
    AuthModule,
  ],
})
export class AppModule {}
```

使用 `APP_GUARD` 后，守卫默认覆盖整个应用，新增 Controller 时不需要重复添加 `@UseGuards()`。这种“默认拒绝”策略能降低开发者忘记保护新接口的概率，但也意味着注册、健康检查、Webhook 等匿名接口必须主动添加 `@Public()`。


## 十一、把当前用户传给业务接口

守卫验证成功后执行：

```ts
request.user = { id: payload.sub }
```

为请求对象定义扩展类型：

```ts
import type { Request } from 'express'

interface RequestUser {
  id: number
}

export interface RequestWithContext extends Request {
  requestId: string
  user?: RequestUser
}
```

Controller 就可以读取当前用户：

```ts
@Get('me')
findCurrentUser(@Req() request: RequestWithContext) {
  return this.userService.findOne(request.user!.id)
}
```

这里使用非空断言是因为全局守卫已经保证受保护路由只有在设置 `request.user` 后才会执行。随着使用场景增加，可以进一步封装 `@CurrentUser()` 参数装饰器，让 Controller 不再直接依赖 Express Request：

```ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithContext>()
    return request.user
  },
)
```

使用方式：

```ts
@Get('me')
findCurrentUser(@CurrentUser() user: { id: number }) {
  return this.userService.findOne(user.id)
}
```

## 十二、接口调用示例

### 1. 登录

```http
POST http://localhost:3000/auth/login HTTP/1.1
Content-Type: application/json

{
  "email": "testuser2@example.com",
  "password": "testpassword"
}
```

在项目的统一响应拦截器下，成功响应形如：

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi..."
  },
  "message": "登录成功"
}
```

### 2. 访问受保护路由

```http
GET http://localhost:3000/user/me HTTP/1.1
Authorization: Bearer <accessToken>
```

### 3. 刷新令牌

```http
POST http://localhost:3000/auth/refresh HTTP/1.1
Content-Type: application/json

{
  "refreshToken": "<refreshToken>"
}
```

刷新成功后，客户端应原子地替换本地保存的 access token 和 refresh token，避免继续使用旧的一对令牌。

## 十三、错误状态与统一响应的边界

当前实现同时存在两类失败处理：

- 用户不存在、密码错误：Service 返回 `{ error: true, message }`，再由响应拦截器包装为 `success: false`，HTTP 状态码仍是 `200`。
- 用户禁用、JWT 无效：抛出 `ForbiddenException` 或 `UnauthorizedException`，HTTP 状态码分别是 `403` 和 `401`。

这会导致错误响应外形和状态码策略不完全一致。生产项目更推荐让认证失败抛出明确的 HTTP 异常，再使用全局 Exception Filter 统一错误结构。例如，为避免泄漏邮箱是否注册，用户不存在和密码错误可以统一处理：

```ts
throw new UnauthorizedException('邮箱或密码错误')
```

这样既保留正确的 401 状态码，也能避免攻击者通过不同提示批量探测有效账号。

## 十四、当前实现的安全边界与演进方向

这套实现已经完成基础 JWT 认证，但 refresh token 仍是无状态的：服务端没有保存 `jti` 或令牌哈希。因此，签发新令牌后，旧 refresh token 在到期前仍然有效，用户退出登录、修改密码或管理员强制下线时也无法立即撤销它。

面向生产环境，可以继续增加：

1. 保存 refresh token 的 `jti` 或哈希，并关联用户、设备、过期时间。
2. 刷新时执行 token rotation：旧 refresh token 立即失效，只保留新 token。
3. 检测旧 token 被重复使用，一旦发现重放，撤销同一 token family。
4. 退出登录时撤销当前 refresh token，修改密码时撤销该用户全部会话。
5. 显式限制 JWT 算法，并建立密钥轮换策略。
6. 对登录接口增加限流、失败次数统计、审计日志和必要的验证码策略。
7. 浏览器场景优先将 refresh token 放入 `HttpOnly`、`Secure`、合理 `SameSite` 的 Cookie，降低脚本读取风险；同时根据 Cookie 使用方式评估 CSRF 防护。

当前 `AuthService` 注入了 `DataSource`，但基础版本尚未使用它。若暂时不做 refresh token 持久化，可以删除该依赖；若准备实现轮换与撤销，则可以使用事务原子地完成“旧 token 失效 + 新 token 入库”。同样，`TypeOrmModule.forFeature([])` 没有注册实体，也可以在没有认证实体时移除。

## 十五、建议补充的测试

认证属于全局基础能力，至少应通过端到端测试覆盖以下场景：

- 正确邮箱和密码能获得 access token 与 refresh token。
- 邮箱会在查询前去除首尾空格并转换为小写。
- 密码错误、用户不存在、用户禁用时返回预期结果。
- 未携带 Authorization 请求头时，受保护路由返回 401。
- access token 过期、签名错误或 issuer 错误时返回 401。
- refresh token 不能访问 `/user/me`。
- access token 不能调用 `/auth/refresh` 完成刷新。
- 非法 `sub`，例如字符串、负数或非安全整数，会被拒绝。
- 方法级和 Controller 级 `@Public()` 都能正常跳过守卫。
- `/user/me` 返回 token 对应的用户，且响应中不包含密码。

测试时不要只断言状态码，还应验证最终响应 JSON。全局守卫、响应拦截器、序列化拦截器与异常处理共同决定了客户端实际收到的结果。

## 小结

NestJS 登录与路由鉴权可以拆成几条清晰边界：

- DTO 负责输入校验和邮箱规范化。
- Repository 为登录显式读取必要字段，同时让密码在普通查询中保持隐藏。
- `AuthService` 负责账号校验、bcrypt 密码比对、JWT 签发与刷新。
- payload 中的 `type` 隔离 access token 和 refresh token 的用途。
- `AccessTokenGuard` 验证凭证并把可信用户 ID 写入请求上下文。
- `APP_GUARD` 让鉴权默认覆盖所有路由，`@Public()` 只为确实需要匿名访问的端点开白名单。

这套结构不依赖 Passport，代码路径直接，适合需要自主控制 token payload 和错误策略的项目。上线前还应补齐刷新令牌持久化与轮换、统一异常响应、登录限流和端到端测试，才能从“可用的 JWT 登录”进一步演进为“可撤销、可审计的会话系统”。
