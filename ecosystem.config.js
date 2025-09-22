module.exports = {
    apps: [
        {
            name: "stocrm-server",
            cwd: "./apps/server",
            script: "node",
            args: "dist/index.js",
            env: { NODE_ENV: "production" },
            env_file: "../.env",
            watch: false,
            autorestart: true,
            max_restarts: 10
        },
        {
            name: "stocrm-bot",
            cwd: "./apps/bot",
            script: "node",
            args: "dist/index.js",
            env: { NODE_ENV: "production" },
            env_file: "../.env",
            watch: false,
            autorestart: true,
            max_restarts: 10
        }
    ]
}
