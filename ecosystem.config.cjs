module.exports = {
  apps: [{
    name: 'restock-alerts',
    script: 'node_modules/.bin/react-router-serve',
    args: './build/server/index.js',
    cwd: '/var/www/restock-alerts',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: '3012',
    }
  }]
}
