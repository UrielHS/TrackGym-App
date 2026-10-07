/**
 * Controlador Principal de la Aplicación (TrackGym App)
 * Orquestador de Autenticación, Datos Multi-usuario, UI y Eventos.
 */
import { AuthService } from './services/auth.service.js';
import { WorkoutsService } from './services/workouts.service.js';
import { UI } from './modules/ui.js';
import { sanitizeText, sanitizeDuration, normalizeExerciseName } from './utils/sanitize.js';

// --- ESTADO GLOBAL AISLADO DE LA APLICACIÓN ---
const state = {
    currentUser: null,
    currentProfile: null,
    gymData: [],
    routineData: { active: [], archived: [] },
    activeWorkout: null,
    activeTab: 'dashboard',
    ghostSetsData: null,
    workoutTimerInterval: null,
    restTimerInterval: null,
    restTimeRemaining: 0,
    editingSessionDate: null,
    editingExerciseIndex: null
};

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

    // Purgar almacenamiento local para garantizar aislamiento total
    localStorage.removeItem('hypertrack_gymData');
    localStorage.removeItem('hypertrack_active_workout');
    localStorage.removeItem('hypertrack_cached_user');

    if (state.workoutTimerInterval) clearInterval(state.workoutTimerInterval);
    if (state.restTimerInterval) clearInterval(state.restTimerInterval);

    UI.renderAuthNavbar(null, null);
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
        updateSuggestionsChips();
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
        <div class="flex items-center gap-2 md:gap-3 set-row main-set">
            <span class="text-gray-500 font-bold w-6 set-number">#${rowCount}</span>
            <div class="flex-1 min-w-0">
                <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-gray-700 rounded-lg p-2.5 text-white text-sm focus:border-primary outline-none reps-input">
            </div>
            <span class="text-gray-500">x</span>
            <div class="flex-[1.2] relative flex min-w-0">
                <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full bg-dark border border-gray-700 rounded-l-lg p-2.5 text-white text-sm border-r-0 focus:border-primary outline-none weight-input">
                <select class="bg-gray-800 border border-gray-700 text-white rounded-r-lg p-2.5 text-sm outline-none focus:border-primary unit-select">
                    <option value="kg">kg</option>
                    <option value="lbs">lbs</option>
                </select>
            </div>
            <button type="button" onclick="window.appHandler.addDropSet(this)" class="text-gray-500 hover:text-accent p-1 ml-1" title="Añadir Drop Set"><i class="ph ph-arrow-bend-right-down text-lg"></i></button>
            <button type="button" onclick="this.closest('.set-group').remove(); window.appHandler.recalcSets()" class="text-gray-600 hover:text-red-400 p-1" title="Eliminar Serie"><i class="ph ph-trash text-lg"></i></button>
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
    dropDiv.className = "flex items-center gap-2 md:gap-3 set-row drop-set";
    dropDiv.innerHTML = `
        <span class="text-accent text-[10px] font-bold w-6 flex-shrink-0">DS</span>
        <div class="flex-1 min-w-0">
            <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-accent/50 rounded-lg p-2.5 text-white text-sm focus:border-accent outline-none reps-input">
        </div>
        <span class="text-gray-500 text-xs">x</span>
        <div class="flex-[1.2] relative flex min-w-0">
            <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full bg-dark border border-accent/50 rounded-l-lg p-2.5 text-white text-sm border-r-0 focus:border-accent outline-none weight-input">
            <select class="bg-gray-800 border border-accent/50 text-white rounded-r-lg p-2.5 text-sm outline-none focus:border-accent unit-select">
                <option value="kg">kg</option>
                <option value="lbs">lbs</option>
            </select>
        </div>
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-600 hover:text-red-400 p-1"><i class="ph ph-x"></i></button>
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

function checkGhostData(name) {
    if (!name || name.trim() === '') {
        document.getElementById('ghostHistoryCard')?.classList.add('hidden');
        return;
    }

    const searchName = normalizeExerciseName(name);
    const sorted = [...state.gymData].sort((a, b) => new Date(b.date) - new Date(a.date));

    let foundEx = null;
    let foundDate = null;

    for (const session of sorted) {
        const ex = (session.exercises || []).find(e => normalizeExerciseName(e.name) === searchName);
        if (ex) {
            foundEx = ex;
            foundDate = session.date;
            break;
        }
    }

    const card = document.getElementById('ghostHistoryCard');
    if (foundEx && card) {
        state.ghostSetsData = JSON.parse(JSON.stringify(foundEx.sets));
        const daysAgo = Math.floor((new Date() - new Date(foundDate + 'T00:00:00')) / (1000 * 60 * 60 * 24));
        const dateObj = new Date(foundDate + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('es-ES');

        document.getElementById('ghostDateText').innerText = `Hace ${daysAgo} días (${dateStr})`;
        const setsStrs = foundEx.sets.map(s => `${s.reps}x${s.weight}${s.unit}${s.isDropSet ? '(DS)' : ''}`);
        document.getElementById('ghostSetsText').innerText = setsStrs.join(', ');

        let maxW = 0, maxR = 0;
        foundEx.sets.forEach(s => {
            if (s.weight > maxW) { maxW = s.weight; maxR = s.reps; }
        });
        document.getElementById('ghostMaxText').innerText = `${maxW} kg x ${maxR}`;
        card.classList.remove('hidden');
    } else if (card) {
        card.classList.add('hidden');
        state.ghostSetsData = null;
    }
}

function copyGhostSets() {
    if (!state.ghostSetsData) return;
    const container = document.getElementById('setsContainer');
    if (!container) return;
    container.innerHTML = '';

    state.ghostSetsData.forEach((s) => {
        if (!s.isDropSet) {
            addSetRow();
            const rows = container.querySelectorAll('.set-group');
            const lastRow = rows[rows.length - 1];
            lastRow.querySelector('.weight-input').value = s.weight;
            lastRow.querySelector('.unit-select').value = s.unit || 'kg';
            const repsInput = lastRow.querySelector('.reps-input');
            repsInput.value = '';
            repsInput.placeholder = s.reps;
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
                lastDsRow.querySelector('.weight-input').value = s.weight;
                lastDsRow.querySelector('.unit-select').value = s.unit || 'kg';
                const repsInput = lastDsRow.querySelector('.reps-input');
                repsInput.value = '';
                repsInput.placeholder = s.reps;
            }
        }
    });
    UI.showToast("📋 Pesos anteriores precargados", "info");
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
                    <div class="flex items-center gap-2 mb-2 edit-set-row main-set">
                        <span class="text-gray-500 font-bold w-6 edit-set-number">#${groupNum}</span>
                        <div class="flex-1">
                            <input type="number" value="${s.reps}" placeholder="Reps" required min="1" class="w-full bg-dark border border-gray-700 rounded-lg p-2 text-white text-sm edit-reps outline-none focus:border-primary">
                        </div>
                        <span class="text-gray-500">x</span>
                        <div class="flex-[1.2] relative flex min-w-0">
                            <input type="number" step="0.1" value="${s.weight}" placeholder="Peso" required min="0" class="w-full bg-dark border border-gray-700 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-primary">
                            <select class="bg-gray-800 border border-gray-700 text-white rounded-r-lg p-2 text-sm edit-unit outline-none focus:border-primary">
                                <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
                                <option value="lbs" ${s.unit === 'lbs' ? 'selected' : ''}>lbs</option>
                            </select>
                        </div>
                        <button type="button" onclick="this.closest('.set-group').remove()" class="text-gray-600 hover:text-red-400 p-1 ml-1"><i class="ph ph-trash text-lg"></i></button>
                    </div>
                    <div class="drop-sets-container flex flex-col gap-2 pl-4 border-l-2 border-accent/30 ml-3">
            `;
        } else {
            setsHtml += `
                <div class="flex items-center gap-2 edit-set-row drop-set mb-2">
                    <span class="text-accent text-[10px] font-bold w-6 flex-shrink-0">DS</span>
                    <div class="flex-1 min-w-0">
                        <input type="number" value="${s.reps}" placeholder="Reps" required min="1" class="w-full bg-dark border border-accent/50 rounded-lg p-2 text-white text-sm edit-reps outline-none focus:border-accent">
                    </div>
                    <span class="text-gray-500 text-xs">x</span>
                    <div class="flex-[1.2] relative flex min-w-0">
                        <input type="number" step="0.1" value="${s.weight}" placeholder="Peso" required min="0" class="w-full bg-dark border border-accent/50 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-accent">
                        <select class="bg-gray-800 border border-accent/50 text-white rounded-r-lg p-2 text-sm edit-unit outline-none focus:border-accent">
                            <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="lbs" ${s.unit === 'lbs' ? 'selected' : ''}>lbs</option>
                        </select>
                    </div>
                    <button type="button" onclick="this.parentElement.remove()" class="text-gray-600 hover:text-red-400 p-1"><i class="ph ph-x"></i></button>
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
                    <button type="button" onclick="window.appHandler.addEditSetRow()" class="text-xs text-primary hover:text-blue-400"><i class="ph ph-plus"></i> Serie</button>
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
        <div class="flex items-center gap-2 mb-2 edit-set-row main-set">
            <span class="text-gray-500 font-bold w-6 edit-set-number">#${rowCount}</span>
            <div class="flex-1 min-w-0">
                <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-gray-700 rounded-lg p-2 text-white text-sm edit-reps outline-none focus:border-primary">
            </div>
            <span class="text-gray-500">x</span>
            <div class="flex-[1.2] relative flex min-w-0">
                <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full bg-dark border border-gray-700 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-primary">
                <select class="bg-gray-800 border border-gray-700 text-white rounded-r-lg p-2 text-sm edit-unit outline-none focus:border-primary">
                    <option value="kg">kg</option>
                    <option value="lbs">lbs</option>
                </select>
            </div>
            <button type="button" onclick="this.closest('.set-group').remove()" class="text-gray-600 hover:text-red-400 p-1 ml-1"><i class="ph ph-trash text-lg"></i></button>
        </div>
        <div class="drop-sets-container flex flex-col gap-2 pl-4 border-l-2 border-accent/30 ml-3 hidden"></div>
        <button type="button" onclick="window.appHandler.addEditDropSet(this)" class="text-xs text-accent mt-1 ml-3"><i class="ph ph-plus"></i> Drop Set</button>
    `;
    container.appendChild(div);
}

