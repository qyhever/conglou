---
pubDatetime: 2026-03-19T15:22:00Z
title: NestJS 如何使用 Docker 部署项目
slug: nestjs-docker-deploy
featured: true
tags:
  - Node.js
  - NestJS
  - Docker
description: "在 NestJS 中基于 Docker 实现项目部署，采用「本地构建镜像 + scp 上传镜像包」的部署方式。"
---

在 NestJS 项目进入生产环境后，部署方式会直接影响交付效率、环境一致性和线上故障排查成本。如果仍然在服务器上手动安装依赖、执行构建、切换 Node.js 版本，很容易出现「本地能跑、线上不能跑」的问题。

Docker 的价值在于把应用、Node.js 运行时、生产依赖和启动命令封装进同一个镜像。服务器只需要具备 Docker 和 Docker Compose，就可以按固定流程加载镜像、启动容器、挂载日志目录并执行健康检查。

本文结合 NestJS 后端项目的 `Dockerfile`、`docker-compose.yml` 和 `scripts/deploy.sh`，总结一套可直接落地的 Docker 部署方案：本地构建镜像、压缩上传到服务器、远程加载镜像、使用 Docker Compose 重建服务，并通过 `/api/meta` 完成发布后的健康验证。

## 一、整体部署思路

不使用远程镜像仓库，而是采用「本地构建镜像 + scp 上传镜像包」的部署方式。

完整流程如下：

```text
本地开发机
  ├── 检查 Docker、ssh、scp、gzip 等命令
  ├── 读取 package.json version 作为默认镜像版本
  ├── 通过 ssh 检测远程服务器 CPU 架构
  ├── 使用 docker buildx 构建对应平台镜像
  ├── docker save 导出镜像
  └── gzip 压缩后上传到远程服务器

远程服务器
  ├── 创建部署目录
  ├── 接收镜像包、docker-compose.yml、.env、.env.production
  ├── gzip 解压并 docker load 导入镜像
  ├── 使用 Docker Compose 强制重建容器
  ├── 等待 Docker healthcheck 通过
  └── 请求 /api/meta 做最终服务检查
```

这种方式的核心优点是简单、直观、不依赖镜像仓库。对于个人项目、小团队内部系统或单机部署场景，它的维护成本很低。

## 二、项目目录约定

部署相关文件：

```text
app-backend/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── .env
├── .env.production
└── scripts/
    └── deploy.sh
```

几个关键文件的职责如下：

- `Dockerfile`：定义 NestJS 应用如何构建成 Docker 镜像

- `docker-compose.yml`：定义服务器上如何启动容器、加载环境变量、挂载日志、配置健康检查

- `.env`：基础环境配置，会被上传到远程部署目录

- `.env.production`：生产环境配置，会被上传到远程部署目录

- `scripts/deploy.sh`：一键部署脚本，负责构建、打包、上传、远程启动和健康检查

## 三、准备 NestJS 生产启动命令

Docker 镜像最终启动的是编译后的 JavaScript 文件，而不是 `nest start --watch` 这种开发命令。

`package.json` 中，生产启动命令是：

```json
{
  "scripts": {
    "build": "node scripts/meta.mjs && nest build",
    "start:prod": "NODE_ENV=production node dist/main"
  }
}
```

这里有两个关键点：

- `pnpm build` 会先执行 `scripts/meta.mjs` 更新 `public/meta.json`，再通过 `nest build` 编译到 `dist/`

- `pnpm start:prod` 会设置 `NODE_ENV=production`，然后执行 `node dist/main`

因此 Dockerfile 只需要在构建阶段生成 `dist/`，在运行阶段安装生产依赖并执行 `pnpm start:prod`。

## 四、编写多阶段 Dockerfile

使用 Node.js `24.12.0-alpine`，并通过 Docker 多阶段构建减少最终镜像体积。

