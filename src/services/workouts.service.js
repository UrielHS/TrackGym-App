/**
 * Servicio de Entrenamientos y Rutinas (WorkoutsService)
 * CRUD completo de sesiones, series regulares, sub-series (drop sets),
 * persistencia en Supabase con RLS, importación segura de Excel y exportación.
 */
import { getSupabase } from '../config/supabase.js';
import { sanitizeText, sanitizeDuration, isValidDateString } from '../utils/sanitize.js';

export class WorkoutsService {
    /**
     * Obtiene todas las sesiones del usuario autenticado ordenadas por fecha descendente.
     * @param {string} userId 
     * @returns {Promise<Array>}
     */
    static async fetchSessions(userId) {
        if (!userId) return [];
        const supabase = await getSupabase();

        const { data, error } = await supabase
            .from('gym_sessions')
            .select('date, duration, exercises')
            .eq('user_id', userId)
            .order('date', { ascending: false });

        if (error) {
            console.error("Error al obtener sesiones de Supabase:", error);
            throw new Error(`Error al cargar sesiones: ${error.message}`);
        }

        return (data || []).map(s => {
            let duration = s.duration;
            // Compatibilidad hacia atrás si la duración estaba en exercises[0]._sessionDuration
            if (!duration && s.exercises && s.exercises.length > 0 && s.exercises[0]._sessionDuration) {
                duration = s.exercises[0]._sessionDuration;
            }
            return {
                date: s.date,
                duration: duration || '',
                exercises: s.exercises || []
            };
        });
    }

