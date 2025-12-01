// --- Trace'N Find Notifications Logic ---
// This file handles all logic *specific* to notifications.html.
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

import { 
    fbDB,
    collection, 
    onSnapshot, 
    query,
    doc,
    updateDoc,
    writeBatch,
    deleteDoc,
    orderBy,
    showToast,
    showModal,
    formatTimeAgo,
    sanitizeHTML
} from '/app/js/app-shell.js';

// --- Global State ---
let allNotifications = []; // Stores RAW list (including duplicates)
let notificationListener = null; // Unsubscribe function

// --- DOM Elements ---
const elements = {
    notificationList: document.getElementById('notification-list'),
    notificationListEmpty: document.getElementById('notification-list-empty'),
    markAllReadBtn: document.getElementById('mark-all-read-btn'),
    clearAllBtn: document.getElementById('clear-all-btn'),
    notificationBadge: document.getElementById('notificationBadge'), // Header badge
};

// --- Initialization ---
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId) {
            callback(window.currentUserId);
        } else {
            requestAnimationFrame(check);
        }
    };
    if (window.currentUserId) callback(window.currentUserId);
    else requestAnimationFrame(check);
}

waitForAuth((userId) => {
    setupEventListeners(userId);
    listenForNotifications(userId);
});

function setupEventListeners(userId) {
    if (elements.markAllReadBtn) {
        elements.markAllReadBtn.addEventListener('click', () => markAllAsRead(userId));
    }
    
    if (elements.clearAllBtn) {
        elements.clearAllBtn.addEventListener('click', () => clearAllNotifications(userId));
    }

    // Event delegation for "Mark as Read" buttons within the list
    if (elements.notificationList) {
        elements.notificationList.addEventListener('click', (e) => {
            const target = e.target.closest('.btn-mark-read');
            if (target) {
                const notificationId = target.dataset.id;
                markOneAsRead(notificationId, userId);
            }
        });
    }
}

// --- Firestore Data ---

function listenForNotifications(userId) {
    if (notificationListener) notificationListener();
    
    // Path: /user_data/{userId}/notifications
    const notificationsRef = collection(fbDB, 'user_data', userId, 'notifications');
    
    // Query: Order by 'timestamp' descending (newest first)
    const q = query(notificationsRef, orderBy('timestamp', 'desc'));

    notificationListener = onSnapshot(q, (snapshot) => {
        // Store ALL data (even duplicates) so we can manage them locally
        allNotifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        renderNotificationList();
        updateBadgeCount();
    }, (error) => {
        console.error("Error listening for notifications:", error);
        if (elements.notificationList) {
            elements.notificationList.innerHTML = `<div class="p-4 text-center text-danger">Error loading notifications.</div>`;
        }
    });
}

// --- Logic for Deduplication ---

/**
 * Filters the raw list to show only unique notifications.
 * It groups items that have the same type, title, message, and are close in time.
 * This fixes the issue of multiple tabs creating multiple entries.
 */
function getUniqueNotifications(notifications) {
    const unique = [];
    const seenSignatures = new Map(); // key: "type|title|msg", value: timestamp

    notifications.forEach(notification => {
        const timeMs = getTimestampMs(notification);
        // Signature defines "sameness"
        const signature = `${notification.type}|${notification.title}|${notification.message}`;
        
        if (seenSignatures.has(signature)) {
            const lastTime = seenSignatures.get(signature);
            const timeDiff = Math.abs(timeMs - lastTime);
            
            // If the same message appears within 10 seconds, treat it as a duplicate
            if (timeDiff < 10000) { 
                return; // Skip this one (it's a duplicate)
            }
        }

        // It's unique (or significantly later), so keep it
        seenSignatures.set(signature, timeMs);
        unique.push(notification);
    });

    return unique;
}

