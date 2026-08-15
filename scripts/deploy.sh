#!/bin/bash

set -euo pipefail

DEPLOY_SSH_PORT=""

# GitHub Actions 通过环境变量指定服务器；本地继续兼容 ~/.ssh/config 中的 qyhever。
if [ -n "${SERVER_HOST:-}" ] && [ -n "${SERVER_USER:-}" ]; then
    DEPLOY_TARGET="${SERVER_USER}@${SERVER_HOST}"
    DEPLOY_SSH_PORT="${SERVER_PORT:-22}"
elif [ -z "${SERVER_HOST:-}" ] && [ -z "${SERVER_USER:-}" ]; then
    DEPLOY_TARGET="${DEPLOY_TARGET:-qyhever}"
else
    echo "❌ SERVER_HOST 和 SERVER_USER 必须同时设置"
    exit 1
fi

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$PROJECT_ROOT"

export TZ="Asia/Shanghai"

echo "🚀 开始构建前端项目..."
echo "🎯 部署目标: $DEPLOY_TARGET"
echo "🕒 构建时区: $TZ"

pnpm build

echo "📤 开始上传前端构建产物..."
if [ -n "$DEPLOY_SSH_PORT" ]; then
    rsync -avz --delete -e "ssh -p $DEPLOY_SSH_PORT" dist/ "${DEPLOY_TARGET}:/usr/share/nginx/html/conglou/"
else
    rsync -avz --delete dist/ "${DEPLOY_TARGET}:/usr/share/nginx/html/conglou/"
fi
echo "✅ 前端部署完成！"

