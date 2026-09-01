# Despliegue independiente en el VPS

Monster Gym OS se ejecuta mediante `monster-gym.service`, fuera de PM2 y en el
puerto interno 4100. Nginx es el único punto de acceso público.

La aplicación de Copetín permanece en `/var/www/prestamos-app`, dentro de PM2 y
en el puerto 4000. Ningún comando de despliegue de Monster Gym debe operar sobre
esa carpeta, ese proceso o ese puerto.

Para actualizar una instalación existente:

```bash
cd /var/www/monster-gym-os
git pull --ff-only origin main
npm ci
npm run build
sudo systemctl restart monster-gym
sudo systemctl status monster-gym --no-pager
```
