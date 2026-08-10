---
pubDatetime: 2026-07-04T15:22:00Z
title: 使用 GitHub Actions 自动化部署 Nodejs 前后端
slug: nestjs-github-actions-auto-deploy
tags:
  - Node.js
  - NestJS
  - GitHub Actions
  - CI/CD
  - Docker
  - Vue
description: ""
---

自动化部署的核心价值，不是把 `ssh` 命令搬到云端执行一次，而是把“构建、传输、发布、验证”这些容易出错的步骤固定下来。GitHub Actions 部署链路：前端构建后通过 `rsync` 同步到 Nginx 目录，后端构建 Docker 镜像后上传到服务器，再用 Docker Compose 启动并执行健康检查。

## 部署目标

现在 有一个前后端分离项目：

- `application-frontend`：Vue + Vite PC Web 端，构建产物为 `dist/`。
- `application-backend`：Node.js + NestJS 后端，使用 Docker 镜像和 Docker Compose 发布。

自动化部署后，发布动作由 GitHub Actions 统一触发：

1. 拉取仓库代码。
2. 安装指定版本的 pnpm 和 Node.js。
3. 安装项目依赖。
4. 配置 SSH 私钥和服务器指纹。
5. 调用对应子项目的 `scripts/deploy.sh`。
6. 前端同步静态文件，后端重建容器并完成健康检查。

当前两个 workflow 都使用 `workflow_dispatch` 手动触发。也就是说，代码推送后不会自动发布，需要在 GitHub 仓库的 Actions 页面手动点击运行。这适合生产环境部署，因为它把“合并代码”和“发布上线”分开了。

## 一、GitHub Secrets 配置

部署服务器信息不应该写进仓库，需要放到 GitHub 仓库的 Secrets 中。

进入 GitHub 仓库：

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

添加以下 Secrets：

| Secret 名称 | 说明 |
| --- | --- |
| `SERVER_HOST` | 服务器公网 IP 或域名，例如 `example.com` |
| `SERVER_PORT` | SSH 端口，不配置时 workflow 默认使用 `22` |
| `SERVER_USER` | SSH 登录用户，例如 `root` 或 `deploy` |
| `SERVER_SSH_RSA` | 用于登录服务器的 SSH 私钥内容 |

`SERVER_SSH_RSA` 必须是私钥全文，例如：

```text
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

建议为部署单独创建 SSH key，不要复用个人主力私钥：

```bash
ssh-keygen -t ed25519 -C "github-actions-application" -f ~/.ssh/application_actions
ssh-copy-id -i ~/.ssh/application_actions.pub -p 22 user@example.com
```

然后把 `~/.ssh/application_actions` 的内容配置到 `SERVER_SSH_RSA`。

如果服务器禁用了 `ssh-copy-id`，可以手动追加公钥：

```bash
cat ~/.ssh/application_actions.pub
```

复制输出内容，追加到服务器用户的 `~/.ssh/authorized_keys`。

## 二、前端自动化部署流程

前端 workflow 位于：

```text
.github/workflows/deploy-frontend.yml
```

它的关键步骤如下。

### 1. 手动触发部署

```yaml
on:
  workflow_dispatch:
```

`workflow_dispatch` 表示部署需要人工点击触发。这样可以避免每次 push 都直接影响线上环境。

如果后续希望合并到 `main` 后自动部署，可以恢复文件中已经预留的 `push` 配置：

```yaml
on:
  push:
    branches:
      - main
    paths:
      - 'application-frontend/**'
      - '.github/workflows/deploy-frontend.yml'
  workflow_dispatch:
```

`paths` 的作用是限制触发范围：只有前端目录或前端 workflow 变化时才触发前端部署。

### 2. 固定构建环境

workflow 先安装 pnpm，再通过 `.nvmrc` 指定 Node.js 版本：

```yaml
- name: Set up pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 10

- name: Set up Node.js
  uses: actions/setup-node@v4
  with:
    node-version-file: application-frontend/.nvmrc
    cache: pnpm
    cache-dependency-path: application-frontend/pnpm-lock.yaml
