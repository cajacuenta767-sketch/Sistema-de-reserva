# Arquitectura

## Backend (hexagonal / clean)

```
src/
├─ domain/            Reglas de negocio puras. Sin dependencias externas.
│  ├─ entities/       User, Service, Staff, Booking, Review, Coupon, Notification, Waitlist
│  └─ services/       SlotCalculator (franjas), RecurrenceGenerator (series)
├─ application/       Orquestación. Depende solo del dominio y de puertos.
│  ├─ ports/          Interfaces: repositorios, PasswordHasher, TokenService, Mailer
│  ├─ services/       NotificationService (in-app + email)
│  └─ use-cases/      auth · catalog · staff · bookings · reviews · coupons · notifications · waitlist · admin
├─ infrastructure/    Adaptadores concretos.
│  ├─ db/             node:sqlite, migraciones SQL, repositorios Sqlite*
│  ├─ security/       ScryptPasswordHasher, JwtTokenService
│  ├─ notifications/  ConsoleMailer
│  ├─ http/           Express: app, rutas, middlewares (auth, validate, error), esquemas Zod
│  └─ container.ts    Raíz de composición (inyección de dependencias manual)
├─ shared/            AppError, Clock, ids, utilidades de fecha, logger
└─ main.ts            Arranque del servidor + recordatorios periódicos
```

### Decisiones
- **Dependencias hacia adentro**: `infrastructure → application → domain`. Cambiar SQLite por Postgres solo implica nuevos repositorios.
- **Reloj inyectable (`Clock`)**: los tests fijan la fecha y el motor de disponibilidad es determinista.
- **Tiempo local del negocio**: las agendas usan `YYYY-MM-DDTHH:MM` sin zona horaria (comparación lexicográfica). Las marcas de auditoría son ISO UTC. Ver `shared/dates.ts`.
- **Errores tipados** (`AppError` con `code`) → respuesta uniforme `{ error: { code, message, details } }` y status HTTP coherente.
- **Transacciones**: la inserción de una serie de reservas es atómica y repite el chequeo de solape dentro de la transacción.
- **Validación en el borde**: todos los `body/query/params` pasan por Zod antes de llegar a los casos de uso.

### Flujo de una reserva
1. `POST /bookings` → `validate(bookingCreateBody)` → `BookingUseCases.create`.
2. Carga servicio, profesional y cliente; comprueba que el profesional ofrece el servicio.
3. `RecurrenceGenerator` produce las fechas de la serie.
4. `quote()` aplica el cupón y calcula totales.
5. Para cada fecha, `SlotCalculator.isAvailable` valida horario, bloqueos y solapes.
6. `BookingRepository.saveMany` inserta en una transacción (o falla completa).
7. `NotificationService` notifica a cliente y profesional (in-app + email).

## Frontend

```
src/
├─ api/          client.ts (fetch + refresh automático de token), types.ts
├─ store/        auth.tsx (contexto de sesión), toast.tsx
├─ lib/          format.ts (moneda, fechas, etiquetas), useAsync.ts
├─ components/   ui (primitivas), layout (Shell, Guard), booking (Calendar, StaffCard, BookingCard, RescheduleModal, Testimonials)
└─ pages/        Home, Book (asistente), Success, Auth, MyBookings, Notifications, Profile, Track, staff/Agenda, admin/*
```

- El asistente de reserva guarda su estado en `sessionStorage`, de modo que iniciar sesión a mitad de camino no pierde la selección.
- Tailwind v4 con tokens propios (`@theme`) y utilidades compuestas (`btn-primary`, `card`, `input`) en `index.css`.
- Diseño responsive: rejillas que colapsan a una columna, barra de navegación inferior pegajosa en el asistente y menú móvil.
