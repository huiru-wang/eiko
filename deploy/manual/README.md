# 手动部署（IP 验证阶段）

本目录只支持当前的单台 ECS 手动部署：Nginx 托管 H5，Nginx 将 `/api` 和 `/health` 反向代理到由 PM2 守护的后端。它不创建 Fanto 的 systemd 服务。

## 一次性准备

服务器应具备 Node.js 22、Corepack/pnpm、Git、PM2、curl 和已安装的 Nginx。PM2 可通过 `npm install -g pm2` 安装。后端依赖含有原生模块；若安装依赖时没有可用预构建包，还需要 C/C++ 编译工具和 Python 3。

以部署用户在服务器执行：

```bash
sudo mkdir -p /opt/fanto /var/lib/fanto /etc/fanto
sudo chown -R "$USER":"$USER" /opt/fanto
git clone git@github.com:huiru-wang/fanto.git /opt/fanto/app
cd /opt/fanto/app
chmod +x deploy/manual/*.sh
```

创建 `/etc/fanto/server.env`（权限应为 `600`，且所有者为部署用户）：

```dotenv
PROVIDER=deepseek
MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=replace-me

EMBEDDING_API_KEY=replace-me
EMBEDDING_API_BASE=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-v2
EMBEDDING_DIMENSION=1536

SQLITE_PATH=/var/lib/fanto/fanto.sqlite
HOST=127.0.0.1
PORT=3000
ORGANIZER_TRIGGER_CRON=*/5 * * * *
```

```bash
sudo chown "$USER":"$USER" /etc/fanto/server.env
sudo chmod 600 /etc/fanto/server.env
./deploy/manual/install-nginx.sh
./deploy/manual/deploy.sh
```

Nginx 默认使用 `server_name _`，因此可通过 `http://<ECS 公网 IP>/` 验证 H5，并通过 `http://<ECS 公网 IP>/health` 验证服务。ECS 安全组需要允许 TCP 80；后端 3000 端口不应对公网开放。

## 日常发布

先将确认过的代码推送至 GitHub 的 `main`，然后在 ECS 执行：

```bash
cd /opt/fanto/app
./deploy/manual/deploy.sh
```

脚本会在 `git pull --ff-only` 前检查工作目录是否干净，避免意外覆盖服务器文件。生产密钥和 SQLite 数据库均在仓库外，不会受更新影响。

## 运维命令

```bash
pm2 status
pm2 logs fanto-server
pm2 restart fanto-server
curl http://127.0.0.1:3000/health
```

未配置 systemd 或其他启动钩子时，服务器重启后需手动运行：

```bash
cd /opt/fanto/app
pm2 startOrReload deploy/manual/ecosystem.config.cjs --only fanto-server
```

Docker 版本应另放在 `deploy/docker/`，不要与本目录共用运行或密钥文件。
