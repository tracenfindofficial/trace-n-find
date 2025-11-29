// --- CONSTANTS ---
export const TOAST_DURATION = 5000;
export const DANGER_COLOR = 'var(--color-danger)';
export const SUCCESS_COLOR = 'var(--color-success)';

// --- UTILITY IMPLEMENTATIONS ---

/**
 * Displays a toast notification.
 * @param {string} title 
 * @param {string} message 
 * @param {('success'|'error'|'info'|'warning')} type 
 */
export function showToast(title, message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = '';
    let colorVar = '';
    switch (type) {
        case 'success':
            iconClass = 'bi-check-circle-fill';
            colorVar = SUCCESS_COLOR;
            break;
        case 'error':
            iconClass = 'bi-exclamation-triangle-fill';
            colorVar = DANGER_COLOR;
            break;
        case 'info':
            iconClass = 'bi-info-circle-fill';
            colorVar = 'var(--color-info)';
            break;
        case 'warning':
            iconClass = 'bi-exclamation-circle-fill';
            colorVar = 'var(--color-warning)';
            break;
    }

    toast.innerHTML = `
        <i class="bi ${iconClass} toast-icon" style="color: ${colorVar}"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="text-slate-400 hover:text-slate-600" onclick="this.parentElement.remove()"><i class="bi bi-x-lg"></i></button>
    `;

    toastContainer.appendChild(toast);

    // Show the toast with a slight delay for CSS transition
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Auto-remove
    setTimeout(() => {
        if(toast.parentElement) {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 400);
        }
    }, TOAST_DURATION);
}

/**
 * Displays the confirmation modal.
 * @param {string} title 
 * @param {string} message 
 * @param {('danger'|'primary'|'warning'|'info'|'success')} type 
 * @param {function} onConfirm Callback function on confirmation.
 * @param {function} [onCancel] Optional callback function on cancel.
 * @param {object} [options] Optional settings. { isHTML: false }
 */
export function showModal(title, message, type = 'primary', onConfirm, onCancel, options = {}) {
    // Find modal elements each time
    const modalElements = {
        confirmationModal: document.getElementById('confirmationModal'),
        modalClose: document.getElementById('modalClose'),
        modalTitle: document.getElementById('modalTitle'),
        modalMessage: document.getElementById('modalMessage'),
        modalConfirm: document.getElementById('modalConfirm'),
        modalCancel: document.getElementById('modalCancel'),
    };
    
    if (!modalElements.confirmationModal) return;

    modalElements.modalTitle.textContent = title;

    const { isHTML = false } = options;
    if (isHTML) {
        modalElements.modalMessage.innerHTML = message;
    } else {
        modalElements.modalMessage.textContent = message;
    }

    // Reset button styles
    modalElements.modalConfirm.className = 'btn';
    
    let btnClass = 'btn-primary';
    if (type === 'danger') btnClass = 'btn-danger';
    if (type === 'warning') btnClass = 'btn-warning text-gray-800';
    if (type === 'info') btnClass = 'btn-info';
    if (type === 'success') btnClass = 'btn-success';

    modalElements.modalConfirm.classList.add(btnClass);
    
    // Clone nodes to remove old event listeners
    const newConfirm = modalElements.modalConfirm.cloneNode(true);
    modalElements.modalConfirm.parentNode.replaceChild(newConfirm, modalElements.modalConfirm);
    modalElements.modalConfirm = newConfirm;

    const newCancel = modalElements.modalCancel.cloneNode(true);
    modalElements.modalCancel.parentNode.replaceChild(newCancel, modalElements.modalCancel);
    modalElements.modalCancel = newCancel;
    
    const newClose = modalElements.modalClose.cloneNode(true);
    modalElements.modalClose.parentNode.replaceChild(newClose, modalElements.modalClose);
    modalElements.modalClose = newClose;

    // Add new listeners
    modalElements.modalConfirm.addEventListener('click', () => {
        if (typeof onConfirm === 'function') onConfirm();
        hideModal();
    });

    modalElements.modalCancel.addEventListener('click', () => {
        if (typeof onCancel === 'function') onCancel();
        hideModal();
    });
    
    modalElements.modalClose.addEventListener('click', () => {
        if (typeof onCancel === 'function') onCancel();
        hideModal();
    });

    modalElements.confirmationModal.classList.add('active');
}

