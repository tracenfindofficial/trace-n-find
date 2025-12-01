// --- Trace'N Find Device Overview Logic ---
// This file handles all logic *specific* to admin/devices.html.
// It assumes `admin-app-shell.js` has already been loaded and has authenticated the user.

import { 
    fbDB,
    collection, 
    onSnapshot, 
    query,
    doc,
    getDoc,
    getDocs,
    showToast,
    showModal,
    collectionGroup,
    orderBy
} from './admin-app-shell.js';

// --- Global State ---
let allDevices = [];
let userProfiles = new Map(); // Cache for user profiles
let deviceListener = null;

// --- DOM Elements ---
const elements = {
    devicesTableBody: document.getElementById('devices-table-body'),
    devicesEmptyState: document.getElementById('devices-empty-state'),
    devicesLoadingState: document.getElementById('devices-loading-state'),
    searchInput: document.getElementById('device-search-input'),
    totalDeviceCount: document.getElementById('total-device-count'),
};

// --- Initialization ---
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserIsAdmin) {
            console.log("Device Overview Logic: Auth is ready.");
            callback(window.currentUserId);
        } else {
            console.log("Device Overview logic waiting for admin authentication...");
            requestAnimationFrame(check);
        }
    };
    requestAnimationFrame(check);
}

waitForAuth((adminId) => {
    listenForAllDevices();
    setupEventListeners();
});

/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners() {
    elements.searchInput.addEventListener('input', (e) => {
        renderDeviceList(allDevices, e.target.value.toLowerCase());
    });

    // Event delegation for action buttons
    elements.devicesTableBody.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const deviceId = target.dataset.id;
        const userId = target.dataset.user;

        if (target.matches('.btn-delete-device')) {
            handleDeleteDevice(deviceId, userId);
        }
        // TODO: Add view device details logic
    });
}

// --- Firestore Data ---

/**
 * Sets up a real-time listener for ALL devices from ALL users.
 * Uses a collectionGroup query for scalability.
 */
function listenForAllDevices() {
    setLoadingState(true);
    
    const devicesRef = collectionGroup(fbDB, 'devices');
    const q = query(devicesRef, orderBy('lastSeen', 'desc'));

    if (deviceListener) deviceListener();

    deviceListener = onSnapshot(q, async (snapshot) => {
        setLoadingState(false);
        elements.totalDeviceCount.textContent = snapshot.size;

        if (snapshot.empty) {
            elements.devicesEmptyState.style.display = 'table-row';
            elements.devicesTableBody.innerHTML = ''; // Clear
            elements.devicesTableBody.appendChild(elements.devicesEmptyState);
            return;
        }

        // Get all unique user IDs from the devices
        const userIds = new Set(snapshot.docs.map(doc => doc.ref.parent.parent.id));
        
        // Fetch any user profiles we don't have cached
        const profilePromises = [];
        userIds.forEach(id => {
            if (!userProfiles.has(id)) {
                profilePromises.push(fetchUserProfile(id));
            }
        });
        await Promise.all(profilePromises);

        // Now that profiles are cached, map the device data
        allDevices = snapshot.docs.map(doc => {
            const device = doc.data();
            const userId = doc.ref.parent.parent.id;
            const owner = userProfiles.get(userId) || { fullName: 'Unknown User' };
            return {
                id: doc.id,
                ...device,
                userId: userId,
                ownerName: owner.fullName,
            };
        });

        renderDeviceList(allDevices, elements.searchInput.value.toLowerCase());

    }, (error) => {
        console.error("Error listening for all devices:", error);
        showToast('Error', 'Could not load device data.', 'error');
        setLoadingState(false);
        elements.devicesEmptyState.style.display = 'table-row';
    });
}

/**
 * Helper to fetch and cache a single user's profile information.
 * @param {string} userId - The ID of the user.
 */
async function fetchUserProfile(userId) {
    if (userProfiles.has(userId)) return userProfiles.get(userId);

    try {
        const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
        const profileSnap = await getDoc(profileRef);

        if (profileSnap.exists()) {
            const profile = profileSnap.data();
            userProfiles.set(userId, profile);
            return profile;
        } else {
            const defaultProfile = { fullName: 'New User', email: 'N/A' };
            userProfiles.set(userId, defaultProfile);
            return defaultProfile;
        }
    } catch (error) {
        console.warn("Could not fetch profile for user:", userId, error);
        const errorProfile = { fullName: 'Error Loading' };
        userProfiles.set(userId, errorProfile);
        return errorProfile;
    }
}


// --- UI Rendering ---

/**
 * Renders the list of devices into the table, applying any filters.
 * @param {Array} devices - The complete list of device objects.
 * @param {string} filterText - The text to filter by.
 */
