---
pubDatetime: 2026-03-10T15:22:00Z
title: NestJS 项目如何检查 Node.js 版本：从版本声明到启动前强校验
slug: nestjs-nodejs-version-check
tags:
  - Node.js
  - NestJS
description: "本文介绍如何在 NestJS 项目中检查 Node.js 版本，包括版本声明、兼容范围声明和执行前校验。"
---

多人协作开发 NestJS 项目时，Node.js 版本不一致很容易引发依赖安装失败、构建结果不同或运行时 API 不兼容等问题。仅在 README 中写一句“请使用某个版本”并不可靠，更稳妥的做法是让仓库本身同时具备版本提示、兼容范围声明和执行前校验能力。

本文基于一个 NestJS 11 项目的实际改造，使用 `.nvmrc`、`package.json#engines` 和 npm scripts 建立 Node.js 版本检查机制。最终约束为：

```text
Node.js ^22.18.0 或 >=24.12.0
```

同时，项目统一使用 pnpm 安装依赖，并在依赖安装和开发服务启动前自动检查 Node.js 版本。

## 为什么要做 Node.js 版本检查

同一个项目在不同 Node.js 版本下，可能出现以下问题：

- 某些依赖使用了旧版本 Node.js 不支持的语法或运行时 API。
- 本地开发正常，但 CI 或部署服务器构建失败。
- lockfile 相同，原生依赖或可选依赖的安装结果却不一致。
- 新成员不知道项目使用哪个版本，只能反复尝试。
- `@types/node` 的类型版本与实际运行时差距过大，出现“类型存在、运行时报错”的情况。

版本约束应该尽可能早地失败。与其让应用运行到一半后暴露晦涩错误，不如在安装依赖或启动开发服务之前给出明确提示。

## 整体方案

本方案包含三层防线：

| 配置 | 作用 | 使用场景 |
| --- | --- | --- |
| `.nvmrc` | 告诉版本管理工具默认使用哪个 Node.js 主版本 | 本地环境切换 |
| `engines.node` | 声明项目支持的 Node.js 版本范围 | 包管理器、CI 和部署平台识别 |
| `check` 脚本 | 主动检查当前运行时，不满足要求就退出 | 安装依赖、启动开发服务前硬校验 |

三者并不重复：`.nvmrc` 解决“应该切换到哪个版本”，`engines` 解决“项目支持哪些版本”，检查脚本解决“不符合要求时必须停止”。

## 1. 使用 `.nvmrc` 统一本地默认版本

在项目根目录创建 `.nvmrc`：

```text
24
```

这里选择 Node.js 24 作为本地默认主版本。使用支持 `.nvmrc` 的 nvm 时，可以在项目根目录执行：

```bash
nvm install
nvm use
node -v
```

命令作用如下：

- `nvm install`：读取 `.nvmrc` 并安装对应版本。
- `nvm use`：切换当前终端使用的 Node.js 版本。
- `node -v`：确认切换后的实际版本。

需要注意，`.nvmrc` 中的 `24` 只指定主版本，并不能表达“至少为 24.12.0”这样的精确下限。因此，真正的兼容范围还要通过 `engines` 和检查脚本约束。

不同版本管理工具对 `.nvmrc` 的支持方式可能不同。如果使用的是 nvm-windows、fnm、Volta 等工具，应根据对应工具的命令读取或手动切换到满足条件的版本。

## 2. 使用 `engines` 声明兼容范围

在 `package.json` 中增加：

```json
{
  "engines": {
    "node": "^22.18.0 || >=24.12.0"
  }
}
```

这个 SemVer 表达式包含两段规则：

- `^22.18.0`：允许 `22.18.0` 及以上、但低于 `23.0.0` 的版本。
- `>=24.12.0`：允许 `24.12.0` 及以上的版本。
- 中间使用 `||`：满足任意一段即可。

因此，Node.js 23 不在支持范围内，Node.js 24 也必须至少达到 24.12.0。

| Node.js 版本 | 是否通过 | 原因 |
| --- | --- | --- |
| `22.17.0` | 否 | 低于 `22.18.0` |
| `22.18.0` | 是 | 满足 `^22.18.0` |
| `22.20.0` | 是 | 仍属于 Node.js 22 |
| `23.11.0` | 否 | 不属于任一范围 |
| `24.11.0` | 否 | 低于 `24.12.0` |
| `24.12.0` | 是 | 满足 `>=24.12.0` |
| `25.0.0` | 是 | 高于 `24.12.0` |

