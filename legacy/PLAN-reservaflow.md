# Plan de funcionalidades

Estado: ✅ implementado · 🧭 propuesto para siguientes versiones.

## 1. Cuentas y seguridad
- ✅ Registro y login con JWT (access 15 min + refresh 7 días) y renovación automática en el cliente.
- ✅ Roles `CLIENT`, `STAFF`, `ADMIN` con autorización por ruta y por recurso (un cliente solo ve sus reservas; un profesional solo su agenda).
- ✅ Perfil editable (nombre, teléfono, dirección, ciudad) y cambio de contraseña.
- ✅ Hash scrypt, rate limiting en `/auth`, Helmet, CORS configurable.
- 🧭 Verificación de correo, recuperación de contraseña, login social.

## 2. Catálogo
- ✅ Categorías y servicios con duración, buffer de descanso, precio, imagen, destacado, activo/inactivo.
- ✅ CRUD completo desde el panel admin.

## 3. Profesionales
- ✅ Perfil público (foto, cargo, bio, contacto), servicios que ofrece, rating agregado y trabajos completados.
- ✅ Horario semanal con múltiples rangos por día y bloqueos puntuales (vacaciones, citas médicas).
- ✅ El profesional edita su propio horario; el admin edita el de cualquiera.

## 4. Motor de disponibilidad
- ✅ Franjas = horario del día − bloqueos − reservas activas (con buffer simétrico) − anticipación mínima (60 min).
- ✅ Consulta por día (`/staff/:id/availability`) y resumen mensual para pintar el calendario.
- ✅ Filtros "disponible hoy / mañana" y "próxima fecha disponible".
- ✅ Chequeo de solapamiento repetido dentro de la transacción de inserción (evita carreras).

## 5. Reservas
- ✅ Frecuencias `ONCE`, `WEEKLY` (4), `BIWEEKLY` (3), `MONTHLY` (3), configurables hasta 12 ocurrencias; la serie se crea completa o no se crea (todo o nada).
- ✅ Código de confirmación legible (`RF-XXXXXX`) y consulta pública por código.
- ✅ Estados `PENDING → CONFIRMED → IN_PROGRESS → COMPLETED | CANCELLED | NO_SHOW` con transiciones validadas.
- ✅ Cancelación (individual o resto de la serie) con política de 2 h de antelación para clientes; reprogramación con validación de cupo.
- ✅ Cotización previa (precio, descuento, total por serie), cupón, notas y dirección del servicio.
- ✅ Recordatorios automáticos cada hora para citas de las próximas 24 h.

## 6. Reseñas
- ✅ Solo sobre reservas completadas, una por reserva; recalcula el promedio del profesional.
- ✅ Testimonios en la portada y filtro por profesional.

## 7. Cupones
- ✅ Porcentaje o monto fijo, mínimo de compra, límite de usos, vigencia, activación.
- ✅ Validación pública y gestión desde el panel admin.

## 8. Notificaciones
- ✅ In-app (campana con contador) + adaptador de correo intercambiable (consola en desarrollo).
- ✅ Eventos: creación, confirmación, cancelación, reprogramación, completada, recordatorio, reseña recibida, cupo liberado.
- 🧭 Proveedor SMTP/SendGrid, WhatsApp/SMS, push.

## 9. Lista de espera
- ✅ El cliente se apunta a una fecha; al liberarse un cupo (cancelación/reprogramación) se le notifica.

## 10. Paneles
- ✅ Cliente: asistente de reserva, mis reservas (próximas/historial), reprogramar, cancelar, reseñar, notificaciones, perfil.
- ✅ Profesional: agenda diaria con cambio de estado, métricas personales, editor de horario y bloqueos.
- ✅ Admin: dashboard (reservas, ingresos, estados, últimos 14 días, equipo), reservas, servicios, personal, cupones, bandeja de correos simulados.
- 🧭 Vista de calendario semanal para admin, exportación CSV, pagos en línea, multi-sede y zona horaria por negocio.

## Calidad
- ✅ 40 tests: dominio puro (cálculo de franjas, recurrencia) e integración HTTP del flujo completo.
- ✅ Tipado estricto en ambos proyectos; build de producción verificado.
- ✅ Recorrido end-to-end verificado con Chromium (escritorio 1280 px y móvil 400 px).
