# ReservaFlow · Sistema de reservas

Sistema completo para agendar servicios (a domicilio o en local) con profesionales, horarios, citas recurrentes, reseñas, cupones, notificaciones y panel de administración.

- **Backend**: Node 22 + TypeScript + Express 5, arquitectura hexagonal, SQLite nativo (`node:sqlite`, sin binarios), JWT, validación con Zod, 40 tests (unitarios + integración).
- **Frontend**: React 18 + Vite + Tailwind v4, asistente de reserva en 5 pasos, calendario con disponibilidad real, paneles de cliente / profesional / admin.
- **Sin dependencias externas de infraestructura**: clona, instala y ejecuta.

## Inicio rápido

```bash
npm install            # instala backend y frontend (workspaces)
npm run seed           # crea la base de datos con datos de demostración
npm run dev            # API en http://localhost:4000 · Web en http://localhost:5173
```

También puedes ejecutarlos por separado: `npm run dev:api` y `npm run dev:web`.

### Cuentas de demostración (contraseña `Reserva123!`)

| Rol         | Correo                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| Cliente     | `paola@gmail.com` · `andres@gmail.com`                                                                 |
| Profesional | `daniel@reservaflow.app` · `lulu@reservaflow.app` · `camila@reservaflow.app` · `mateo@reservaflow.app` |
| Admin       | `admin@reservaflow.app`                                                                                |

Cupones de prueba: `BIENVENIDO10` (10 %) y `HOGAR20K` ($20.000 en servicios de hogar).

## Scripts

| Comando         | Descripción                                                   |
| --------------- | ------------------------------------------------------------- |
| `npm run dev`   | Backend + frontend en modo desarrollo                         |
| `npm test`      | Tests del backend (Vitest + Supertest)                        |
| `npm run build` | Compila backend (`backend/dist`) y frontend (`frontend/dist`) |
| `npm start`     | Arranca la API compilada                                      |
| `npm run seed`  | Siembra datos de demostración (idempotente)                   |

## Configuración

Copia `backend/.env.example` a `backend/.env` y ajusta:

| Variable                                   | Descripción                            |
| ------------------------------------------ | -------------------------------------- |
| `PORT`                                     | Puerto de la API (4000)                |
| `DATABASE_PATH`                            | Ruta del archivo SQLite                |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secretos de firma de tokens            |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`       | Vigencia de tokens (`15m`, `7d`)       |
| `CORS_ORIGIN`                              | Orígenes permitidos separados por coma |

El frontend usa el proxy de Vite hacia `/api`. En producción define `VITE_API_URL` (por ejemplo `https://api.midominio.com/api/v1`).

## Estructura

```
backend/   API REST (dominio → aplicación → infraestructura)
frontend/  SPA React
docs/      PLAN.md · ARQUITECTURA.md · API.md
```

Más detalle en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md), el plan de funcionalidades en [docs/PLAN.md](docs/PLAN.md) y la referencia de endpoints en [docs/API.md](docs/API.md).

## Despliegue

1. `npm run build`
2. Sirve `frontend/dist` desde cualquier CDN o servidor estático.
3. Ejecuta `node backend/dist/main.js` con las variables de entorno de producción (usa secretos reales y un volumen persistente para `DATABASE_PATH`).
