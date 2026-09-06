const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");

module.exports = {
  apps: [
    {
      name: "fanto-server",
      script: path.join(repositoryRoot, "deploy/manual/run-server.sh"),
      cwd: repositoryRoot,
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 30_000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
