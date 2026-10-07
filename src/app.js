/**
 * Controlador Principal de la Aplicación (TrackGym App)
 * Orquestador de Autenticación, Datos Multi-usuario, UI y Eventos.
 */
import { AuthService } from './services/auth.service.js';
import { WorkoutsService } from './services/workouts.service.js';
import { UI } from './modules/ui.js';
import { sanitizeText, sanitizeDuration, normalizeExerciseName, escapeHTML } from './utils/sanitize.js';

// --- ESTADO GLOBAL AISLADO DE LA APLICACIÓN ---
const state = {
    currentUser: null,
    currentProfile: null,
    gymData: [],
    routineData: { active: [], archived: [] },
    activeWorkout: null,
    activeTab: 'dashboard',
    ghostSetsData: null,
    ghostMatchedExerciseName: null,
    ghostMatchedMuscle: null,
    workoutTimerInterval: null,
    restTimerInterval: null,
    restTimeRemaining: 0,
    editingSessionDate: null,
    editingExerciseIndex: null
};

// Cargar caché local inmediato para reactividad instantánea y offline
try {
    const cachedData = localStorage.getItem('hypertrack_gymData');
    if (cachedData) {
        state.gymData = JSON.parse(cachedData);
    }
} catch (e) {
    console.warn("No se pudo cargar la caché local de gymData", e);
}

// ==============================================================================
// 1. GESTIÓN DE SESIÓN Y AUTENTICACIÓN
// ==============================================================================

async function initAuth() {
    UI.toggleGlobalLoading(true);

    try {
        // Escuchar cambios de estado en Supabase Auth
        AuthService.onAuthStateChange(async (event, session) => {
            console.log(`[Auth Event]: ${event}`);

            if (session?.user) {
                state.currentUser = session.user;
                state.currentProfile = await AuthService.getUserProfile(session.user.id);
                UI.renderAuthNavbar(state.currentUser, state.currentProfile);
                closeAuthModal();
                await loadUserData();
            } else {
                handleUserLoggedOut();
            }
            UI.toggleGlobalLoading(false);
        });

        // Verificar sesión activa inicial
        const user = await AuthService.getCurrentUser();
        if (user) {
            state.currentUser = user;
            state.currentProfile = await AuthService.getUserProfile(user.id);
            UI.renderAuthNavbar(state.currentUser, state.currentProfile);
            await loadUserData();
        } else {
            handleUserLoggedOut();
            openAuthModal();
        }
    } catch (err) {
        console.error("Error inicializando autenticación:", err);
        UI.showToast("Error de conexión al servidor de autenticación", "error");
    } finally {
        UI.toggleGlobalLoading(false);
    }
}

function handleUserLoggedOut() {
    state.currentUser = null;
    state.currentProfile = null;
    state.gymData = [];
    state.routineData = { active: [], archived: [] };
    state.activeWorkout = null;
    state.ghostSetsData = null;
    state.ghostMatchedExerciseName = null;
    state.ghostMatchedMuscle = null;

    // Purgar almacenamiento local para garantizar aislamiento total
    localStorage.removeItem('hypertrack_gymData');
    localStorage.removeItem('hypertrack_active_workout');
    localStorage.removeItem('hypertrack_cached_user');

    if (state.workoutTimerInterval) clearInterval(state.workoutTimerInterval);
    if (state.restTimerInterval) clearInterval(state.restTimerInterval);

    UI.renderAuthNavbar(null, null);
    populateExerciseDatalist();
    refreshActiveView();
}

async function loadUserData() {
    if (!state.currentUser) return;
    try {
        // Cargar sesiones y rutinas exclusivamente para el user_id autenticado
        const [sessions, routine] = await Promise.all([
            WorkoutsService.fetchSessions(state.currentUser.id),
            WorkoutsService.fetchRoutine(state.currentUser.id)
        ]);

        state.gymData = sessions;
        state.routineData = routine;

        // Guardar respaldo local aislado para el usuario
        localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));

        populateExerciseDatalist();
        refreshActiveView();
        UI.showToast("☁️ Datos sincronizados con tu cuenta", "success");
    } catch (error) {
        console.error("Error cargando datos de usuario:", error);
        UI.showToast("No se pudieron cargar tus datos de la nube", "error");
    }
}

// ==============================================================================
// 2. MODAL DE AUTENTICACIÓN (LOGIN / SIGNUP)
// ==============================================================================

function openAuthModal(defaultTab = 'login') {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    switchAuthTab(defaultTab);
    clearAuthErrors();
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.add('hidden');
    clearAuthErrors();
}

function switchAuthTab(tab) {
    const tabLogin = document.getElementById('tabBtnLogin');
    const tabSignup = document.getElementById('tabBtnSignup');
    const formLogin = document.getElementById('authLoginForm');
    const formSignup = document.getElementById('authSignupForm');

    clearAuthErrors();

    if (tab === 'login') {
        tabLogin?.classList.add('border-primary', 'text-white');
        tabLogin?.classList.remove('border-transparent', 'text-gray-400');
        tabSignup?.classList.remove('border-primary', 'text-white');
        tabSignup?.classList.add('border-transparent', 'text-gray-400');

        formLogin?.classList.remove('hidden');
        formSignup?.classList.add('hidden');
    } else {
        tabSignup?.classList.add('border-primary', 'text-white');
        tabSignup?.classList.remove('border-transparent', 'text-gray-400');
        tabLogin?.classList.remove('border-primary', 'text-white');
        tabLogin?.classList.add('border-transparent', 'text-gray-400');

        formSignup?.classList.remove('hidden');
        formLogin?.classList.add('hidden');
    }
}

function showAuthError(msg, isSignup = false) {
    const errorEl = document.getElementById(isSignup ? 'signupErrorBox' : 'loginErrorBox');
    if (errorEl) {
        errorEl.innerText = msg;
        errorEl.classList.remove('hidden');
    }
}

function clearAuthErrors() {
    const el1 = document.getElementById('loginErrorBox');
    const el2 = document.getElementById('signupErrorBox');
    if (el1) { el1.innerText = ''; el1.classList.add('hidden'); }
    if (el2) { el2.innerText = ''; el2.classList.add('hidden'); }
}

function fillAdminCredentials() {
    const email = document.getElementById('loginEmail');
    const pass = document.getElementById('loginPassword');
    if (email) email.value = 'admin@trackgym.com';
    if (pass) pass.value = 'TrackGym2026!';
    UI.showToast("Credenciales de Administrador cargadas", "info");
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    clearAuthErrors();

    const email = document.getElementById('loginEmail')?.value;
    const password = document.getElementById('loginPassword')?.value;
    const btn = document.getElementById('btnLoginSubmit');

    if (!email || !password) {
        showAuthError("Por favor completa todos los campos.");
        return;
    }

    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner animate-spin mr-2"></i> Iniciando sesión...'; }
        await AuthService.login(email, password);
        UI.showToast("Sesión iniciada correctamente", "success");
    } catch (err) {
        showAuthError(err.message || "Error al iniciar sesión.");
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-sign-in mr-2"></i> Iniciar Sesión'; }
    }
}