```dockerfile
# 使用Node.js官方镜像作为基础镜像
# 阶段1: 构建应用
FROM node:24.12.0-alpine AS builder

WORKDIR /app

# 保证时区一致
ENV TZ=Asia/Shanghai

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

# 阶段2: 运行应用
FROM node:24.12.0-alpine AS runner

WORKDIR /app

# 保证运行时区一致
ENV TZ=Asia/Shanghai

# 复制package.json和pnpm-lock.yaml
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 启用package.json中固定版本的pnpm
RUN corepack enable

# 安装生产依赖
RUN pnpm install --prod --frozen-lockfile

# 从构建阶段复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# 暴露8300端口
EXPOSE 8300

# 启动应用
CMD ["pnpm", "start:prod"]
```

这份 Dockerfile 分成两个阶段。

第一阶段是 `builder`：

- 设置工作目录为 `/app`

- 设置容器时区为 `Asia/Shanghai`

- 复制 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`

- 通过 `corepack enable` 启用 `package.json` 中声明的 `pnpm@11.9.0`

- 使用 `pnpm install --frozen-lockfile` 按锁文件安装完整依赖

- 复制项目全部源码

- 执行 `pnpm build` 生成 `dist/` 和更新后的 `public/`

第二阶段是 `runner`：

- 使用同样的 Node.js 运行时，避免构建环境和运行环境版本不一致

- 只安装生产依赖：`pnpm install --prod --frozen-lockfile`

- 从 `builder` 阶段复制 `dist/` 和 `public/`

- 暴露默认端口 `8300`

- 使用 `pnpm start:prod` 启动 NestJS 应用

多阶段构建的好处是：最终镜像不需要保留 TypeScript 源码编译过程中产生的临时状态，也不需要安装 devDependencies，生产镜像更干净。

## 五、使用 Docker Compose 管理容器

镜像负责「应用如何构建」，Compose 负责「应用如何运行」。

`docker-compose.yml` 内容如下：

```yaml
services:
  app:
    image: ${IMAGE_NAME:-app-backend}:${IMAGE_TAG:-1.0.0}
    container_name: app-backend
    network_mode: host
    ports:
      - "8300:8300"
    env_file:
      - .env
      - .env.production
    environment:
      NODE_ENV: production
    volumes:
        - ./logs:/app/logs
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:' + (process.env.PORT || 8300) + '/api/meta')
          .then((response) => { if (!response.ok) process.exit(1) })
          .catch(() => process.exit(1))
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s
    init: true
    restart: unless-stopped
```

这里有几处部署关键点。

### 1. 镜像名和版本由环境变量控制

```yaml
image: ${IMAGE_NAME:-app-backend}:${IMAGE_TAG:-1.0.0}
```

Compose 启动时会读取 `IMAGE_NAME` 和 `IMAGE_TAG`。如果没有传入，则默认使用：

```text
app-backend:1.0.0
```

部署脚本会在远程执行时导出这两个变量：

```bash
export IMAGE_NAME IMAGE_TAG
```

这样每次部署都可以启动指定版本的镜像，而不是固定写死镜像 tag。

### 2. 使用 host 网络

```yaml
network_mode: host
ports:
  - "8300:8300"
```

`network_mode: host` 表示容器直接使用宿主机网络。对于 Linux 服务器来说，NestJS 在容器内监听 `8300`，宿主机也可以直接通过 `8300` 访问。

需要注意：使用 host 网络时，`ports` 映射实际不会再起传统桥接网络的端口转发作用，但保留它可以表达应用默认端口，方便阅读配置。

### 3. 加载多份环境变量文件

```yaml
env_file:
  - .env
  - .env.production
environment:
  NODE_ENV: production
```

容器会加载远程部署目录下的 `.env` 和 `.env.production`。同时，Compose 明确设置：

```text
NODE_ENV=production
```

这和 NestJS 应用内部的配置加载逻辑保持一致。基础配置可以放在 `.env`，生产专用配置放在 `.env.production`，避免把所有配置都混在一个文件里。

### 4. 挂载日志目录

```yaml
volumes:
    - ./logs:/app/logs
```

容器内 `/app/logs` 会映射到远程部署目录下的 `logs/`。

这样做的好处是：容器重建或镜像升级后，日志文件仍保留在宿主机上，便于排查线上问题。

### 5. 配置健康检查

```yaml
healthcheck:
  test:
    - CMD
    - node
    - -e
    - >-
      fetch('http://127.0.0.1:' + (process.env.PORT || 8300) + '/api/meta')
      .then((response) => { if (!response.ok) process.exit(1) })
      .catch(() => process.exit(1))
  interval: 5s
  timeout: 3s
  retries: 12
  start_period: 10s