    /**
     * Guarda o actualiza atómicamente una sola sesión vinculada al usuario autenticado.
     * @param {object} session { date, duration, exercises }
     * @param {string} userId 
     */
    static async saveSingleSession(session, userId) {
        if (!userId) throw new Error("Usuario no autenticado");
        if (!session.date) throw new Error("Fecha de sesión requerida");

        const supabase = await getSupabase();
        const cleanedExercises = this.sanitizeExercises(session.exercises || []);

        const payload = {
            user_id: userId,
            date: session.date,
            duration: sanitizeDuration(session.duration) || null,
            exercises: cleanedExercises,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('gym_sessions')
            .upsert(payload, { onConflict: 'user_id,date' });

        if (error) {
            console.error("Error guardando sesión individual en Supabase:", error);
            throw new Error(`Error al guardar sesión: ${error.message}`);
        }

        // Sincronizar en workout_logs si la tabla existe
        try {
            await supabase
                .from('workout_logs')
                .upsert(payload, { onConflict: 'user_id,date' });
        } catch {
            // Ignorar si workout_logs no se utiliza activamente
        }
    }

    /**
     * Guarda por lotes todas las sesiones del usuario (útil tras importaciones masivas).
     * @param {Array} sessions 
     * @param {string} userId 
     */
    static async saveBatchSessions(sessions, userId) {
        if (!userId) throw new Error("Usuario no autenticado");
        if (!Array.isArray(sessions) || sessions.length === 0) return;

        const supabase = await getSupabase();
        const payload = sessions.map(s => ({
            user_id: userId,
            date: s.date,
            duration: sanitizeDuration(s.duration) || null,
            exercises: this.sanitizeExercises(s.exercises || []),
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabase
            .from('gym_sessions')
            .upsert(payload, { onConflict: 'user_id,date' });

        if (error) {
            console.error("Error sincronizando sesiones en bloque:", error);
            throw new Error(`Error al guardar lote de sesiones: ${error.message}`);
        }
    }

    /**
     * Elimina una sesión específica por fecha para el usuario autenticado.
     * @param {string} date 
     * @param {string} userId 
     */
    static async deleteSession(date, userId) {
        if (!userId) throw new Error("Usuario no autenticado");
        const supabase = await getSupabase();

        const { error } = await supabase
            .from('gym_sessions')
            .delete()
            .eq('user_id', userId)
            .eq('date', date);

        if (error) {
            console.error("Error al borrar sesión:", error);
            throw new Error(`Error al borrar sesión: ${error.message}`);
        }

        try {
            await supabase
                .from('workout_logs')
                .delete()
                .eq('user_id', userId)
                .eq('date', date);
        } catch {
            // Silencioso
        }
    }

    /**
     * Elimina todos los registros del usuario actual (Zero Collateral: solo del usuario autenticado vía RLS).
     * @param {string} userId 
     */
    static async deleteAllUserSessions(userId) {
        if (!userId) throw new Error("Usuario no autenticado");
        const supabase = await getSupabase();

        const { error } = await supabase
            .from('gym_sessions')
            .delete()
            .eq('user_id', userId);

        if (error) {
            throw new Error(`Error eliminando sesiones: ${error.message}`);
        }

        try {
            await supabase
                .from('workout_logs')
                .delete()
                .eq('user_id', userId);
        } catch {}
    }

    /**
     * Obtiene la rutina del usuario autenticado (activa y archivada).
     * @param {string} userId 
     * @returns {Promise<{active: Array, archived: Array}>}
     */
    static async fetchRoutine(userId) {
        if (!userId) return { active: [], archived: [] };
        const supabase = await getSupabase();

        const { data, error } = await supabase
            .from('gym_routines')
            .select('data')
            .eq('user_id', userId)
            .eq('id', 'my_routine')
            .maybeSingle();

        if (error) {
            console.warn("No se pudo obtener la rutina:", error.message);
            return { active: [], archived: [] };
        }

        return data?.data || { active: [], archived: [] };
    }

    /**
     * Guarda la rutina del usuario autenticado.
     * @param {object} routineData { active: [], archived: [] }
     * @param {string} userId 
     */
    static async saveRoutine(routineData, userId) {
        if (!userId) throw new Error("Usuario no autenticado");
        const supabase = await getSupabase();

        const cleanedRoutine = {
            active: (routineData.active || []).map(item => ({
                id: item.id || String(Date.now() + Math.random()),
                day: sanitizeText(item.day, 20),
                muscle: sanitizeText(item.muscle, 30),
                name: sanitizeText(item.name, 100)
            })),
            archived: (routineData.archived || []).map(item => ({
                id: item.id || String(Date.now() + Math.random()),
                day: sanitizeText(item.day, 20),
                muscle: sanitizeText(item.muscle, 30),
                name: sanitizeText(item.name, 100)
            }))
        };

        const { error } = await supabase
            .from('gym_routines')
            .upsert({
                id: 'my_routine',
                user_id: userId,
                data: cleanedRoutine,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,id' });

        if (error) {
            console.error("Error guardando rutina:", error);
            throw new Error(`Error al guardar rutina: ${error.message}`);
        }
    }

    /**
     * Sanitiza y valida la estructura de ejercicios y series (incluyendo drop sets).
     * @param {Array} exercises 
     * @returns {Array}
     */
    static sanitizeExercises(exercises) {
        if (!Array.isArray(exercises)) return [];

        return exercises.map(ex => {
            const cleanEx = {
                name: sanitizeText(ex.name, 100) || 'Ejercicio sin nombre',
                muscle: sanitizeText(ex.muscle, 50) || 'General',
                sets: []
            };

            if (ex.note) cleanEx.note = sanitizeText(ex.note, 500);

            if (Array.isArray(ex.sets)) {
                cleanEx.sets = ex.sets.map(s => {
                    const reps = parseInt(s.reps, 10);
                    const weight = parseFloat(s.weight);
                    const unit = String(s.unit || 'kg').toLowerCase() === 'lbs' ? 'lbs' : 'kg';
                    const isDropSet = Boolean(s.isDropSet);

                    return {
                        reps: isNaN(reps) || reps < 0 ? 0 : Math.min(reps, 500),
                        weight: isNaN(weight) || weight < 0 ? 0 : Math.min(weight, 2000),
                        unit,
                        isDropSet
                    };
                });
            }

            return cleanEx;
        });
    }

    /**
     * Importación Segura de Excel: Valida schema de columnas, tipos de datos
     * y asocia inmutablemente cada fila al usuario autenticado.
     * @param {File} file Archivo subido por el usuario
     * @param {Array} existingSessions Sesiones actuales para fusionar
     * @param {string} userId UUID del usuario
     * @returns {Promise<{mergedSessions: Array, countAdded: number}>}
     */
    static async parseAndValidateExcel(file, existingSessions, userId) {
        if (!userId) throw new Error("Operación no autorizada. Debes iniciar sesión.");
        if (!file) throw new Error("No se proporcionó ningún archivo.");

        // Validar tamaño máximo (10MB)
        if (file.size > 10 * 1024 * 1024) {
            throw new Error("El archivo excede el tamaño máximo permitido de 10MB.");
        }

        // Validar tipo de archivo
        const validExtensions = ['.xlsx', '.xls', '.csv'];
        const fileName = file.name.toLowerCase();
        if (!validExtensions.some(ext => fileName.endsWith(ext))) {
            throw new Error("Formato no compatible. Sube un archivo .xlsx, .xls o .csv");
        }

        const XLSX = window.XLSX;
        if (!XLSX) {
            throw new Error("Librería de procesamiento de hojas de cálculo (SheetJS) no cargada.");
        }

        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error("El libro de Excel no contiene hojas de datos.");
        }

        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(firstSheet);

        if (!Array.isArray(rawRows) || rawRows.length === 0) {
            throw new Error("La hoja de cálculo está vacía o no tiene registros válidos.");
        }

        let importedMap = {};
        let countAdded = 0;

        rawRows.forEach((row, rowIndex) => {
            // Resolver columnas tolerando variaciones
            const rawExName = row['Ejercicio'] || row['ejercicio'] || row['Exercise'];
            const repsRaw = row['Repeticiones'] !== undefined ? row['Repeticiones'] : (row['Repeticion'] || row['Reps']);
            const weightRaw = row['Peso'] !== undefined ? row['Peso'] : (row['Pesos'] || row['Weight']);
            const muscleRaw = row['Grupo Muscular'] || row['Grupo muscular'] || row['Musculo'] || row['Muscle'] || 'General';
            const noteRaw = row['Notas'] || row['Nota'] || row['Notes'] || '';
            const durationRaw = row['Tiempo'] || row['Tiempo (Duración)'] || row['Duracion'] || '';
            const dropSetRaw = row['Es Drop Set'] || row['Es DropSet'] || row['Drop Set'] || 'No';
            const unitRaw = (row['Unidad'] || row['Unit'] || 'kg').toString().toLowerCase().trim();

            if (!rawExName || repsRaw === undefined || weightRaw === undefined) {
                return; // Omitir fila inválida
            }

            const cleanName = sanitizeText(rawExName, 100);
            const cleanMuscle = sanitizeText(muscleRaw, 50) || 'General';
            const cleanNote = sanitizeText(noteRaw, 500);
            const reps = parseInt(repsRaw, 10);
            const weight = parseFloat(weightRaw);

            if (isNaN(reps) || reps <= 0 || isNaN(weight) || weight < 0) {
                return; // Omitir datos numéricos inválidos
            }

            // Parsear fecha
            let dateStr = row['Fecha'] || row['fecha'] || row['Date'];
            if (typeof dateStr === 'number') {
                // Fecha de Excel a JS
                const excelEpoch = new Date(1899, 11, 30);
                const jsDate = new Date(excelEpoch.getTime() + dateStr * 86400000);
                dateStr = jsDate.toISOString().split('T')[0];
            } else if (dateStr) {
                const parsedDate = new Date(dateStr);
                if (!isNaN(parsedDate.getTime())) {
                    dateStr = parsedDate.toISOString().split('T')[0];
                } else {
                    dateStr = new Date().toISOString().split('T')[0];
                }
            } else {
                dateStr = new Date().toISOString().split('T')[0];
            }

            if (!isValidDateString(dateStr)) {
                dateStr = new Date().toISOString().split('T')[0];
            }

            if (!importedMap[dateStr]) importedMap[dateStr] = {};

            if (!importedMap[dateStr][cleanName]) {
                importedMap[dateStr][cleanName] = {
                    muscle: cleanMuscle,
                    note: cleanNote,
                    duration: sanitizeDuration(durationRaw) || '',
                    sets: []
                };
            }

            const isDS = String(dropSetRaw).toLowerCase().trim();
            const isDropSet = ['sí', 'si', 'true', 'yes', '1', 'ds'].includes(isDS);

            importedMap[dateStr][cleanName].sets.push({
                reps: Math.min(reps, 500),
                weight: Math.min(weight, 2000),
                unit: unitRaw === 'lbs' ? 'lbs' : 'kg',
                isDropSet
            });

            countAdded++;
        });

        if (countAdded === 0) {
            throw new Error("No se encontraron series válidas. Verifica que las columnas sean: Fecha, Ejercicio, Repeticiones, Peso, Unidad.");
        }

        // Clonar array de sesiones existentes para no mutar inesperadamente
        const mergedSessions = JSON.parse(JSON.stringify(existingSessions || []));

        for (const [date, exercisesMap] of Object.entries(importedMap)) {
            let session = mergedSessions.find(s => s.date === date);
            if (!session) {
                session = { date, duration: '', exercises: [] };
                mergedSessions.push(session);
            }

            // Duración si existe
            for (const exData of Object.values(exercisesMap)) {
                if (exData.duration && !session.duration) {
                    session.duration = exData.duration;
                }
            }

            for (const [exName, exData] of Object.entries(exercisesMap)) {
                let existingEx = session.exercises.find(e => e.name.toLowerCase() === exName.toLowerCase());
                if (existingEx) {
                    existingEx.sets.push(...exData.sets);
                    if (!existingEx.note && exData.note) existingEx.note = exData.note;
                } else {
                    session.exercises.push({
                        name: exName,
                        muscle: exData.muscle,
                        note: exData.note,
                        sets: exData.sets
                    });
                }
            }
        }

        return { mergedSessions, countAdded };
    }

    /**
     * Exporta el historial de sesiones a un archivo Excel (.xlsx).
     * @param {Array} sessions 
     */
    static exportToExcel(sessions) {
        const XLSX = window.XLSX;
        if (!XLSX) throw new Error("Librería SheetJS no encontrada.");

        let rows = [];
        (sessions || []).forEach(session => {
            (session.exercises || []).forEach(ex => {
                (ex.sets || []).forEach((set, i) => {
                    rows.push({
                        'Fecha': session.date,
                        'Tiempo': session.duration || '',
                        'Grupo Muscular': ex.muscle || '',
                        'Ejercicio': ex.name || '',
                        'Serie': i + 1,
                        'Repeticiones': set.reps,
                        'Peso': set.weight,
                        'Unidad': (set.unit || 'kg').toLowerCase(),
                        'Es Drop Set': set.isDropSet ? 'Sí' : 'No',
                        'Notas': ex.note || ''
                    });
                });
            });
        });

        if (rows.length === 0) {
            throw new Error("No hay registros en tu historial para exportar.");
        }

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Historial Gym");
        XLSX.writeFile(workbook, "TrackGym_Historial.xlsx");
    }
}

