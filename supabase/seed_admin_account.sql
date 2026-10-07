-- ==============================================================================
-- TRACKGYM-APP: SCRIPT MAESTRO AUTOCONTENIDO (SEED ADMIN + DATOS HISTÓRICOS)
-- Soluciona automáticamente columnas faltantes, tipos UUID y permisos
-- ==============================================================================

-- 1. Habilitar extensión criptográfica
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Asegurar que existan todas las columnas necesarias en gym_sessions
ALTER TABLE public.gym_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.gym_sessions ADD COLUMN IF NOT EXISTS duration TEXT;
ALTER TABLE public.gym_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.gym_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Asegurar columnas en gym_routines
CREATE TABLE IF NOT EXISTS public.gym_routines (
    id TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id),
    data JSONB NOT NULL DEFAULT '{"active":[],"archived":[]}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.gym_routines ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.gym_routines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Asegurar tabla profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    preferred_unit TEXT DEFAULT 'kg',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Asegurar tabla workout_logs
CREATE TABLE IF NOT EXISTS public.workout_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    duration TEXT,
    exercises JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Configurar restricciones de unicidad compuestas (user_id, date) de forma segura
DO $$
BEGIN
    -- Remover clave primaria simple por date si existía
    BEGIN
        ALTER TABLE public.gym_sessions DROP CONSTRAINT IF EXISTS gym_sessions_pkey;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Agregar restricción única (user_id, date) en gym_sessions
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_sessions_user_id_date_unique') THEN
        BEGIN
            ALTER TABLE public.gym_sessions ADD CONSTRAINT gym_sessions_user_id_date_unique UNIQUE (user_id, date);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- Agregar restricción en workout_logs
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_logs_user_id_date_unique') THEN
        BEGIN
            ALTER TABLE public.workout_logs ADD CONSTRAINT workout_logs_user_id_date_unique UNIQUE (user_id, date);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;
END $$;

-- 7. BLOQUE PRINCIPAL DE CREACIÓN Y VINCULACIÓN
DO $$
DECLARE
    ADMIN_EMAIL TEXT := 'admin@trackgym.com';
    ADMIN_PASSWORD TEXT := 'TrackGym2026!';
    ADMIN_NAME TEXT := 'Uriel (Admin)';
    
    ADMIN_UID UUID;
