#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /var/www/restock-alerts

echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm ci --omit=dev

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "Running database migrations..."
npm run setup

echo "Building app..."
npm run build

echo "Reloading PM2..."
pm2 reload restock-alerts || pm2 start ecosystem.config.cjs
pm2 save

echo "Deploy complete."
