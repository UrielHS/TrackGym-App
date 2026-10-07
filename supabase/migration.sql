-- ==============================================================================
-- TRACKGYM-APP / HYPERTRACK - MIGRACIÓN Y MODELADO DE DATOS SUPABASE
-- Arquitectura SaaS Multi-Usuario, Row Level Security (RLS) y Migración Histórica
-- ==============================================================================

-- 1. TABLA PROFILES Y TRIGGER DE AUTH
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    preferred_unit TEXT DEFAULT 'kg' CHECK (preferred_unit IN ('kg', 'lbs')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Habilitar RLS en profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para profiles
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Función y Trigger para auto-crear perfil al registrarse en Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, preferred_unit)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'preferred_unit', 'kg')
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
        updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 2. TABLA GYM_SESSIONS (HISTORIAL DE ENTRENAMIENTO MULTI-USUARIO)
-- ==============================================================================
-- Si la tabla ya existe, nos aseguramos de que tenga user_id y soporte multi-usuario
CREATE TABLE IF NOT EXISTS public.gym_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    date TEXT NOT NULL,
    duration TEXT,
    exercises JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Agregar columna user_id en caso de que la tabla ya existiese sin ella
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'gym_sessions' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE public.gym_sessions ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'gym_sessions' AND column_name = 'duration'
    ) THEN
        ALTER TABLE public.gym_sessions ADD COLUMN duration TEXT;
    END IF;
END $$;

-- Eliminar restricciones primarias antiguas basadas únicamente en 'date' para evitar colisiones entre usuarios
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    FOR constraint_rec IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = 'public' 
          AND tc.table_name = 'gym_sessions' 
          AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
          AND ccu.column_name = 'date'
          AND NOT EXISTS (
              SELECT 1 FROM information_schema.constraint_column_usage ccu2 
              WHERE ccu2.constraint_name = tc.constraint_name AND ccu2.column_name = 'user_id'
          )
    ) LOOP
        -- Si era la PK sólo con date, la removemos si ya tenemos id como PK
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gym_sessions' AND column_name = 'id') THEN
            BEGIN
                EXECUTE format('ALTER TABLE public.gym_sessions DROP CONSTRAINT %I', constraint_rec.constraint_name);
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END IF;
    END LOOP;
END $$;

-- Asegurar restricción única por (user_id, date) para permitir upserts limpios por usuario y fecha
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'gym_sessions_user_id_date_unique'
    ) THEN
        BEGIN
            ALTER TABLE public.gym_sessions ADD CONSTRAINT gym_sessions_user_id_date_unique UNIQUE (user_id, date);
        EXCEPTION WHEN duplicate_table THEN
            NULL;
        WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END $$;

-- Índices de alto rendimiento para gym_sessions
CREATE INDEX IF NOT EXISTS idx_gym_sessions_user_date ON public.gym_sessions (user_id, date DESC);


-- 3. TABLA GYM_ROUTINES (RUTINAS PERSONALIZADAS MULTI-USUARIO)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.gym_routines (
    id TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
    data JSONB NOT NULL DEFAULT '{"active":[],"archived":[]}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    PRIMARY KEY (user_id, id)
);

-- Asegurar columna user_id si la tabla existía previamente
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'gym_routines' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE public.gym_routines ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
    END IF;
END $$;

-- Asegurar clave primaria compuesta (user_id, id) en gym_routines
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.gym_routines DROP CONSTRAINT IF EXISTS gym_routines_pkey;
        ALTER TABLE public.gym_routines ADD PRIMARY KEY (user_id, id);
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
END $$;

CREATE INDEX IF NOT EXISTS idx_gym_routines_user_id ON public.gym_routines (user_id);


-- 4. TABLA WORKOUT_LOGS (OPCIONAL / VISTA UNIFICADA)
-- ==============================================================================
-- Tabla estandarizada que cumple con el requerimiento de denominación workout_logs
CREATE TABLE IF NOT EXISTS public.workout_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid(),
    date TEXT NOT NULL,
    duration TEXT,
    exercises JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    CONSTRAINT workout_logs_user_id_date_unique UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON public.workout_logs (user_id, date DESC);


-- 5. ROW LEVEL SECURITY (RLS) IMPARABLE
-- ==============================================================================

-- A) gym_sessions
ALTER TABLE public.gym_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_sessions_select_own" ON public.gym_sessions;
CREATE POLICY "gym_sessions_select_own"
    ON public.gym_sessions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "gym_sessions_insert_own" ON public.gym_sessions;
CREATE POLICY "gym_sessions_insert_own"
    ON public.gym_sessions FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "gym_sessions_update_own" ON public.gym_sessions;
CREATE POLICY "gym_sessions_update_own"
    ON public.gym_sessions FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "gym_sessions_delete_own" ON public.gym_sessions;
CREATE POLICY "gym_sessions_delete_own"
    ON public.gym_sessions FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- B) gym_routines
