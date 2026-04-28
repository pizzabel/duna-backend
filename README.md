# D-una · Backend API

Marketplace P2P hiperlocal para Colombia. Compra y vende cerca de ti con escrow automático.

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | NestJS 10 (monolito modular) |
| Base de datos | PostgreSQL 16 + PostGIS |
| Caché / colas | Redis 7 |
| ORM | Prisma 5 |
| Chat tiempo real | Socket.IO 4 |
| Pagos | Wompi (PSE · Tarjeta · Nequi · Daviplata) |
| SMS OTP | Twilio |
| Imágenes | AWS S3 + CloudFront |

## Arquitectura de módulos

```
src/modules/
├── auth/           # OTP, JWT, refresh tokens
├── users/          # Perfiles, reputación, KYC
├── posts/          # CRUD publicaciones + upload S3
├── feed/           # Ranking hiperlocal PostGIS
├── chat/           # WebSocket + pipeline antifraude
├── transactions/   # Máquina de estados escrow + Wompi
├── disputes/       # Flujo de disputas + evidencia
├── antifraud/      # Score de riesgo, detección de evasión
└── notifications/  # Push + email
```

## Inicio rápido

```bash
# 1. Clonar e instalar
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de Wompi sandbox, Twilio, etc.

# 3. Levantar base de datos y Redis
docker compose up -d

# 4. Ejecutar migraciones de Prisma
npm run db:migrate

# 5. Generar cliente Prisma
npm run db:generate

# 6. Seed de categorías y datos iniciales
npm run db:seed

# 7. Arrancar en modo desarrollo
npm run start:dev
```

La API quedará disponible en `http://localhost:3000/v1`

## Endpoints principales

### Autenticación (sin JWT)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/v1/auth/otp/request` | Envía OTP SMS · `{ phone }` |
| POST | `/v1/auth/otp/verify` | Verifica OTP → tokens · `{ phone, code }` |
| POST | `/v1/auth/refresh` | Renueva access token |
| POST | `/v1/auth/logout` | Revoca sesión (requiere JWT) |

### Feed y publicaciones
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/v1/feed` | Feed hiperlocal · query: `lat, lng, radiusKm, categoryId, cursor` |
| GET | `/v1/posts/search` | Búsqueda por texto + filtros |
| POST | `/v1/posts` | Crear publicación (multipart) |
| GET | `/v1/posts/:id` | Detalle |
| PATCH | `/v1/posts/:id` | Editar |

### Transacciones y escrow
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/v1/transactions` | Iniciar compra · `{ postId, paymentMethod, buyerEmail }` |
| POST | `/v1/webhooks/wompi` | Webhook Wompi (firma HMAC verificada) |
| POST | `/v1/transactions/:id/confirm-delivery` | Vendedor marca entregado |
| POST | `/v1/transactions/:id/confirm-receipt` | Comprador confirma recepción → libera pago |
| POST | `/v1/transactions/:id/dispute` | Abrir disputa |

### Chat (WebSocket)
Conectar a `ws://localhost:3000` con token en handshake:
```js
socket.auth = { token: 'Bearer <access_token>' }
socket.emit('chat:send', { chatId, body })
socket.emit('chat:typing', { chatId, isTyping: true })
socket.on('chat:message', msg => ...)
```

## Máquina de estados de transacción

```
pending_payment → paid_held → delivered → released
                      ↓            ↓
                  cancelled    disputed → refunded | released
```

## Reglas de negocio críticas

- Máximo **3 transacciones en `paid_held`** simultáneas por comprador
- Auto-release a las **72 horas** de `delivered` si el comprador no confirma
- Si hay disputa abierta, el auto-release queda **congelado**
- La comisión (8%, mín $2.000 COP) se calcula al crear la tx y es **inmutable**
- Los mensajes de chat son **append-only** — trigger SQL impide UPDATE/DELETE

## Pipeline antifraude del chat

Cada mensaje pasa por `AntifraudService.scan()` antes de persistirse:

1. Regex: teléfonos colombianos → `[número bloqueado]`
2. Keywords de escape: WhatsApp, efectivo, fuera de la app → `[bloqueado]`
3. URLs externas no whitelistadas → `[enlace bloqueado]`
4. Emails → `[email bloqueado]`

El emisor ve su mensaje original; el receptor ve la versión redactada.
Cada flag suma puntos al `riskScore` del usuario (score ≥ 70 → KYC, ≥ 90 → ban).

## Sprint roadmap

| Sprint | Foco | Estado |
|---|---|---|
| 0 | Setup · infra · esquema DB | ✅ Este commit |
| 1 | Auth + perfiles completos | 🔜 |
| 2 | Posts + feed + S3 | 🔜 |
| 3 | Chat + antifraude | 🔜 |
| 4 | Pagos Wompi + escrow | 🔜 |
| 5 | Disputas + reviews | 🔜 |
| 6 | QA beta cerrada | 🔜 |
| 7 | Lanzamiento MVP | 🔜 |