BEGIN
    -- Buscar o crear el usuario en auth.users
    SELECT id INTO ADMIN_UID FROM auth.users WHERE email = LOWER(ADMIN_EMAIL);
    
    IF ADMIN_UID IS NOT NULL THEN
        RAISE NOTICE 'El usuario % ya existe con UUID: %', ADMIN_EMAIL, ADMIN_UID;
        
        UPDATE auth.users
        SET encrypted_password = extensions.crypt(ADMIN_PASSWORD, extensions.gen_salt('bf')),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            updated_at = NOW(),
            raw_user_meta_data = jsonb_build_object('display_name', ADMIN_NAME, 'preferred_unit', 'kg')
        WHERE id = ADMIN_UID;
    ELSE
        ADMIN_UID := gen_random_uuid();
        
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            last_sign_in_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            email_change,
            email_change_token_new,
            recovery_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000'::uuid,
            ADMIN_UID,
            'authenticated',
            'authenticated',
            LOWER(ADMIN_EMAIL),
            extensions.crypt(ADMIN_PASSWORD, extensions.gen_salt('bf')),
            NOW(),
            NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('display_name', ADMIN_NAME, 'preferred_unit', 'kg'),
            NOW(),
            NOW(),
            '',
            '',
            '',
            ''
        );

        RAISE NOTICE '✅ Usuario creado en auth.users con UUID: %', ADMIN_UID;
    END IF;

    -- Registrar identidad para login
    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = ADMIN_UID) THEN
        INSERT INTO auth.identities (
            id,
            user_id,
            identity_data,
            provider,
            provider_id,
            last_sign_in_at,
            created_at,
            updated_at
        ) VALUES (
            ADMIN_UID,
            ADMIN_UID,
            jsonb_build_object('sub', ADMIN_UID::text, 'email', LOWER(ADMIN_EMAIL)),
            'email',
            ADMIN_UID::text,
            NOW(),
            NOW(),
            NOW()
        );
    END IF;

    -- Crear o actualizar perfil
    INSERT INTO public.profiles (id, email, display_name, preferred_unit)
    VALUES (ADMIN_UID, LOWER(ADMIN_EMAIL), ADMIN_NAME, 'kg')
    ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        preferred_unit = EXCLUDED.preferred_unit,
        updated_at = NOW();

    -- Vincular registros huérfanos preexistentes a tu cuenta
    UPDATE public.gym_sessions
    SET user_id = ADMIN_UID
    WHERE user_id IS NULL;

    UPDATE public.gym_routines
    SET user_id = ADMIN_UID
    WHERE user_id IS NULL;

    -- Insertar sesiones históricas
    INSERT INTO public.gym_sessions (user_id, date, duration, exercises)
    VALUES 
    (
        ADMIN_UID, 
        '2024-06-09', 
        NULL,
        '[
            {"name": "Press Inclinado", "muscle": "Pecho", "sets": [{"reps": 10, "weight": 20, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 20, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 20, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 20, "unit": "kg", "isDropSet": false}]},
            {"name": "Press militar", "muscle": "Hombro", "sets": [{"reps": 10, "weight": 10, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 10, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 10, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 10, "unit": "kg", "isDropSet": false}]}
        ]'::jsonb
    ),
    (
        ADMIN_UID, 
        '2024-06-18', 
        NULL,
        '[
            {"name": "Press Inclinado", "muscle": "Pecho", "sets": [{"reps": 10, "weight": 22.5, "unit": "kg", "isDropSet": false}, {"reps": 8, "weight": 25, "unit": "kg", "isDropSet": false}, {"reps": 7, "weight": 25, "unit": "kg", "isDropSet": false}, {"reps": 5, "weight": 25, "unit": "kg", "isDropSet": false}]},
            {"name": "Press militar", "muscle": "Hombro", "sets": [{"reps": 10, "weight": 10, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 10, "unit": "kg", "isDropSet": false}, {"reps": 6, "weight": 15, "unit": "kg", "isDropSet": false}, {"reps": 6, "weight": 15, "unit": "kg", "isDropSet": false}]}
        ]'::jsonb
    ),
    (
        ADMIN_UID, 
        '2024-06-20', 
        NULL,
        '[
            {"name": "Jalón al pecho en polea", "muscle": "Espalda", "sets": [{"reps": 11, "weight": 45, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 51.8, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 51.8, "unit": "kg", "isDropSet": false}, {"reps": 7, "weight": 58.5, "unit": "kg", "isDropSet": false}]},
            {"name": "Curl de bicep con mancuerna", "muscle": "Bicep", "sets": [{"reps": 10, "weight": 25, "unit": "lbs", "isDropSet": false}, {"reps": 10, "weight": 20, "unit": "lbs", "isDropSet": false}, {"reps": 8, "weight": 25, "unit": "lbs", "isDropSet": false}, {"reps": 8, "weight": 20, "unit": "lbs", "isDropSet": false}]}
        ]'::jsonb
    ),
    (
        ADMIN_UID, 
        '2024-06-24', 
        NULL,
        '[
            {"name": "Hack", "muscle": "Pierna", "sets": [{"reps": 12, "weight": 15, "unit": "kg", "isDropSet": false}, {"reps": 10, "weight": 20, "unit": "kg", "isDropSet": false}, {"reps": 7, "weight": 30, "unit": "kg", "isDropSet": false}, {"reps": 7, "weight": 30, "unit": "kg", "isDropSet": false}]},
            {"name": "Peso muerto en maquina", "muscle": "Pierna", "sets": [{"reps": 10, "weight": 25, "unit": "kg", "isDropSet": false}, {"reps": 8, "weight": 25, "unit": "kg", "isDropSet": false}, {"reps": 8, "weight": 20, "unit": "kg", "isDropSet": false}, {"reps": 8, "weight": 20, "unit": "kg", "isDropSet": false}]}
        ]'::jsonb
    ),
    (
        ADMIN_UID, 
        '2024-08-31', 
        NULL,
        '[
            {"name": "Press Inclinado", "muscle": "Pecho", "sets": [{"reps": 11, "weight": 25, "unit": "kg", "isDropSet": false}, {"reps": 7, "weight": 30, "unit": "kg", "isDropSet": false}, {"reps": 5, "weight": 30, "unit": "kg", "isDropSet": false}]},
            {"name": "Press militar", "muscle": "Hombro", "sets": [{"reps": 7, "weight": 20, "unit": "kg", "isDropSet": false}, {"reps": 5, "weight": 22.5, "unit": "kg", "isDropSet": false}, {"reps": 8, "weight": 20, "unit": "kg", "isDropSet": false}]}
        ]'::jsonb
    ),
    (
        ADMIN_UID, 
        '2024-09-02', 
        NULL,
        '[
            {"name": "Jalón al pecho en polea", "muscle": "Espalda", "sets": [{"reps": 7, "weight": 65.3, "unit": "kg", "isDropSet": false}, {"reps": 8, "weight": 58.5, "unit": "kg", "isDropSet": false}, {"reps": 7, "weight": 58.5, "unit": "kg", "isDropSet": false}]},
            {"name": "Curl de bicep con barra recta", "muscle": "Bicep", "sets": [{"reps": 9, "weight": 60, "unit": "lbs", "isDropSet": false}, {"reps": 7, "weight": 60, "unit": "lbs", "isDropSet": false}, {"reps": 8, "weight": 60, "unit": "lbs", "isDropSet": false}]}
        ]'::jsonb
    )
    ON CONFLICT DO NOTHING;

    -- Sincronizar en workout_logs
    INSERT INTO public.workout_logs (user_id, date, duration, exercises)
    SELECT s.user_id, s.date, s.duration, s.exercises
    FROM public.gym_sessions s
    WHERE s.user_id = ADMIN_UID
    ON CONFLICT DO NOTHING;

    -- Inicializar rutina
    INSERT INTO public.gym_routines (id, user_id, data)
    VALUES (
        'my_routine',
        ADMIN_UID,
        '{
            "active": [
                {"id": "r1", "day": "Lunes", "muscle": "Pecho", "name": "Press Inclinado"},
                {"id": "r2", "day": "Lunes", "muscle": "Hombro", "name": "Press militar"},
                {"id": "r3", "day": "Miércoles", "muscle": "Espalda", "name": "Jalón al pecho en polea"},
                {"id": "r4", "day": "Miércoles", "muscle": "Bicep", "name": "Curl de bicep con barra recta"},
                {"id": "r5", "day": "Viernes", "muscle": "Pierna", "name": "Hack"},
                {"id": "r6", "day": "Viernes", "muscle": "Pierna", "name": "Peso muerto en maquina"}
            ],
            "archived": []
        }'::jsonb
    )
    ON CONFLICT DO NOTHING;

    RAISE NOTICE '--------------------------------------------------------------------------------';
    RAISE NOTICE '🚀 TODO LISTO: CUENTA ADMIN Y DATOS HISTÓRICOS VINCULADOS CON ÉXITO:';
    RAISE NOTICE ' - Email: %', ADMIN_EMAIL;
    RAISE NOTICE ' - Contraseña: %', ADMIN_PASSWORD;
    RAISE NOTICE ' - UUID Asignado: %', ADMIN_UID;
    RAISE NOTICE '--------------------------------------------------------------------------------';
END $$;
