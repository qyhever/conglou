---
pubDatetime: 2026-05-19T15:22:00Z
title: VSCode REST Client：用 `.http` 文件调试和管理 API
slug: vscode-rest-client
tags:
  - VSCode
  - REST
  - API
  - 工具
description: "VSCode 的 REST Client 插件允许我们直接在 `.http` 或 `.rest` 文件中编写并发送 HTTP 请求。请求是普通文本，可以和代码一起维护、进行 Git 版本管理，也能通过变量和响应引用串联登录、鉴权等操作。"
---

在后端开发中，我们经常需要验证接口是否可用：发送一个登录请求、复制返回的 token、把 token 填到下一个请求，再观察响应结果。Postman、Apifox 等图形化工具很适合完整的接口管理，但如果只是开发阶段快速调试接口，频繁离开编辑器会打断编码节奏。

VSCode 的 REST Client 插件允许我们直接在 `.http` 或 `.rest` 文件中编写并发送 HTTP 请求。请求是普通文本，可以和代码一起维护、进行 Git 版本管理，也能通过变量和响应引用串联登录、鉴权等操作。

本文将从安装和基本语法开始，逐步介绍变量、环境切换、JWT 请求串联、文件上传以及常用配置，并以一个运行在 `http://localhost:3000` 的 NestJS 服务作为示例。

## 一、安装 REST Client

在 VSCode 扩展市场搜索 `REST Client`，安装由 Huachao Mao 发布、扩展 ID 为 `humao.rest-client` 的插件。

也可以在已经配置好 `code` 命令的终端中执行：

```bash
code --install-extension humao.rest-client
```

安装完成后，在项目中新建一个 `.http` 文件，例如：

```text
rest/
├── app.http
├── auth.http
├── user.http
└── posts.http
```

建议按业务模块拆分文件。这样既容易查找，也能避免所有请求都堆积在一个文件中。

## 二、发送第一个请求

在 `rest/app.http` 中写入：

```http
GET http://localhost:3000/health HTTP/1.1
```

把光标放在请求区域内，使用下面任意一种方式发送请求：

- 点击请求上方的 `Send Request`。
- Windows/Linux 按 `Ctrl+Alt+R`，macOS 按 `Cmd+Alt+R`。
- 打开命令面板，执行 `Rest Client: Send Request`。
- 在编辑器中右键，选择 `Send Request`。

插件会在 VSCode 中打开响应面板，其中包含状态码、耗时、响应头和响应体。重新发送上一次请求可以使用 `Ctrl+Alt+L`；取消正在执行的请求可以使用 `Ctrl+Alt+K`。

HTTP 方法不区分大小写，但推荐统一使用大写，让请求文件更容易阅读：

```http
GET http://localhost:3000/posts

POST http://localhost:3000/posts

PUT http://localhost:3000/posts/1

PATCH http://localhost:3000/posts/1

DELETE http://localhost:3000/posts/1
```

`HTTP/1.1` 可以省略，因此下面两种写法都可以：

```http
GET http://localhost:3000/posts HTTP/1.1
```

```http
GET http://localhost:3000/posts
```

## 三、在一个文件中编写多个请求

使用 `###` 分隔多个请求，分隔符后面的文本可以作为请求说明：

```http
### 查询文章列表
GET http://localhost:3000/posts

### 查询文章详情
GET http://localhost:3000/posts/1

### 删除文章
DELETE http://localhost:3000/posts/1
```

普通注释可以使用 `#` 或 `//`：

```http
# 查询当前用户
// 该接口需要 access token
GET http://localhost:3000/user/me
```

分隔请求后，编辑器会为每个请求分别显示 `Send Request`。只要光标位于对应区域内，快捷键也只会发送当前请求。

## 四、设置请求头和 JSON 请求体

请求头写在请求行下方，请求头与请求体之间必须保留一个空行：

```http
POST http://localhost:3000/user
Content-Type: application/json
Accept: application/json

{
  "username": "testuser",
  "email": "testuser@example.com",
  "password": "testpassword",
  "nickname": "Test User",
  "isEnabled": true
}
```

这里的空行不能省略，否则插件可能把 JSON 内容当成请求头解析。发送表单数据时，应修改 `Content-Type` 并使用相应的正文格式：

```http
POST http://localhost:3000/auth/login
Content-Type: application/x-www-form-urlencoded

email=testuser%40example.com&password=testpassword
```

带查询参数的 GET 请求可以写成一行：

```http
GET http://localhost:3000/posts?page=1&pageSize=10&keyword=nestjs
```

参数较多时可以换行，便于阅读和修改：

```http
GET http://localhost:3000/posts
  ?page=1
  &pageSize=10
  &keyword=nestjs
```

## 五、使用文件变量消除重复内容

