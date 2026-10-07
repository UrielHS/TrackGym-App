/**
 * Inicialización Segura del Cliente Supabase
 * Lee variables de entorno cargadas dinámicamente y mantiene una instancia Singleton.
 * Aplica Zero Leaks: únicamente ANON_KEY.
 */
import { getEnv, loadEnv } from './env.js';

let supabaseInstance = null;

/**
 * Obtiene o inicializa la instancia única del cliente de Supabase.
 * @returns {Promise<any>} Instancia del cliente Supabase
 */
export async function getSupabase() {
    if (supabaseInstance) return supabaseInstance;

    await loadEnv();
    const env = getEnv();

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        throw new Error("Configuración de Supabase incompleta. Verifica SUPABASE_URL y SUPABASE_ANON_KEY.");
    }

    // Verificar si window.supabase está disponible por CDN o importar dinámicamente
    let createClient = window.supabase?.createClient;
    if (!createClient) {
        try {
            const module = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
            createClient = module.createClient;
        } catch (err) {
            console.error("No se pudo cargar la librería Supabase:", err);
            throw new Error("Librería de Supabase no disponible.");
        }
    }

    supabaseInstance = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: window.localStorage
        }
    });

    return supabaseInstance;
}