```

健康检查会在容器内部请求：

```text
http://127.0.0.1:${PORT || 8300}/api/meta
```

只要接口返回非 2xx 状态，或者请求失败，健康检查就会失败。

这要求 NestJS 应用必须提供 `/api/meta` 接口。部署脚本也会在容器启动后再次请求这个接口，作为发布完成前的最终检查。

### 6. 启用 init 和自动重启

```yaml
init: true
restart: unless-stopped
```

`init: true` 会让 Docker 在容器中注入一个轻量 init 进程，用来正确处理子进程和系统信号。

`restart: unless-stopped` 表示容器异常退出后自动重启，除非人工显式停止容器。对于后端服务来说，这是一个常见的生产配置。

## 六、编写一键部署脚本

部署入口是：

```bash
app-backend/scripts/deploy.sh
```

它可以直接执行：

```bash
cd app-backend
./scripts/deploy.sh
```

也可以指定镜像版本：

```bash
cd app-backend
./scripts/deploy.sh 1.0.1
```

如果不传版本号，脚本会读取 `package.json` 中的 `version`：

```bash
IMAGE_TAG="${1:-$(node -p "require('${PROJECT_DIR}/package.json').version")}"
```

也就是说，默认会使用：

```text
app-backend:1.0.0
```

### 1. 定义部署默认值

脚本开头定义了几个关键变量：

```bash
REMOTE_HOST="${REMOTE_HOST:-kr}"
REMOTE_DIR="${REMOTE_DIR:-/opt/apps/app-backend}"
IMAGE_NAME="${IMAGE_NAME:-app-backend}"
IMAGE_TAG="${1:-$(node -p "require('${PROJECT_DIR}/package.json').version")}"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
BASE_ENV_FILE="${PROJECT_DIR}/.env"
PROD_ENV_FILE="${PROJECT_DIR}/.env.production"
FULL_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"
```

默认部署目标是：

```text
REMOTE_HOST=kr
REMOTE_DIR=/opt/apps/app-backend
IMAGE_NAME=app-backend
```

如果要部署到其他服务器，可以在执行命令前覆盖环境变量：

```bash
cd app-backend
REMOTE_HOST=root@example.com REMOTE_DIR=/opt/apps/app-backend ./scripts/deploy.sh 1.0.1
```

如果要修改镜像名称，也可以覆盖 `IMAGE_NAME`：

```bash
cd app-backend
IMAGE_NAME=registry-free/app-backend ./scripts/deploy.sh 1.0.1
```

### 2. 校验镜像版本格式

脚本会先校验镜像 tag 是否符合 Docker tag 规则：

```bash
if [[ ! "${IMAGE_TAG}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "错误：镜像版本格式无效：${IMAGE_TAG}" >&2
  exit 1
fi
```

合法示例：

```text
1.0.0
1.0.1
release-20260726
```

不建议使用包含空格、中文或特殊符号的版本号。

### 3. 检查本地依赖命令

脚本要求本地必须安装以下命令：

```bash
for command_name in docker ssh scp gzip; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "错误：未找到命令 ${command_name}" >&2
    exit 1
  fi
done
```

这些命令分别负责：

- `docker`：构建、导出镜像

- `ssh`：远程执行命令

- `scp`：上传镜像包和配置文件

- `gzip`：压缩镜像包，减少传输体积

脚本还会检查 Docker daemon 是否已经启动：

```bash
if ! docker info >/dev/null 2>&1; then
  echo "错误：Docker daemon 未运行，请先启动 Docker Desktop。" >&2
  exit 1
fi
```

在 macOS 上，如果 Docker Desktop 没有启动，部署会在这里中断。

### 4. 自动识别远程服务器架构

部署脚本会通过 `uname -m` 获取远程服务器 CPU 架构：

```bash
REMOTE_ARCH="$(ssh "${REMOTE_HOST}" 'uname -m' | tr -d '\r' | tail -n 1)"
```

然后映射成 Docker 平台：

```bash
case "${REMOTE_ARCH}" in
  x86_64 | amd64)
    DEFAULT_PLATFORM="linux/amd64"
    ;;
  aarch64 | arm64)
    DEFAULT_PLATFORM="linux/arm64"
    ;;
  *)
    echo "错误：不支持的远程服务器架构：${REMOTE_ARCH}" >&2
    exit 1
    ;;