async function handleSignupSubmit(e) {
    e.preventDefault();
    clearAuthErrors();

    const name = document.getElementById('signupName')?.value;
    const email = document.getElementById('signupEmail')?.value;
    const password = document.getElementById('signupPassword')?.value;
    const confirmPassword = document.getElementById('signupConfirmPassword')?.value;
    const unit = document.getElementById('signupUnit')?.value || 'kg';
    const btn = document.getElementById('btnSignupSubmit');

    if (!email || !password) {
        showAuthError("Por favor ingresa tu correo y contraseña.", true);
        return;
    }

    if (password.length < 6) {
        showAuthError("La contraseña debe tener mínimo 6 caracteres.", true);
        return;
    }

    if (password !== confirmPassword) {
        showAuthError("Las contraseñas no coinciden.", true);
        return;
    }

    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner animate-spin mr-2"></i> Creando cuenta...'; }
        const res = await AuthService.signUp(email, password, name, unit);

        if (res?.user && !res?.session) {
            UI.showModal("Cuenta creada", "Se ha enviado un correo de confirmación. Por favor revisa tu bandeja de entrada o inicia sesión si la confirmación no está habilitada.");
            switchAuthTab('login');
        } else {
            UI.showToast("¡Cuenta creada exitosamente!", "success");
        }
    } catch (err) {
        showAuthError(err.message || "Error al crear la cuenta.", true);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-user-plus mr-2"></i> Crear Cuenta'; }
    }
}

async function handleSignOut() {
    if (!confirm("¿Deseas cerrar tu sesión?")) return;
    try {
        await AuthService.logout();
        UI.showToast("Sesión cerrada", "info");
        openAuthModal('login');
    } catch (err) {
        console.error("Error al cerrar sesión:", err);
    }
}

// ==============================================================================
// 3. NAVEGACIÓN Y VISTAS
// ==============================================================================

function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.target === tabId) {
            btn.classList.add('text-primary', 'bg-gray-800');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('text-primary', 'bg-gray-800');
            btn.classList.add('text-gray-400');
        }
    });

    refreshActiveView();
}

function refreshActiveView() {
    if (state.activeTab === 'dashboard') {
        UI.renderQuickStats(state.gymData);
        UI.renderFatigueMap(state.gymData);
        UI.populateExerciseSelect(state.gymData);
        UI.renderProgressChart(state.gymData);
        UI.renderVolumeChart(state.gymData);
        UI.renderSuggestions(state.gymData);
    } else if (state.activeTab === 'history') {
        const search = document.getElementById('historySearch')?.value || '';
        const muscle = document.getElementById('historyFilterMuscle')?.value || '';
        UI.renderHistoryList(state.gymData, search, muscle);
    } else if (state.activeTab === 'routine') {
        UI.renderRoutine(state.routineData);
    } else if (state.activeTab === 'add') {
        populateExerciseDatalist();
        updateSuggestionsChips();
        const curName = document.getElementById('inputName')?.value;
        if (curName) checkGhostData(curName);
    }
}

// ==============================================================================
// 4. ENTRENAMIENTO EN CURSO (TIMERS Y GHOST)
// ==============================================================================

function initWorkoutState() {
    const saved = localStorage.getItem('hypertrack_active_workout');
    if (saved) {
        try {
            state.activeWorkout = JSON.parse(saved);
            renderActiveWorkoutList();
            startWorkoutTimerUI();
        } catch {
            state.activeWorkout = null;
        }
    }
    updateWorkoutPanelUI();
}

function startWorkout() {
    if (state.activeWorkout) return;
    const dateInput = document.getElementById('inputDate');
    state.activeWorkout = {
        startTime: Date.now(),
        date: dateInput ? dateInput.value : new Date().toISOString().split('T')[0],
        exercises: []
    };
    localStorage.setItem('hypertrack_active_workout', JSON.stringify(state.activeWorkout));
    updateWorkoutPanelUI();
    startWorkoutTimerUI();
    UI.showToast("⏱️ Entrenamiento iniciado", "info");
}

function updateWorkoutPanelUI() {
    const startPanel = document.getElementById('startWorkoutPanel');
    const activePanel = document.getElementById('activeWorkoutPanel');
    if (state.activeWorkout) {
        startPanel?.classList.add('hidden');
        activePanel?.classList.remove('hidden');
    } else {
        startPanel?.classList.remove('hidden');
        activePanel?.classList.add('hidden');
    }
}

function startWorkoutTimerUI() {
    if (state.workoutTimerInterval) clearInterval(state.workoutTimerInterval);
    const display = document.getElementById('workoutTimerDisplay');

    const tick = () => {
        if (!state.activeWorkout) return;
        const diff = Math.floor((Date.now() - state.activeWorkout.startTime) / 1000);
        const h = String(Math.floor(diff / 3600)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        if (display) display.innerText = `${h}:${m}:${s}`;
    };

    tick();
    state.workoutTimerInterval = setInterval(tick, 1000);
}

function startRestTimer(seconds) {
    if (state.restTimerInterval) clearInterval(state.restTimerInterval);
    state.restTimeRemaining = seconds;
    updateRestTimerUI();

    const display = document.getElementById('restTimerDisplay');
    display?.classList.remove('text-gray-500');
    display?.classList.add('text-accent');

    state.restTimerInterval = setInterval(() => {
        state.restTimeRemaining--;
        updateRestTimerUI();

        if (state.restTimeRemaining <= 0) {
            clearInterval(state.restTimerInterval);
            display?.classList.remove('text-accent');
            display?.classList.add('text-gray-500');
            UI.showToast("🔔 ¡Tiempo de descanso terminado!", "info");
        }
    }, 1000);
}

function stopRestTimer() {
    if (state.restTimerInterval) clearInterval(state.restTimerInterval);
    state.restTimeRemaining = 0;
    updateRestTimerUI();
    const display = document.getElementById('restTimerDisplay');
    display?.classList.remove('text-accent');
    display?.classList.add('text-gray-500');
}

function updateRestTimerUI() {
    const display = document.getElementById('restTimerDisplay');
    if (!display) return;
    const m = String(Math.floor(state.restTimeRemaining / 60)).padStart(2, '0');
    const s = String(state.restTimeRemaining % 60).padStart(2, '0');
    display.innerText = `${m}:${s}`;
}

function renderActiveWorkoutList() {
    const list = document.getElementById('activeWorkoutList');
    if (!list) return;

    if (!state.activeWorkout || state.activeWorkout.exercises.length === 0) {
        list.classList.add('hidden');
        list.innerHTML = '';
        return;
    }

    list.classList.remove('hidden');
    list.innerHTML = state.activeWorkout.exercises.map((ex, idx) => {
        const totalSets = ex.sets.length;
        return `
            <div class="flex justify-between items-center bg-card p-2.5 rounded-lg border border-gray-800 text-xs">
                <div class="flex items-center gap-2">
                    <span class="text-primary font-bold">#${idx + 1}</span>
                    <span class="font-semibold text-white">${sanitizeText(ex.name, 40)}</span>
                    <span class="text-gray-400">(${totalSets} ${totalSets === 1 ? 'serie' : 'series'})</span>
                </div>
                <button type="button" onclick="window.appHandler.removeActiveWorkoutExercise(${idx})" class="text-gray-500 hover:text-red-400 p-1">
                    <i class="ph ph-trash text-sm"></i>
                </button>
            </div>
        `;
    }).join('');
}

function removeActiveWorkoutExercise(idx) {
    if (!state.activeWorkout) return;
    state.activeWorkout.exercises.splice(idx, 1);
    localStorage.setItem('hypertrack_active_workout', JSON.stringify(state.activeWorkout));
    renderActiveWorkoutList();
}

async function finishWorkout() {
    if (!state.activeWorkout) return;

    if (state.activeWorkout.exercises.length === 0) {
        if (confirm("No has añadido ejercicios. ¿Cancelar entrenamiento?")) {
            state.activeWorkout = null;
            localStorage.removeItem('hypertrack_active_workout');
            stopRestTimer();
            if (state.workoutTimerInterval) clearInterval(state.workoutTimerInterval);
            updateWorkoutPanelUI();
        }
        return;
    }

    const diff = Math.floor((Date.now() - state.activeWorkout.startTime) / 1000);
    const h = String(Math.floor(diff / 3600)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    const durationStr = h === '00' ? `${m}:${s}` : `${h}:${m}:${s}`;
    const date = state.activeWorkout.date;

    let session = state.gymData.find(s => s.date === date);
    if (session) {
        session.exercises.push(...state.activeWorkout.exercises);
        if (!session.duration) session.duration = durationStr;
    } else {
        session = {
            date,
            duration: durationStr,
            exercises: state.activeWorkout.exercises
        };
        state.gymData.push(session);
    }

    // Persistir en Supabase
    if (state.currentUser) {
        try {
            await WorkoutsService.saveSingleSession(session, state.currentUser.id);
            localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));
        } catch (err) {
            console.error("Error guardando sesión en Supabase:", err);
            UI.showToast("Guardado localmente. Error al sincronizar en la nube.", "error");
        }
    }

    state.activeWorkout = null;
    localStorage.removeItem('hypertrack_active_workout');
    if (state.workoutTimerInterval) clearInterval(state.workoutTimerInterval);

    stopRestTimer();
    updateWorkoutPanelUI();

    const list = document.getElementById('activeWorkoutList');
    if (list) list.innerHTML = '';

    switchTab('history');
    UI.showToast("✅ ¡Entrenamiento guardado con éxito!", "success");
}

