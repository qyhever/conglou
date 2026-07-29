---
pubDatetime: 2026-03-11T15:22:00Z
title: NestJS 使用 Swagger 生成接口文档，并接入 Knife4j 主题
slug: nestjs-swagger-knife4j-api-docs
tags:
  - Node.js
  - NestJS
description: "本文基于一个 NestJS 11 项目的实际改造，介绍如何接入 Swagger、启用 Knife4j 主题，并补充统一响应、JWT 鉴权、错误响应、分页查询、枚举、文件上传等进阶用法。"
---

接口文档最怕两件事：一是和代码分离，写完很快过期；二是只描述请求参数，不描述真实响应、鉴权和错误结构。NestJS 官方提供的 `@nestjs/swagger` 可以从 Controller、DTO 和装饰器元数据中生成 OpenAPI 文档，再配合 Knife4j 提供更适合中文团队阅读和调试的文档界面。

本文基于一个 NestJS 11 项目的实际改造，介绍如何接入 Swagger、启用 Knife4j 主题，并补充统一响应、JWT 鉴权、错误响应、分页查询、枚举、文件上传等进阶用法。

## 一、最终效果

完成后，项目会同时提供 3 个文档相关入口：

| 文档入口 | 地址 | 说明 |
| --- | --- | --- |
| Swagger UI | `/api/docs` | `@nestjs/swagger` 默认文档界面 |
| OpenAPI JSON | `/api/docs-json` | 自动生成的 OpenAPI JSON |
| Knife4j | `/api/k4/doc.html` | 基于同一份 OpenAPI JSON 的增强主题 |

启动服务后访问：

```text
http://localhost:3000/api/docs
http://localhost:3000/api/k4/doc.html
```

如果项目通过环境变量修改了端口，请把 `3000` 换成实际端口。

## 二、安装依赖

安装 Swagger 与 Knife4j：

```bash
pnpm add @nestjs/swagger nestjs-knife4j-plus
```

依赖说明：

- `@nestjs/swagger`：NestJS 官方 Swagger 集成，负责生成 OpenAPI 文档与 Swagger UI。
- `nestjs-knife4j-plus`：为 NestJS 提供 Knife4j UI 集成。

本项目当前新增的依赖版本如下：

```json
{
  "dependencies": {
    "@nestjs/swagger": "^11.4.6",
    "nestjs-knife4j-plus": "^1.0.9"
  }
}
```

安装时如果 pnpm 提示构建脚本确认，按照团队依赖安全策略选择即可。本项目的 `pnpm-workspace.yaml` 中已经出现了 `@scarf/scarf` 的构建确认项。

## 三、在启动入口创建 Swagger 文档

在 `src/main.ts` 中引入 `DocumentBuilder`、`SwaggerModule` 和 `knife4jSetup`：

```ts
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { knife4jSetup } from 'nestjs-knife4j-plus'
import { AppModule } from './app.module'
import type { EnvironmentVariables } from './config/environment.validation'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const configService = app.get(ConfigService<EnvironmentVariables, true>)

  app.setGlobalPrefix('api')

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  )

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Neapp API')
    .setDescription('Neapp backend API documentation')
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)

  SwaggerModule.setup('/api/docs', app, document)

  await knife4jSetup(
    app,
    [
      {
        name: 'Neapp API',
        url: '../docs-json',
      },
    ],
    '/api/k4',
  )

  await app.listen(configService.get('PORT', { infer: true }))
}

bootstrap().catch((err) => {
  console.error('启动失败', err)
  process.exit(1)
})
```

这里有几个关键点：

- `app.setGlobalPrefix('api')` 会让业务接口都带上 `/api` 前缀。
- `SwaggerModule.setup('/api/docs', app, document)` 会注册 Swagger UI，同时默认暴露 `/api/docs-json`。
- Knife4j 的 `url: '../docs-json'` 是相对于 `/api/k4/doc.html` 的路径，实际会指向 `/api/docs-json`。
- `addBearerAuth()` 用于声明 JWT 鉴权方案，后续接口再用 `@ApiBearerAuth()` 标记即可。
- `ValidationPipe` 的 `transform: true` 和 `whitelist: true` 不只影响运行时参数处理，也能让 DTO 的设计更贴近接口文档。

