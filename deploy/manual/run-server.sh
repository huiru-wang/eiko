#!/usr/bin/env bash
# PM2 的启动入口。生产密钥只保存在服务器，不写入 Git 仓库。
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly env_file="${FANTO_ENV_FILE:-/etc/fanto/server.env}"

if [[ ! -r "$env_file" ]]; then
  echo "缺少生产环境文件：$env_file" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

cd "$repo_root/apps/server"
exec pnpm start