esac
```

这一步很重要。比如本地是 Apple Silicon Mac，但服务器是 x86_64。如果直接构建本机架构镜像，传到服务器后可能无法运行。

脚本最终使用：

```bash
PLATFORM="${PLATFORM:-${DEFAULT_PLATFORM}}"
```

如果有特殊需求，也可以手动指定平台：

```bash
cd app-backend
PLATFORM=linux/amd64 ./scripts/deploy.sh 1.0.1
```

### 5. 构建指定平台镜像

核心构建命令是：

```bash
docker buildx build \
  --platform "${PLATFORM}" \
  --tag "${FULL_IMAGE}" \
  --load \
  "${PROJECT_DIR}"
```

参数说明：

- `--platform "${PLATFORM}"`：按远程服务器架构构建镜像

- `--tag "${FULL_IMAGE}"`：设置镜像名和版本号

- `--load`：把 buildx 构建结果加载到本地 Docker 镜像列表

- `"${PROJECT_DIR}"`：使用后端项目根目录作为构建上下文

构建完成后，本地会出现类似镜像：

```text
app-backend:1.0.0
```

### 6. 导出并压缩镜像

构建完成后，脚本会把镜像导出成 tar 包，并使用 gzip 压缩：

```bash
docker save "${FULL_IMAGE}" | gzip -c >"${ARCHIVE_PATH}"
```

压缩文件名由镜像名和版本号组成：

```bash
ARCHIVE_NAME="${IMAGE_NAME//\//-}-${IMAGE_TAG}.tar.gz"
```

例如：

```text
app-backend-1.0.0.tar.gz
```

临时文件会放在 `mktemp -d` 创建的目录中，并在脚本退出时自动清理：

```bash
cleanup() {
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT
```

### 7. 上传文件到远程服务器

脚本会先创建远程部署目录：

```bash
ssh "${REMOTE_HOST}" bash -s -- "${REMOTE_DIR}" <<'REMOTE_PREPARE'
set -Eeuo pipefail
mkdir -p "$1"
REMOTE_PREPARE
```

然后上传镜像包、Compose 文件和环境变量文件：

```bash
scp "${ARCHIVE_PATH}" "${COMPOSE_FILE}" "${BASE_ENV_FILE}" "${REMOTE_HOST}:${REMOTE_DIR}/"
scp "${ARCHIVE_PATH}" "${COMPOSE_FILE}" "${PROD_ENV_FILE}" "${REMOTE_HOST}:${REMOTE_DIR}/"
```

远程目录最终会包含：

```text
/opt/apps/app-backend/
├── docker-compose.yml
├── .env
├── .env.production
├── app-backend-1.0.0.tar.gz
└── logs/
```

其中 `logs/` 会在容器运行时作为宿主机日志目录使用。

## 七、远程加载镜像并启动服务

上传完成后，部署脚本会通过 ssh 在远程服务器执行发布逻辑。

### 1. 检查生产配置文件

远程部署前必须存在 `.env.production`：

```bash
if [[ ! -f .env.production ]]; then
  echo "错误：远程配置文件 ${REMOTE_DIR}/.env.production 不存在。" >&2
  exit 1
fi
```

因为脚本会上传 `.env.production`，正常情况下不会缺失。这个检查主要用于防止手动部署或上传失败时继续启动服务。

### 2. 检查远程 Docker 与 Compose

远程服务器必须安装 Docker 和 gzip：

```bash
for command_name in docker gzip; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "错误：远程服务器未安装 ${command_name}。" >&2
    exit 1
  fi
done
```

Compose 支持两种命令形式：

```bash
if docker compose version >/dev/null 2>&1; then
  COMPOSE_COMMAND=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_COMMAND=(docker-compose)
else
  echo "错误：远程服务器未安装 Docker Compose。" >&2
  exit 1
fi
```

也就是说，新版 Docker Compose V2 和旧版 `docker-compose` V1 都能兼容。

### 3. 导入镜像

远程服务器收到的是 `.tar.gz` 镜像包，需要先解压再导入 Docker：

```bash
gzip -dc "${ARCHIVE_NAME}" | docker load
```

导入成功后，远程服务器就拥有本次部署的镜像：

```text
app-backend:1.0.0
```

### 4. 兼容旧版 Docker Compose

脚本中有一段对 Docker Compose V1 的兼容逻辑：

```bash
if [[ "${COMPOSE_VERSION}" =~ (^|[[:space:]])v?1\. ]]; then
  echo "检测到旧版 Docker Compose，正在移除旧容器以兼容新版 Docker Engine"
  "${COMPOSE_COMMAND[@]}" down --remove-orphans
fi
```

原因是 Python 版 Docker Compose `1.29.2` 和新版 Docker Engine 的部分镜像元数据不兼容，直接 recreate 旧容器时可能因为缺少 `ContainerConfig` 字段而失败。

当前部署本来就要求强制重建容器，所以对旧版 Compose 先执行 `down --remove-orphans`，不会改变发布语义，只是让部署过程更稳定。

### 5. 使用 Compose 强制重建容器

真正启动服务的命令是：

```bash
"${COMPOSE_COMMAND[@]}" up -d --no-build --remove-orphans --force-recreate
```

参数说明：

- `up -d`：后台启动服务

- `--no-build`：不在服务器上构建镜像，只使用已经 `docker load` 的镜像

- `--remove-orphans`：移除 Compose 文件中已经不存在的孤儿容器

- `--force-recreate`：即使配置看起来没有变化，也强制重建容器

启动后，脚本会打印服务状态：

```bash
"${COMPOSE_COMMAND[@]}" ps
```

然后获取 `app` 服务的容器 ID：

```bash
CONTAINER_ID="$("${COMPOSE_COMMAND[@]}" ps -q app)"
```

如果找不到容器，脚本会输出最近 100 行日志并终止部署：

```bash
"${COMPOSE_COMMAND[@]}" logs --tail=100 app >&2 || true
```

## 八、等待健康检查通过

容器启动不代表服务已经可用。NestJS 还需要完成配置加载、数据库连接、模块初始化等工作。

因此脚本会等待 Docker healthcheck 进入 `healthy` 状态：

```bash
HEALTH_TIMEOUT=90
HEALTH_DEADLINE=$((SECONDS + HEALTH_TIMEOUT))

while ((SECONDS < HEALTH_DEADLINE)); do
  HEALTH_STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${CONTAINER_ID}")"

  case "${HEALTH_STATUS}" in
    healthy)
      echo "服务健康检查已通过"
      break
      ;;
    unhealthy)
      echo "错误：服务健康检查失败。" >&2
      "${COMPOSE_COMMAND[@]}" logs --tail=100 app >&2 || true
      exit 1
      ;;
    starting)
      sleep 2
      ;;
    *)
      echo "错误：容器健康状态异常：${HEALTH_STATUS}" >&2
      "${COMPOSE_COMMAND[@]}" logs --tail=100 app >&2 || true
      exit 1
      ;;
  esac