```

这里有两个重要点：

- `node-version-file` 让 GitHub Actions 使用项目声明的 Node.js 版本。
- `cache: pnpm` 和 `cache-dependency-path` 让依赖缓存跟 `pnpm-lock.yaml` 绑定，减少重复安装耗时。

安装依赖时使用：

```yaml
pnpm install --frozen-lockfile
```

这会要求 `package.json` 与 `pnpm-lock.yaml` 保持一致。如果 lockfile 没有同步提交，部署会直接失败，避免线上构建使用不确定的依赖版本。

### 3. 配置 SSH

前端和后端 workflow 都包含同一段 SSH 配置逻辑：

```bash
: "${SERVER_HOST:?SERVER_HOST secret is required}"
: "${SERVER_PORT:?SERVER_PORT secret is required}"
: "${SERVER_SSH_RSA:?SERVER_SSH_RSA secret is required}"
install -m 700 -d ~/.ssh
printf '%s\n' "$SERVER_SSH_RSA" | tr -d '\r' > ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
ssh-keygen -y -f ~/.ssh/id_rsa > /dev/null
ssh-keyscan -T 10 -p "$SERVER_PORT" -H "$SERVER_HOST" >> ~/.ssh/known_hosts
chmod 600 ~/.ssh/known_hosts
```

这段脚本做了三件事：

- 校验必要 Secret 是否存在。
- 写入私钥并校验它是否是合法 SSH private key。
- 使用 `ssh-keyscan` 写入服务器 host key，避免 CI 环境交互式确认。

### 4. 构建并同步静态文件

前端最终调用：

```bash
bash application-frontend/scripts/deploy.sh
```

脚本会执行：

```bash
pnpm build
rsync -avz --delete -e "ssh -p $DEPLOY_SSH_PORT" dist/ "${DEPLOY_TARGET}:/var/www/html/application/"
```

这里的部署目标由 GitHub Actions 注入：

```bash
DEPLOY_TARGET="${SERVER_USER}@${SERVER_HOST}"
DEPLOY_SSH_PORT="${SERVER_PORT:-22}"
```

`rsync --delete` 表示目标目录会和本次构建产物保持一致，线上已经不存在于 `dist/` 的旧文件会被删除。这对 Vite 这类带 hash 的静态资源很重要，否则服务器目录可能长期堆积历史文件。

服务器上需要提前准备好 Nginx 静态目录：

```bash
sudo mkdir -p /var/www/html/application
sudo chown -R user:user /var/www/html/application
```

把 `user:user` 替换为 `SERVER_USER` 对应的用户和用户组。

## 三、后端自动化部署流程

后端 workflow 位于：

```text
.github/workflows/deploy-backend.yml
```

第二次提交重点修正了后端 workflow：它不再使用旧项目的 `bluespot-backend` 路径，也不再设置 Go 环境，而是改为 application 后端实际需要的 pnpm 和 Node.js。

### 1. 后端构建环境

当前后端配置为：

```yaml
- name: Set up pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 11.9.0

- name: Set up Node.js
  uses: actions/setup-node@v4
  with:
    node-version-file: application-backend/.nvmrc
    cache: pnpm
    cache-dependency-path: application-backend/pnpm-lock.yaml