`engines` 是标准化的项目元数据，编辑器、包管理器和部分部署平台可以读取它。不过，不同包管理器和配置对不兼容版本的处理可能只是警告，并不一定终止命令，所以不能只依赖这一项。

## 3. 增加可主动执行的版本检查脚本

在 `scripts` 中添加 `check`：

```json
{
  "scripts": {
    "check": "node -e \"const v=process.versions.node.split('.').map(Number); const ok=(v[0]===22&&v[1]>=18)||(v[0]===24&&v[1]>=12)||v[0]>24; if(!ok){console.error(' 错误: 需要Node.js版本^22.18.0或>=24.12.0，当前版本为'+process.versions.node); process.exit(1)} console.log(' Node.js版本'+process.versions.node+'符合要求')\""
  }
}
```

可以直接执行：

```bash
pnpm run check
```

这里显式写出 `run`，表示执行的是 `package.json` 中定义的项目脚本，命令含义更加清晰。

这段脚本的执行过程如下：

1. 从 `process.versions.node` 读取当前 Node.js 版本，例如 `24.12.0`。
2. 使用 `split('.')` 拆分主版本、次版本和补丁版本。
3. 判断版本是否属于 Node.js 22.18+、Node.js 24.12+ 或高于 Node.js 24。
4. 不满足条件时调用 `process.exit(1)`，让当前命令以失败状态退出。
5. 满足条件时输出当前版本并正常结束。

检查失败时会看到类似输出：

```text
错误: 需要Node.js版本^22.18.0或>=24.12.0，当前版本为22.17.0
```

这里使用 Node.js 自带的 `node -e` 执行内联 JavaScript，不需要额外安装 SemVer 库，适合规则较少的项目。

## 4. 在安装依赖前检查包管理器和 Node.js 版本

项目使用 pnpm，因此可以通过 `preinstall` 同时限制包管理器并执行版本检查：

```json
{
  "scripts": {
    "preinstall": "node -e \"if(!(process.env.npm_config_user_agent||'').startsWith('pnpm/')){console.error('错误：请使用pnpm安装依赖');process.exit(1)}\" && npm run check"
  }
}
```

当执行 `pnpm install` 时，包管理器会触发 `preinstall` 生命周期：

```text
pnpm install
  -> preinstall
    -> 检查 npm_config_user_agent 是否以 pnpm/ 开头
    -> npm run check
      -> 检查 Node.js 版本
  -> 继续安装依赖
```

其中，`npm_config_user_agent` 由包管理器注入。pnpm 的值会以 `pnpm/` 开头；如果使用 npm 或 Yarn 安装，脚本会输出“请使用 pnpm 安装依赖”并退出。

`&&` 表示只有前一个检查成功，才继续执行 `npm run check`。这里的 `npm run check` 只是从生命周期脚本中调用项目脚本，实际安装依赖的包管理器仍然是 pnpm。

## 5. 在开发服务启动前再次检查

开发者可能已经安装过依赖，之后又在终端中切换了 Node.js 版本。因此，只有 `preinstall` 还不够，还需要在开发服务启动前检查：

```json
{
  "scripts": {
    "predev": "npm run check",
    "dev": "nest start --watch",
    "start": "npm run dev",
    "start:dev": "npm run dev"
  }
}
```

npm scripts 会自动执行与目标命令同名的 `pre` 脚本。运行下面任一命令时，最终都会进入 `dev`，并先触发 `predev`：

```bash
pnpm dev
pnpm start
pnpm start:dev
```

执行链路如下：

```text
pnpm dev
  -> predev
    -> check
  -> nest start --watch
```

如果版本不符合要求，`check` 返回退出码 `1`，NestJS 开发服务器不会启动。

## 6. 完整配置

与版本检查相关的 `package.json` 配置如下：