done
```

这里最多等待 90 秒。健康状态可能有几种：

- `starting`：服务仍在启动，继续等待

- `healthy`：健康检查通过，可以继续下一步

- `unhealthy`：健康检查失败，打印日志并终止

- `none` 或其他值：说明容器没有正常提供健康检查状态，打印日志并终止

如果超过 90 秒仍未变成 `healthy`，脚本会认为部署失败：

```bash
if [[ "${HEALTH_STATUS}" != healthy ]]; then
  echo "错误：等待服务健康检查超时（${HEALTH_TIMEOUT} 秒）。" >&2
  "${COMPOSE_COMMAND[@]}" logs --tail=100 app >&2 || true
  exit 1
fi
```

## 九、发布后的接口检查

健康检查通过后，脚本还会在容器内执行一次接口请求：

```bash
"${COMPOSE_COMMAND[@]}" exec -T app node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 8300) + '/api/meta').then((response) => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.text(); }).then((body) => console.log('服务检查通过：' + body))"
```

这一步和 Docker healthcheck 请求的是同一个接口：

```text
/api/meta
```

区别在于，healthcheck 只关心成功或失败；这一步会输出接口响应内容，方便确认当前运行版本、构建信息或服务元数据。

检查完成后，脚本会删除远程服务器上的镜像压缩包：

```bash
rm -f "${ARCHIVE_NAME}"
```

最后输出：

```text
部署完成：app-backend:1.0.0
```

## 十、服务器首次部署准备

首次使用这套方案前，需要先准备远程服务器环境。

### 1. 安装 Docker

服务器需要安装 Docker Engine。安装完成后确认版本：

```bash
docker version
docker info
```

### 2. 安装 Docker Compose

优先使用 Docker Compose V2：

```bash
docker compose version
```

如果服务器只安装了旧版命令，也可以：

```bash
docker-compose version
```

当前脚本兼容两种形式。

### 3. 配置 SSH 登录

本地需要能通过 `REMOTE_HOST` 免密或正常登录服务器。

默认目标是：

```bash
ssh kr
```

如果本机 `~/.ssh/config` 中配置了 `kr`，可以直接使用默认值。否则执行部署时需要显式指定：

```bash
cd app-backend
REMOTE_HOST=root@your-server-ip ./scripts/deploy.sh 1.0.0
```

### 4. 确认生产环境变量

部署脚本会上传本地后端项目中的 `.env` 和 `.env.production`。因此执行发布前，要确认这两个文件已经包含生产运行所需配置。

常见配置包括：

```text
PORT=8300
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=neocrown
DB_USERNAME=...
DB_PASSWORD=...
JWT_SECRET=...
```

如果数据库不在同一台服务器，`DB_HOST` 应该填写数据库服务器地址。

如果数据库运行在同一台服务器，并且应用容器使用 `network_mode: host`，那么应用访问 `127.0.0.1:3306` 时访问的是宿主机网络上的 MySQL。

## 十一、常用部署命令

使用 `package.json` 中的版本号部署：

```bash
cd app-backend
./scripts/deploy.sh
```

指定版本号部署：

```bash
cd app-backend
./scripts/deploy.sh 1.0.1
```

部署到指定服务器：

```bash
cd app-backend
REMOTE_HOST=root@example.com ./scripts/deploy.sh 1.0.1
```

部署到指定远程目录：

```bash
cd app-backend
REMOTE_DIR=/opt/apps/app-backend ./scripts/deploy.sh 1.0.1
```

指定构建平台：

```bash
cd app-backend
PLATFORM=linux/amd64 ./scripts/deploy.sh 1.0.1
```

组合使用：

```bash
cd app-backend
REMOTE_HOST=root@example.com REMOTE_DIR=/opt/apps/app-backend PLATFORM=linux/amd64 ./scripts/deploy.sh 1.0.1
```

## 十二、常用排障命令

查看远程容器状态：

```bash
ssh kr
cd /opt/apps/app-backend
docker compose ps
```

查看应用日志：

```bash
ssh kr
cd /opt/apps/app-backend
docker compose logs -f app
```

查看最近 100 行日志：

```bash
ssh kr
cd /opt/apps/app-backend
docker compose logs --tail=100 app
```

查看健康检查状态：

```bash
ssh kr
docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' app-backend
```

手动请求健康检查接口：

```bash
ssh kr
curl http://127.0.0.1:8300/api/meta
```

进入容器执行命令：

```bash
ssh kr
cd /opt/apps/app-backend
docker compose exec app sh
```

重启服务：

```bash
ssh kr
cd /opt/apps/app-backend
docker compose restart app
```

停止服务：

```bash
ssh kr
cd /opt/apps/app-backend
docker compose down
```

## 十三、常见问题

### 1. Docker daemon 未运行

本地执行部署时如果出现：

```text
错误：Docker daemon 未运行，请先启动 Docker Desktop。
```

说明本地 Docker Desktop 没有启动。启动 Docker Desktop 后重新执行：

```bash
cd app-backend
./scripts/deploy.sh
```

### 2. 镜像版本格式无效

如果版本号包含空格、中文或特殊符号，会触发：

```text
错误：镜像版本格式无效
```

推荐使用语义化版本或日期版本：

```bash
./scripts/deploy.sh 1.0.1
./scripts/deploy.sh release-20260726
```

### 3. 远程服务器架构不支持

脚本只支持：

```text
x86_64 / amd64
aarch64 / arm64
```

如果远程 `uname -m` 返回其他值，脚本会中断。可以先登录服务器确认：

```bash
ssh kr 'uname -m'
```

### 4. 健康检查失败

健康检查失败通常有几类原因：

- `.env.production` 缺少必填环境变量

- 数据库连接失败

- `PORT` 配置和实际监听端口不一致

- `/api/meta` 接口不存在或返回非 2xx 状态

- 应用启动时抛出异常

优先查看日志：

```bash
ssh kr
cd /opt/apps/app-backend
docker compose logs --tail=100 app
```

### 5. 容器启动了但无法访问

当前 Compose 使用 `network_mode: host`，在 Linux 服务器上应用会直接监听宿主机端口。

先在服务器本机检查：

```bash
curl http://127.0.0.1:8300/api/meta
```

如果本机可以访问，但外网不能访问，重点检查：

- 云服务器安全组是否开放 `8300`

- 系统防火墙是否放行 `8300`

- Nginx 或网关反向代理是否配置正确

## 十四、为什么不在服务器上构建镜像

很多部署方案会把源码上传到服务器，然后在服务器上执行：

```bash
docker compose build
docker compose up -d
```

当前没有这么做，而是本地构建后上传镜像包。

这种方式有几个好处：

- 服务器不需要安装 Node.js 和 pnpm

- 服务器不需要拉取 npm 依赖，避免网络波动影响部署

- 构建产物在本地生成，失败更容易排查

- 远程服务器只负责运行镜像，职责更单一

- 可以根据远程 CPU 架构提前构建正确平台的镜像

代价是每次部署需要上传完整镜像包。如果镜像较大、服务器带宽较低，上传会比镜像仓库增量拉取慢。项目规模变大后，可以考虑接入私有镜像仓库或 CI/CD。

## 十五、可以继续优化的方向

当前方案已经能稳定完成单机部署，但还可以继续增强。

### 1. 接入镜像仓库

如果部署频率提高，可以改成：

```bash
docker buildx build --platform linux/amd64 -t your-registry/app-backend:1.0.1 --push .
```

远程服务器再执行：

```bash
docker compose pull
docker compose up -d
```

这样可以减少手动传输镜像包的成本，也更适合 CI/CD。

### 2. 增加自动回滚

当前脚本在健康检查失败时会中断并打印日志，但不会自动回滚到上一个版本。

如果需要更强的生产保障，可以在远程保留上一版本镜像 tag，并在健康检查失败后执行：

```bash
IMAGE_TAG=previous-version docker compose up -d --no-build --force-recreate
```

回滚逻辑要谨慎设计，尤其是涉及数据库迁移时，应用版本回滚不一定意味着数据结构也能回滚。

### 3. 增加 Nginx 反向代理

生产环境通常不会直接暴露 `8300`，可以在宿主机上用 Nginx 代理到本地端口：

```nginx
server {
  listen 80;
  server_name api.example.com;

  location / {
    proxy_pass http://127.0.0.1:8300;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

这样可以统一处理域名、HTTPS、访问日志、限流和网关层配置。

## 十六、总结

NestJS 使用 Docker 部署的关键不是单纯写一个 Dockerfile，而是把构建、运行、配置、日志、健康检查和发布脚本串成一条可靠链路。

当前的部署方案可以总结为：

- `Dockerfile` 使用多阶段构建，构建阶段生成 `dist/`，运行阶段只安装生产依赖

- `docker-compose.yml` 负责加载环境变量、挂载日志目录、设置重启策略和健康检查

- `deploy.sh` 负责本地构建镜像、按远程架构选择平台、压缩上传、远程加载镜像、强制重建服务

- `/api/meta` 同时承担 Docker 健康检查和发布后验证的职责

对于单机 NestJS 服务来说，这套方案已经具备生产部署需要的核心能力：环境一致、流程可重复、失败可见、发布后可验证。后续如果接入镜像仓库、CI/CD、自动回滚和 Nginx HTTPS，就可以自然演进成更完整的生产发布体系。