// ==============================================================================
// 5. REGISTRO DE EJERCICIOS Y ASISTENTE GHOST
// ==============================================================================

function addSetRow() {
    const container = document.getElementById('setsContainer');
    if (!container) return;
    const rowCount = container.querySelectorAll('.set-group').length + 1;
    const div = document.createElement('div');
    div.className = "set-group mb-2";
    div.innerHTML = `
        <div class="flex items-center gap-1.5 sm:gap-2 set-row main-set">
            <span class="text-gray-500 font-bold w-6 text-center set-number flex-shrink-0 text-xs sm:text-sm">#${rowCount}</span>
            <div class="w-16 sm:w-20 flex-shrink-0">
                <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-gray-700 rounded-lg p-2 text-white text-sm text-center focus:border-primary outline-none reps-input">
            </div>
            <span class="text-gray-500 text-xs flex-shrink-0">x</span>
            <div class="flex-1 min-w-0 flex items-stretch">
                <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full min-w-0 bg-dark border border-gray-700 rounded-l-lg p-2 text-white text-sm focus:border-primary outline-none weight-input">
                <select class="w-12 sm:w-14 flex-shrink-0 bg-gray-800 border border-gray-700 border-l-0 text-white rounded-r-lg p-1 text-xs font-semibold outline-none focus:border-primary text-center unit-select">
                    <option value="kg">kg</option>
                    <option value="lbs">lbs</option>
                </select>
            </div>
            <button type="button" onclick="window.appHandler.addDropSet(this)" class="text-gray-400 hover:text-accent p-1.5 flex-shrink-0" title="Añadir Drop Set"><i class="ph ph-arrow-bend-right-down text-lg"></i></button>
            <button type="button" onclick="this.closest('.set-group').remove(); window.appHandler.recalcSets()" class="text-gray-500 hover:text-red-400 p-1.5 flex-shrink-0" title="Eliminar Serie"><i class="ph ph-trash text-lg"></i></button>
        </div>
        <div class="drop-sets-container flex flex-col gap-2 mt-2 pl-4 border-l-2 border-accent/30 ml-3 hidden"></div>
    `;
    container.appendChild(div);
}

function addDropSet(btn) {
    const group = btn.closest('.set-group');
    const container = group.querySelector('.drop-sets-container');
    container.classList.remove('hidden');

    const dropDiv = document.createElement('div');
    dropDiv.className = "flex items-center gap-1.5 sm:gap-2 set-row drop-set";
    dropDiv.innerHTML = `
        <span class="text-accent text-[10px] font-bold w-6 text-center flex-shrink-0">DS</span>
        <div class="w-16 sm:w-20 flex-shrink-0">
            <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-accent/50 rounded-lg p-2 text-white text-sm text-center focus:border-accent outline-none reps-input">
        </div>
        <span class="text-gray-500 text-xs flex-shrink-0">x</span>
        <div class="flex-1 min-w-0 flex items-stretch">
            <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full min-w-0 bg-dark border border-accent/50 rounded-l-lg p-2 text-white text-sm border-r-0 focus:border-accent outline-none weight-input">
            <select class="w-12 sm:w-14 flex-shrink-0 bg-gray-800 border border-accent/50 border-l-0 text-white rounded-r-lg p-1 text-xs font-semibold outline-none focus:border-accent text-center unit-select">
                <option value="kg">kg</option>
                <option value="lbs">lbs</option>
            </select>
        </div>
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-500 hover:text-red-400 p-1.5 flex-shrink-0"><i class="ph ph-x text-lg"></i></button>
    `;
    container.appendChild(dropDiv);
}

function recalcSets() {
    const container = document.getElementById('setsContainer');
    if (container) {
        container.querySelectorAll('.set-number').forEach((span, idx) => {
            span.innerText = '#' + (idx + 1);
        });
    }
}

function populateExerciseDatalist() {
    const datalist = document.getElementById('exerciseSuggestions');
    if (!datalist) return;

    const seen = new Set();
    const suggestions = [];

    // 1. Ejercicios de la rutina activa
    if (state.routineData) {
        const routineItems = Array.isArray(state.routineData.active)
            ? state.routineData.active
            : (state.routineData.active && typeof state.routineData.active === 'object'
                ? Object.values(state.routineData.active).flat()
                : []);

        routineItems.forEach(ex => {
            if (!ex || !ex.name) return;
            const cleanName = ex.name.trim();
            const norm = normalizeExerciseName(cleanName);
            if (norm && !seen.has(norm)) {
                seen.add(norm);
                suggestions.push({ name: cleanName, muscle: ex.muscle || '' });
            }
        });
    }

    // 2. Ejercicios de sesiones históricas (cronológicamente más recientes primero)
    if (Array.isArray(state.gymData)) {
        const sortedSessions = [...state.gymData].sort((a, b) => new Date(b.date) - new Date(a.date));
        sortedSessions.forEach(session => {
            (session.exercises || []).forEach(ex => {
                if (!ex || !ex.name) return;
                const cleanName = ex.name.trim();
                const norm = normalizeExerciseName(cleanName);
                if (norm && !seen.has(norm)) {
                    seen.add(norm);
                    suggestions.push({ name: cleanName, muscle: ex.muscle || '' });
                }
            });
        });
    }

    datalist.innerHTML = suggestions
        .map(item => `<option value="${escapeHTML(item.name)}">${escapeHTML(item.muscle ? item.muscle : '')}</option>`)
        .join('');
}

