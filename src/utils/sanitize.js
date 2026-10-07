/**
 * Módulo de Sanitización y Seguridad (Anti-XSS e Inyección)
 * Proporciona utilidades para desinfectar entradas de texto libre antes de renderizar en el DOM
 * o enviar a la base de datos.
 */

/**
 * Escapa caracteres HTML potencialmente peligrosos para evitar inyecciones XSS.
 * @param {string|any} str Texto a escapar
 * @returns {string} Texto seguro para HTML
 */
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitiza y recorta un texto de entrada para nombres de ejercicios, notas o alias.
 * Remueve caracteres de control invisibles y limita la longitud.
 * @param {string} str Texto de entrada
 * @param {number} maxLength Longitud máxima permitida
 * @returns {string} Texto limpio
 */
export function sanitizeText(str, maxLength = 250) {
    if (!str) return '';
    const clean = String(str)
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remover caracteres de control ASCII
        .trim();
    return clean.slice(0, maxLength);
}

/**
 * Valida y normaliza nombres de ejercicios
 * @param {string} name 
 * @returns {string}
 */
export function normalizeExerciseName(name) {
    if (!name) return '';
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Valida un formato de fecha YYYY-MM-DD
 * @param {string} dateStr 
 * @returns {boolean}
 */
export function isValidDateString(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;
    const d = new Date(dateStr + 'T00:00:00Z');
    return !isNaN(d.getTime());
}

/**
 * Valida y formatea duración de tiempo (HH:MM:SS o MM:SS)
 * @param {string} durationStr 
 * @returns {string|null}
 */
export function sanitizeDuration(durationStr) {
    if (!durationStr) return null;
    const trimmed = String(durationStr).trim();
    if (/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(trimmed)) {
        return trimmed;
    }
    // Si viene en minutos decimales
    const num = parseFloat(trimmed);
    if (!isNaN(num) && num > 0) {
        const totalSecs = Math.round(num * 60);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return null;
}

