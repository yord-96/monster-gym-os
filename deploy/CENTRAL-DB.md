# Monster Gym — Base central + membresías + cobros

Esta versión usa SQLite central en `data/monster-gym.sqlite` y guarda imágenes de cobro en `uploads/`.
El puerto público interno sigue siendo `4100`; Vinext se ejecuta internamente en `4101`.

## Seguridad obligatoria

La versión de cobros y vouchers requiere autenticación antes de exponer datos de clientes.

Crear `/etc/monster-gym.env`:

```bash
sudo nano /etc/monster-gym.env
```

Contenido:

```text
MONSTER_ADMIN_PASSWORD=CAMBIAR_POR_UNA_CONTRASENA_SEGURA
MONSTER_SESSION_SECRET=CAMBIAR_POR_UN_SECRETO_LARGO_ALEATORIO
```

El archivo de servicio debe incluir:

```text
EnvironmentFile=-/etc/monster-gym.env
```

Después:

```bash
sudo chmod 600 /etc/monster-gym.env
sudo systemctl daemon-reload
```

## Actualización

```bash
cd /var/www/monster-gym-os
git pull --ff-only origin main
mkdir -p data uploads/payment-qr uploads/vouchers
npm ci
npm run db:init
npm run build
sudo systemctl restart monster-gym
sleep 3
sudo systemctl status monster-gym --no-pager
curl -sS https://monster-gym-2-24-108-161.nip.io/api/health
```

La inicialización migra la base existente sin borrar clientes. También crea/actualiza las tablas de planes, membresías, pagos y configuración.

## Datos que deben respaldarse

Respaldar juntos:

```text
data/monster-gym.sqlite
uploads/payment-qr/
uploads/vouchers/
```

Con WAL activo, usar `sqlite3 ... '.backup ...'` si está disponible o detener brevemente `monster-gym.service` antes de copiar la base.

Nginx continúa apuntando a `127.0.0.1:4100`. No se modifica Copetín ni PM2.