function checkGhostData(name) {
    const card = document.getElementById('ghostHistoryCard');
    if (!card) return;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
        card.classList.add('hidden');
        state.ghostSetsData = null;
        state.ghostMatchedExerciseName = null;
        state.ghostMatchedMuscle = null;
        return;
    }

    const queryRaw = name.trim();
    const queryNorm = normalizeExerciseName(queryRaw);
    if (!queryNorm || queryNorm.length < 2) {
        card.classList.add('hidden');
        state.ghostSetsData = null;
        return;
    }

    // Palabras vacías en español para tokenización
    const stopWords = new Set(['de', 'del', 'al', 'a', 'en', 'con', 'el', 'la', 'los', 'las', 'un', 'una', 'por', 'para', 'y', 'o']);
    const queryTokens = queryNorm
        .split(/[\s,./\-_+()]+/)
        .filter(t => t.length > 0 && !stopWords.has(t));

    const selectedMuscle = document.getElementById('inputMuscle')?.value || '';
    const selectedMuscleNorm = normalizeExerciseName(selectedMuscle);

    // Asegurar sesiones ordenadas por fecha descendente
    const sorted = [...(state.gymData || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

    let bestMatch = null;
    let highestScore = 0;

    for (let sIdx = 0; sIdx < sorted.length; sIdx++) {
        const session = sorted[sIdx];
        const exercises = session.exercises || [];

        for (const ex of exercises) {
            if (!ex.name || !Array.isArray(ex.sets) || ex.sets.length === 0) continue;

            const candNorm = normalizeExerciseName(ex.name);
            if (!candNorm) continue;

            const candMuscleNorm = ex.muscle ? normalizeExerciseName(ex.muscle) : '';
            const candTokens = candNorm
                .split(/[\s,./\-_+()]+/)
                .filter(t => t.length > 0 && !stopWords.has(t));

            let score = 0;

            // 1. Coincidencia exacta
            if (candNorm === queryNorm) {
                score = 100;
            }
            // 2. Prefijo directo (ej: "press in" -> "press inclinado")
            else if (candNorm.startsWith(queryNorm)) {
                score = 85 + Math.min(10, Math.floor((queryNorm.length / candNorm.length) * 10));
            }
            // 3. El usuario escribió más palabras que el ejercicio registrado
            else if (queryNorm.startsWith(candNorm)) {
                score = 80;
            }
            // 4. Subcadena completa
            else if (candNorm.includes(queryNorm)) {
                score = 75;
            }
            // 5. Query contiene la subcadena candidata
            else if (queryNorm.includes(candNorm)) {
                score = 70;
            }
            // 6. Token matching inteligente de palabras clave
            else if (queryTokens.length > 0 && candTokens.length > 0) {
                let matchedTokens = 0;
                let exactTokens = 0;

                for (const qTok of queryTokens) {
                    if (candTokens.includes(qTok)) {
                        exactTokens++;
                        matchedTokens += 1;
                    } else if (candTokens.some(cTok => cTok.startsWith(qTok) || qTok.startsWith(cTok))) {
                        matchedTokens += 0.75;
                    }
                }

                const ratio = matchedTokens / queryTokens.length;
                if (ratio >= 0.99) {
                    score = 65 + (exactTokens * 5);
                } else if (ratio >= 0.5) {
                    score = 40 * ratio;
                }
            }

            if (score <= 0) continue;

            // Bonificación o penalización según el grupo muscular seleccionado en el formulario
            if (selectedMuscleNorm && candMuscleNorm) {
                if (selectedMuscleNorm === candMuscleNorm) {
                    score += 15;
                } else if (score < 90) {
                    score -= 15;
                }
            }

            // Bonificación por recencia (hasta +5 puntos para las 10 sesiones más recientes)
            const recencyBonus = Math.max(0, 10 - sIdx) * 0.5;
            const totalScore = score + recencyBonus;

            if (score === 100) {
                bestMatch = { ex, date: session.date, score: totalScore, isExact: true };
                highestScore = totalScore;
                break;
            }

            if (totalScore > highestScore) {
                highestScore = totalScore;
                bestMatch = { ex, date: session.date, score: totalScore, isExact: candNorm === queryNorm };
            }
        }

        if (bestMatch && bestMatch.isExact) break;
    }

    if (!bestMatch || highestScore < 45) {
        card.classList.add('hidden');
        state.ghostSetsData = null;
        state.ghostMatchedExerciseName = null;
        state.ghostMatchedMuscle = null;
        return;
    }

    const { ex: foundEx, date: foundDate, isExact } = bestMatch;

    state.ghostSetsData = JSON.parse(JSON.stringify(foundEx.sets));
    state.ghostMatchedExerciseName = foundEx.name;
    state.ghostMatchedMuscle = foundEx.muscle || '';

    // Autoseleccionar grupo muscular si el usuario aún no lo ha elegido
    const inputMuscle = document.getElementById('inputMuscle');
    if (inputMuscle && (!inputMuscle.value || inputMuscle.value === '') && foundEx.muscle) {
        const options = Array.from(inputMuscle.options);
        const matchOpt = options.find(o => normalizeExerciseName(o.value) === normalizeExerciseName(foundEx.muscle));
        if (matchOpt) inputMuscle.value = matchOpt.value;
    }

    // Calcular días transcurridos
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sessionDate = new Date(foundDate + 'T00:00:00');
    const diffTime = today.getTime() - sessionDate.getTime();
    const daysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let dateBadge = '';
    if (daysAgo === 0) dateBadge = 'Hoy';
    else if (daysAgo === 1) dateBadge = 'Ayer';
    else if (daysAgo > 1) dateBadge = `Hace ${daysAgo} días`;
    else dateBadge = 'Próxima';

    const dateStr = sessionDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const dateTextEl = document.getElementById('ghostDateText');
    if (dateTextEl) {
        dateTextEl.innerText = `${dateBadge} (${dateStr})`;
    }

    // Nombre del ejercicio y badge
    const nameEl = document.getElementById('ghostExerciseName');
    if (nameEl) {
        nameEl.innerText = `${foundEx.name}${foundEx.muscle ? ' (' + foundEx.muscle + ')' : ''}`;
    }

    const matchBadgeEl = document.getElementById('ghostMatchBadge');
    if (matchBadgeEl) {
        if (isExact) {
            matchBadgeEl.className = "text-[10px] bg-green-900/40 text-green-400 border border-green-700/50 px-2 py-0.5 rounded font-semibold";
            matchBadgeEl.innerText = "Exacto";
        } else {
            matchBadgeEl.className = "text-[10px] bg-accent/20 text-accent border border-accent/40 px-2 py-0.5 rounded font-semibold";
            matchBadgeEl.innerText = "Similar";
        }
    }

    // Renderizado legible de series previas
    const setsContainerEl = document.getElementById('ghostSetsText');
    if (setsContainerEl) {
        const badges = foundEx.sets.map((s, idx) => {
            const unit = escapeHTML(s.unit || 'kg');
            const dsTag = s.isDropSet ? '<span class="text-accent font-bold ml-1 text-[10px]">DS</span>' : '';
            return `<span class="inline-flex items-center bg-dark px-2 py-1 rounded border border-gray-700/70 text-xs font-mono mr-1.5 mb-1.5">
                <span class="text-gray-400 mr-1.5">#${idx + 1}</span>
                <span class="font-bold text-white">${s.reps}</span><span class="text-gray-400 text-[10px] mx-0.5">x</span><span class="font-bold text-primary">${s.weight}</span><span class="text-gray-400 text-[10px] ml-0.5">${unit}</span>
                ${dsTag}
            </span>`;
        });
        setsContainerEl.innerHTML = `<div class="flex flex-wrap items-center">${badges.join('')}</div>`;
    }

    // Top Set con la unidad correspondiente (kg o lbs)
    let maxW = 0, maxR = 0, maxUnit = 'kg';
    foundEx.sets.forEach(s => {
        const w = Number(s.weight) || 0;
        if (w > maxW) {
            maxW = w;
            maxR = s.reps;
            maxUnit = s.unit || 'kg';
        }
    });
    const maxTextEl = document.getElementById('ghostMaxText');
    if (maxTextEl) {
        maxTextEl.innerText = `${maxW} ${maxUnit} × ${maxR}`;
    }

    card.classList.remove('hidden');
}

function applyGhostExerciseName() {
    if (state.ghostMatchedExerciseName) {
        const inputName = document.getElementById('inputName');
        if (inputName) {
            inputName.value = state.ghostMatchedExerciseName;
            checkGhostData(state.ghostMatchedExerciseName);
            UI.showToast(`Nombre actualizado a "${state.ghostMatchedExerciseName}"`, "info");
        }
    }
}

function copyGhostSets() {
    if (!state.ghostSetsData || state.ghostSetsData.length === 0) {
        UI.showToast("No hay series previas disponibles para copiar", "warning");
        return;
    }

    // Autocompletar nombre y grupo si el usuario escribió un término parcial
    if (state.ghostMatchedExerciseName) {
        const inputName = document.getElementById('inputName');
        if (inputName) inputName.value = state.ghostMatchedExerciseName;
    }
    if (state.ghostMatchedMuscle) {
        const inputMuscle = document.getElementById('inputMuscle');
        if (inputMuscle && (!inputMuscle.value || inputMuscle.value === '')) {
            const options = Array.from(inputMuscle.options);
            const matchOpt = options.find(o => normalizeExerciseName(o.value) === normalizeExerciseName(state.ghostMatchedMuscle));
            if (matchOpt) inputMuscle.value = matchOpt.value;
        }
    }

    const container = document.getElementById('setsContainer');
    if (!container) return;
    container.innerHTML = '';

    state.ghostSetsData.forEach((s) => {
        if (!s.isDropSet) {
            addSetRow();
            const rows = container.querySelectorAll('.set-group');
            const lastRow = rows[rows.length - 1];
            if (!lastRow) return;
            const wInput = lastRow.querySelector('.weight-input');
            const uSelect = lastRow.querySelector('.unit-select');
            const repsInput = lastRow.querySelector('.reps-input');
            if (wInput) wInput.value = s.weight;
            if (uSelect) uSelect.value = s.unit || 'kg';
            if (repsInput) {
                repsInput.value = '';
                repsInput.placeholder = s.reps;
            }
        } else {
            const rows = container.querySelectorAll('.set-group');
            if (rows.length === 0) return;
            const lastRow = rows[rows.length - 1];
            const dsBtn = lastRow.querySelector('button[title="Añadir Drop Set"]');
            if (dsBtn) {
                addDropSet(dsBtn);
                const dsContainer = lastRow.querySelector('.drop-sets-container');
                const dsRows = dsContainer.querySelectorAll('.drop-set');
                const lastDsRow = dsRows[dsRows.length - 1];
                if (!lastDsRow) return;
                const wInput = lastDsRow.querySelector('.weight-input');
                const uSelect = lastDsRow.querySelector('.unit-select');
                const repsInput = lastDsRow.querySelector('.reps-input');
                if (wInput) wInput.value = s.weight;
                if (uSelect) uSelect.value = s.unit || 'kg';
                if (repsInput) {
                    repsInput.value = '';
                    repsInput.placeholder = s.reps;
                }
            }
        }
    });

    recalcSets();
    const exName = state.ghostMatchedExerciseName || 'ejercicio';
    UI.showToast(`📋 Cargas de "${exName}" precargadas`, "success");
}

function handleAddSubmit(e) {
    e.preventDefault();

    if (!state.activeWorkout) {
        startWorkout();
    }

    const date = document.getElementById('inputDate')?.value;
    const muscle = document.getElementById('inputMuscle')?.value;
    const name = sanitizeText(document.getElementById('inputName')?.value, 100);
    const note = sanitizeText(document.getElementById('inputNote')?.value, 500);

    const sets = [];
    document.querySelectorAll('.set-group').forEach(group => {
        const mainRow = group.querySelector('.main-set');
        if (mainRow) {
            const r = parseInt(mainRow.querySelector('.reps-input').value, 10);
            const w = parseFloat(mainRow.querySelector('.weight-input').value);
            const u = mainRow.querySelector('.unit-select').value;
            if (!isNaN(r) && !isNaN(w)) sets.push({ reps: r, weight: w, unit: u, isDropSet: false });
        }
        const dropRows = group.querySelectorAll('.drop-set');
        dropRows.forEach(dropRow => {
            const r = parseInt(dropRow.querySelector('.reps-input').value, 10);
            const w = parseFloat(dropRow.querySelector('.weight-input').value);
            const u = dropRow.querySelector('.unit-select').value;
            if (!isNaN(r) && !isNaN(w)) sets.push({ reps: r, weight: w, unit: u, isDropSet: true });
        });
    });

    if (sets.length === 0) {
        alert("Debes añadir al menos una serie con peso y repeticiones.");
        return;
    }

    const exData = { name, muscle, sets };
    if (note) exData.note = note;

    state.activeWorkout.exercises.push(exData);
    if (date) state.activeWorkout.date = date;
    localStorage.setItem('hypertrack_active_workout', JSON.stringify(state.activeWorkout));

    renderActiveWorkoutList();

    // Resetear formulario
    const inputName = document.getElementById('inputName');
    const inputNote = document.getElementById('inputNote');
    if (inputName) inputName.value = '';
    if (inputNote) inputNote.value = '';

    const setsContainer = document.getElementById('setsContainer');
    if (setsContainer) {
        setsContainer.innerHTML = '';
        addSetRow();
    }

    document.getElementById('ghostHistoryCard')?.classList.add('hidden');
    state.ghostSetsData = null;
    state.ghostMatchedExerciseName = null;
    state.ghostMatchedMuscle = null;
    populateExerciseDatalist();

    UI.showToast("Ejercicio añadido a la sesión actual", "success");
}

function updateSuggestionsChips() {
    const inputDate = document.getElementById('inputDate');
    const container = document.getElementById('suggestionsContainer');
    const list = document.getElementById('suggestionsList');
    if (!inputDate || !container || !list) return;

    const dateVal = inputDate.value;
    if (!dateVal) return;

    const dateObj = new Date(dateVal + 'T00:00:00');
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dayName = dayNames[dateObj.getDay()];

    const dayRoutine = (state.routineData.active || []).filter(e => e.day === dayName);

    if (dayRoutine.length === 0) {
        container.classList.add('hidden');
        list.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');
    list.innerHTML = dayRoutine.map(ex => `
        <button type="button" onclick="window.appHandler.loadSuggestion('${sanitizeText(ex.name, 40)}', '${sanitizeText(ex.muscle, 30)}')" class="bg-primary/20 hover:bg-primary/40 text-primary border border-primary/40 rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1 transition-colors">
            <i class="ph ph-plus"></i> ${sanitizeText(ex.name, 40)}
        </button>
    `).join('');
}

function loadSuggestion(name, muscle) {
    const inputName = document.getElementById('inputName');
    const inputMuscle = document.getElementById('inputMuscle');
    if (inputName) inputName.value = name;
    if (inputMuscle) inputMuscle.value = muscle;
    checkGhostData(name);
}

// ==============================================================================
// 6. EDICIÓN Y BORRADO DE REGISTROS
// ==============================================================================

function editDuration(date) {
    const session = state.gymData.find(s => s.date === date);
    if (!session) return;
    const current = session.duration || '';
    const newDur = prompt("Ingresa el tiempo del entrenamiento (HH:MM:SS o MM:SS):", current);

    if (newDur !== null) {
        const trimmed = newDur.trim();
        if (trimmed === '') {
            delete session.duration;
        } else {
            const sanitized = sanitizeDuration(trimmed);
            if (sanitized) {
                session.duration = sanitized;
            } else {
                alert("Formato de tiempo inválido. Usa HH:MM:SS o MM:SS (ej: 01:15:00 o 45:00)");
                return;
            }
        }

        if (state.currentUser) {
            WorkoutsService.saveSingleSession(session, state.currentUser.id);
        }
        localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));
        refreshActiveView();
        UI.showToast("⏱️ Tiempo actualizado", "success");
    }
}