/** Hides the confirmation modal. */
export function hideModal() {
    const confirmationModal = document.getElementById('confirmationModal');
    if (confirmationModal) {
        confirmationModal.classList.remove('active');
    }
}

/**
 * Toggles the loading state of a button.
 * @param {HTMLElement} btn - The button element.
 * @param {boolean} isLoading - Whether to show the loading state.
 */
export function setLoadingState(btn, isLoading) {
    if (!btn) return;
    const text = btn.querySelector('.button-text');
    const spinner = btn.querySelector('.button-spinner');
    
    if (isLoading) {
        btn.disabled = true;
        if(text) text.classList.add('hidden');
        if(spinner) spinner.classList.remove('hidden');
    } else {
        btn.disabled = false;
        if(text) text.classList.remove('hidden');
        if(spinner) spinner.classList.add('hidden');
    }
}

/**
 * Formats a Firestore Timestamp or Date object to a time-ago string.
 * @param {Date | {toDate: function}} timestamp 
 * @returns {string}
 */
export function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Never';
    
    let date;
    if (typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
        date = timestamp;
    } else {
        return 'N/A';
    }

    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 10) return "Just now";
    let interval = Math.floor(seconds / 31536000);

    if (interval >= 1) { return interval + " year" + (interval === 1 ? "" : "s") + " ago"; }
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) { return interval + " month" + (interval === 1 ? "" : "s") + " ago"; }
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) { return interval + " day" + (interval === 1 ? "" : "s") + " ago"; }
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) { return interval + " hour" + (interval === 1 ? "" : "s") + " ago"; }
    interval = Math.floor(seconds / 60);
    if (interval >= 1) { return interval + " minute" + (interval === 1 ? "" : "s") + " ago"; }
    
    return Math.floor(seconds) + " seconds ago";
}

/**
 * Gets the appropriate Bootstrap icon class for a device type.
 * @param {string} type 
 * @returns {string}
 */
export function getDeviceIcon(type) {
    switch (type?.toLowerCase()) {
        case 'phone':
            return 'bi-phone';
        case 'laptop':
            return 'bi-laptop';
        case 'car':
            return 'bi-car-front-fill';
        case 'tablet':
            return 'bi-tablet';
        case 'watch':
            return 'bi-smartwatch';
        default:
            return 'bi-box';
    }
}

/**
 * Gets a color based on device status.
 * @param {string} status 
 * @returns {string} CSS color value
 */
export function getDeviceColor(status) {
    switch (status?.toLowerCase()) {
        case 'online':
            return 'var(--color-success)'; // Green
        case 'lost':
            return 'var(--color-danger)'; // Red
        case 'offline':
            return 'var(--color-danger)'; // Red
        case 'warning':
            return 'var(--color-warning)';
        default:
            return 'var(--color-text-secondary)';
    }
}

/**
 * Gets the appropriate Bootstrap icon class for battery level.
 * @param {number} level 
 * @returns {string}
 */
export function getBatteryIcon(level) {
    if (level === null || typeof level === 'undefined') return 'bi-battery';
    if (level > 85) return 'bi-battery-full';
    if (level > 60) return 'bi-battery-half';
    return 'bi-battery'; 
}

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds.
 * @param {function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {function} Returns the new debounced function.
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * SECURITY FIX: Simple HTML sanitizer to prevent XSS from user input.
 * @param {string} str The string to sanitize
 * @returns {string} The sanitized string
 */
export function sanitizeHTML(str) {
    if (!str) return '';
    return str.replace(/[<>&"']/g, function(match) {
        return {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&#39;'
        }[match];
    });
}

/**
 * Formats a timestamp into a full string like "Nov 18, 2025, 5:19:01 PM"
 * @param {Date | {toDate: function}} timestamp 
 * @returns {string}
 */
export function formatDateTime(timestamp) {
    if (!timestamp) return 'N/A';
    
    let date;
    if (typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
        date = timestamp;
    } else {
        return 'N/A';
    }

    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
    });
}