## 四、用 `@ApiTags` 按模块分组

Controller 上添加 `@ApiTags()`，可以让文档按业务模块分组。

```ts
import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AppService } from './app.service'
import { Public } from './common/decorators/public.decorator'
import { StringResponseDto } from './common/dto/string-response.dto'

@ApiTags('基础接口')
@Controller()
@Public()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: '获取服务问候语' })
  @ApiOkResponse({ description: '获取成功', type: StringResponseDto })
  @Get()
  getHello(): string {
    return this.appService.getHello()
  }
}
```

常用写法如下：

```ts
@ApiTags('认证')
@Controller('auth')
export class AuthController {}

@ApiTags('用户')
@ApiBearerAuth()
@Controller('user')
export class UserController {}

@ApiTags('文章示例')
@ApiBearerAuth()
@Controller('posts')
export class PostsController {}
```

建议标签名使用中文业务名，例如「用户」「认证」「订单」。这样 Knife4j 左侧导航会更适合中文团队阅读。

## 五、用 DTO 描述请求参数

`class-validator` 负责运行时校验，`@nestjs/swagger` 负责文档描述。两者应该同时写在 DTO 上。

以登录 DTO 为例：

```ts
import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @ApiProperty({ description: '登录邮箱', example: 'testuser@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @IsNotEmpty()
  email!: string

  @ApiProperty({ description: '登录密码', example: 'testpassword' })
  @IsString()
  @IsNotEmpty()
  password!: string
}
```

新增用户 DTO：

```ts
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateUserDto {
  @ApiPropertyOptional({
    description: '头像 URL',
    example: 'https://example.com/avatar.png',
  })
  @IsOptional()
  @IsString()
  avatar?: string

  @ApiProperty({ description: '用户名', example: 'testuser' })
  @IsString()
  @IsNotEmpty()
  username!: string

  @ApiProperty({ description: '昵称', example: '测试用户' })
  @IsString()
  @IsNotEmpty()
  nickname!: string

  @ApiProperty({ description: '邮箱', example: 'testuser@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string

  @ApiProperty({ description: '密码', example: 'testpassword' })
  @IsString()
  @IsNotEmpty()
  password!: string

  @ApiProperty({ description: '是否启用', example: true })
  @IsBoolean()
  isEnabled!: boolean
}
```

装饰器选择建议：

| 装饰器 | 场景 |
| --- | --- |
| `@ApiProperty()` | 必填字段 |
| `@ApiPropertyOptional()` | 可选字段 |
| `@ApiHideProperty()` | 不希望出现在文档中的字段 |

## 六、更新 DTO 使用 `@nestjs/swagger` 的 `PartialType`

很多项目会从 `@nestjs/mapped-types` 引入 `PartialType`：

```ts
import { PartialType } from '@nestjs/mapped-types'
```

如果这个 DTO 会用于 Swagger 文档，更推荐从 `@nestjs/swagger` 引入：

```ts
import { PartialType } from '@nestjs/swagger'
import { CreateUserDto } from './create-user.dto'

export class UpdateUserDto extends PartialType(CreateUserDto) {}
```

原因是 `@nestjs/swagger` 版本的 `PartialType` 会同时保留 Swagger 元数据，让更新接口的请求体也能正确显示字段结构。

文章示例模块同理：

```ts
import { PartialType } from '@nestjs/swagger'
import { CreatePostDto } from './create-post.dto'

export class UpdatePostDto extends PartialType(CreatePostDto) {}
```

## 七、隐藏敏感字段

实体类中经常存在 `password`、`secret`、`token` 等字段。即使响应序列化已经通过 `@Exclude()` 隐藏字段，也建议在 Swagger 文档里同步隐藏。