function openEditDateModal(date) {
    state.editingSessionDate = date;
    const modal = document.getElementById('editDateModal');
    const input = document.getElementById('editDateInput');
    const oldVal = document.getElementById('editDateOldValue');
    if (modal && input && oldVal) {
        input.value = date;
        oldVal.value = date;
        modal.classList.remove('hidden');
    }
}

function closeEditDateModal() {
    const modal = document.getElementById('editDateModal');
    if (modal) modal.classList.add('hidden');
}

async function saveEditDate() {
    const oldDate = state.editingSessionDate;
    const newDate = document.getElementById('editDateInput')?.value;

    if (!newDate || newDate === oldDate) {
        closeEditDateModal();
        return;
    }

    const oldIndex = state.gymData.findIndex(s => s.date === oldDate);
    if (oldIndex === -1) return;

    const existingIndex = state.gymData.findIndex(s => s.date === newDate);
    if (existingIndex > -1) {
        // Fusionar sesiones del mismo día
        state.gymData[existingIndex].exercises.push(...state.gymData[oldIndex].exercises);
        if (!state.gymData[existingIndex].duration && state.gymData[oldIndex].duration) {
            state.gymData[existingIndex].duration = state.gymData[oldIndex].duration;
        }
        state.gymData.splice(oldIndex, 1);
    } else {
        state.gymData[oldIndex].date = newDate;
    }

    if (state.currentUser) {
        try {
            await WorkoutsService.deleteSession(oldDate, state.currentUser.id);
            const targetSession = state.gymData.find(s => s.date === newDate);
            if (targetSession) {
                await WorkoutsService.saveSingleSession(targetSession, state.currentUser.id);
            }
        } catch (err) {
            console.error("Error actualizando fecha en Supabase:", err);
        }
    }

    localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));
    closeEditDateModal();
    refreshActiveView();
    UI.showToast("📅 Fecha actualizada", "success");
}

