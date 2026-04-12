module.exports = {
  apps: [
    {
      name: "connexa-web",
      script: "npm",
      args: "run start -- --hostname 0.0.0.0 --port 3000",
      cwd: "/srv/connexa",
      env: {
        NODE_ENV: "production",
        APP_URL: "http://YOUR_WEB_HOST:3000",
        OUTBOUND_WORKER_TOKEN: "replace-with-a-long-random-secret"
      }
    },
    {
      name: "connexa-worker",
      script: "npm",
      args: "run worker:messages",
      cwd: "/srv/connexa",
      env: {
        NODE_ENV: "production",
        WORKSPACE_ID: "replace-with-your-workspace-id",
        APP_URL: "http://YOUR_WEB_HOST:3000",
        OUTBOUND_WORKER_URL: "http://YOUR_WEB_HOST:3000",
        OUTBOUND_WORKER_LABEL: "connexa-worker-1",
        OUTBOUND_WORKER_TOKEN: "replace-with-a-long-random-secret"
      }
    }
  ]
};
