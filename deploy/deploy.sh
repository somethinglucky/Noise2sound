#!/usr/bin/env bash
# Run on the droplet from the repo folder:  bash deploy/deploy.sh
set -euo pipefail
git pull
npm ci
npm test
npm run build            # website -> dist/
npm run build:server     # API -> server-dist/
sudo mkdir -p /var/www/noise2sound /opt/noise2sound
sudo rsync -a --delete dist/ /var/www/noise2sound/
sudo rsync -a --delete server-dist package.json package-lock.json /opt/noise2sound/
(cd /opt/noise2sound && sudo npm ci --omit=dev)
sudo systemctl restart noise2sound-api
sleep 1
curl -fsS http://127.0.0.1:8787/api/health && echo " API is up"