使用 `@变量名 = 值` 定义文件变量，使用 `{{变量名}}` 引用变量：

```http
@hostname = localhost
@port = 3000
@baseUrl = http://{{hostname}}:{{port}}
@postId = 1

### 查询文章列表
GET {{baseUrl}}/posts

### 查询文章详情
GET {{baseUrl}}/posts/{{postId}}
```

文件变量只在当前 `.http` 文件中生效，适合存放端口、基础路径、分页参数和测试资源 ID 等内容。变量可以互相引用，因此可以先分别声明主机和端口，再组合成 `baseUrl`。

不要把真实密码、长期 token 或生产环境密钥直接写进会提交到 Git 的 `.http` 文件。即使请求文件只用于测试，凭据一旦进入 Git 历史，后续仅删除文件也不能真正清除泄漏记录。

## 六、配置开发、测试和生产环境

当同一组请求需要访问不同服务时，可以在 VSCode 配置中使用 `rest-client.environmentVariables` 定义环境变量：

```json
{
  "rest-client.environmentVariables": {
    "$shared": {
      "apiVersion": "v1"
    },
    "local": {
      "baseUrl": "http://localhost:3000",
      "email": "testuser@example.com",
      "password": "testpassword"
    },
    "test": {
      "baseUrl": "https://test-api.example.com",
      "email": "api-tester@example.com",
      "password": "replace-with-local-secret"
    },
    "production": {
      "baseUrl": "https://api.example.com"
    }
  }
}
```

请求文件中直接引用对应变量：

```http
GET {{baseUrl}}/{{apiVersion}}/posts
```

切换环境有两种常用方式：

- 点击 VSCode 右下角显示的 REST Client 环境名称。
- Windows/Linux 按 `Ctrl+Alt+E`，macOS 按 `Cmd+Alt+E`。

`$shared` 中的变量对所有环境可用；具体环境如果声明了同名变量，会覆盖共享值。自定义变量重名时，请求变量的优先级高于文件变量，文件变量又高于环境变量。

团队共享的 `.vscode/settings.json` 只适合保存不敏感的地址和默认值。账号、密码和 token 应放在不提交到仓库的个人配置中，或者在执行时通过输入变量提供。

### 使用 Prompt 变量临时输入敏感值

在请求前添加 `# @prompt 变量名`，发送请求时插件会弹出输入框：

```http
@baseUrl = http://localhost:3000

# @prompt password
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "email": "testuser@example.com",
  "password": "{{password}}"
}
```

Prompt 变量只对当前请求生效，插件不会把输入值写回 `.http` 文件，适合临时输入密码或验证码。

### 从操作系统环境变量读取 token

REST Client 还可以通过 `$processEnv` 读取当前 VSCode 进程可见的环境变量。以 PowerShell 为例，先在启动 VSCode 的终端中设置变量：

```powershell
$env:REST_CLIENT_TOKEN = 'replace-with-your-token'
code .
```

然后在请求中读取：

```http
GET {{baseUrl}}/user/me
Authorization: Bearer {{$processEnv REST_CLIENT_TOKEN}}
```

这种方式不会把 token 写入请求文件。环境变量由进程在启动时继承，如果在 VSCode 启动后才通过另一个终端设置，当前编辑器窗口通常无法读取，需要从设置好变量的终端重新启动 VSCode。

## 七、通过命名请求串联登录和鉴权

REST Client 最实用的能力之一，是从前一个响应中读取数据并用于后续请求。这样无需手动复制 JWT。

假设登录接口返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi..."
  }
}
```

可以使用 `# @name` 为请求命名，再通过 `请求名.response.body` 引用响应体：

```http
@baseUrl = http://localhost:3000

### 登录
# @name login
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "email": "testuser@example.com",
  "password": "testpassword"
}

### 查询当前用户
GET {{baseUrl}}/user/me
Authorization: Bearer {{login.response.body.$.data.accessToken}}
```

执行顺序如下：

1. 先发送 `login` 请求。
2. 插件在当前会话中保存该请求的响应。
3. 再发送“查询当前用户”请求。
4. 插件读取登录响应中的 `data.accessToken`，替换 Authorization 请求头中的变量。

这里的 `$` 表示 JSON 响应体的根节点。如果登录接口直接返回 `accessToken`，引用应改为：

```http
Authorization: Bearer {{login.response.body.$.accessToken}}
```

还可以引用响应头。例如登录接口通过响应头返回 token：

```http
Authorization: Bearer {{login.response.headers.X-Auth-Token}}
```

如果插件提示变量无法解析，首先确认命名请求已经成功执行，并检查引用路径是否与真实响应结构一致。关闭 VSCode 或重新加载窗口后，通常也需要重新执行产生数据的请求。

## 八、完成 access token 刷新流程

