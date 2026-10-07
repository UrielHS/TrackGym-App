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

### Paso 1: Configurar Supabase y Ejecutar la Migración SQL

1. Entra a tu consola de [Supabase Dashboard](https://supabase.com/dashboard) y selecciona tu proyecto.
2. Ve al menú lateral **SQL Editor** y haz clic en **New Query**.
3. Abre el archivo [`supabase/migration.sql`](file:///c:/Users/Uriel/Documents/GitHub2/TrackGym-App/supabase/migration.sql) de este repositorio y copia todo su contenido.
4. **VINCULACIÓN HISTÓRICA DEL USUARIO CREADOR (ADMIN):**
   - Si ya tienes un usuario creado en tu proyecto de Supabase, ve a **Authentication > Users** y copia tu **User UID** (un identificador con formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
   - Al final del script `supabase/migration.sql`, localiza la variable:
     ```sql
     TARGET_USER_ID UUID := '00000000-0000-0000-0000-000000000000'::uuid;
     ```
   - Reemplaza ese valor con tu UUID copiado.
   - Si aún no te has registrado en Supabase, ejecuta el script completo; luego crea tu cuenta en la app y vuelve a correr únicamente el bloque `DO $$ ... $$` con tu nuevo UUID.
5. Haz clic en **Run** en el SQL Editor de Supabase.
   - Se creará la tabla `profiles` con su trigger automático sobre `auth.users`.
   - Se actualizará `gym_sessions` con `user_id` y restricción única `(user_id, date)`.
   - Se creará `gym_routines` con clave primaria compuesta `(user_id, id)`.
   - Se activará **Row Level Security (RLS)** estricto en todas las tablas.
   - Todos los datos históricos precargados quedarán vinculados a tu cuenta sin perder ni truncar ningún dato.

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

