# Caja, Tienda y Reportes

## Operación

- Tienda administra nombre, precio y disponibilidad de artículos. Desactivar un artículo impide venderlo; no cambia ventas anteriores.
- Cobros permite pagar el saldo del plan de un cliente, registrar una inscripción independiente o vender uno o varios artículos con cantidades. La venta puede ser de mostrador o asociarse a un cliente.
- La inscripción es un cargo independiente: no crea ni renueva la membresía. Para una nueva membresía se registra primero el cliente; para una renovación se usa Renovar y luego se cobra el saldo del nuevo período.
- QR requiere un voucher; en efectivo es opcional. El comprobante puede tomarse con la cámara o seleccionarse de la galería.
- Reportes muestra una fecha completa en America/La_Paz (UTC-4), con total por medio de pago y concepto, detalle de artículos y vouchers.
- Un saldo de membresía debe pagarse antes de renovar.

## Persistencia y actualización

Se conserva SQLite central y la carpeta uploads. Al iniciar se crean de forma aditiva store_products y cash_receipts, y se añade payments.request_key. Los pagos históricos existentes se incorporan una sola vez al registro de ingresos.

Un trigger guarda cada nuevo pago de membresía en cash_receipts dentro de la misma transacción. Las ventas e inscripciones se guardan en transacciones y usan identificadores de operación para evitar cobros repetidos por reintentos.

Los ingresos conservan nombres, precios, cantidades y rutas de vouchers originales. No se eliminan al borrar clientes, cambiar precios o desactivar artículos. Los registros de pagos ya eliminados antes de esta actualización no se pueden recuperar automáticamente.

Todas las rutas nuevas y los vouchers requieren la sesión administrativa existente:

- GET /api/store/products
- POST /api/store/products
- PUT /api/store/products/:id
- POST /api/cash/receipts
- GET /api/reports/daily?date=YYYY-MM-DD

El despliegue sigue el procedimiento habitual del VPS. No cambia la configuración de autenticación ni requiere dependencias nuevas.

## Validación

npm test ejecuta compilación, renderizado y pruebas de base de datos. Las pruebas de caja cubren conciliación de totales, reintentos, precios históricos, eliminación de clientes, validaciones, límites diarios de Bolivia y migración de pagos existentes.