登录、访问受保护接口、刷新令牌可以写成一个完整的调试链路：

```http
@baseUrl = http://localhost:3000

### 1. 登录并获取令牌
# @name login
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "email": "testuser@example.com",
  "password": "testpassword"
}

### 2. 使用 access token 访问受保护接口
GET {{baseUrl}}/user/me
Authorization: Bearer {{login.response.body.$.data.accessToken}}

### 3. 使用 refresh token 获取新令牌
# @name refresh
POST {{baseUrl}}/auth/refresh-token
Content-Type: application/json

{
  "refreshToken": "{{login.response.body.$.data.refreshToken}}"
}

### 4. 使用刷新后的 access token 再次访问
GET {{baseUrl}}/user/me
Authorization: Bearer {{refresh.response.body.$.data.accessToken}}
```

这种写法把接口调用顺序和依赖关系直接保存在代码仓库中。其他开发者只需修改测试账号，就能复现完整的认证流程。

需要注意，REST Client 的请求引用不是自动化工作流。发送第四个请求不会自动执行前三个请求，仍然需要开发者按顺序手动发送。需要在 CI 中自动执行的接口测试，应该使用 Jest、Vitest、Supertest 或专门的 API 测试工具实现。

## 九、使用系统变量生成动态数据

REST Client 内置了一些系统变量。系统变量以 `$` 开头，适合生成不会重复的测试数据：

```http
@baseUrl = http://localhost:3000

POST {{baseUrl}}/user
Content-Type: application/json

{
  "username": "user_{{$timestamp}}",
  "email": "user_{{$guid}}@example.com",
  "password": "testpassword",
  "nickname": "User {{$randomInt 1000 9999}}"
}
```

常用系统变量如下：

| 变量 | 作用 |
| --- | --- |
| `{{$guid}}` | 生成 GUID |
| `{{$timestamp}}` | 生成 Unix 时间戳 |
| `{{$datetime iso8601}}` | 生成 ISO 8601 格式时间 |
| `{{$randomInt 1 100}}` | 生成指定范围内的随机整数 |

自定义变量写作 `{{baseUrl}}`，系统变量写作 `{{$guid}}`，两者不要混淆。

## 十、上传文件和发送 multipart/form-data

上传文件通常使用 `multipart/form-data`。边界字符串必须和请求体中的分隔符保持一致：

```http
@baseUrl = http://localhost:3000

POST {{baseUrl}}/files/upload
Content-Type: multipart/form-data; boundary=WebAppBoundary

--WebAppBoundary
Content-Disposition: form-data; name="description"

用户头像
--WebAppBoundary
Content-Disposition: form-data; name="file"; filename="avatar.png"
Content-Type: image/png

< ./fixtures/avatar.png
--WebAppBoundary--
```

`< ./fixtures/avatar.png` 表示读取相对于当前 `.http` 文件的本地文件内容。需要同时提交普通字段和文件时，为每个字段创建一个 part，并用相同的 boundary 分隔。

如果接口接收的是整个二进制文件，而不是 multipart 表单，可以直接把文件作为请求体：

```http
PUT {{baseUrl}}/files/avatar.png
Content-Type: image/png

< ./fixtures/avatar.png
```

## 十一、Basic Auth、Cookie 和自定义请求头

Basic Auth 可以直接写在 Authorization 请求头中：

```http
GET {{baseUrl}}/admin/status
Authorization: Basic admin testpassword
```

Bearer Token 的写法为：

```http
GET {{baseUrl}}/user/me
Authorization: Bearer {{accessToken}}
```

手动携带 Cookie：

```http
GET {{baseUrl}}/profile
Cookie: sessionId=replace-with-session-id; theme=dark
```

也可以添加业务自定义请求头：

```http
GET {{baseUrl}}/orders
X-Request-Id: {{$guid}}
X-Tenant-Id: demo
Accept-Language: zh-CN
```

## 十二、从 cURL 导入或复制为 cURL

REST Client 能识别常见的 cURL 请求。可以把下面的内容直接放入 `.http` 文件并发送：

```bash
curl --request POST \
  --url http://localhost:3000/auth/login \
  --header 'Content-Type: application/json' \
  --data '{"email":"testuser@example.com","password":"testpassword"}'
```

插件只支持常用 cURL 参数，并不是完整的 cURL 运行时。如果复杂命令执行结果与终端不同，应回到原生 `curl` 命令验证。

反过来，也可以把 `.http` 中的请求复制成 cURL：将光标放到请求区域，打开命令面板并执行 `Rest Client: Copy Request As cURL`。这在向其他开发者提供复现命令时很方便。

## 十三、推荐的项目组织方式

一个中小型后端项目可以采用下面的结构：

```text
rest/
├── fixtures/
│   └── avatar.png
├── app.http
├── auth.http
├── posts.http
└── user.http
```

