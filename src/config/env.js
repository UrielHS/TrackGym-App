/**
 * Configuración de Variables de Entorno para el Cliente
 * Soporta inyección dinámica en runtime (Vercel Serverless /api/config),
 * variables globales inyectadas (window.__ENV__), y fallbacks seguros con ANON_KEY.
 * 
 * ZERO LEAKS POLICY:
 * Prohibido rotundamente incluir SERVICE_ROLE_KEY.
 * Solo la clave pública ANON_KEY es expuesta al cliente web.
 */

const DEFAULT_CONFIG = {
    SUPABASE_URL: 'https://qremwdvbhqvzbxtecvpj.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyZW13ZHZiaHF2emJ4dGVjdnBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDAyMDQsImV4cCI6MjEwNDIxNjIwNH0.gdEx2Lg8pZYKUHahtLs9n87yso6Y8jym7X58oZ-_dbk'
};

let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Carga la configuración de variables de entorno de forma asíncrona.
 * En Vercel intenta leer de /api/config (si existe el endpoint).
 * De lo contrario, utiliza window.__ENV__ o DEFAULT_CONFIG.
 * @returns {Promise<{SUPABASE_URL: string, SUPABASE_ANON_KEY: string}>}
 */
export async function loadEnv() {
    // 1. Verificar si existen variables inyectadas en window.__ENV__
    if (window.__ENV__ && window.__ENV__.SUPABASE_URL && window.__ENV__.SUPABASE_ANON_KEY) {
        currentConfig.SUPABASE_URL = window.__ENV__.SUPABASE_URL;
        currentConfig.SUPABASE_ANON_KEY = window.__ENV__.SUPABASE_ANON_KEY;
        return currentConfig;
    }

    // 2. Intentar consultar endpoint serverless de Vercel (/api/config)
    try {
        const res = await fetch('/api/config', { method: 'GET', cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data.SUPABASE_URL && data.SUPABASE_ANON_KEY) {
                currentConfig.SUPABASE_URL = data.SUPABASE_URL;
                currentConfig.SUPABASE_ANON_KEY = data.SUPABASE_ANON_KEY;
                return currentConfig;
            }
        }
    } catch {
        // En desarrollo local estático o GitHub Pages el endpoint /api/config puede no estar disponible
    }

    return currentConfig;
}

export function getEnv() {
    return currentConfig;
}