```ts
import { Column, Entity, Index } from 'typeorm'
import { Exclude } from 'class-transformer'
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger'
import { BaseEntity } from '../../common/entities/base.entity'

@Entity({ name: 'user' })
@Index('uk_user_username', ['username'], { unique: true })
@Index('uk_user_email', ['email'], { unique: true })
export class User extends BaseEntity {
  @ApiProperty({ description: '用户名', example: 'testuser' })
  @Column({ type: 'varchar', length: 50 })
  username!: string

  @ApiHideProperty()
  @Exclude({ toPlainOnly: true })
  @Column({
    type: 'varchar',
    length: 255,
    comment: '密码哈希',
    select: false,
  })
  password!: string
}
```

这里的职责要分清：

- `@Exclude()` 控制运行时响应序列化。
- `@ApiHideProperty()` 控制 Swagger 文档展示。
- `select: false` 控制 TypeORM 默认查询行为。

三者解决的问题不同，不能互相替代。

## 八、为统一响应封装单独建立响应 DTO

如果项目使用全局 `ResponseInterceptor` 把接口统一包装成：

```json
{
  "success": true,
  "data": {},
  "message": "请求成功"
}
```

那么 Swagger 响应也应该描述包装后的真实结构，而不是只写业务实体。

例如字符串响应：

```ts
import { ApiProperty } from '@nestjs/swagger'

export class StringResponseDto {
  @ApiProperty({ description: '请求是否成功', example: true })
  success!: boolean

  @ApiProperty({ description: '字符串响应数据', example: 'Hello World!' })
  data!: string

  @ApiProperty({ description: '响应消息', example: '请求成功' })
  message!: string
}
```

Token 响应：

```ts
import { ApiProperty } from '@nestjs/swagger'

export class TokenDataDto {
  @ApiProperty({ description: '访问令牌', example: 'eyJhbGciOiJIUzI1NiIs...' })
  accessToken!: string

  @ApiProperty({ description: '刷新令牌', example: 'eyJhbGciOiJIUzI1NiIs...' })
  refreshToken!: string
}

export class TokenResponseDto {
  @ApiProperty({ description: '请求是否成功', example: true })
  success!: boolean

  @ApiProperty({ description: 'Token 数据', type: TokenDataDto })
  data!: TokenDataDto

  @ApiProperty({ description: '响应消息', example: '登录成功' })
  message!: string
}
```

用户列表响应：

```ts
export class UserListResponseDto {
  @ApiProperty({ description: '请求是否成功', example: true })
  success!: boolean

  @ApiProperty({ description: '用户列表', type: [UserDataDto] })
  data!: UserDataDto[]

  @ApiProperty({ description: '响应消息', example: '请求成功' })
  message!: string
}
```

这样前端在看文档时，能直接知道接口返回的是 `success/data/message`，而不是误以为接口直接返回 `User`。

## 九、在 Controller 中声明接口说明和响应

认证接口示例：

```ts
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'
import { BusinessErrorResponseDto } from '../common/dto/error-response.dto'
import { TokenResponseDto } from './dto/token-response.dto'

@ApiTags('认证')
@ApiExtraModels(TokenResponseDto, BusinessErrorResponseDto)
@Controller('auth')
export class AuthController {
  @ApiOperation({ summary: '登录' })
  @ApiOkResponse({
    description: '登录成功；用户不存在或密码错误时返回业务失败 envelope',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TokenResponseDto) },
        { $ref: getSchemaPath(BusinessErrorResponseDto) },
      ],
    },
  })
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }
}
```

这里用到了 `oneOf`，用于表达「同一个 HTTP 200 响应下可能有多种业务结构」。例如本项目中，登录失败可能不是抛出 HTTP 异常，而是由统一响应拦截器返回：

```json
{
  "success": false,
  "data": null,
  "message": "用户不存在"
}
```

为了让 `getSchemaPath()` 能引用这些模型，需要在 Controller 上加 `@ApiExtraModels()`：

```ts
@ApiExtraModels(TokenResponseDto, BusinessErrorResponseDto)
```

