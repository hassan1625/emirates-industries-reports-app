// pm2 process definition for the production server:  pm2 start ecosystem.config.cjs
//
// ONE instance only. The app runs a background poller (job recovery, report retention)
// inside the server process; two copies would run every pass twice.
//
// The app's settings come from the .env file next to this one (see
// .env.production.example); node reads it itself through --env-file, because the
// production server does not load .env on its own.
module.exports = {
  apps: [
    {
      name: "emirates-reports",
      cwd: __dirname,
      script: "./node_modules/@react-router/serve/bin.js",
      args: "./build/server/index.js",
      node_args: ["--env-file=.env"],
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3000", // the port the domain's proxy rule points at (docs/handover-guide.md)
        HOST: "127.0.0.1", // listen on this machine only; the web server proxies to it
      },
      autorestart: true,
      min_uptime: "20s", // a start that dies sooner counts as a crash
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "3G", // a year-long report build peaks near 1 GB
      kill_timeout: 10000,
      time: true, // timestamp every log line
    },
  ],
};
