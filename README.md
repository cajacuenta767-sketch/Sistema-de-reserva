# Nexo ERP

ERP/CRM modular y multiempresa: clientes, ventas, compras, inventario,
contabilidad de partida doble, proyectos, tickets y recursos humanos, con
auditoría de cada cambio y cierre contable de verdad.

Pensado para empresas colombianas: NIT con dígito de verificación, IVA, INC,
retenciones (ReteFuente, ReteIVA, ReteICA) y numeración con resolución DIAN.

> **Estado: Fase 0 (cimientos) completa.** Están la plataforma, el aislamiento
> entre empresas, el control de accesos y el sistema de diseño. Los módulos de
> negocio llegan en las fases siguientes; el plan está en [docs/PLAN.md](docs/PLAN.md).

## Empezar

```bash
pnpm install
cp .env.example apps/api/.env

# Con Docker
docker compose up -d

# O con un PostgreSQL local ya instalado
createdb erp_dev

pnpm db:migrate     # aplica las migraciones
pnpm seed           # empresa de demostración con 8 personas y 5 roles
pnpm dev            # API en :4000 · Web en :5173
```

Contraseña de todas las cuentas de demostración: `Demo2026Segura!`

| Correo                 | Rol           | Para ver                                   |
| ---------------------- | ------------- | ------------------------------------------ |
| `ana@andina.demo`      | Propietario   | Todo el sistema                            |
| `admin@andina.demo`    | Administrador | Todo menos los datos legales de la empresa |
| `contador@andina.demo` | Contador      | Cómo se reduce el menú al faltar permisos  |
| `ventas1@andina.demo`  | Comercial     | Alcance limitado a lo suyo y a su equipo   |
| `bodega@andina.demo`   | Empleado      | El acceso mínimo                           |

## Cómo está hecho

Monorepo TypeScript de punta a punta, con pnpm workspaces y Turborepo.

```
apps/api        API REST y trabajador de segundo plano
                (dos puntos de entrada, un solo código)
apps/web        SPA React
packages/core   Money, impuestos, fechas, errores — sin dependencias del framework
packages/contracts  Esquemas Zod compartidos entre API y web
legacy/         ReservaFlow, hasta migrarlo al módulo de reservas
```

Tres decisiones que explican casi todo lo demás:

**El aislamiento entre empresas lo garantiza PostgreSQL, no el cuidado de quien
escribe consultas.** Cada tabla de negocio lleva Row Level Security _forzada_, y
el rol de aplicación no es dueño de las tablas ni tiene `BYPASSRLS`. Olvidar un
`WHERE organization_id` en cualquiera de los cientos de consultas que tendrá el
sistema no filtra datos: devuelve cero filas.

**Cada módulo se registra a sí mismo.** Declara sus permisos, construye sus
casos de uso y devuelve su API pública. El contenedor tiene ~110 líneas que no
crecen: la única lista que crece es `apps/api/src/modules/index.ts`, con una
línea por módulo. Entre módulos se habla por eventos, no por referencias.

**El dinero nunca es un `number`.** `NUMERIC(19,4)` en la base, leído como
cadena y operado con `Money`, que usa aritmética decimal exacta. Los impuestos y
las retenciones se calculan con funciones puras que se prueban sin base de datos.

Más detalle en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Comandos

| Comando                             | Qué hace                                   |
| ----------------------------------- | ------------------------------------------ |
| `pnpm dev`                          | API y web en modo desarrollo               |
| `pnpm test`                         | Todos los tests                            |
| `pnpm lint` · `pnpm typecheck`      | Lint y comprobación de tipos               |
| `pnpm build`                        | Compila todo                               |
| `pnpm db:migrate` · `pnpm db:reset` | Migraciones                                |
| `pnpm seed`                         | Datos de demostración (idempotente)        |
| `pnpm walkthrough`                  | Recorrido de humo en Chromium con capturas |

## Calidad

67 tests de backend y 38 de los paquetes compartidos. Los que más valen son los
que se generan solos y crecen con el sistema:

- **Matriz de permisos** — recorre todas las rutas montadas y comprueba que
  ninguna deja pasar a alguien sin permisos. Un endpoint nuevo sin proteger
  falla el día que se escribe.
- **Aislamiento entre empresas** — dos empresas sembradas; ninguna ruta de
  lectura devuelve datos de la otra, ni por identificador ni por cabecera.
- **Contrato de listados** — todos los endpoints de lista hablan el mismo
  idioma, y ordenar por un campo no declarado o inyectar SQL en `sort` falla.
- **Arquitectura** — analiza los imports reales: el dominio no importa
  infraestructura y un módulo solo ve la API pública de otro. Incluye pruebas de
  que el propio analizador sabe detectar violaciones.

## Configuración

Copia `.env.example` a `apps/api/.env`. Lo importante:

| Variable                                   | Para qué                                            |
| ------------------------------------------ | --------------------------------------------------- |
| `DATABASE_URL`                             | Rol de aplicación, **sin** `BYPASSRLS`              |
| `DATABASE_MIGRATION_URL`                   | Rol dueño del esquema; solo lo usan las migraciones |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secretos de firma                                   |
| `VITE_APP_NAME`                            | Nombre visible de la aplicación                     |

El color de marca no es una variable de entorno: se cambia con un número
(`--brand-h`) y cada empresa puede tener el suyo desde su pantalla de
configuración, sin recompilar.