function openEditExerciseModal(date, index) {
    state.editingSessionDate = date;
    state.editingExerciseIndex = index;

    const session = state.gymData.find(s => s.date === date);
    if (!session || !session.exercises[index]) return;
    const ex = session.exercises[index];

    const content = document.getElementById('editModalContent');
    if (!content) return;

    let setsHtml = '';
    let groupNum = 0;

    ex.sets.forEach((s) => {
        if (!s.isDropSet) {
            groupNum++;
            setsHtml += `
                <div class="set-group mb-2 border-b border-gray-800/50 pb-2">
                    <div class="flex items-center gap-1.5 sm:gap-2 mb-2 edit-set-row main-set">
                        <span class="text-gray-500 font-bold w-6 text-center edit-set-number flex-shrink-0 text-xs sm:text-sm">#${groupNum}</span>
                        <div class="w-16 sm:w-20 flex-shrink-0">
                            <input type="number" value="${s.reps}" placeholder="Reps" required min="1" class="w-full bg-dark border border-gray-700 rounded-lg p-2 text-white text-sm text-center edit-reps outline-none focus:border-primary">
                        </div>
                        <span class="text-gray-500 text-xs flex-shrink-0">x</span>
                        <div class="flex-1 min-w-0 flex items-stretch">
                            <input type="number" step="0.1" value="${s.weight}" placeholder="Peso" required min="0" class="w-full min-w-0 bg-dark border border-gray-700 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-primary">
                            <select class="w-12 sm:w-14 flex-shrink-0 bg-gray-800 border border-gray-700 border-l-0 text-white rounded-r-lg p-1 text-xs font-semibold edit-unit outline-none focus:border-primary text-center">
                                <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
                                <option value="lbs" ${s.unit === 'lbs' ? 'selected' : ''}>lbs</option>
                            </select>
                        </div>
                        <button type="button" onclick="this.closest('.set-group').remove()" class="text-gray-500 hover:text-red-400 p-1.5 flex-shrink-0"><i class="ph ph-trash text-lg"></i></button>
                    </div>
                    <div class="drop-sets-container flex flex-col gap-2 pl-4 border-l-2 border-accent/30 ml-3">
            `;
        } else {
            setsHtml += `
                <div class="flex items-center gap-1.5 sm:gap-2 edit-set-row drop-set mb-2">
                    <span class="text-accent text-[10px] font-bold w-6 text-center flex-shrink-0">DS</span>
                    <div class="w-16 sm:w-20 flex-shrink-0">
                        <input type="number" value="${s.reps}" placeholder="Reps" required min="1" class="w-full bg-dark border border-accent/50 rounded-lg p-2 text-white text-sm text-center edit-reps outline-none focus:border-accent">
                    </div>
                    <span class="text-gray-500 text-xs flex-shrink-0">x</span>
                    <div class="flex-1 min-w-0 flex items-stretch">
                        <input type="number" step="0.1" value="${s.weight}" placeholder="Peso" required min="0" class="w-full min-w-0 bg-dark border border-accent/50 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-accent">
                        <select class="w-12 sm:w-14 flex-shrink-0 bg-gray-800 border border-accent/50 border-l-0 text-white rounded-r-lg p-1 text-xs font-semibold edit-unit outline-none focus:border-accent text-center">
                            <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="lbs" ${s.unit === 'lbs' ? 'selected' : ''}>lbs</option>
                        </select>
                    </div>
                    <button type="button" onclick="this.parentElement.remove()" class="text-gray-500 hover:text-red-400 p-1.5 flex-shrink-0"><i class="ph ph-x text-lg"></i></button>
                </div>
            `;
        }
    });

    if (groupNum > 0) setsHtml += `</div></div>`;

    content.innerHTML = `
        <div class="space-y-4">
            <div>
                <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Nombre del Ejercicio</label>
                <input type="text" id="editExerciseName" value="${sanitizeText(ex.name, 100)}" class="w-full bg-dark border border-gray-700 rounded-lg p-3 text-white focus:border-primary outline-none">
            </div>
            <div>
                <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Notas</label>
                <textarea id="editNote" rows="2" class="w-full bg-dark border border-gray-700 rounded-lg p-3 text-white focus:border-primary outline-none resize-none">${sanitizeText(ex.note || '', 500)}</textarea>
            </div>
            <div>
                <div class="flex justify-between items-center mb-2">
                    <label class="text-xs font-bold text-gray-400 uppercase tracking-wider">Series y Drop Sets</label>
                    <button type="button" onclick="window.appHandler.addEditSetRow()" class="text-xs text-primary hover:text-blue-400 font-semibold"><i class="ph ph-plus"></i> Serie</button>
                </div>
                <div id="editSetsContainer" class="space-y-2 max-h-60 overflow-y-auto pr-1">
                    ${setsHtml}
                </div>
            </div>
        </div>
    `;

    document.getElementById('editExerciseModal')?.classList.remove('hidden');
}

function closeEditExerciseModal() {
    document.getElementById('editExerciseModal')?.classList.add('hidden');
}

function addEditSetRow() {
    const container = document.getElementById('editSetsContainer');
    if (!container) return;
    const rowCount = container.querySelectorAll('.set-group').length + 1;
    const div = document.createElement('div');
    div.className = "set-group mb-2 border-b border-gray-800/50 pb-2";
    div.innerHTML = `
        <div class="flex items-center gap-1.5 sm:gap-2 mb-2 edit-set-row main-set">
            <span class="text-gray-500 font-bold w-6 text-center edit-set-number flex-shrink-0 text-xs sm:text-sm">#${rowCount}</span>
            <div class="w-16 sm:w-20 flex-shrink-0">
                <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-gray-700 rounded-lg p-2 text-white text-sm text-center edit-reps outline-none focus:border-primary">
            </div>
            <span class="text-gray-500 text-xs flex-shrink-0">x</span>
            <div class="flex-1 min-w-0 flex items-stretch">
                <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full min-w-0 bg-dark border border-gray-700 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-primary">
                <select class="w-12 sm:w-14 flex-shrink-0 bg-gray-800 border border-gray-700 border-l-0 text-white rounded-r-lg p-1 text-xs font-semibold edit-unit outline-none focus:border-primary text-center">
                    <option value="kg">kg</option>
                    <option value="lbs">lbs</option>
                </select>
            </div>
            <button type="button" onclick="this.closest('.set-group').remove()" class="text-gray-500 hover:text-red-400 p-1.5 flex-shrink-0"><i class="ph ph-trash text-lg"></i></button>
        </div>
        <div class="drop-sets-container flex flex-col gap-2 pl-4 border-l-2 border-accent/30 ml-3 hidden"></div>
        <button type="button" onclick="window.appHandler.addEditDropSet(this)" class="text-xs text-accent mt-1 ml-3 font-semibold"><i class="ph ph-plus"></i> Drop Set</button>
    `;
    container.appendChild(div);
}