每个文件只维护一个业务模块。例如 `rest/user.http`：

```http
@baseUrl = http://localhost:3000

### 创建用户
POST {{baseUrl}}/user
Content-Type: application/json

{
  "username": "testuser",
  "email": "testuser@example.com",
  "password": "testpassword",
  "nickname": "Test User",
  "isEnabled": true
}

### 查询用户列表
GET {{baseUrl}}/user

### 查询当前用户
GET {{baseUrl}}/user/me
Authorization: Bearer {{accessToken}}
```

维护请求文件时建议遵循这些约定：

- 使用 `### 动词 + 资源` 描述请求，例如 `### 创建用户`。
- HTTP 方法统一大写，URL 路径与后端路由保持一致。
- 公共地址用变量表示，避免在每个请求中重复修改。
- 示例数据使用明显的测试账号，不使用真实用户信息。
- 提交前检查文件中是否存在 token、Cookie、密码和内部生产地址。
- 请求文件用于开发调试，自动化断言仍放在正式测试代码中。

## 十四、常见问题排查

### 1. 请求上方没有 `Send Request`

确认文件后缀是 `.http` 或 `.rest`，并检查 VSCode 右下角的语言模式是否为 `HTTP`。如果插件刚安装完成，可以执行 `Developer: Reload Window` 重新加载窗口。

### 2. JSON 请求返回 400 或服务端读取不到正文

检查是否设置了正确的请求头：

```http
Content-Type: application/json
```

同时确认请求头与 JSON 之间存在一个空行，并检查 JSON 是否有多余逗号、缺少引号等语法问题。

### 3. `{{variable}}` 无法解析

依次检查：

- 变量名拼写和大小写是否一致。
- 是否选择了包含该变量的环境。
- 文件变量是否声明在请求文件中。
- 被引用的命名请求是否已经成功执行。
- 响应路径是否与实际 JSON 层级一致。

### 4. 返回 401 Unauthorized

检查 `Authorization` 格式是否完整：

```http
Authorization: Bearer {{accessToken}}
```

`Bearer` 与 token 之间必须有空格。还要确认 token 没有过期，并且没有误把 refresh token 当作 access token 使用。

### 5. HTTPS 请求出现证书错误

开发环境使用自签名服务端证书时，REST Client 可能拒绝连接。正确的解决方式是把签发该证书的本地 CA 加入操作系统信任链，并确保证书中的主机名与请求地址一致。

如果服务端要求双向 TLS（mTLS），可以通过 `rest-client.certificates` 配置客户端证书：

```json
{
  "rest-client.certificates": {
    "localhost:3443": {
      "cert": "C:/certs/client.crt",
      "key": "C:/certs/client.key"
    }
  }
}
```

客户端证书用于向服务端证明调用方身份，并不能让客户端自动信任自签名的服务端证书，这两个问题不要混淆。不要通过长期关闭 TLS 校验来掩盖证书配置错误。

### 6. 代理导致请求无法访问

REST Client 可以使用 VSCode 的代理配置。先检查 `http.proxy`，再确认操作系统代理、VPN 和目标服务的网络访问策略。排查时可以用终端中的 `curl` 请求同一地址，对比是插件配置问题还是网络本身不可达。

## 十五、REST Client 适合什么场景

REST Client 特别适合以下场景：

- 后端开发过程中快速验证接口。
- 把可执行的 HTTP 示例与业务代码一起维护。
- 复现登录、刷新令牌和资源访问等连续操作。
- Code Review 时直接查看接口请求发生了什么变化。
- 为新成员提供最小可运行的接口调用示例。

它并不能完全替代专业 API 平台。复杂 Mock Server、团队权限管理、可视化接口设计、大规模自动化测试和测试报告仍然更适合由专门工具承担。一个实用的分工方式是：OpenAPI 负责接口规范，REST Client 负责开发期手动调试，测试框架负责可重复执行的自动化验证。

## 总结

REST Client 的核心价值，是把接口调试过程变成可阅读、可修改、可版本管理的纯文本文件。掌握下面几项能力，就足以覆盖大多数日常后端调试需求：

1. 使用 `.http` 文件和 `###` 组织请求。
2. 使用 `@name = value` 与 `{{name}}` 复用变量。
3. 使用环境变量切换 local、test 和 production 地址。
4. 使用 `# @name` 和响应引用串联登录、鉴权与刷新令牌。
5. 避免把真实密码、token 和 Cookie 提交到 Git。

从一个简单的 `GET` 请求开始，把项目中经常手动调试的接口逐步整理到 `rest/` 目录，就能获得一套轻量、透明且与代码同步演进的接口调试文档。

## 参考资料

- [REST Client - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)
- [REST Client - GitHub](https://github.com/Huachao/vscode-restclient)
