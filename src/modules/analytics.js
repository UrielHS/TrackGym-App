/**
 * Módulo de Análisis Biomecánico y Estadísticas (Analytics)
 * Algoritmos de 1RM (Epley), volumen semanal por grupo muscular,
 * mapeo de fatiga y recuperación muscular, y recomendaciones de hipertrofia.
 */

export const MUSCLE_GROUPS = ['Pecho', 'Espalda', 'Hombro', 'Pierna', 'Bicep', 'Tricep'];

export const MUSCLE_ALIASES = {
    'Pecho': ['pecho', 'chest', 'pectoral', 'pectorales'],
    'Espalda': ['espalda', 'dorsal', 'dorsales', 'back', 'trapecio', 'trapecios'],
    'Hombro': ['hombro', 'hombros', 'deltoides', 'deltoide', 'shoulder'],
    'Pierna': ['pierna', 'piernas', 'leg', 'legs', 'cuadricep', 'cuadriceps', 'gluteo', 'gluteos', 'isquio', 'isquiotibiales', 'pantorrilla', 'femoral'],
    'Bicep': ['bicep', 'biceps', 'bicepss'],
    'Tricep': ['tricep', 'triceps']
};

/**
 * Convierte un peso a kilogramos para unificar cálculos matemáticos.
 * @param {number} weight 
 * @param {string} unit 'kg' | 'lbs'
 * @returns {number}
 */
export function convertToKg(weight, unit = 'kg') {
    const num = parseFloat(weight) || 0;
    if (String(unit).toLowerCase() === 'lbs') {
        return num / 2.20462;
    }
    return num;
}

/**
 * Convierte un peso de kilogramos a la unidad preferida.
 * @param {number} weightInKg 
 * @param {string} targetUnit 'kg' | 'lbs'
 * @returns {number}
 */
export function convertFromKg(weightInKg, targetUnit = 'kg') {
    const num = parseFloat(weightInKg) || 0;
    if (String(targetUnit).toLowerCase() === 'lbs') {
        return num * 2.20462;
    }
    return num;
}

/**
 * Calcula el 1RM estimado utilizando la fórmula de Epley:
 * 1RM = Weight * (1 + Reps / 30)
 * Si Reps == 1, 1RM = Weight.
 * @param {number} weight Peso levantado
 * @param {number} reps Repeticiones completadas
 * @param {string} unit Unidad de medida ('kg' | 'lbs')
 * @returns {number} 1RM estimado en la unidad especificada
 */
export function calculate1RM(weight, reps, unit = 'kg') {
    const w = parseFloat(weight) || 0;
    const r = parseInt(reps, 10) || 0;
    if (w <= 0 || r <= 0) return 0;
    if (r === 1) return parseFloat(w.toFixed(1));
    // Fórmula Epley
    const epley = w * (1 + (r / 30));
    return parseFloat(epley.toFixed(1));
}

/**
 * Resuelve el grupo muscular canónico a partir de un texto libre.
 * @param {string} rawMuscle 
 * @returns {string|null}
 */
export function resolveMuscleGroup(rawMuscle) {
    if (!rawMuscle) return null;
    const normalized = rawMuscle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    for (const [canonical, aliases] of Object.entries(MUSCLE_ALIASES)) {
        if (aliases.includes(normalized)) return canonical;
    }
    return null;
}

/**
 * Obtiene la serie con el 1RM más alto de un ejercicio en una sesión.
 * @param {object} exercise 
 * @returns {{max1RM: number, maxWeight: number, repsAtMax: number, bestSet: object}|null}
 */
export function getExercisePeakMetrics(exercise) {
    if (!exercise || !Array.isArray(exercise.sets) || exercise.sets.length === 0) {
        return null;
    }

    // Excluir drop sets para estimación de fuerza máxima
    const mainSets = exercise.sets.filter(s => !s.isDropSet);
    const candidateSets = mainSets.length > 0 ? mainSets : exercise.sets;

    let max1RM = 0;
    let maxWeightKg = 0;
    let repsAtMax = 0;
    let bestSet = null;

    candidateSets.forEach(set => {
        const weightKg = convertToKg(set.weight, set.unit);
        const est1RM = calculate1RM(weightKg, set.reps, 'kg');
        if (est1RM > max1RM) {
            max1RM = est1RM;
            maxWeightKg = weightKg;
            repsAtMax = set.reps;
            bestSet = set;
        }
    });

    return { max1RM, maxWeightKg, repsAtMax, bestSet };
}

