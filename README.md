# ROCA — Sistema de Entradas

## Estructura del proyecto

```
roca-app/
├── index.html                 ← Página principal (eventos + compra + scanner)
├── pago-ok.html               ← Página de pago exitoso
├── vercel.json                ← Configuración de Vercel
├── package.json               ← Dependencias Node
├── supabase-increment-fn.sql  ← Función SQL (ejecutar una sola vez en Supabase)
└── api/
    ├── create-preference.js   ← Crea preferencia de pago en Mercado Pago
    └── webhook-mp.js          ← Recibe confirmación de pago, genera QRs y manda mail
```

---

## Setup paso a paso

### 1. Supabase — ejecutar el SQL adicional

En Supabase → SQL Editor, ejecutar el contenido de `supabase-increment-fn.sql`.

---

### 2. Mercado Pago

1. Entrá a https://www.mercadopago.com.ar/developers
2. Creá una aplicación
3. Copiá el **Access Token** (modo producción cuando estés listo, sandbox para pruebas)

---

### 3. Resend (mails)

1. Entrá a https://resend.com y creá una cuenta (gratis hasta 3.000 mails/mes)
2. Verificá tu dominio (o usá el dominio de prueba de Resend inicialmente)
3. Copiá el **API Key**

---

### 4. Vercel — Variables de entorno

En tu proyecto de Vercel → Settings → Environment Variables, agregar:

| Variable          | Valor                                      |
|-------------------|--------------------------------------------|
| MP_ACCESS_TOKEN   | Tu Access Token de Mercado Pago            |
| SUPABASE_URL      | https://vdomxszqpikqsvcrfupb.supabase.co   |
| SUPABASE_KEY      | Tu service_role key de Supabase            |
| RESEND_API_KEY    | Tu API Key de Resend                       |
| FROM_EMAIL        | ROCA Entradas <entradas@tudominio.com>     |
| BASE_URL          | https://tu-proyecto.vercel.app             |

> La SUPABASE_KEY aquí debe ser la **service_role** (no la anon), porque el webhook
> necesita permisos para escribir tickets. Está en Supabase → Settings → API.

---

### 5. Links de promotores

Para trackear promotores, los links son simplemente:

```
https://tu-proyecto.vercel.app/?ref=SLUG_DEL_PROMOTOR
```

Donde `SLUG_DEL_PROMOTOR` es el valor que pusiste en la columna `slug` de la tabla `promoters`.

Ejemplo: `https://roca-app.vercel.app/?ref=martin`

---

### 6. Agregar un evento de prueba

En Supabase → Table Editor → events, crear un registro:

```json
{
  "name": "ROCA 001",
  "date": "2025-08-15T22:00:00-03:00",
  "venue": "Club X, Buenos Aires",
  "description": "Primera edición",
  "is_active": true
}
```

Luego en ticket_types, asociarlo al evento:

```json
{
  "event_id": "<id del evento>",
  "name": "General",
  "price": 5000,
  "total_quantity": 200
}
```

---

### 7. Agregar staff

En Supabase → Table Editor → staff:

```json
{
  "name": "Juan (puerta)",
  "pin": "1234",
  "is_active": true
}
```

El PIN puede ser cualquier número de 4 dígitos.

---

## Flujo completo

```
Usuario entra a la URL (con o sin ?ref=promotor)
  → Ve los eventos activos
  → Clickea → elige tipo de entrada y cantidad
  → Ingresa nombre y email
  → Redirige a Mercado Pago
  → Paga
  → Vuelve a pago-ok.html
  → Webhook de MP genera los QRs y manda el mail automáticamente

En la puerta:
  → Staff entra a la URL → tab "Staff"
  → Ingresa PIN
  → Scanner lee el QR con la cámara
  → Sistema valida y marca como usada
```