## 十、声明 JWT 鉴权

全局文档配置中已经通过 `addBearerAuth()` 声明了 Bearer Token：

```ts
const swaggerConfig = new DocumentBuilder()
  .setTitle('Neapp API')
  .setDescription('Neapp backend API documentation')
  .setVersion('1.0.0')
  .addBearerAuth({
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  })
  .build()
```

需要鉴权的 Controller 再添加 `@ApiBearerAuth()`：

```ts
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

@ApiTags('用户')
@ApiBearerAuth()
@Controller('user')
export class UserController {}
```

如果只有部分接口需要鉴权，也可以把 `@ApiBearerAuth()` 写到具体方法上。

在 Swagger UI 或 Knife4j 页面中点击 Authorize，填入：

```text
Bearer <accessToken>
```

有些界面会自动拼接 `Bearer` 前缀，有些不会。若调试时一直返回 401，优先检查最终请求头是否为：

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

## 十一、把常见错误响应封装成装饰器

鉴权失败、用户禁用、refresh token 失效等错误会在很多接口重复出现。可以封装成自定义 Swagger 装饰器，减少 Controller 噪音。

```ts
import {
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  ForbiddenResponseDto,
  UnauthorizedResponseDto,
} from '../dto/error-response.dto'
import { ResponseMessageEnum } from '../enums/response-message.enum'

export const ApiAccessTokenUnauthorizedResponse = () =>
  ApiUnauthorizedResponse({
    description: ResponseMessageEnum.ACCESS_TOKEN_INVALID_OR_EXPIRED,
    type: UnauthorizedResponseDto,
  })

export const ApiRefreshTokenUnauthorizedResponse = () =>
  ApiUnauthorizedResponse({
    description: ResponseMessageEnum.REFRESH_TOKEN_INVALID_OR_EXPIRED,
    type: UnauthorizedResponseDto,
  })

export const ApiUserDisabledForbiddenResponse = () =>
  ApiForbiddenResponse({
    description: ResponseMessageEnum.USER_DISABLED,
    type: ForbiddenResponseDto,
  })
```

使用时直接加在接口上：

```ts
@ApiOperation({ summary: '刷新 token' })
@ApiOkResponse({ description: '刷新成功', type: TokenResponseDto })
@ApiRefreshTokenUnauthorizedResponse()
@ApiUserDisabledForbiddenResponse()
@Post('refresh')
@Public()
@HttpCode(HttpStatus.OK)
refresh(@Body() dto: RefreshTokenDto) {
  return this.authService.refresh(dto.refreshToken)
}
```

这个模式适合封装所有跨模块复用的响应，例如：

- `ApiAccessTokenUnauthorizedResponse()`
- `ApiPermissionForbiddenResponse()`
- `ApiValidationBadRequestResponse()`
- `ApiServerErrorResponse()`

## 十二、描述路径参数和查询参数

路径参数使用 `@ApiParam()`：

```ts
@ApiOperation({ summary: '根据 ID 获取用户' })
@ApiParam({ name: 'id', description: '用户 ID', type: Number, example: 1 })
@ApiOkResponse({ description: '获取成功', type: UserResponseDto })
@Get(':id')
findOne(@Param('id', ParseIntPipe) id: number) {
  return this.userService.findOne(id)
}
```

查询参数建议使用 DTO 承载，尤其是分页、排序、筛选条件较多时。

