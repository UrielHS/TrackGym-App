/**
 * Módulo de Interfaz de Usuario (UI)
 * Renderizado de vistas, componentes dinámicos, gestión segura de Chart.js,
 * skeletons de carga y feedback visual.
 */
import { escapeHTML } from '../utils/sanitize.js';
import {
    getExerciseProgressData,
    calculateWeeklyVolume,
    calculateMuscleRecovery,
    generateProgressiveOverloadSuggestions,
    MUSCLE_GROUPS
} from './analytics.js';

let progressChartInstance = null;
let volumeChartInstance = null;

export class UI {
    /**
     * Muestra una notificación emergente (Toast).
     * @param {string} message 
     * @param {'success'|'error'|'info'} type 
     */
    static showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const toastMsg = document.getElementById('toast-msg');
        if (!toast || !toastMsg) return;

        toastMsg.innerText = message;
        toast.className = `fixed top-4 right-4 text-white px-4 py-2.5 rounded-xl shadow-2xl transform transition-all duration-300 z-50 flex items-center font-medium ${
            type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-primary' : 'bg-accent'
        }`;

        toast.style.transform = 'translateY(0)';
        setTimeout(() => {
            toast.style.transform = 'translateY(-150%)';
        }, 3200);
    }

    /**
     * Muestra un modal informativo personalizado.
     * @param {string} title 
     * @param {string} body 
     */
    static showModal(title, body) {
        const modal = document.getElementById('customModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        if (!modal) return;

        if (modalTitle) modalTitle.innerText = title;
        if (modalBody) modalBody.innerText = body;
        modal.classList.remove('hidden');
    }

    static closeModal() {
        const modal = document.getElementById('customModal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * Muestra u oculta la pantalla de carga global inicial (JWT verification).
     * @param {boolean} show 
     */
    static toggleGlobalLoading(show) {
        let loader = document.getElementById('globalAppLoader');
        if (!loader && show) {
            loader = document.createElement('div');
            loader.id = 'globalAppLoader';
            loader.className = 'fixed inset-0 z-[100] bg-darker flex flex-col items-center justify-center';
            loader.innerHTML = `
                <div class="flex items-center space-x-3 mb-4 animate-pulse">
                    <i class="ph-fill ph-barbell text-5xl text-primary"></i>
                    <h1 class="text-3xl font-bold tracking-wider text-white">Track<span class="text-primary">Gym</span></h1>
                </div>
                <div class="w-10 h-10 border-4 border-gray-800 border-t-primary rounded-full animate-spin mb-3"></div>
                <p class="text-sm text-gray-400 font-medium">Validando sesión segura...</p>
            `;
            document.body.appendChild(loader);
        } else if (loader && !show) {
            loader.classList.add('transition-opacity', 'duration-300', 'opacity-0');
            setTimeout(() => loader.remove(), 300);
        }
    }

    /**
     * Actualiza la barra de navegación con la información del usuario autenticado o botón de login.
     * @param {object|null} user 
     * @param {object|null} profile 
     */
    static renderAuthNavbar(user, profile) {
        const container = document.getElementById('navUserSection');
        if (!container) return;

        if (user) {
            const displayName = profile?.display_name || user.user_metadata?.display_name || user.email.split('@')[0];
            const initials = displayName.slice(0, 2).toUpperCase();
            const email = user.email;

            container.innerHTML = `
                <div class="flex items-center justify-between p-3 bg-darker rounded-xl border border-gray-800 w-full">
                    <div class="flex items-center min-w-0 mr-2">
                        <div class="w-9 h-9 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm border border-primary/40 mr-2.5 flex-shrink-0">
                            ${escapeHTML(initials)}
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-white truncate" title="${escapeHTML(displayName)}">${escapeHTML(displayName)}</p>
                            <p class="text-[10px] text-gray-400 truncate" title="${escapeHTML(email)}">${escapeHTML(email)}</p>
                        </div>
                    </div>
                    <button id="btnNavbarSignOut" class="text-gray-400 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition-colors" title="Cerrar Sesión">
                        <i class="ph ph-sign-out text-lg"></i>
                    </button>
                </div>
            `;
        } else {
            container.innerHTML = `
                <button id="btnNavbarOpenAuth" class="w-full bg-primary hover:bg-blue-600 text-white font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center text-sm shadow-lg shadow-primary/20">
                    <i class="ph ph-sign-in mr-2 text-lg"></i> Iniciar Sesión
                </button>
            `;
        }
    }

    /**
     * Renderiza las estadísticas rápidas del dashboard.
     * @param {Array} sessions 
     */
    static renderQuickStats(sessions) {
        const statTotal = document.getElementById('totalSessionsStat');
        const statTime = document.getElementById('avgTimeStat');
        const totalSessions = (sessions || []).length;

        if (statTotal) statTotal.innerText = totalSessions;

        if (statTime) {
            let totalMins = 0;
            let countWithTime = 0;

            (sessions || []).forEach(s => {
                if (s.duration) {
                    let mins = 0;
                    if (typeof s.duration === 'string' && s.duration.includes(':')) {
                        const parts = s.duration.split(':').map(Number);
                        if (parts.length === 3) {
                            mins = parts[0] * 60 + parts[1] + (parts[2] || 0) / 60;
                        } else if (parts.length === 2) {
                            mins = parts[0] + (parts[1] || 0) / 60;
                        }
                    } else {
                        mins = parseFloat(s.duration) || 0;
                    }

                    if (mins > 0) {
                        totalMins += mins;
                        countWithTime++;
                    }
                }
            });

            if (countWithTime > 0) {
                const avgMins = totalMins / countWithTime;
                const hrs = Math.floor(avgMins / 60);
                const mins = Math.floor(avgMins % 60);
                statTime.innerText = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
            } else {
                statTime.innerText = '-- min';
            }
        }
    }

    /**
     * Renderiza la tarjeta de recuperación muscular (mapa de fatiga).
     * @param {Array} sessions 
     */
    static renderFatigueMap(sessions) {
        const container = document.getElementById('fatigueContainer');
        if (!container) return;

        const recoveryList = calculateMuscleRecovery(sessions);
        container.innerHTML = recoveryList.map(item => `
            <div class="px-2 py-3 rounded-xl border ${item.colorClass} text-center flex flex-col items-center justify-center transition-all shadow-sm">
                <span class="text-[10px] uppercase font-bold tracking-wider opacity-70 mb-1">${escapeHTML(item.muscle)}</span>
                <span class="text-sm font-semibold">${escapeHTML(item.status)}</span>
            </div>
        `).join('');
    }

    /**
     * Llena el selector de ejercicios únicos disponibles para la gráfica de 1RM.
     * @param {Array} sessions 
     */
    static populateExerciseSelect(sessions) {
        const select = document.getElementById('chartExerciseSelect');
        if (!select) return;

        const currentVal = select.value;
        const exerciseNames = new Set();

        (sessions || []).forEach(s => {
            (s.exercises || []).forEach(e => {
                if (e.name && e.name.trim()) exerciseNames.add(e.name.trim());
            });
        });

        const sorted = Array.from(exerciseNames).sort();
        select.innerHTML = sorted.map(name => `
            <option value="${escapeHTML(name)}">${escapeHTML(name)}</option>
        `).join('');

        if (sorted.includes(currentVal)) {
            select.value = currentVal;
        } else if (sorted.length > 0) {
            select.value = sorted[0];
        }
    }

    /**
     * Renderiza o actualiza dinámicamente la gráfica de 1RM (Epley) y peso con Chart.js.
     * @param {Array} sessions 
     */
    static renderProgressChart(sessions) {
        const select = document.getElementById('chartExerciseSelect');
        const canvas = document.getElementById('progressChart');
        if (!canvas || !select) return;

        const selectedExercise = select.value;
        if (!selectedExercise) {
            if (progressChartInstance) {
                progressChartInstance.destroy();
                progressChartInstance = null;
            }
            return;
        }

        const { labels, oneRmData, maxWeightData } = getExerciseProgressData(sessions, selectedExercise);

        if (progressChartInstance) {
            progressChartInstance.destroy();
            progressChartInstance = null;
        }

        const ctx = canvas.getContext('2d');
        const Chart = window.Chart;
        if (!Chart) return;

        progressChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: '1RM Estimado (Epley kg)',
                        data: oneRmData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.12)',
                        borderWidth: 3,
                        pointBackgroundColor: '#3b82f6',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Carga Máxima Real (kg)',
                        data: maxWeightData,
                        borderColor: '#10b981',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 4],
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        fill: false,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#9ca3af', boxWidth: 12, usePointStyle: true }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 20, 0.95)',
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 13 },
                        padding: 12,
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} kg`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#9ca3af', callback: v => `${v} kg` }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
    }

    /**
     * Renderiza o actualiza la gráfica de volumen semanal (series efectivas por músculo).
     * @param {Array} sessions 
     */
    static renderVolumeChart(sessions) {
        const canvas = document.getElementById('volumeChart');
        if (!canvas) return;

        const { counts, startDateStr, endDateStr } = calculateWeeklyVolume(sessions);

        if (volumeChartInstance) {
            volumeChartInstance.destroy();
            volumeChartInstance = null;
        }

        const ctx = canvas.getContext('2d');
        const Chart = window.Chart;
        if (!Chart) return;

        volumeChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: MUSCLE_GROUPS,
                datasets: [{
                    label: `Series efectivas (${startDateStr} al ${endDateStr})`,
                    data: MUSCLE_GROUPS.map(m => counts[m] || 0),
                    backgroundColor: '#10b981',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#9ca3af', boxWidth: 12 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 20, 0.95)',
                        padding: 10
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#9ca3af', stepSize: 2 }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
    }

    /**
     * Renderiza las sugerencias de sobrecarga progresiva en el dashboard.
     * @param {Array} sessions 
     */
    static renderSuggestions(sessions) {
        const grid = document.getElementById('suggestionsGrid');
        if (!grid) return;

        const suggestions = generateProgressiveOverloadSuggestions(sessions);
        if (suggestions.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full text-center py-8 text-gray-500">
                    <i class="ph ph-barbell text-4xl mb-2 opacity-50 block"></i>
                    <p>Registra entrenamientos para recibir recomendaciones personalizadas de sobrecarga.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = suggestions.map(item => `
            <div class="glass-card rounded-xl p-5 border border-gray-800 hover:border-gray-600 transition-colors">
                <div class="flex justify-between items-start mb-3">
                    <span class="text-xs font-bold uppercase tracking-wider text-gray-500">${escapeHTML(item.muscle)}</span>
                    <i class="ph ${item.icon} ${item.suggestionColor} text-xl"></i>
                </div>
                <h4 class="text-lg font-bold text-white mb-1 truncate" title="${escapeHTML(item.exerciseName)}">${escapeHTML(item.exerciseName)}</h4>
                <p class="text-sm text-gray-400 mb-4">Última vez: ${item.maxWeightKg} kg x ${item.repsAtMax} reps</p>
                <div class="bg-darker p-3 rounded-lg border border-gray-800">
                    <p class="text-sm text-gray-300 leading-relaxed">${item.suggestionText}</p>
                </div>
            </div>
        `).join('');
    }

    /**
     * Renderiza la lista de sesiones históricas con soporte de filtros.
     * @param {Array} sessions 
     * @param {string} searchQuery 
     * @param {string} muscleFilter 
     * @param {object} callbacks Handlers de edición y borrado
     */
    static renderHistoryList(sessions, searchQuery = '', muscleFilter = '', callbacks = {}) {
        const list = document.getElementById('historyList');
        const countSpan = document.getElementById('totalWorkouts');
        if (!list) return;

        const normalize = str => str ? str.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : '';
        const search = normalize(searchQuery);
        const muscle = normalize(muscleFilter);

        const sorted = [...(sessions || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
        let visibleCount = 0;
        let html = '';

        sorted.forEach(session => {
            const dateObj = new Date(session.date + 'T00:00:00');
            const formattedDate = dateObj.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            const visibleExercises = (session.exercises || []).filter(ex => {
                const nameMatch = !search || normalize(ex.name).includes(search) || normalize(ex.muscle).includes(search);
                const muscleMatch = !muscle || normalize(ex.muscle) === muscle;
                return nameMatch && muscleMatch;
            });

            if (visibleExercises.length > 0) {
                visibleCount++;
                const durationBadge = session.duration ? `
                    <span class="text-xs bg-gray-800 text-gray-300 px-2.5 py-1 rounded-full border border-gray-700 flex items-center gap-1 cursor-pointer hover:border-gray-500" onclick="window.appHandler.editDuration('${session.date}')" title="Editar tiempo">
                        <i class="ph ph-clock"></i> ${escapeHTML(session.duration)}
                    </span>
                ` : `
                    <button onclick="window.appHandler.editDuration('${session.date}')" class="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1">
                        <i class="ph ph-plus-circle"></i> Tiempo
                    </button>
                `;

                html += `
                    <div class="glass-card rounded-2xl p-5 md:p-6 border border-gray-800/80 shadow-xl mb-4">
                        <div class="flex flex-wrap justify-between items-center pb-4 mb-4 border-b border-gray-800 gap-2">
                            <div class="flex items-center gap-3">
                                <h3 class="text-lg font-bold text-white capitalize">${escapeHTML(formattedDate)}</h3>
                                <button onclick="window.appHandler.openEditDateModal('${session.date}')" class="text-gray-500 hover:text-primary transition-colors text-sm" title="Cambiar fecha">
                                    <i class="ph ph-pencil-simple"></i>
                                </button>
                            </div>
                            <div class="flex items-center gap-2">
                                ${durationBadge}
                                <button onclick="window.appHandler.deleteSession('${session.date}')" class="text-gray-500 hover:text-red-400 transition-colors p-1" title="Eliminar sesión completa">
                                    <i class="ph ph-trash text-lg"></i>
                                </button>
                            </div>
                        </div>
                        <div class="space-y-4">
                `;

                visibleExercises.forEach((ex) => {
                    const originalIdx = (session.exercises || []).indexOf(ex);
                    html += `
                        <div class="bg-darker p-4 rounded-xl border border-gray-800/60">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <span class="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-md">${escapeHTML(ex.muscle)}</span>
                                    <h4 class="text-base font-bold text-white mt-1">${escapeHTML(ex.name)}</h4>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button onclick="window.appHandler.openEditExerciseModal('${session.date}', ${originalIdx})" class="text-gray-400 hover:text-primary p-1" title="Editar">
                                        <i class="ph ph-pencil-simple text-base"></i>
                                    </button>
                                    <button onclick="window.appHandler.deleteExercise('${session.date}', ${originalIdx})" class="text-gray-400 hover:text-red-400 p-1" title="Eliminar">
                                        <i class="ph ph-trash text-base"></i>
                                    </button>
                                </div>
                            </div>
                            ${ex.note ? `<p class="text-xs text-gray-400 italic mb-2">"${escapeHTML(ex.note)}"</p>` : ''}
                            <div class="flex flex-wrap gap-2 mt-2">
                    `;

                    (ex.sets || []).forEach((set, sIdx) => {
                        const isDS = Boolean(set.isDropSet);
                        html += `
                            <div class="text-xs px-2.5 py-1 rounded-lg border ${
                                isDS ? 'bg-emerald-950/30 border-accent/40 text-accent font-semibold' : 'bg-gray-800/80 border-gray-700 text-gray-200'
                            }">
                                ${isDS ? '<span class="text-[10px] font-bold mr-1">DS:</span>' : ''}${set.reps} reps × ${set.weight} ${escapeHTML(set.unit || 'kg')}
                            </div>
                        `;
                    });

                    html += `
                            </div>
                        </div>
                    `;
                });

                html += `
                        </div>
                    </div>
                `;
            }
        });

        if (countSpan) countSpan.innerText = visibleCount;

        if (visibleCount === 0) {
            list.innerHTML = `
                <div class="text-center py-12 text-gray-500">
                    <i class="ph ph-magnifying-glass text-4xl mb-2 opacity-50 block"></i>
                    <p>No se encontraron entrenamientos con los filtros aplicados.</p>
                </div>
            `;
        } else {
            list.innerHTML = html;
        }
    }

    /**
     * Renderiza la rutina (activa y archivada).
     * @param {object} routineData 
     */
    static renderRoutine(routineData) {
        const container = document.getElementById('routineDaysContainer');
        const archivedContainer = document.getElementById('archivedListContainer');
        if (!container) return;

        const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        const activeItems = routineData?.active || [];
        const archivedItems = routineData?.archived || [];

        container.innerHTML = days.map(day => {
            const dayExercises = activeItems.filter(e => e.day === day);
            return `
                <div class="glass-card rounded-xl p-4 border border-gray-800">
                    <h4 class="text-base font-bold text-white mb-3 pb-2 border-b border-gray-800 flex justify-between items-center">
                        <span>${escapeHTML(day)}</span>
                        <span class="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full font-normal">${dayExercises.length}</span>
                    </h4>
                    <div class="space-y-2">
                        ${dayExercises.length === 0 ? '<p class="text-xs text-gray-500 italic py-2">Descanso o sin ejercicios</p>' : ''}
                        ${dayExercises.map(ex => `
                            <div class="flex items-center justify-between p-2.5 bg-darker rounded-lg border border-gray-800/80 group">
                                <div class="min-w-0 mr-2">
                                    <p class="text-sm font-semibold text-white truncate">${escapeHTML(ex.name)}</p>
                                    <p class="text-[10px] text-gray-400">${escapeHTML(ex.muscle)}</p>
                                </div>
                                <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                                    <button onclick="window.appHandler.openEditRoutineModal('${ex.id}')" class="text-gray-400 hover:text-primary p-1" title="Editar">
                                        <i class="ph ph-pencil-simple"></i>
                                    </button>
                                    <button onclick="window.appHandler.archiveRoutineExercise('${ex.id}')" class="text-gray-400 hover:text-yellow-400 p-1" title="Archivar">
                                        <i class="ph ph-archive"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');

        if (archivedContainer) {
            if (archivedItems.length === 0) {
                archivedContainer.innerHTML = '<p class="text-sm text-gray-500 italic">No hay ejercicios archivados.</p>';
            } else {
                archivedContainer.innerHTML = archivedItems.map(ex => `
                    <div class="flex items-center justify-between p-3 bg-darker rounded-xl border border-gray-800">
                        <div>
                            <p class="text-sm font-bold text-white">${escapeHTML(ex.name)}</p>
                            <p class="text-xs text-gray-400">${escapeHTML(ex.muscle)} · ${escapeHTML(ex.day)}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="window.appHandler.restoreRoutineExercise('${ex.id}')" class="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700">
                                <i class="ph ph-arrow-counter-clockwise mr-1"></i> Restaurar
                            </button>
                            <button onclick="window.appHandler.deleteArchivedRoutineExercise('${ex.id}')" class="text-gray-400 hover:text-red-400 p-1.5" title="Eliminar definitivamente">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
            }
        }
    }
}