```json
{
  "engines": {
    "node": "^22.18.0 || >=24.12.0"
  },
  "scripts": {
    "check": "node -e \"const v=process.versions.node.split('.').map(Number); const ok=(v[0]===22&&v[1]>=18)||(v[0]===24&&v[1]>=12)||v[0]>24; if(!ok){console.error(' 错误: 需要Node.js版本^22.18.0或>=24.12.0，当前版本为'+process.versions.node); process.exit(1)} console.log(' Node.js版本'+process.versions.node+'符合要求')\"",
    "preinstall": "node -e \"if(!(process.env.npm_config_user_agent||'').startsWith('pnpm/')){console.error('错误：请使用pnpm安装依赖');process.exit(1)}\" && npm run check",
    "predev": "npm run check",
    "dev": "nest start --watch",
    "start": "npm run dev",
    "start:dev": "npm run dev"
  }
}
```

项目根目录还需要保留：

```text
.nvmrc
package.json
pnpm-lock.yaml
```

## 7. 如何验证配置

先检查当前环境：

```bash
node -v
pnpm -v
pnpm run check
```

然后分别验证安装和启动流程：

```bash
pnpm install
pnpm dev
```

建议至少覆盖以下场景：

- 使用符合要求的 Node.js 版本执行 `pnpm run check`，命令应成功。
- 使用低于 22.18.0 的版本执行 `pnpm run check`，命令应失败。
- 使用 Node.js 23 执行 `pnpm run check`，命令应失败。
- 使用 npm 执行依赖安装，`preinstall` 应提示改用 pnpm。
- 使用符合要求的版本执行 `pnpm dev`，检查通过后 NestJS 应正常启动。

## 8. CI 和部署环境中的使用方式

CI 中应显式安装满足范围的 Node.js 版本，然后主动运行检查：

```bash
node -v
corepack enable
pnpm run check
pnpm install --frozen-lockfile
pnpm build
```

命令作用如下：

- `node -v`：在日志中记录实际使用的 Node.js 版本，便于排查环境问题。
- `corepack enable`：启用随 Node.js 分发的包管理器代理。
- `pnpm run check`：在安装和构建前主动验证版本。
- `pnpm install --frozen-lockfile`：严格按照 lockfile 安装，避免 CI 中意外更新依赖解析结果。
- `pnpm build`：构建 NestJS 项目。

即使 `pnpm install` 会触发 `preinstall`，在 CI 中单独执行 `pnpm run check` 仍有价值：失败位置更明确，日志也更容易阅读。

## 9. 常见问题

### `.nvmrc` 已经写了 24，为什么还会检查失败

`.nvmrc` 不会自动改变所有终端和 CI 的 Node.js 版本，它只是版本管理工具可以读取的提示文件。另外，`24` 只限定主版本；如果实际切换到 `24.11.0`，仍然不满足 `>=24.12.0`。

先执行以下命令确认实际版本：

```bash
node -v
nvm use
node -v
```

### 配置了 `engines`，为什么安装时没有中断

`engines` 的强制程度取决于包管理器及其配置，有时只会产生警告。当前方案使用 `preinstall` 和 `predev` 主动执行检查，确保关键流程能够以非零退出码停止。

### 为什么不直接判断版本字符串

字符串比较不符合版本号的数值语义。例如，按字符串比较时，`"22.9.0"` 和 `"22.18.0"` 可能得到错误结论。当前脚本先把各段转换成数字，再比较主版本和次版本。

### 版本规则变更时要修改哪些地方

至少需要同步修改：

1. `.nvmrc` 中推荐使用的版本。
2. `package.json` 中的 `engines.node`。
3. `check` 脚本中的判断条件和错误提示。
4. CI、容器镜像及部署平台中的 Node.js 版本。

如果只改其中一处，就可能出现声明范围与实际校验逻辑不一致的问题。

## 10. 进一步优化

内联脚本的优点是零依赖、改动集中；缺点是版本规则变复杂后可读性会下降。如果未来要支持更多主版本、预发布版本，或者需要完全复用 SemVer 语义，可以把逻辑迁移到独立脚本，并使用成熟的 SemVer 实现统一解析。

无论采用哪种实现，都建议继续保留“推荐版本、兼容声明、执行前校验”这三个层次。这样既能降低新成员配置环境的成本，也能让本地开发、CI 和生产构建尽早暴露版本不一致问题。
