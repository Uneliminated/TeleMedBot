module.exports = {
  apps: [
    {
      name: 'medbot-server',
      script: './server/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: '/var/log/medbot/server-error.log',
      out_file: '/var/log/medbot/server-out.log',
      time: true
    },
    {
      name: 'medbot-bot',
      script: './bot/bot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/var/log/medbot/bot-error.log',
      out_file: '/var/log/medbot/bot-out.log',
      time: true
    }
  ]
};