function renderDeviceList(devices, filterText) {
    elements.devicesTableBody.innerHTML = ''; // Clear list
    
    const filteredDevices = devices.filter(device => 
        device.name.toLowerCase().includes(filterText) ||
        device.model.toLowerCase().includes(filterText) ||
        device.ownerName.toLowerCase().includes(filterText)
    );

    if (filteredDevices.length === 0) {
        elements.devicesEmptyState.style.display = 'table-row';
        elements.devicesTableBody.appendChild(elements.devicesEmptyState);
        return;
    }
    
    elements.devicesEmptyState.style.display = 'none';

    filteredDevices.forEach(device => {
        const tr = document.createElement('tr');
        tr.className = 'animate-fade-in';
        
        const { iconClass, colorClass, statusText } = getDeviceStatus(device);
        const lastSeen = device.lastSeen?.toDate ? device.lastSeen.toDate().toLocaleString() : 'Never';

        tr.innerHTML = `
            <!-- Device Column -->
            <td>
                <div class="flex items-center gap-3">
                    <i class="bi ${iconClass} text-2xl" style="color: ${colorClass};"></i>
                    <div class="flex-1 overflow-hidden">
                        <div class="font-medium text-text-primary dark:text-dark-text-primary truncate">${device.name}</div>
                        <div class="text-sm text-text-secondary dark:text-dark-text-secondary truncate">${device.model}</div>
                    </div>
                </div>
            </td>
            <!-- Owner Column -->
            <td class="text-sm text-text-secondary dark:text-dark-text-secondary">
                <div class="font-medium text-text-primary dark:text-dark-text-primary truncate">${device.ownerName}</div>
                <div class="text-xs font-mono">${device.userId}</div>
            </td>
            <!-- Status Column -->
            <td>
                <span class="badge ${colorClass.includes('danger') ? 'badge-danger' : (colorClass.includes('warning') ? 'badge-warning' : 'badge-success')}">
                    ${statusText}
                </span>
            </td>
            <!-- Last Seen Column -->
            <td class="text-sm text-text-secondary dark:text-dark-text-secondary">${lastSeen}</td>
            <!-- Actions Column -->
            <td>
                <div class="flex gap-2">
                    <button class="btn btn-secondary btn-sm btn-view-device" data-id="${device.id}" data-user="${device.userId}" title="View Details">
                        <i class="bi bi-eye-fill"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-delete-device" data-id="${device.id}" data-user="${device.userId}" title="Delete Device">
                        <i class="bi bi-trash-fill text-danger"></i>
                    </button>
                </div>
            </td>
        `;
        elements.devicesTableBody.appendChild(tr);
    });
}

/**
 * Shows or hides the table loading state.
 * @param {boolean} isLoading - True to show loading, false to hide.
 */
function setLoadingState(isLoading) {
    if (isLoading) {
        elements.devicesTableBody.innerHTML = '';
        elements.devicesLoadingState.style.display = 'table-row';
        elements.devicesEmptyState.style.display = 'none';
    } else {
        elements.devicesLoadingState.style.display = 'none';
    }
}

/**
 * Gets the icon, color, and text for a device's status.
 * @param {object} device - The device object.
 * @returns {object} { iconClass, colorClass, statusText }
 */
function getDeviceStatus(device) {
    const typeIcon = {
        'Phone': 'bi-phone-fill',
        'Tablet': 'bi-tablet-landscape-fill',
        'Laptop': 'bi-laptop-fill',
        'Watch': 'bi-smartwatch',
    }[device.type] || 'bi-question-circle-fill';

    let colorClass = 'var(--color-success)';
    let statusText = 'Online';

    switch (device.status) {
        case 'offline':
            colorClass = 'var(--color-warning)';
            statusText = 'Offline';
            break;
        case 'lost':
            colorClass = 'var(--color-danger)';
            statusText = 'Lost Mode';
            break;
    }
    
    return { iconClass: typeIcon, colorClass, statusText };
}

// --- Core Logic ---

/**
 * Handles deleting a device.
 * @param {string} deviceId - The ID of the device to delete.
 * @param {string} userId - The ID of the device's owner.
 */
function handleDeleteDevice(deviceId, userId) {
    const device = allDevices.find(d => d.id === deviceId);
    const deviceName = device ? device.name : 'this device';

    showModal(
        true,
        'Delete Device?',
        `Are you sure you want to permanently delete <strong>${deviceName}</strong>? This will remove it from the user's account. This action cannot be undone.`,
        'Delete Device',
        'btn-danger',
        () => {
            // Confirm callback
            // SCALABILITY/SECURITY: This MUST be a Cloud Function.
            // An admin should not have direct write access to a user's subcollection.
            console.log(`Requesting deletion for device: ${deviceId} from user ${userId} (via Cloud Function)`);
            showToast(
                'Deletion Requested',
                `A request to delete ${deviceName} has been sent. This must be handled by a secure server function.`,
                'info'
            );
            // In a real app:
            // const deleteDevice = httpsCallable(fbFunctions, 'adminDeleteDevice');
            // await deleteDevice({ uid: userId, deviceId: deviceId });
            // The onSnapshot listener would then automatically remove the device from the list.
        }
    );
}