```

后端 `package.json` 中声明了：

```json
"packageManager": "pnpm@11.9.0"
```

因此 workflow 使用 `pnpm/action-setup@v4` 安装 `11.9.0`，可以让 CI 环境和项目声明保持一致。

### 2. 调用后端部署脚本

后端部署前，workflow 会显式校验部署目标：

```bash
: "${SERVER_HOST:?SERVER_HOST secret is required}"
: "${SERVER_PORT:?SERVER_PORT secret is required}"
: "${SERVER_USER:?SERVER_USER secret is required}"
REMOTE_HOST="${SERVER_USER}@${SERVER_HOST}" \
DEPLOY_SSH_PORT="${SERVER_PORT}" \
bash application-backend/scripts/deploy.sh
```

这一步把 GitHub Secrets 转换成部署脚本理解的环境变量：

| workflow 环境变量 | 部署脚本变量 | 用途 |
| --- | --- | --- |
| `SERVER_USER` + `SERVER_HOST` | `REMOTE_HOST` | SSH 连接目标 |
| `SERVER_PORT` | `DEPLOY_SSH_PORT` | SSH/SCP 端口 |

这样做的好处是部署脚本仍然可以在本地使用。没有传入 `REMOTE_HOST` 时，它会继续默认使用本机 `~/.ssh/config` 中的 `kr`。

### 3. 后端脚本做了什么

`application-backend/scripts/deploy.sh` 的发布逻辑可以拆成六步。

第一步，确定镜像版本：

```bash
IMAGE_TAG="${1:-$(node -p "require('${PROJECT_DIR}/package.json').version")}"
```

如果没有传入参数，就读取 `package.json` 的 `version`。当前后端默认镜像名和版本类似：

```text
application-backend:1.0.0
```

第二步，校验 SSH 端口：

```bash
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-}"
```

如果配置了端口，脚本会检查它是否是 `1-65535` 之间的数字，并分别生成 `ssh -p` 和 `scp -P` 参数。

第三步，探测服务器 CPU 架构：

```bash
ssh "$REMOTE_HOST" 'uname -m'
```

脚本会根据返回值选择 Docker 构建平台：

| 服务器架构 | Docker platform |
| --- | --- |
| `x86_64` / `amd64` | `linux/amd64` |
| `aarch64` / `arm64` | `linux/arm64` |

这一步可以避免在 Apple Silicon 本机或不同架构的 CI 环境里构建出服务器无法运行的镜像。

第四步，构建并打包镜像：

```bash
docker buildx build \
  --platform "${PLATFORM}" \
  --tag "${FULL_IMAGE}" \
  --load \
  "${PROJECT_DIR}"