ALTER TABLE public.gym_routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_routines_select_own" ON public.gym_routines;
CREATE POLICY "gym_routines_select_own"
    ON public.gym_routines FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "gym_routines_insert_own" ON public.gym_routines;
CREATE POLICY "gym_routines_insert_own"
    ON public.gym_routines FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "gym_routines_update_own" ON public.gym_routines;
CREATE POLICY "gym_routines_update_own"
    ON public.gym_routines FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "gym_routines_delete_own" ON public.gym_routines;
CREATE POLICY "gym_routines_delete_own"
    ON public.gym_routines FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- C) workout_logs
ALTER TABLE public.workout_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workout_logs_select_own" ON public.workout_logs;
CREATE POLICY "workout_logs_select_own"
    ON public.workout_logs FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "workout_logs_insert_own" ON public.workout_logs;
CREATE POLICY "workout_logs_insert_own"
    ON public.workout_logs FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "workout_logs_update_own" ON public.workout_logs;
CREATE POLICY "workout_logs_update_own"
    ON public.workout_logs FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "workout_logs_delete_own" ON public.workout_logs;
CREATE POLICY "workout_logs_delete_own"
    ON public.workout_logs FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);


-- 6. SCRIPT DE ASIGNACIÓN HISTÓRICA (VINCULACIÓN AL ADMIN)
-- ==============================================================================
-- INSTRUCCIONES:
-- 1. Regístrate o copia el UUID de tu usuario Administrador desde Supabase Dashboard -> Authentication -> Users.
-- 2. Reemplaza el valor de 'TARGET_USER_ID' a continuación con tu UUID.
-- 3. Ejecuta este bloque para asociar todos los registros huérfanos anteriores a tu cuenta.

DO $$
DECLARE
    -- >>> REEMPLAZA ESTE UUID CON EL ID DE TU USUARIO ADMIN EN AUTH.USERS <<<
    TARGET_USER_ID UUID := '00000000-0000-0000-0000-000000000000'::uuid;
    updated_sessions_count INT := 0;
    updated_routines_count INT := 0;
    updated_logs_count INT := 0;
BEGIN
    -- Verificar si el usuario existe en auth.users
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = TARGET_USER_ID) THEN
        RAISE NOTICE '--------------------------------------------------------------------------------';
        RAISE NOTICE '⚠️ AVISO IMPORTANTE:';
        RAISE NOTICE 'El TARGET_USER_ID (%) no existe en auth.users.', TARGET_USER_ID;
        RAISE NOTICE 'Por favor regístrate en la app o ve a Supabase > Auth > Users para obtener tu UUID';
        RAISE NOTICE 'y re-ejecuta este bloque DO $$ para vincular los datos históricos.';
        RAISE NOTICE 'Los datos existentes se mantuvieron INTACTOS y seguros.';
        RAISE NOTICE '--------------------------------------------------------------------------------';
    ELSE
        -- 1. Asignar sesiones huérfanas
        UPDATE public.gym_sessions
        SET user_id = TARGET_USER_ID
        WHERE user_id IS NULL;
        GET DIAGNOSTICS updated_sessions_count = ROW_COUNT;

        -- 2. Asignar rutinas huérfanas
        UPDATE public.gym_routines
        SET user_id = TARGET_USER_ID
        WHERE user_id IS NULL;
        GET DIAGNOSTICS updated_routines_count = ROW_COUNT;

        -- 3. Sincronizar hacia workout_logs si estuviera vacía y gym_sessions tiene datos
        INSERT INTO public.workout_logs (user_id, date, duration, exercises, created_at, updated_at)
        SELECT s.user_id, s.date, s.duration, s.exercises, s.created_at, s.updated_at
        FROM public.gym_sessions s
        WHERE s.user_id = TARGET_USER_ID
        ON CONFLICT (user_id, date) DO UPDATE
        SET exercises = EXCLUDED.exercises,
            duration = EXCLUDED.duration,
            updated_at = NOW();
        GET DIAGNOSTICS updated_logs_count = ROW_COUNT;

        -- 4. Asegurar que el perfil del admin exista
        INSERT INTO public.profiles (id, email, display_name, preferred_unit)
        SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'display_name', 'Admin'), 'kg'
        FROM auth.users u
        WHERE u.id = TARGET_USER_ID
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE '--------------------------------------------------------------------------------';
        RAISE NOTICE '✅ MIGRACIÓN HISTÓRICA COMPLETADA CON ÉXITO:';
        RAISE NOTICE ' - Sesiones vinculadas: %', updated_sessions_count;
        RAISE NOTICE ' - Rutinas vinculadas: %', updated_routines_count;
        RAISE NOTICE ' - Registros sincronizados en workout_logs: %', updated_logs_count;
        RAISE NOTICE ' - Usuario Propietario (Admin): %', TARGET_USER_ID;
        RAISE NOTICE '--------------------------------------------------------------------------------';
    END IF;
END $$;

