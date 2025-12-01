// --- Trace'N Find System Logs Logic ---
// This file handles all logic *specific* to admin/logs.html.
// It assumes `admin-app-shell.js` has already been loaded and has authenticated the user.

import { 
    fbDB,
    collection, 
    onSnapshot, 
    query,
    showToast,
    showModal,
    orderBy,
    limit,
    writeBatch
} from './admin-app-shell.js';

// --- Global State ---
let allLogs = [];
let logListener = null;

// --- DOM Elements ---
const elements = {
    logsTableBody: document.getElementById('logs-table-body'),
    logsEmptyState: document.getElementById('logs-empty-state'),
    logsLoadingState: document.getElementById('logs-loading-state'),
    searchInput: document.getElementById('log-search-input'),
    levelFilter: document.getElementById('log-level-filter'),
    clearLogsBtn: document.getElementById('clear-logs-btn'),
};

// --- Initialization ---
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserIsAdmin) {
            console.log("System Logs Logic: Auth is ready.");
            callback(window.currentUserId);
        } else {
            console.log("System Logs logic waiting for admin authentication...");
            requestAnimationFrame(check);
        }
    };
    requestAnimationFrame(check);
}

waitForAuth((adminId) => {
    listenForLogs();
    setupEventListeners();
});

/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners() {
    const render = () => renderLogList(allLogs, elements.searchInput.value.toLowerCase(), elements.levelFilter.value);
    
    elements.searchInput.addEventListener('input', render);
    elements.levelFilter.addEventListener('change', render);

    elements.clearLogsBtn.addEventListener('click', handleClearLogs);
}

// --- Firestore Data ---

/**
 * Sets up a real-time listener for the latest 100 system logs.
 * SCALABILITY: Assumes logs are in a root `system_logs` collection.
 */
function listenForLogs() {
    setLoadingState(true);
    
    const logsRef = collection(fbDB, 'system_logs');
    // PERFORMANCE: Order by timestamp and limit to the latest 100.
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(100));

    if (logListener) logListener();

    logListener = onSnapshot(q, (snapshot) => {
        setLoadingState(false);

        allLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderLogList(allLogs, elements.searchInput.value.toLowerCase(), elements.levelFilter.value);

    }, (error) => {
        console.error("Error listening for logs:", error);
        showToast('Error', 'Could not load system logs.', 'error');
        setLoadingState(false);
        elements.logsEmptyState.style.display = 'table-row';
    });
}


// --- UI Rendering ---

/**
 * Renders the list of logs into the table, applying any filters.
 * @param {Array} logs - The complete list of log objects.
 * @param {string} filterText - The text to filter by.
 * @param {string} levelFilter - The log level to filter by.
 */
function renderLogList(logs, filterText, levelFilter) {
    elements.logsTableBody.innerHTML = ''; // Clear list
    
    const filteredLogs = logs.filter(log => {
        const textMatch = filterText === '' || 
                          log.message.toLowerCase().includes(filterText) ||
                          (log.context?.userId && log.context.userId.toLowerCase().includes(filterText));
        
        const levelMatch = levelFilter === '' || log.level === levelFilter;

        return textMatch && levelMatch;
    });

    if (filteredLogs.length === 0) {
        elements.logsEmptyState.style.display = 'table-row';
        elements.logsTableBody.appendChild(elements.logsEmptyState);
        return;
    }
    
    elements.logsEmptyState.style.display = 'none';

    filteredLogs.forEach(log => {
        const tr = document.createElement('tr');
        tr.className = 'animate-fade-in';
        
        const { badgeClass, iconClass } = getLogBadge(log.level);
        const timestamp = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'N/A';
        const contextText = log.context?.userId ? `User: ${log.context.userId}` : (log.context?.page || 'System');

        tr.innerHTML = `
            <!-- Level Column -->
            <td>
                <span class="badge ${badgeClass}">
                    <i class"bi ${iconClass}"></i>
                    ${log.level}
                </span>
            </td>
            <!-- Timestamp Column -->
            <td class="text-sm text-text-secondary dark:text-dark-text-secondary">${timestamp}</td>
            <!-- Event Column -->
            <td>
                <div class="log-message text-text-primary dark:text-dark-text-primary">${log.message}</div>
            </td>
            <!-- Context Column -->
            <td class="text-sm text-text-secondary dark:text-dark-text-secondary font-mono">${contextText}</td>
        `;
        elements.logsTableBody.appendChild(tr);
    });
}

/**
 * Shows or hides the table loading state.
 * @param {boolean} isLoading - True to show loading, false to hide.
 */
function setLoadingState(isLoading) {
    if (isLoading) {
        elements.logsTableBody.innerHTML = '';
        elements.logsLoadingState.style.display = 'table-row';
        elements.logsEmptyState.style.display = 'none';
    } else {
        elements.logsLoadingState.style.display = 'none';
    }
}

/**
 * Gets the CSS classes for a log level.
 * @param {string} level - The log level (e.g., "INFO", "ERROR").
 * @returns {object} { badgeClass, iconClass }
 */
function getLogBadge(level) {
    switch (level) {
        case 'INFO':
            return { badgeClass: 'badge-info', iconClass: 'bi-info-circle-fill' };
        case 'SECURITY':
            return { badgeClass: 'badge-success', iconClass: 'bi-shield-check' };
        case 'WARN':
            return { badgeClass: 'badge-warning', iconClass: 'bi-exclamation-triangle-fill' };
        case 'ERROR':
            return { badgeClass: 'badge-danger', iconClass: 'bi-x-circle-fill' };
        default:
            return { badgeClass: 'badge-secondary', iconClass: 'bi-question-circle' };
    }
}

// --- Core Logic ---

/**
 * Handles clearing all logs (that are currently loaded).
 */
function handleClearLogs() {
    const logsToDelete = allLogs; // We only clear the 100 loaded logs
    
    if (logsToDelete.length === 0) {
        showToast('No Logs', 'There are no logs to clear.', 'info');
        return;
    }

    showModal(
        true,
        'Clear Displayed Logs?',
        `Are you sure you want to delete the <strong>${logsToDelete.length}</strong> currently displayed logs? This cannot be undone.`,
        'Clear Logs',
        'btn-danger',
        async () => {
            // Confirm callback
            const batch = writeBatch(fbDB);
            logsToDelete.forEach(log => {
                const docRef = doc(fbDB, 'system_logs', log.id);
                batch.delete(docRef);
            });

            try {
                await batch.commit();
                showToast('Success', 'Logs cleared successfully.', 'success');
                // The onSnapshot listener will automatically update the UI
            } catch (error) {
                console.error("Error clearing logs:", error);
                showToast('Error', 'Could not clear logs.', 'error');
            }
        }
    );
}