function addEditDropSet(btn) {
    const container = btn.parentElement.querySelector('.drop-sets-container');
    container.classList.remove('hidden');
    const dropDiv = document.createElement('div');
    dropDiv.className = "flex items-center gap-2 edit-set-row drop-set mb-2";
    dropDiv.innerHTML = `
        <span class="text-accent text-[10px] font-bold w-6 flex-shrink-0">DS</span>
        <div class="flex-1 min-w-0">
            <input type="number" placeholder="Reps" required min="1" class="w-full bg-dark border border-accent/50 rounded-lg p-2 text-white text-sm edit-reps outline-none focus:border-accent">
        </div>
        <span class="text-gray-500 text-xs">x</span>
        <div class="flex-[1.2] relative flex min-w-0">
            <input type="number" step="0.1" placeholder="Peso" required min="0" class="w-full bg-dark border border-accent/50 rounded-l-lg p-2 text-white text-sm border-r-0 edit-weight outline-none focus:border-accent">
            <select class="bg-gray-800 border border-accent/50 text-white rounded-r-lg p-2 text-sm edit-unit outline-none focus:border-accent">
                <option value="kg">kg</option>
                <option value="lbs">lbs</option>
            </select>
        </div>
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-600 hover:text-red-400 p-1"><i class="ph ph-x"></i></button>
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
    handleSignOut,
    startWorkout,
    finishWorkout,
    startRestTimer,
    stopRestTimer,
    addSetRow,
    addDropSet,
    recalcSets,
    copyGhostSets,
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

    // Event listener del Asistente Ghost
    document.getElementById('inputName')?.addEventListener('input', (e) => checkGhostData(e.target.value));

    // Delegación para botones dinámicos en Navbar
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btnNavbarSignOut')) handleSignOut();
        if (e.target.closest('#btnNavbarOpenAuth')) openAuthModal('login');
    });

    initWorkoutState();
    initAuth();
});