function addEditDropSet(btn) {
    const container = btn.parentElement.querySelector('.drop-sets-container');
    container.classList.remove('hidden');
    const dropDiv = document.createElement('div');
    dropDiv.className = "flex items-center gap-1.5 sm:gap-2 edit-set-row drop-set mb-2";
    dropDiv.innerHTML = `
        <span class="text-accent text-[10px] font-bold w-6 text-center flex-shrink-0">DS</span>
        <div class="w-16 sm:w-20 flex-shrink-0">
            <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-accent/50 rounded-lg p-2 text-white text-sm text-center edit-reps outline-none focus:border-accent">
        </div>
        <span class="text-gray-500 text-xs flex-shrink-0">x</span>
        <div class="flex-1 min-w-0 flex items-stretch">
            <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full min-w-0 bg-dark border border-accent/50 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-accent">
            <select class="w-12 sm:w-14 flex-shrink-0 bg-gray-800 border border-accent/50 border-l-0 text-white rounded-r-lg p-1 text-xs font-semibold edit-unit outline-none focus:border-accent text-center">
                <option value="kg">kg</option>
                <option value="lbs">lbs</option>
            </select>
        </div>
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-500 hover:text-red-400 p-1.5 flex-shrink-0"><i class="ph ph-x text-lg"></i></button>
    `;
    container.appendChild(dropDiv);
}

async function saveEditExercise() {
    const session = state.gymData.find(s => s.date === state.editingSessionDate);
    if (!session || !session.exercises[state.editingExerciseIndex]) return;

    const ex = session.exercises[state.editingExerciseIndex];
    const newSets = [];

    document.querySelectorAll('#editSetsContainer .set-group').forEach(group => {
        const main = group.querySelector('.main-set');
        if (main) {
            const r = parseInt(main.querySelector('.edit-reps').value, 10);
            const w = parseFloat(main.querySelector('.edit-weight').value);
            const u = main.querySelector('.edit-unit').value;
            if (!isNaN(r) && !isNaN(w)) newSets.push({ reps: r, weight: w, unit: u, isDropSet: false });
        }
        group.querySelectorAll('.drop-set').forEach(drop => {
            const r = parseInt(drop.querySelector('.edit-reps').value, 10);
            const w = parseFloat(drop.querySelector('.edit-weight').value);
            const u = drop.querySelector('.edit-unit').value;
            if (!isNaN(r) && !isNaN(w)) newSets.push({ reps: r, weight: w, unit: u, isDropSet: true });
        });
    });

    if (newSets.length === 0) {
        alert("Debes tener al menos una serie válida.");
        return;
    }

    const nameInput = document.getElementById('editExerciseName');
    const noteInput = document.getElementById('editNote');

    if (nameInput?.value.trim()) ex.name = sanitizeText(nameInput.value, 100);
    ex.note = sanitizeText(noteInput?.value || '', 500);
    ex.sets = newSets;

    if (state.currentUser) {
        await WorkoutsService.saveSingleSession(session, state.currentUser.id);
    }

    localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));
    closeEditExerciseModal();
    refreshActiveView();
    UI.showToast("✏️ Registro actualizado", "success");
}

async function deleteExercise(date, index) {
    if (!confirm("¿Eliminar este ejercicio de la sesión?")) return;

    const sessionIndex = state.gymData.findIndex(s => s.date === date);
    if (sessionIndex === -1) return;

    const session = state.gymData[sessionIndex];
    session.exercises.splice(index, 1);

    if (session.exercises.length === 0) {
        state.gymData.splice(sessionIndex, 1);
        if (state.currentUser) {
            await WorkoutsService.deleteSession(date, state.currentUser.id);
        }
    } else {
        if (state.currentUser) {
            await WorkoutsService.saveSingleSession(session, state.currentUser.id);
        }
    }

    localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));
    refreshActiveView();
    UI.showToast("🗑️ Ejercicio eliminado", "info");
}

async function deleteSession(date) {
    if (!confirm(`¿Eliminar la sesión completa del día ${date}?`)) return;

    const sessionIndex = state.gymData.findIndex(s => s.date === date);
    if (sessionIndex === -1) return;

    state.gymData.splice(sessionIndex, 1);
    if (state.currentUser) {
        await WorkoutsService.deleteSession(date, state.currentUser.id);
    }

    localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));
    refreshActiveView();
    UI.showToast("🗑️ Sesión eliminada", "info");
}

// ==============================================================================
// 7. GESTIÓN DE RUTINA
// ==============================================================================

async function handleAddRoutine(e) {
    e.preventDefault();
    const day = document.getElementById('routineDay')?.value;
    const muscle = document.getElementById('routineMuscle')?.value;
    const name = sanitizeText(document.getElementById('routineName')?.value, 100);

    if (!name) return;

    if (!state.routineData.active) state.routineData.active = [];
    state.routineData.active.push({
        id: String(Date.now() + Math.random()),
        day,
        muscle,
        name
    });

    if (state.currentUser) {
        await WorkoutsService.saveRoutine(state.routineData, state.currentUser.id);
    }

    document.getElementById('routineName').value = '';
    populateExerciseDatalist();
    UI.renderRoutine(state.routineData);
    UI.showToast("Plan de rutina actualizado", "success");
}

async function archiveRoutineExercise(id) {
    const idx = (state.routineData.active || []).findIndex(e => e.id === id);
    if (idx === -1) return;

    const item = state.routineData.active.splice(idx, 1)[0];
    if (!state.routineData.archived) state.routineData.archived = [];
    state.routineData.archived.push(item);

    if (state.currentUser) {
        await WorkoutsService.saveRoutine(state.routineData, state.currentUser.id);
    }
    UI.renderRoutine(state.routineData);
    UI.showToast("Ejercicio archivado", "info");
}

async function restoreRoutineExercise(id) {
    const idx = (state.routineData.archived || []).findIndex(e => e.id === id);
    if (idx === -1) return;

    const item = state.routineData.archived.splice(idx, 1)[0];
    if (!state.routineData.active) state.routineData.active = [];
    state.routineData.active.push(item);

    if (state.currentUser) {
        await WorkoutsService.saveRoutine(state.routineData, state.currentUser.id);
    }
    UI.renderRoutine(state.routineData);
    UI.showToast("Ejercicio restaurado a tu plan", "success");
}

async function deleteArchivedRoutineExercise(id) {
    if (!confirm("¿Eliminar definitivamente este ejercicio archivado?")) return;
    const idx = (state.routineData.archived || []).findIndex(e => e.id === id);
    if (idx === -1) return;

    state.routineData.archived.splice(idx, 1);
    if (state.currentUser) {
        await WorkoutsService.saveRoutine(state.routineData, state.currentUser.id);
    }
    UI.renderRoutine(state.routineData);
    UI.showToast("Ejercicio eliminado", "info");
}

function openEditRoutineModal(id) {
    const item = (state.routineData.active || []).find(e => e.id === id);
    if (!item) return;

    const modal = document.getElementById('editRoutineModal');
    const idInput = document.getElementById('editRoutineId');
    const dayInput = document.getElementById('editRoutineDay');
    const muscleInput = document.getElementById('editRoutineMuscle');
    const nameInput = document.getElementById('editRoutineName');

    if (idInput) idInput.value = item.id;
    if (dayInput) dayInput.value = item.day;
    if (muscleInput) muscleInput.value = item.muscle;
    if (nameInput) nameInput.value = item.name;

    modal?.classList.remove('hidden');
}

function closeEditRoutineModal() {
    document.getElementById('editRoutineModal')?.classList.add('hidden');
}

