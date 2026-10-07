/**
 * Servicio de Autenticación y Gestión de Usuarios (Supabase Auth)
 * Encapsula Login, Signup, SignOut, Obtención de Usuario y Listener de Sesión.
 */
import { getSupabase } from '../config/supabase.js';

export class AuthService {
    /**
     * Iniciar sesión con email y contraseña
     * @param {string} email 
     * @param {string} password 
     */
    static async login(email, password) {
        const supabase = await getSupabase();
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password
        });

        if (error) {
            throw this.formatAuthError(error);
        }

        return data;
    }

    /**
     * Registrar un nuevo usuario con email, contraseña y nombre
     * @param {string} email 
     * @param {string} password 
     * @param {string} displayName 
     * @param {string} preferredUnit 
     */
    static async signUp(email, password, displayName = '', preferredUnit = 'kg') {
        const supabase = await getSupabase();
        const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
                data: {
                    display_name: displayName.trim() || email.split('@')[0],
                    preferred_unit: preferredUnit
                }
            }
        });

        if (error) {
            throw this.formatAuthError(error);
        }

        return data;
    }

    /**
     * Cerrar sesión y purgar tokens de autenticación
     */
    static async logout() {
        const supabase = await getSupabase();
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error("Error cerrando sesión en Supabase:", error);
        }
    }

    /**
     * Obtener el usuario autenticado actual
     * @returns {Promise<any|null>}
     */
    static async getCurrentUser() {
        const supabase = await getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        return user || null;
    }

    /**
     * Obtener la sesión activa
     * @returns {Promise<any|null>}
     */
    static async getCurrentSession() {
        const supabase = await getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        return session || null;
    }

    /**
     * Obtener el perfil del usuario desde public.profiles
     * @param {string} userId 
     */
    static async getUserProfile(userId) {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            console.warn("No se pudo obtener el perfil de usuario:", error.message);
            return null;
        }
        return data;
    }

    /**
     * Actualizar información de perfil del usuario
     * @param {string} userId 
     * @param {object} updates 
     */
    static async updateUserProfile(userId, updates) {
        const supabase = await getSupabase();
        const { data, error } = await supabase
            .from('profiles')
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            throw new Error(`Error actualizando perfil: ${error.message}`);
        }
        return data;
    }

    /**
     * Escuchar cambios en el estado de autenticación (login, logout, refresh de token)
     * @param {(event: string, session: any) => void} callback 
     */
    static async onAuthStateChange(callback) {
        const supabase = await getSupabase();
        return supabase.auth.onAuthStateChange(callback);
    }

    /**
     * Transforma errores técnicos de Supabase Auth a mensajes claros en español.
     * @param {any} error 
     * @returns {Error}
     */
    static formatAuthError(error) {
        const msg = (error.message || '').toLowerCase();

        if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
            return new Error('Credenciales incorrectas. Verifica tu correo y contraseña.');
        }
        if (msg.includes('user already registered') || msg.includes('email already')) {
            return new Error('Este correo electrónico ya está registrado.');
        }
        if (msg.includes('password should be at least') || msg.includes('weak_password')) {
            return new Error('La contraseña debe tener al menos 6 caracteres.');
        }
        if (msg.includes('email not confirmed')) {
            return new Error('Correo no confirmado. Por favor revisa tu bandeja de entrada o desactiva la confirmación obligatoria en Supabase.');
        }
        if (msg.includes('rate limit')) {
            return new Error('Demasiados intentos. Espera unos momentos antes de reintentar.');
        }

        return new Error(error.message || 'Error en el servicio de autenticación.');
    }
}