function getTimestampMs(notification) {
    if (notification.timestamp && typeof notification.timestamp.toMillis === 'function') {
        return notification.timestamp.toMillis();
    } else if (notification.time) {
        const d = new Date(notification.time);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    return 0;
}

// --- UI Rendering ---

function renderNotificationList() {
    if (!elements.notificationList) return;
    
    // Filter duplicates before rendering
    const uniqueNotifications = getUniqueNotifications(allNotifications);
    
    // Clear the current list content
    elements.notificationList.innerHTML = '';
    
    // If no notifications, re-append the empty state element and show it
    if (!uniqueNotifications || uniqueNotifications.length === 0) {
        if (elements.notificationListEmpty) {
            elements.notificationList.appendChild(elements.notificationListEmpty);
            elements.notificationListEmpty.style.display = 'block';
            elements.notificationListEmpty.classList.remove('hidden');
        }
        return;
    }
    
    // Hide empty state if we have data
    if (elements.notificationListEmpty) {
        elements.notificationListEmpty.style.display = 'none';
    }
    
    uniqueNotifications.forEach((notification, index) => {
        const item = document.createElement('div');
        const isUnread = notification.read === false;
        
        // Add styling classes
        item.className = `notification-list-item ${isUnread ? 'unread' : ''}`;
        item.style.animationDelay = `${index * 50}ms`; // Staggered animation for smoothness
        
        const icon = getNotificationIcon(notification.type);
        const color = getNotificationColor(notification.type);
        
        // Robust timestamp handling
        let timeVal = notification.timestamp || notification.time;
        let timeAgo = 'Just now';
        
        if (timeVal) {
             if (typeof timeVal.toDate === 'function') {
                 timeAgo = formatTimeAgo(timeVal.toDate());
             } else if (timeVal instanceof Date) {
                 timeAgo = formatTimeAgo(timeVal);
             } else if (typeof timeVal === 'string') {
                 const d = new Date(timeVal);
                 if(!isNaN(d)) timeAgo = formatTimeAgo(d);
             }
        }

        item.innerHTML = `
            ${isUnread ? '<div class="unread-dot" title="Unread"></div>' : ''}
            <div class="notification-icon-wrapper" style="background-color: ${color}20; color: ${color};">
                <i class="bi ${icon}"></i>
            </div>
            <div class="flex-1">
                <div class="font-semibold text-text-primary dark:text-dark-text-primary">${sanitizeHTML(notification.title || 'Notification')}</div>
                <div class="text-sm text-text-secondary dark:text-dark-text-secondary mt-1">${sanitizeHTML(notification.message || '')}</div>
                <div class="text-xs text-text-secondary dark:text-dark-text-secondary mt-2">${timeAgo}</div>
            </div>
            ${isUnread ? `
                <button class="btn btn-secondary btn-sm btn-mark-read" data-id="${notification.id}" title="Mark as Read">
                    <i class="bi bi-check-lg"></i>
                </button>
            ` : ''}
        `;
        elements.notificationList.appendChild(item);
    });
}

function updateBadgeCount() {
    if (!elements.notificationBadge) return;

    // Only count unread items that are VISIBLE (unique)
    // This ensures the badge matches the visual list, not the database count
    const uniqueList = getUniqueNotifications(allNotifications);
    const unreadCount = uniqueList.filter(n => n.read === false).length;
    
    if (unreadCount > 0) {
        elements.notificationBadge.textContent = unreadCount;
        elements.notificationBadge.classList.remove('hidden');
        elements.notificationBadge.classList.add('animate-pulse');
    } else {
        elements.notificationBadge.classList.add('hidden');
        elements.notificationBadge.classList.remove('animate-pulse');
    }
}

// --- Helper Functions (Icons & Colors) ---

function getNotificationIcon(type) {
    switch (type) {
        case 'security': return 'bi-shield-lock-fill';
        case 'geofence-enter': return 'bi-box-arrow-in-right';
        case 'geofence-exit': return 'bi-box-arrow-right';
        case 'low-battery': return 'bi-battery-half';
        case 'lost-mode': return 'bi-exclamation-diamond-fill';
        case 'success': return 'bi-check-circle-fill';
        case 'sim-alert': return 'bi-sd-card-fill';
        case 'tracking-start': return 'bi-play-circle-fill';
        case 'tracking-stop': return 'bi-stop-circle-fill';
        case 'message-received': return 'bi-chat-left-text-fill';
        case 'photo-received': return 'bi-camera-fill';
        default: return 'bi-bell-fill';
    }
}

function getNotificationColor(type) {
    switch (type) {
        case 'security':
        case 'lost-mode':
        case 'sim-alert': 
            return 'var(--color-danger)';
        case 'tracking-stop':
        case 'low-battery':
            return 'var(--color-warning)';
        case 'geofence-enter':
        case 'geofence-exit':
        case 'info':
            return 'var(--color-info)';
        case 'success':
        case 'tracking-start': 
        case 'message-received': 
        case 'photo-received':
            return 'var(--color-success)';
        default:
            return 'var(--color-primary)';
    }
}

// --- Actions ---

async function markOneAsRead(notificationId, userId) {
    // 1. Find the specific notification clicked
    const target = allNotifications.find(n => n.id === notificationId);
    if (!target) return;

    // 2. SMART MARKING: Find this notification AND all its duplicates (from other tabs)
    // This prevents "Whac-A-Mole" where you mark one read and a hidden duplicate pops up.
    const targetTime = getTimestampMs(target);
    const siblingsToMark = allNotifications.filter(n => {
        if (n.read) return false; // Already read
        
        // Check matching content
        const sameContent = (n.title === target.title && n.message === target.message && n.type === target.type);
        
        // Check matching time (10s window to catch all concurrent writes)
        const nTime = getTimestampMs(n);
        const closeTime = Math.abs(nTime - targetTime) < 10000;

        return sameContent && closeTime;
    });

    const batch = writeBatch(fbDB);
    siblingsToMark.forEach(n => {
        const docRef = doc(fbDB, 'user_data', userId, 'notifications', n.id);
        batch.update(docRef, { read: true });
    });

    try {
        await batch.commit();
        // No toast needed for simple read action usually
    } catch (error) {
        console.error("Error marking read:", error);
        showToast('Error', 'Could not update status.', 'error');
    }
}

async function markAllAsRead(userId) {
    const unread = allNotifications.filter(n => n.read === false);
    if (unread.length === 0) {
        showToast('Info', 'No unread notifications.', 'info');
        return;
    }

    const batch = writeBatch(fbDB);
    // Limit batch size to 500 (Firestore limit)
    const toUpdate = unread.slice(0, 500); 
    
    toUpdate.forEach(n => {
        const docRef = doc(fbDB, 'user_data', userId, 'notifications', n.id);
        batch.update(docRef, { read: true });
    });

    try {
        await batch.commit();
        showToast('Success', 'Marked all as read.', 'success');
    } catch (error) {
        console.error("Batch error:", error);
        showToast('Error', 'Could not mark all as read.', 'error');
    }
}

function clearAllNotifications(userId) {
    if (allNotifications.length === 0) {
        showToast('Info', 'Notification list is already empty.', 'info');
        return;
    }

    showModal(
        'Clear Notifications?',
        'This will permanently delete all your notifications history.',
        'danger',
        async () => {
            const batch = writeBatch(fbDB);
            // Delete everything in the raw list (including duplicates)
            const toDelete = allNotifications.slice(0, 500);
            
            toDelete.forEach(n => {
                const docRef = doc(fbDB, 'user_data', userId, 'notifications', n.id);
                batch.delete(docRef);
            });
            
            try {
                await batch.commit();
                showToast('Cleared', 'All notifications deleted.', 'success');
            } catch (error) {
                console.error("Batch delete error:", error);
                showToast('Error', 'Failed to clear history.', 'error');
            }
        }
    );
}