async function saveEditRoutine() {
    const id = document.getElementById('editRoutineId')?.value;
    const item = (state.routineData.active || []).find(e => e.id === id);
    if (!item) return;

    item.day = document.getElementById('editRoutineDay')?.value;
    item.muscle = document.getElementById('editRoutineMuscle')?.value;
    item.name = sanitizeText(document.getElementById('editRoutineName')?.value, 100);

    if (state.currentUser) {
        await WorkoutsService.saveRoutine(state.routineData, state.currentUser.id);
    }

    closeEditRoutineModal();
    UI.renderRoutine(state.routineData);
    UI.showToast("Rutina actualizada", "success");
}

function toggleRoutineView(view) {
    const viewActive = document.getElementById('viewActiveRoutine');
    const viewArchived = document.getElementById('viewArchivedRoutine');
    const btnActive = document.getElementById('btnViewActive');
    const btnArchived = document.getElementById('btnViewArchived');

    if (view === 'active') {
        viewActive?.classList.remove('hidden');
        viewArchived?.classList.add('hidden');
        btnActive?.classList.add('bg-gray-800', 'text-white');
        btnActive?.classList.remove('text-gray-400');
        btnArchived?.classList.remove('bg-gray-800', 'text-white');
        btnArchived?.classList.add('text-gray-400');
    } else {
        viewActive?.classList.add('hidden');
        viewArchived?.classList.remove('hidden');
        btnArchived?.classList.add('bg-gray-800', 'text-white');
        btnArchived?.classList.remove('text-gray-400');
        btnActive?.classList.remove('bg-gray-800', 'text-white');
        btnActive?.classList.add('text-gray-400');
    }
}

// ==============================================================================
// 8. EXCEL: IMPORT / EXPORT & ZONA DE PELIGRO
// ==============================================================================

async function handleImportExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!state.currentUser) {
        alert("Debes iniciar sesión para importar registros a tu cuenta.");
        return;
    }

    try {
        UI.toggleGlobalLoading(true);
        const { mergedSessions, countAdded } = await WorkoutsService.parseAndValidateExcel(
            file,
            state.gymData,
            state.currentUser.id
        );

        state.gymData = mergedSessions;
        await WorkoutsService.saveBatchSessions(state.gymData, state.currentUser.id);
        localStorage.setItem('hypertrack_gymData', JSON.stringify(state.gymData));

        populateExerciseDatalist();
        refreshActiveView();
        UI.showModal("Importación Exitosa", `Se han añadido ${countAdded} series validadas y vinculadas inmutablemente a tu cuenta.`);
    } catch (err) {
        console.error("Error importando Excel:", err);
        UI.showModal("Error al importar", err.message || "Hubo un problema al procesar el archivo Excel.");
    } finally {
        event.target.value = '';
        UI.toggleGlobalLoading(false);
    }
}

function handleExportExcel() {
    try {
        WorkoutsService.exportToExcel(state.gymData);
        UI.showToast("Historial descargado a Excel", "success");
    } catch (err) {
        UI.showModal("Aviso", err.message);
    }
}

async function handleDeleteAllUserRecords() {
    if (!state.currentUser) {
        alert("Debes iniciar sesión.");
        return;
    }

    if (!confirm("⚠️ ¿Estás seguro? Esta acción borrará TODOS tus registros de la nube y localmente. Se recomienda descargar un respaldo primero.")) return;
    if (!confirm("🔴 Última confirmación: ¿Realmente quieres borrar todo tu historial?")) return;

    try {
        await WorkoutsService.deleteAllUserSessions(state.currentUser.id);
        state.gymData = [];
        localStorage.removeItem('hypertrack_gymData');
        refreshActiveView();
        UI.showToast("🗑️ Todos tus registros han sido eliminados", "info");
    } catch (err) {
        console.error("Error eliminando registros:", err);
        UI.showToast("Error al eliminar registros en la nube", "error");
    }
}

// ==============================================================================
// 9. EXPOSICIÓN DE HANDLERS PARA INTERACCIÓN DEL DOM
// ==============================================================================

window.appHandler = {
    switchTab,
    openAuthModal,
    closeAuthModal,
    switchAuthTab,
    fillAdminCredentials,
    handleSignOut,
    startWorkout,
    finishWorkout,
    startRestTimer,
    stopRestTimer,
    addSetRow,
    addDropSet,
    recalcSets,
    copyGhostSets,
    checkGhostData,
    applyGhostExerciseName,
    populateExerciseDatalist,
    loadSuggestion,
    removeActiveWorkoutExercise,
    editDuration,
    openEditDateModal,
    closeEditDateModal,
    saveEditDate,
    openEditExerciseModal,
    closeEditExerciseModal,
    addEditSetRow,
    addEditDropSet,
    saveEditExercise,
    deleteExercise,
    deleteSession,
    handleAddRoutine,
    archiveRoutineExercise,
    restoreRoutineExercise,
    deleteArchivedRoutineExercise,
    openEditRoutineModal,
    closeEditRoutineModal,
    saveEditRoutine,
    toggleRoutineView,
    handleImportExcel,
    handleExportExcel,
    handleDeleteAllUserRecords
};

// Aliases para retrocompatibilidad con atributos inline existentes
window.switchTab = switchTab;
window.exportExcel = handleExportExcel;
window.handleImport = handleImportExcel;
window.deleteAllRecords = handleDeleteAllUserRecords;
window.closeModal = UI.closeModal;
window.startWorkout = startWorkout;
window.finishWorkout = finishWorkout;
window.startRestTimer = startRestTimer;
window.stopRestTimer = stopRestTimer;
window.addSetRow = addSetRow;
window.addDropSet = addDropSet;
window.copyGhostSets = copyGhostSets;
window.checkGhostData = checkGhostData;
window.applyGhostExerciseName = applyGhostExerciseName;
window.populateExerciseDatalist = populateExerciseDatalist;
window.handleAddRoutine = handleAddRoutine;
window.toggleRoutineView = toggleRoutineView;
window.closeEditModal = closeEditExerciseModal;
window.saveEditExercise = saveEditExercise;
window.closeEditDateModal = closeEditDateModal;
window.saveEditDate = saveEditDate;
window.closeEditRoutineModal = closeEditRoutineModal;
window.saveEditRoutine = saveEditRoutine;

// ==============================================================================
// 10. INICIALIZACIÓN AL CARGAR EL DOM
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar fecha de hoy
    const inputDate = document.getElementById('inputDate');
    if (inputDate) inputDate.valueAsDate = new Date();

    // Event listeners de formularios
    document.getElementById('authLoginForm')?.addEventListener('submit', handleLoginSubmit);
    document.getElementById('authSignupForm')?.addEventListener('submit', handleSignupSubmit);
    document.getElementById('addExerciseForm')?.addEventListener('submit', handleAddSubmit);
    document.getElementById('addRoutineForm')?.addEventListener('submit', handleAddRoutine);

    // Event listeners del Asistente Ghost y autocompletado
    const inputName = document.getElementById('inputName');
    if (inputName) {
        const handleGhostTrigger = (e) => checkGhostData(e.target.value);
        inputName.addEventListener('input', handleGhostTrigger);
        inputName.addEventListener('change', handleGhostTrigger);
        inputName.addEventListener('focus', (e) => {
            if (e.target.value) checkGhostData(e.target.value);
        });
    }

    const inputMuscle = document.getElementById('inputMuscle');
    if (inputMuscle) {
        inputMuscle.addEventListener('change', () => {
            const currentName = document.getElementById('inputName')?.value;
            if (currentName) checkGhostData(currentName);
        });
    }

    // Delegación para botones dinámicos en Navbar
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btnNavbarSignOut')) handleSignOut();
        if (e.target.closest('#btnNavbarOpenAuth')) openAuthModal('login');
    });

    populateExerciseDatalist();
    initWorkoutState();
    initAuth();
});