```ts
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'

export const USER_PAGE_DATE_FIELDS = ['createdAt', 'updatedAt'] as const
export const USER_PAGE_SORT_VALUES = ['asc', 'desc'] as const

const dateTimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

export class FindUsersPageDto {
  @ApiPropertyOptional({ description: '当前页码', example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  currentPage: number = 1

  @ApiPropertyOptional({ description: '每页数量', example: 10, default: 10 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @IsPositive()
  pageSize: number = 10

  @ApiPropertyOptional({
    description: '排序字段',
    enum: USER_PAGE_DATE_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(USER_PAGE_DATE_FIELDS)
  sortField = 'createdAt'

  @ApiPropertyOptional({
    description: '排序方向',
    enum: USER_PAGE_SORT_VALUES,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(USER_PAGE_SORT_VALUES)
  sortValue = 'desc'

  @ApiPropertyOptional({ description: '用户名模糊查询', example: 'admin' })
  @IsOptional()
  @IsString()
  username?: string

  @ApiPropertyOptional({
    description: '日期范围，格式为 YYYY-MM-DD HH:mm:ss。空数组表示不按日期过滤',
    example: ['2026-07-01 00:00:00', '2026-07-31 23:59:59'],
    default: [],
    type: [String],
  })
  @Transform(({ value }: { value: unknown }) => value ?? [])
  @IsArray()
  @ValidateIf((_, value: unknown[]) => value.length > 0)
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @Matches(dateTimePattern, { each: true })
  rangeDate: string[] = []
}
```

Controller 中使用：

```ts
@Get('page')
findPage(@Query() query: FindUsersPageDto) {
  return this.userService.findPage(query)
}
```

当开启 `ValidationPipe({ transform: true })` 后，可以配合 `@Type(() => Number)` 把字符串查询参数转换成数字：

```ts
import { Type } from 'class-transformer'

@ApiPropertyOptional({ description: '当前页码', example: 1, default: 1 })
@Type(() => Number)
@IsOptional()
@IsInt()
@IsPositive()
currentPage: number = 1
```

这点很重要。浏览器传入的 query 参数天然是字符串，如果没有转换，`@IsInt()` 可能会因为收到 `'1'` 而校验失败。

## 十三、常见 Swagger 装饰器速查

| 装饰器 | 用途 |
| --- | --- |
| `@ApiTags()` | 接口分组 |
| `@ApiOperation()` | 接口摘要和说明 |
| `@ApiOkResponse()` | `200 OK` 响应 |
| `@ApiCreatedResponse()` | `201 Created` 响应 |
| `@ApiUnauthorizedResponse()` | `401 Unauthorized` 响应 |
| `@ApiForbiddenResponse()` | `403 Forbidden` 响应 |
| `@ApiParam()` | 路径参数 |
| `@ApiQuery()` | 查询参数 |
| `@ApiBody()` | 请求体 |
| `@ApiBearerAuth()` | Bearer Token 鉴权 |
| `@ApiExtraModels()` | 注册额外模型，常配合 `getSchemaPath()` 使用 |
| `@ApiHideProperty()` | 隐藏模型字段 |
| `@ApiConsumes()` | 声明请求内容类型，例如文件上传 |

如果某个参数已经由 DTO 上的 `@ApiProperty()` 描述，就不需要再用 `@ApiBody()` 手动重复声明。

## 十四、文件上传接口文档

文件上传是 Swagger 中比较特殊的场景，需要显式声明 `multipart/form-data`。

```ts
import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'

@ApiTags('文件')
@Controller('files')
export class FileController {
  @ApiOperation({ summary: '上传单个文件' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '待上传文件',
        },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ description: '上传成功' })
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File) {
    return file.filename
  }
}
```

如果还有额外表单字段，可以继续在 `properties` 中添加字符串、数字或布尔字段。

## 十五、枚举字段和数组字段

枚举字段建议在 `@ApiProperty()` 中显式声明 `enum`：

```ts
export enum UserStatus {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

export class UpdateUserStatusDto {
  @ApiProperty({
    description: '用户状态',
    enum: UserStatus,
    example: UserStatus.Enabled,
  })
  status!: UserStatus
}
```

数组字段需要声明 `type: [String]` 或 `type: [SomeDto]`：

```ts
export class BatchDeleteUserDto {
  @ApiProperty({
    description: '用户 ID 列表',
    example: [1, 2, 3],
    type: [Number],
  })
  ids!: number[]
}
```

嵌套对象同理：

```ts
export class CreateOrderDto {
  @ApiProperty({ description: '订单商品列表', type: [OrderItemDto] })
  items!: OrderItemDto[]
}
```

