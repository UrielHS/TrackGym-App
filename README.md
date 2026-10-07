# 🏋️ TrackGym - SaaS Multi-Usuario de Entrenamiento y Progresión

TrackGym es una plataforma SaaS moderna, reactiva y segura diseñada para registrar entrenamientos, rutinas, series regulares y drop sets, con análisis biomecánico de fuerza (1RM con fórmula Epley), volumen semanal por grupo muscular, mapeo de fatiga en 72 horas y sugerencias algorítmicas de sobrecarga progresiva.

Desarrollada con arquitectura desacoplada **Vanilla JS + ES Modules**, backend relacional en **Supabase** con **Row Level Security (RLS)** y lista para despliegue serverless continuo en **Vercel**.

---

## 🏛️ Arquitectura del Proyecto

```text
TrackGym-App/
├── index.html                   # Interfaz de usuario (Tailwind CSS, Phosphor Icons, Modales)
├── vercel.json                  # Configuración de routing, headers de seguridad HTTP y serverless en Vercel
├── .env.example                 # Plantilla de variables de entorno públicas
├── api/
│   └── config.js                # Vercel Serverless Function (/api/config) para inyectar env vars
├── supabase/
│   └── migration.sql            # Script transaccional SQL: DDL, RLS, triggers y migración de datos históricos
└── src/
    ├── app.js                   # Orquestador principal de eventos, timers y estado de la app
    ├── config/
    │   ├── env.js               # Detección y fallback de variables de entorno
    │   └── supabase.js          # Inicialización singleton del cliente Supabase (Zero Leaks: sólo Anon Key)
    ├── services/
    │   ├── auth.service.js      # Wrapper de Supabase Auth (login, signup, sesión, perfiles)
    │   └── workouts.service.js  # CRUD de sesiones, rutinas, drop sets, importación segura y exportación Excel
    ├── modules/
    │   ├── analytics.js         # Algoritmos de 1RM (Epley), volumen 7 días, fatiga y sobrecarga progresiva
    │   └── ui.js                # Renderizado reactivo de la UI, charts dinámicos (Chart.js), toasts y modales
    └── utils/
        └── sanitize.js          # Sanitización contra XSS e inyecciones en entradas de texto libre
```

---

## 🚀 Guía Paso a Paso para Despliegue en Supabase + Vercel

### Paso 1: Configurar Supabase y Crear la Cuenta Admin (1-Click)

Tienes dos opciones según prefieras:

#### Opción A: Creación Inmediata 1-Click (Recomendada)
1. Entra a tu consola de [Supabase Dashboard](https://supabase.com/dashboard) y selecciona tu proyecto.
2. Ve al menú lateral **SQL Editor** y haz clic en **New Query**.
3. Abre el archivo [`supabase/seed_admin_account.sql`](file:///c:/Users/Uriel/Documents/GitHub2/TrackGym-App/supabase/seed_admin_account.sql), copia todo su contenido y haz clic en **Run**.
4. ¡Listo! Esto crea tu usuario administrador con correo confirmado y le vincula e inserta todos tus entrenamientos históricos y rutinas:
   - **Email:** `admin@trackgym.com`
   - **Contraseña:** `TrackGym2026!`
   - *(Puedes cambiar el correo o contraseña editando las variables al inicio del script antes de correrlo).*
5. En la app web, en el modal de login simplemente pulsa **"Cargar credenciales Admin (Uriel)"** e ingresa con un solo clic.

#### Opción B: Si prefieres registrar tu propio email manualmente
1. Ejecuta primero [`supabase/migration.sql`](file:///c:/Users/Uriel/Documents/GitHub2/TrackGym-App/supabase/migration.sql) en el SQL Editor.
2. Regístrate desde la app o en **Authentication > Users** con tu correo personal.
3. Copia tu nuevo **User UID**.
4. Al final de `supabase/migration.sql`, coloca tu UUID en `TARGET_USER_ID` y ejecuta el bloque `DO $$ ... $$` para enlazar tus datos históricos.

---

### Paso 2: Desplegar en Vercel

1. Sube los cambios de este repositorio a tu GitHub:
   ```bash
   git add .
   git commit -m "feat: arquitectura saas multi-usuario con supabase rls y vercel"
   git push origin main
   ```
2. Entra a tu panel de [Vercel](https://vercel.com/) y haz clic en **Add New... > Project**.
3. Importa tu repositorio `TrackGym-App`.
4. En la sección **Environment Variables**, añade:
   | Nombre de Variable | Valor |
   | :--- | :--- |
   | `SUPABASE_URL` | La URL de tu proyecto Supabase (ej: `https://qremwdvbhqvzbxtecvpj.supabase.co`) |
   | `SUPABASE_ANON_KEY` | Tu clave pública `anon` de Supabase (**NUNCA** uses la `service_role` key) |
5. Haz clic en **Deploy**. ¡Tu SaaS estará en producción en segundos!

---

## 🔒 Auditoría de Seguridad y Zero Leaks

1. **Row Level Security (RLS) Imparable:**
   - Todas las consultas (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) en `profiles`, `gym_sessions`, `gym_routines` y `workout_logs` están aisladas mediante la cláusula `auth.uid() = user_id`.
   - Un usuario jamás podrá leer ni modificar entrenamientos o rutinas de otro usuario, incluso intentando consultas directas a la API de Supabase.
2. **Zero Service Role Leaks:**
   - El frontend únicamente utiliza la clave pública `SUPABASE_ANON_KEY`. Las variables secretas `service_role` están estrictamente prohibidas y excluidas del cliente.
3. **Prevención de XSS e Inyecciones:**
   - Todas las entradas de texto libre (nombres de ejercicios, notas de series, comentarios de rutinas) pasan por el módulo [`src/utils/sanitize.js`](file:///c:/Users/Uriel/Documents/GitHub2/TrackGym-App/src/utils/sanitize.js) antes de ser guardadas o renderizadas en el DOM.
4. **Importación Segura de Excel:**
   - La subida de archivos `.xlsx`, `.xls` o `.csv` valida la extensión, el tamaño (máx. 10MB), el esquema de columnas y los tipos numéricos (repeticiones y peso dentro de rangos fisiológicamente válidos), asociando cada fila de forma inmutable al `auth.uid()` del usuario autenticado.

