#!/usr/bin/env bash
# 安装或更新 Fanto 的 Nginx 虚拟主机。首次可直接用 IP 访问，默认 server_name 为 _。
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly template="$repo_root/deploy/manual/nginx/fanto.conf.template"
readonly available="/etc/nginx/sites-available/fanto"
readonly enabled="/etc/nginx/sites-enabled/fanto"
readonly server_name="${FANTO_NGINX_SERVER_NAME:-_}"

if [[ ! -f "$template" ]]; then
  echo "找不到 Nginx 模板：$template" >&2
  exit 1
fi

if [[ "$server_name" == *$'\n'* || "$server_name" == *';'* ]]; then
  echo "FANTO_NGINX_SERVER_NAME 包含不安全字符" >&2
  exit 1
fi

temp_file="$(mktemp)"
trap 'rm -f "$temp_file"' EXIT

sed \
  -e "s|__SERVER_NAME__|$server_name|g" \
  -e "s|__REPOSITORY_ROOT__|$repo_root|g" \
  "$template" > "$temp_file"

sudo install -D -m 644 "$temp_file" "$available"

if [[ -e "$enabled" && ! -L "$enabled" ]]; then
  echo "$enabled 已存在且不是符号链接；为避免覆盖已有配置，已停止。" >&2
  exit 1
fi

sudo ln -sfn "$available" "$enabled"
sudo nginx -t
sudo nginx -s reload

echo "Nginx 已更新。可通过 http://<ECS-IP>/ 验证 H5。"