如果嵌套模型没有被自动收集，可以通过 `@ApiExtraModels(OrderItemDto)` 显式注册。

## 十六、生产环境是否暴露文档

接口文档对内很有价值，但生产环境是否开放需要按项目安全要求决定。常见策略有 3 种：

| 策略 | 适用场景 |
| --- | --- |
| 开发、测试环境开放，生产环境关闭 | 内部系统、管理后台 |
| 生产环境开放但加网关鉴权 | 开放平台、合作方 API |
| 生产环境只暴露 OpenAPI JSON 给文档平台 | 有统一 API 门户的团队 |

可以按环境变量控制：

```ts
const enableSwagger = configService.get('NODE_ENV', { infer: true }) !== 'production'

if (enableSwagger) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Neapp API')
    .setDescription('Neapp backend API documentation')
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('/api/docs', app, document)
}
```

如果生产环境必须开放，建议至少放在内网、VPN、网关鉴权或基础认证之后，不要让后台接口文档裸露在公网。

## 十七、常见问题

### 1. DTO 字段没有出现在文档里

优先检查是否缺少 `@ApiProperty()` 或 `@ApiPropertyOptional()`。TypeScript 类型本身不会自动变成完整的 Swagger 字段说明。

如果使用了 `PartialType`、`PickType`、`OmitType`，建议从 `@nestjs/swagger` 引入，而不是从 `@nestjs/mapped-types` 引入。

### 2. 响应结构和真实接口不一致

如果项目使用了全局响应拦截器，Controller 返回的 `User` 最终可能会被包装成：

```json
{
  "success": true,
  "data": {
    "id": 1,
    "username": "testuser"
  },
  "message": "请求成功"
}
```

这种情况下，`@ApiOkResponse({ type: User })` 就不准确，应该改成 `UserResponseDto`。

### 3. Knife4j 页面打不开接口定义

检查 `knife4jSetup()` 中的 `url` 是否能访问到 OpenAPI JSON。

当前项目中：

```ts
SwaggerModule.setup('/api/docs', app, document)

await knife4jSetup(
  app,
  [
    {
      name: 'Neapp API',
      url: '../docs-json',
    },
  ],
  '/api/k4',
)
```

`/api/k4/doc.html` 中的 `../docs-json` 会解析到 `/api/docs-json`。如果修改了 Swagger UI 路径，也要同步调整 Knife4j 的 `url`。

### 4. Swagger 里点了 Authorize 还是 401

检查请求头是否真的带上了 Bearer Token：

```http
Authorization: Bearer <accessToken>
```

同时确认接口是否正确标记了 `@ApiBearerAuth()`。这个装饰器只影响文档和调试界面，不会替代后端 Guard。

### 5. `@ApiPropertyOptional()` 是否等于运行时可选

不是。`@ApiPropertyOptional()` 只影响文档。运行时是否可选仍然要由 `class-validator` 决定：

```ts
@ApiPropertyOptional({ description: '头像 URL' })
@IsOptional()
@IsString()
avatar?: string
```

如果只写 `@ApiPropertyOptional()`，接口文档会显示可选，但请求校验并不会自动放行。

## 十八、维护建议

Swagger 文档最好的维护方式是让它贴着代码走：

- DTO 字段新增、删除、改名时，同步更新 `@ApiProperty()`。
- 有统一响应拦截器时，为常见响应结构建立专门的响应 DTO。
- 鉴权、错误响应等重复内容封装成自定义装饰器。
- 路径参数使用 `@ApiParam()`，复杂 query 使用查询 DTO。
- 业务失败如果走 HTTP 200 envelope，使用 `oneOf` 明确描述多种响应结构。
- 生产环境按安全策略决定是否暴露 `/api/docs`、`/api/docs-json` 和 `/api/k4/doc.html`。

做到这些后，Swagger 不只是一个临时调试页面，而会成为前后端协作、接口联调和后续自动化生成 SDK 的基础设施。
