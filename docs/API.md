# API REST · `/api/v1`

Autenticación: cabecera `Authorization: Bearer <accessToken>`. Errores: `{ "error": { "code", "message", "details" } }`.
Fechas de agenda en formato `YYYY-MM-DDTHH:MM` (hora local del negocio).

## Auth
| Método | Ruta | Rol | Descripción |
| --- | --- | --- | --- |
| POST | `/auth/register` | público | `{ email, password, firstName, lastName, phone? }` → `{ user, tokens }` |
| POST | `/auth/login` | público | `{ email, password }` → `{ user, tokens }` |
| POST | `/auth/refresh` | público | `{ refreshToken }` → nuevos tokens |
| GET | `/auth/me` | auth | Perfil + `staffProfile` si es profesional |
| PATCH | `/auth/me` | auth | Actualiza nombre, teléfono, dirección, ciudad |
| POST | `/auth/change-password` | auth | `{ currentPassword, newPassword }` |

## Catálogo
| Método | Ruta | Rol | Descripción |
| --- | --- | --- | --- |
| GET | `/categories` | público | Lista de categorías |
| POST/PATCH/DELETE | `/categories[/:id]` | admin | CRUD |
| GET | `/services?categoryId&includeInactive` | público | Servicios activos (admin puede incluir inactivos) |
| GET | `/services/:idOrSlug` | público | Detalle |
| POST/PATCH/DELETE | `/services[/:id]` | admin | CRUD |

## Profesionales y disponibilidad
| Método | Ruta | Rol | Descripción |
| --- | --- | --- | --- |
| GET | `/staff?serviceId&availableOn=YYYY-MM-DD` | público | Profesionales (filtro por servicio y por día con cupos) |
| GET | `/staff/me` | staff | Mi perfil de profesional |
| GET | `/staff/:id` | público | Detalle con `serviceIds` |
| POST | `/staff` | admin | Crea usuario STAFF + perfil + horario |
| PATCH | `/staff/:id` | admin / propio | Edita perfil y servicios |
| GET | `/staff/:id/availability?serviceId&date` | público | `{ slots: [{ startAt, endAt, time }] }` |
| GET | `/staff/:id/availability/month?serviceId&month=YYYY-MM` | público | `{ days: [{ date, slots }] }` |
| GET | `/staff/:id/next-available?serviceId` | público | Primer día con cupo |
| GET/PUT | `/staff/:id/working-hours` | público / propio-admin | `{ hours: [{ weekday 0-6, startTime, endTime }] }` |
| GET/POST | `/staff/:id/time-off` | propio-admin | Bloqueos `{ startAt, endAt, reason? }` |
| DELETE | `/staff/:id/time-off/:timeOffId` | propio-admin | Elimina bloqueo |

## Reservas
| Método | Ruta | Rol | Descripción |
| --- | --- | --- | --- |
| POST | `/bookings/quote` | público | `{ serviceId, couponCode?, frequency?, occurrences? }` → precios |
| GET | `/bookings?status=A,B&from&to&upcoming&limit&offset` | auth | Cliente: las suyas · Staff: su agenda · Admin: todas |
| GET | `/bookings/:id` | auth | Detalle enriquecido (servicio, profesional, cliente, `hasReview`) |
| GET | `/bookings/code/:code` | público | Consulta por código de confirmación |
| POST | `/bookings` | auth | `{ staffId, serviceId, startAt, frequency?, occurrences?, couponCode?, notes?, address?, contact? }` → `{ items, seriesId }` |
| POST | `/bookings/:id/cancel` | auth | `{ reason?, wholeSeries? }` |
| POST | `/bookings/:id/reschedule` | auth | `{ startAt }` |
| POST | `/bookings/:id/status` | staff/admin | `{ status }` con transiciones validadas |
| POST | `/bookings/reminders/run` | admin | Dispara recordatorios manualmente |

## Reseñas, cupones, notificaciones, lista de espera
| Método | Ruta | Rol | Descripción |
| --- | --- | --- | --- |
| GET | `/reviews?staffId&limit&minRating` | público | Reseñas con nombre del cliente/profesional/servicio |
| POST | `/reviews` | auth | `{ bookingId, rating 1-5, comment }` (solo reservas completadas) |
| POST | `/coupons/validate` | público | `{ code, serviceId }` → cotización |
| GET/POST/PATCH/DELETE | `/coupons[/:id]` | admin | CRUD |
| GET | `/notifications?unreadOnly` | auth | `{ items, unread }` |
| POST | `/notifications/read` | auth | `{ ids: string[] | "all" }` |
| GET/POST | `/waitlist` | auth | Mis entradas · `{ serviceId, date, staffId? }` |
| DELETE | `/waitlist/:id` | auth | Salir de la lista |

## Admin y utilidades
| Método | Ruta | Rol | Descripción |
| --- | --- | --- | --- |
| GET | `/admin/stats?from&to` | admin | Métricas: rango, hoy, equipo, reseñas, últimos 14 días |
| GET | `/admin/users` | admin | Usuarios |
| GET | `/admin/outbox` | admin | Últimos correos simulados |
| GET | `/health` | público | Estado del servicio |
| GET | `/openapi.json` | público | Descripción OpenAPI resumida |