docker save "${FULL_IMAGE}" | gzip -c >"${ARCHIVE_PATH}"
```

这里没有推送到镜像仓库，而是把镜像保存为压缩包，再通过 SSH 上传。这种方式适合私有小项目：少一个镜像仓库依赖，链路更直接。

第五步，上传部署文件：

```bash
scp "${SCP_ARGS[@]}" "${ARCHIVE_PATH}" "${COMPOSE_FILE}" "${REMOTE_HOST}:${REMOTE_DIR}/"
upload_env_file "${BASE_ENV_FILE}" ".env"
upload_env_file "${PROD_ENV_FILE}" ".env.production"
```

默认远程目录为：

```text
/opt/apps/application-backend
```

脚本会先检查远程目录是否存在：如果已存在就跳过创建，不存在才执行 `mkdir -p`。

随后脚本会始终上传：

- 镜像压缩包。
- `docker-compose.yml`。

对于环境配置文件，脚本会分别检查远程目录下是否已有对应文件：

- 远程已有 `.env` 时，跳过上传 `.env`。
- 远程已有 `.env.production` 时，跳过上传 `.env.production`。
- 远程缺少对应文件时，才从本地上传。
- 如果远程和本地都没有对应文件，脚本会报错退出。

这样可以把 `.env` 和 `.env.production` 长期维护在服务器侧，不需要把生产环境配置提交到仓库，也不会因为 GitHub Actions 工作区缺少这些文件导致 `scp` 失败。

第六步，远程启动并检查服务：

```bash
gzip -dc "${ARCHIVE_NAME}" | docker load
docker compose up -d --no-build --remove-orphans --force-recreate
docker compose ps
```

脚本兼容两种 Compose 命令：

- `docker compose`
- `docker-compose`

如果检测到旧版 Docker Compose 1.x，脚本会先执行：

```bash
docker compose down --remove-orphans
```

这是为了解决 Python 版 Docker Compose 1.29.2 与新版 Docker Engine 镜像元数据不兼容的问题。

服务启动后，脚本会等待 Docker healthcheck 变为 `healthy`，并额外请求后端接口：

```bash
fetch('http://127.0.0.1:' + (process.env.PORT || 8300) + '/api/meta')
```

只有容器健康检查和接口检查都通过，部署才算完成。

## 四、服务器需要提前准备什么

GitHub Actions 负责构建和触发部署，但服务器运行环境仍需要提前安装。

### 前端服务器

前端使用 Nginx 或其他静态文件服务。当前脚本默认同步到：

```text
/var/www/html/application/
```

需要确保部署用户对该目录有写权限：

```bash
sudo mkdir -p /var/www/html/application
sudo chown -R deploy:deploy /var/www/html/application
```

如果 Nginx 配置了其他目录，需要同步修改 `application-frontend/scripts/deploy.sh` 中的目标路径。

### 后端服务器

后端服务器需要安装：

- Docker
- Docker Compose v2，或兼容的 `docker-compose`
- gzip

可以用以下命令快速检查：

```bash
docker version
docker compose version || docker-compose version
gzip --version
```

后端默认使用 host 网络，服务端口来自 `.env` 或默认 `8300`。如果服务器上已有服务占用该端口，需要先调整后端配置。

## 五、如何执行一次发布

进入 GitHub 仓库页面：

1. 点击 `Actions`。
2. 选择 `Deploy Frontend` 或 `Deploy Backend`。
3. 点击 `Run workflow`。
4. 选择分支。
5. 确认运行。

建议发布顺序：

1. 如果只是前端页面变化，只运行 `Deploy Frontend`。
2. 如果只是后端接口变化，只运行 `Deploy Backend`。
3. 如果前后端接口契约同时变化，先发布后端，再发布前端。

发布后可以在服务器上检查：

```bash
docker ps --filter name=application-backend
docker logs --tail=100 application-backend
curl http://127.0.0.1:8300/api/meta
```

前端可以检查静态文件是否已经同步：

```bash
ls -lah /var/www/html/application
```

## 六、常见失败原因

### 1. `SERVER_SSH_RSA is not a valid SSH private key`

说明 `SERVER_SSH_RSA` 内容不是合法私钥。常见原因：

- 复制时漏了首尾行。
- 把公钥 `.pub` 填进了 Secret。
- Windows 换行导致格式异常。

workflow 中已经使用 `tr -d '\r'` 处理 CRLF，但仍需要保证私钥内容完整。

### 2. `Unable to fetch SSH host key`

说明 GitHub Actions 无法通过 `SERVER_HOST:SERVER_PORT` 获取服务器 host key。检查：

- 服务器 IP 或域名是否正确。
- SSH 端口是否正确。
- 云厂商安全组是否允许 GitHub Actions 出站访问。
- 服务器防火墙是否放行该端口。

### 3. `pnpm install --frozen-lockfile` 失败

说明依赖清单和 lockfile 不一致。本地更新 lockfile 后提交：

```bash
cd application-frontend
pnpm install
git add package.json pnpm-lock.yaml
git commit -m "chore: update frontend lockfile"
```

后端同理：

```bash
cd application-backend
pnpm install
git add package.json pnpm-lock.yaml
git commit -m "chore: update backend lockfile"
```

### 4. 后端健康检查超时

后端脚本会等待容器健康状态变为 `healthy`，超时时会输出最近日志。排查重点：

- `.env.production` 是否包含正确的数据库、Redis、邮件等生产配置。
- 后端端口是否为 `8300`，或 `PORT` 是否正确。
- `/api/meta` 是否能在容器内访问。
- 服务器资源是否不足导致启动过慢。

可以登录服务器手动查看：

```bash
cd /opt/apps/application-backend
docker compose ps
docker compose logs --tail=200 app
```

## 七、这套方案适合什么场景

这套部署方案适合个人项目、小团队项目和单服务器生产环境：

- 不需要额外维护 Jenkins。
- 不依赖镜像仓库。
- 前后端可以独立发布。
- workflow 手动触发，适合生产环境控制节奏。
- 后端带健康检查，失败时能及时中断。

如果项目继续增长，可以进一步演进：

- 使用 GitHub Environments 增加生产环境审批。
- 把 `.env.production` 从仓库移到 GitHub Secrets 或服务器侧。
- 后端镜像推送到 GHCR，再由服务器拉取镜像。
- 增加测试步骤，例如 `pnpm lint`、`pnpm test`、`pnpm build`。
- 增加部署通知，例如企业微信、飞书或 Slack。
