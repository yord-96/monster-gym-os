# Monster Gym — Base central SQLite

Esta versión elimina `localStorage` como fuente de verdad. El servicio `monster-gym.service` inicia `server.mjs` en el puerto 4100; el servidor expone `/api/*`, abre `data/monster-gym.sqlite` y ejecuta Vinext internamente en el puerto 4101.

## Primera instalación / actualización

```bash
cd /var/www/monster-gym-os
mkdir -p data
npm ci
npm run db:init
npm run build
sudo systemctl restart monster-gym
sleep 3
sudo systemctl status monster-gym --no-pager
curl -sS https://monster-gym-2-24-108-161.nip.io/api/health
```

Nginx continúa apuntando solamente a `127.0.0.1:4100`; no se modifica Copetín ni PM2.

## Respaldo

Con WAL activo, para un respaldo consistente puede usarse SQLite CLI si está instalado (`sqlite3 data/monster-gym.sqlite '.backup ...'`) o detener brevemente el servicio antes de copiar el archivo y sus archivos `-wal/-shm`.