/**
 * Genera la serie de datos cronológicos de 1RM y peso para un ejercicio dado.
 * @param {Array} sessions Historial completo de sesiones
 * @param {string} exerciseName Nombre del ejercicio seleccionado
 * @returns {{labels: Array, oneRmData: Array, maxWeightData: Array, avgWeightData: Array}}
 */
export function getExerciseProgressData(sessions, exerciseName) {
    if (!exerciseName || !Array.isArray(sessions)) {
        return { labels: [], oneRmData: [], maxWeightData: [], avgWeightData: [] };
    }

    const targetNorm = exerciseName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // Ordenar de más antiguo a más reciente
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));

    const labels = [];
    const oneRmData = [];
    const maxWeightData = [];
    const avgWeightData = [];

    sorted.forEach(session => {
        const ex = (session.exercises || []).find(e => {
            const eNorm = (e.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            return eNorm === targetNorm;
        });

        if (ex && ex.sets && ex.sets.length > 0) {
            const peak = getExercisePeakMetrics(ex);
            if (!peak) return;

            const mainSets = ex.sets.filter(s => !s.isDropSet);
            const setsToCalc = mainSets.length > 0 ? mainSets : ex.sets;
            const weights = setsToCalc.map(s => convertToKg(s.weight, s.unit));
            const avgKg = weights.reduce((sum, w) => sum + w, 0) / weights.length;

            const dateObj = new Date(session.date + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

            labels.push(formattedDate);
            oneRmData.push(parseFloat(peak.max1RM.toFixed(1)));
            maxWeightData.push(parseFloat(peak.maxWeightKg.toFixed(1)));
            avgWeightData.push(parseFloat(avgKg.toFixed(1)));
        }
    });

    return { labels, oneRmData, maxWeightData, avgWeightData };
}

/**
 * Calcula el volumen semanal (series efectivas) de los últimos 7 días por grupo muscular.
 * Si las sesiones son históricas, usa la fecha más reciente como ancla.
 * @param {Array} sessions 
 * @returns {{counts: object, startDateStr: string, endDateStr: string}}
 */
export function calculateWeeklyVolume(sessions) {
    const counts = { 'Pecho': 0, 'Espalda': 0, 'Hombro': 0, 'Pierna': 0, 'Bicep': 0, 'Tricep': 0 };

    if (!Array.isArray(sessions) || sessions.length === 0) {
        const now = new Date();
        const start = new Date(now.getTime() - (6 * 24 * 60 * 60 * 1000));
        return {
            counts,
            startDateStr: start.toISOString().split('T')[0],
            endDateStr: now.toISOString().split('T')[0]
        };
    }

    // Identificar fecha más reciente registrada
    const dates = sessions.map(s => s.date).filter(Boolean).sort();
    const latestRecordedDateStr = dates[dates.length - 1] || new Date().toISOString().split('T')[0];
    const latestRecordedDate = new Date(latestRecordedDateStr + 'T00:00:00');
    const today = new Date();

    // Si la última sesión fue hace menos de 7 días, anclamos en hoy; sino en la última sesión
    const anchorDate = (today - latestRecordedDate) < (7 * 24 * 60 * 60 * 1000) ? today : latestRecordedDate;
    const sevenDaysBefore = new Date(anchorDate.getTime() - (6 * 24 * 60 * 60 * 1000));

    const startStr = sevenDaysBefore.toISOString().split('T')[0];
    const endStr = anchorDate.toISOString().split('T')[0];

    sessions.forEach(session => {
        if (session.date >= startStr && session.date <= endStr) {
            (session.exercises || []).forEach(ex => {
                const canonical = resolveMuscleGroup(ex.muscle);
                if (canonical && counts[canonical] !== undefined) {
                    // Contabilizar solo series efectivas (no drop sets)
                    const effectiveSets = (ex.sets || []).filter(s => !s.isDropSet).length;
                    counts[canonical] += effectiveSets;
                }
            });
        }
    });

    return { counts, startDateStr: startStr, endDateStr: endStr };
}

/**
 * Determina el estado de fatiga y recuperación de cada grupo muscular.
 * - < 48 horas: 'Fatigado' (color rojo)
 * - 48 a 72 horas: 'Recuperando' (color amarillo)
 * - > 72 horas: 'Recuperado' (color verde)
 * - Sin entrenar: 'Sin datos' (color neutro)
 * @param {Array} sessions 
 * @returns {Array<{muscle: string, status: string, colorClass: string, hoursAgo: number|null}>}
 */
export function calculateMuscleRecovery(sessions) {
    const now = new Date();
    const result = [];

    MUSCLE_GROUPS.forEach(muscle => {
        let lastDate = null;

        (sessions || []).forEach(session => {
            const hasMuscle = (session.exercises || []).some(e => resolveMuscleGroup(e.muscle) === muscle);
            if (hasMuscle && session.date) {
                const sDate = new Date(session.date + 'T00:00:00');
                if (!lastDate || sDate > lastDate) {
                    lastDate = sDate;
                }
            }
        });

        let status = 'Sin datos';
        let colorClass = 'bg-gray-800 text-gray-400 border-gray-700';
        let hoursAgo = null;

        if (lastDate) {
            hoursAgo = Math.max(0, (now - lastDate) / (1000 * 60 * 60));
            if (hoursAgo < 48) {
                status = 'Fatigado';
                colorClass = 'bg-red-900/30 text-red-400 border-red-800';
            } else if (hoursAgo < 72) {
                status = 'Recuperando';
                colorClass = 'bg-yellow-900/30 text-yellow-400 border-yellow-800';
            } else {
                status = 'Recuperado';
                colorClass = 'bg-green-900/30 text-green-400 border-green-800';
            }
        }

        result.push({ muscle, status, colorClass, hoursAgo });
    });

    return result;
}

/**
 * Genera sugerencias inteligentes de sobrecarga progresiva por grupo muscular
 * basadas en el último desempeño registrado.
 * @param {Array} sessions 
 * @returns {Array<object>}
 */
export function generateProgressiveOverloadSuggestions(sessions) {
    if (!Array.isArray(sessions) || sessions.length === 0) return [];

    const sortedData = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
    const suggestions = [];

    MUSCLE_GROUPS.forEach(muscle => {
        let lastExercise = null;
        let lastDate = null;

        for (const session of sortedData) {
            const ex = (session.exercises || []).find(e => resolveMuscleGroup(e.muscle) === muscle);
            if (ex) {
                lastExercise = ex;
                lastDate = session.date;
                break;
            }
        }

        if (lastExercise && lastExercise.sets && lastExercise.sets.length > 0) {
            let maxWeightKg = 0;
            let repsAtMax = 0;

            lastExercise.sets.forEach(set => {
                const wKg = convertToKg(set.weight, set.unit);
                if (wKg > maxWeightKg) {
                    maxWeightKg = wKg;
                    repsAtMax = set.reps;
                } else if (wKg === maxWeightKg && set.reps > repsAtMax) {
                    repsAtMax = set.reps;
                }
            });

            const maxWeightRounded = parseFloat(maxWeightKg.toFixed(1));
            const increment = 2.5;

            let suggestionText = '';
            let suggestionColor = 'text-accent';
            let icon = 'ph-trend-up';

            if (repsAtMax >= 10) {
                suggestionText = `¡Dominado! Intenta subir a <b>${maxWeightRounded + increment} kg</b> (o equivalente en lbs). Apunta a 6-8 reps.`;
            } else if (repsAtMax >= 7 && repsAtMax < 10) {
                suggestionText = `Buen volumen. Intenta sacar <b>10 reps</b> con ${maxWeightRounded} kg antes de subir carga.`;
                suggestionColor = 'text-primary';
                icon = 'ph-arrows-left-right';
            } else {
                suggestionText = `Carga pesada. Mantén <b>${maxWeightRounded} kg</b> y perfecciona la técnica hasta 8 reps limpias.`;
                suggestionColor = 'text-yellow-500';
                icon = 'ph-shield-check';
            }

            suggestions.push({
                muscle,
                exerciseName: lastExercise.name,
                lastDate,
                maxWeightKg: maxWeightRounded,
                repsAtMax,
                suggestionText,
                suggestionColor,
                icon
            });
        }
    });

    return suggestions;
}

