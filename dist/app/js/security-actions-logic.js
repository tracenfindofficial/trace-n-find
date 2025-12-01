// --- Trace'N Find Security Actions Logic ---

import { 
    fbDB,
    appState, 
    doc,
    collection, 
    query,      
    orderBy,    
    getDocs,    
    writeBatch,
    serverTimestamp,
    showToast,
    showModal,
    getDeviceIcon,
    getDeviceColor,
    formatDateTime,
    addDoc, 
    SECURITY_BUTTONS,
    // NEW: Imports for notification logic
    where,
    onSnapshot
} from '/app/js/app-shell.js';

// --- Global State ---
let allDevices = [];
let selectedDeviceIds = new Set();

// Browsing State for Modals
let photoList = [];
let photoIndex = 0;
let messageList = [];
let messageIndex = 0;

// --- DOM Elements ---
const elements = {
    deviceList: document.getElementById('device-list'),
    deviceListEmpty: document.getElementById('device-list-empty'),
    selectAllCheckbox: document.getElementById('select-all'),
    selectedCount: document.getElementById('selected-count'),
    
    // Notification Badge
    notificationBadge: document.getElementById('notificationBadge'),

    actionButtons: {
        ring: document.getElementById('action-ring'),
        viewPhotos: document.getElementById('action-view-photos'),
        viewMessages: document.getElementById('action-view-messages'),
        lost: document.getElementById('action-lost'),
    },

    // Photo Modal Elements
    photoModal: document.getElementById('viewPhotoModal'),
    photoImg: document.getElementById('finderPhotoImg'),
    photoPlaceholder: document.getElementById('photoPlaceholder'),
    photoTimestamp: document.getElementById('photoTimestamp'),
    photoIndexIndicator: document.getElementById('photoIndexIndicator'),
    btnPrevPhoto: document.getElementById('prevPhotoBtn'),
    btnNextPhoto: document.getElementById('nextPhotoBtn'),
    photoCloseBtns: [document.getElementById('viewPhotoClose'), document.getElementById('viewPhotoDone')],

    // Message Modal Elements
    msgModal: document.getElementById('viewMessageModal'),
    msgText: document.getElementById('finderMessageText'),
    msgPlaceholder: document.getElementById('msgPlaceholder'),
    msgTimestamp: document.getElementById('msgTimestamp'),
    msgIndexIndicator: document.getElementById('msgIndexIndicator'),
    btnPrevMsg: document.getElementById('prevMsgBtn'),
    btnNextMsg: document.getElementById('nextMsgBtn'),
    msgCloseBtns: [document.getElementById('viewMsgClose'), document.getElementById('viewMsgDone')]
};

// --- Initialization ---

function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId) callback(window.currentUserId);
        else requestAnimationFrame(check);
    };
    check();
}

waitForAuth((userId) => {
    init(userId);
});

function init(userId) {
    // 1. Inject Buttons
    const container = document.getElementById('security-buttons-container');
    if (container && SECURITY_BUTTONS) {
        container.innerHTML = SECURITY_BUTTONS.map(btn => `
            <button id="${btn.id}" class="action-card ${btn.type}" disabled>
                <i class="bi ${btn.icon}"></i>
                <span>${btn.label}</span>
            </button>
        `).join('');
        
        // 2. Re-bind cache AFTER injection
        elements.actionButtons.ring = document.getElementById('action-ring');
        elements.actionButtons.viewPhotos = document.getElementById('action-view-photos');
        elements.actionButtons.viewMessages = document.getElementById('action-view-messages');
        elements.actionButtons.lost = document.getElementById('action-lost');
    }

    // 3. Load Data
    window.addEventListener('devicesLoaded', (e) => {
        handleDevicesLoaded(e.detail);
    });

    if (appState && appState.userDevices && appState.userDevices.length > 0) {
        handleDevicesLoaded(appState.userDevices);
    } else {
        if(elements.deviceListEmpty) elements.deviceListEmpty.classList.remove('hidden');
    }

    updateSelectionState();
    setupEventListeners(userId);
    listenForUnreadNotifications(userId);
}

// --- Notification Logic ---
function listenForUnreadNotifications(userId) {
    const notifsRef = collection(fbDB, 'user_data', userId, 'notifications');
    
    // Query specifically for unread items to get an accurate count
    const q = query(notifsRef, where("read", "==", false));

    onSnapshot(q, (snapshot) => {
        updateBadgeCount(snapshot.size);
    }, (error) => {
        console.error("Error listening for unread count:", error);
    });
}

function updateBadgeCount(count) {
    const badge = elements.notificationBadge;
    if (!badge) return;

    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
        badge.classList.add('animate-pulse');
    } else {
        badge.classList.add('hidden');
        badge.classList.remove('animate-pulse');
    }
}

function setupEventListeners(userId) {
    elements.selectAllCheckbox.addEventListener('change', (e) => {
        selectedDeviceIds.clear();
        if (e.target.checked) {
            allDevices.forEach(device => selectedDeviceIds.add(device.id));
        }
        renderDeviceList();
        updateSelectionState();
    });

    elements.deviceList.addEventListener('change', (e) => {
        if (e.target.matches('.device-checkbox')) {
            const deviceId = e.target.dataset.id;
            if (e.target.checked) selectedDeviceIds.add(deviceId);
            else selectedDeviceIds.delete(deviceId);
            updateSelectionState();
        }
    });

    if (elements.actionButtons.ring) {
        elements.actionButtons.ring.addEventListener('click', () => handleSecurityAction('ring'));
    }
    
    if (elements.actionButtons.lost) {
        elements.actionButtons.lost.addEventListener('click', () => {
            const action = elements.actionButtons.lost.dataset.currentAction || 'lost';
            handleSecurityAction(action);
        });
    }
    
    // View Handlers
    if (elements.actionButtons.viewPhotos) elements.actionButtons.viewPhotos.addEventListener('click', loadAndShowPhotos);
    if (elements.actionButtons.viewMessages) elements.actionButtons.viewMessages.addEventListener('click', loadAndShowMessages);

    // Modal Navigation
    if(elements.btnPrevPhoto) elements.btnPrevPhoto.addEventListener('click', () => changePhoto(-1));
    if(elements.btnNextPhoto) elements.btnNextPhoto.addEventListener('click', () => changePhoto(1));
    if(elements.btnPrevMsg) elements.btnPrevMsg.addEventListener('click', () => changeMessage(-1));
    if(elements.btnNextMsg) elements.btnNextMsg.addEventListener('click', () => changeMessage(1));

    // Close Handlers
    elements.photoCloseBtns.forEach(btn => btn?.addEventListener('click', () => elements.photoModal.classList.remove('active')));
    elements.msgCloseBtns.forEach(btn => btn?.addEventListener('click', () => elements.msgModal.classList.remove('active')));
}

function handleDevicesLoaded(devices) {
    allDevices = devices || [];
    const allDeviceIds = new Set(allDevices.map(d => d.id));
    selectedDeviceIds.forEach(id => {
        if (!allDeviceIds.has(id)) selectedDeviceIds.delete(id);
    });
    renderDeviceList();
    updateSelectionState();
}

// --- UI Rendering ---

function renderDeviceList() {
    elements.deviceList.innerHTML = '';
    
    if (!allDevices || allDevices.length === 0) {
        if(elements.deviceListEmpty) elements.deviceListEmpty.classList.remove('hidden');
        return;
    }
    
    if(elements.deviceListEmpty) elements.deviceListEmpty.classList.add('hidden');
    
    allDevices.forEach((device, index) => {
        const item = document.createElement('div');
        item.className = 'device-list-item';
        item.style.animationDelay = `${index * 50}ms`;
        
        const isChecked = selectedDeviceIds.has(device.id);
        const statusColor = getDeviceColor(device.status);
        const statusText = device.status ? device.status.charAt(0).toUpperCase() + device.status.slice(1) : 'Unknown';
        const iconClass = getDeviceIcon(device.type || 'phone'); 

        item.innerHTML = `
            <input type="checkbox" id="device-${device.id}" data-id="${device.id}" class="device-checkbox h-5 w-5 text-primary rounded border-gray-300 focus:ring-primary cursor-pointer" ${isChecked ? 'checked' : ''}>
            
            <label for="device-${device.id}" class="device-icon-wrapper flex items-center justify-center rounded-lg cursor-pointer flex-shrink-0" style="width: 40px; height: 40px; background-color: ${statusColor}20; margin-left: 12px;">
                <i class="bi ${iconClass}" style="color: ${statusColor}; font-size: 1.25rem;"></i>
            </label>
            
            <label for="device-${device.id}" class="flex-1 ml-4 cursor-pointer">
                <div class="font-semibold text-text-primary dark:text-dark-text-primary">${device.name}</div>
                ${device.model ? `<div class="text-sm text-text-secondary dark:text-dark-text-secondary">${device.model}</div>` : ''}
            </label>
            
            <div class="text-sm font-medium" style="color: ${statusColor};">
                ${statusText}
            </div>
        `;
        elements.deviceList.appendChild(item);
    });
}

function updateSelectionState() {
    const count = selectedDeviceIds.size;
    
    if (count === 0) elements.selectedCount.textContent = '0 devices selected';
    else if (count === 1) elements.selectedCount.textContent = '1 device selected';
    else elements.selectedCount.textContent = `${count} devices selected`;
    
    if (allDevices.length > 0) {
        elements.selectAllCheckbox.checked = count === allDevices.length;
        elements.selectAllCheckbox.indeterminate = count > 0 && count < allDevices.length;
    } else {
        elements.selectAllCheckbox.checked = false;
        elements.selectAllCheckbox.indeterminate = false;
    }

    const selectedDevices = allDevices.filter(d => selectedDeviceIds.has(d.id));
    
    // Button state logic
    const areAnyOffline = selectedDevices.some(device => device.status === 'offline');
    if (elements.actionButtons.ring) elements.actionButtons.ring.disabled = count === 0 || areAnyOffline;
    
    const isSingleSelection = count === 1;
    if (elements.actionButtons.viewPhotos) elements.actionButtons.viewPhotos.disabled = !isSingleSelection;
    if (elements.actionButtons.viewMessages) elements.actionButtons.viewMessages.disabled = !isSingleSelection;

    const lostBtn = elements.actionButtons.lost;
    if (lostBtn) {
        lostBtn.disabled = count === 0;

        if (count > 0) {
            const allAreLost = selectedDevices.every(d => d.status === 'lost');
            
            if (allAreLost) {
                lostBtn.dataset.currentAction = 'found';
                lostBtn.classList.remove('danger');
                lostBtn.classList.add('success');
                lostBtn.innerHTML = `<i class="bi bi-check-circle-fill"></i><span>Mark as Found</span>`;
            } else {
                lostBtn.dataset.currentAction = 'lost';
                lostBtn.classList.remove('success');
                lostBtn.classList.add('danger');
                lostBtn.innerHTML = `<i class="bi bi-exclamation-diamond-fill"></i><span>Mark as Lost</span>`;
            }
        }
    }
}

// --- Action Execution ---

async function handleSecurityAction(action) {
    const count = selectedDeviceIds.size;
    if (count === 0) return;

    const firstId = selectedDeviceIds.values().next().value;
    const firstDevice = allDevices.find(d => d.id === firstId);
    const deviceNameDisplay = count === 1 ? `<strong>${firstDevice ? firstDevice.name : 'Device'}</strong>` : `<strong>${count} devices</strong>`;

    const actionMap = {
        'ring': { title: 'Sound Alarm?', message: `Sound an alarm on ${deviceNameDisplay}?`, btn: 'Alarm', type: 'info' },
        'lost': { title: 'Mark as Lost?', message: `Enable tracking and lock ${deviceNameDisplay}?`, btn: 'Mark Lost', type: 'danger' },
        'found': { title: 'Mark as Found?', message: `Restore normal status for ${deviceNameDisplay}?`, btn: 'Mark Found', type: 'success' },
        'wipe': { title: 'Wipe Devices?', message: `PERMANENTLY erase all data on ${deviceNameDisplay}? This action cannot be undone.`, btn: 'Erase Data', type: 'danger' }
    };
    
    const config = actionMap[action];
    if (!config) return;

    showModal(
        config.title,
        config.message,
        config.type, 
        async () => { 
            let payload = {};
            if (action === 'lost' || action === 'found') {
                payload = { status: (action === 'lost' ? 'lost' : 'online') };
            } else {
                payload = { pending_action: action };
            }
            await executeBatchAction(action, payload, count, firstDevice?.name || 'Device');
        },
        null, 
        { isHTML: true }
    );
}

async function executeBatchAction(actionName, dataPayload, count, singleDeviceName) {
    const batch = writeBatch(fbDB);
    const userId = window.currentUserId;
    const activityPromises = []; // Array to hold promises for creating activity logs

    selectedDeviceIds.forEach(deviceId => {
        // 1. Update Device Document
        const docRef = doc(fbDB, 'user_data', userId, 'devices', deviceId);
        const finalUpdate = {
            ...dataPayload,
            action_timestamp: serverTimestamp()
        };
        batch.update(docRef, finalUpdate);

        // 2. Create Activity Log (FIX: This ensures it shows on Device Details page)
        const activityRef = collection(fbDB, 'user_data', userId, 'devices', deviceId, 'activity');
        
        let activityType = 'info';
        let activityMsg = `Command '${actionName}' executed.`;

        // Map action to UI-friendly message/type
        if (actionName === 'ring') { 
            activityType = 'warning'; 
            activityMsg = 'Remote alarm triggered manually.'; 
        } else if (actionName === 'lost') { 
            activityType = 'lost-mode'; 
            activityMsg = 'Device marked as Lost.'; 
        } else if (actionName === 'found') { 
            activityType = 'security'; 
            activityMsg = 'Device marked as Found.'; 
        } else if (actionName === 'wipe') { 
            activityType = 'security'; 
            activityMsg = 'Remote wipe command sent.'; 
        } else if (actionName === 'lock') { 
            activityType = 'security'; 
            activityMsg = 'Remote lock command sent.'; 
        }

        // We assume adding a doc doesn't need to be atomic with the batch for UX purposes,
        // but `addDoc` is asynchronous, so we push it to an array.
        activityPromises.push(addDoc(activityRef, {
            type: activityType,
            message: activityMsg,
            timestamp: serverTimestamp()
        }));
    });

    try {
        await batch.commit(); // Commit the device updates
        await Promise.all(activityPromises); // Wait for activity logs to be written
        
        // 3. Create Global Notification (existing logic)
        const notifRef = collection(fbDB, 'user_data', userId, 'notifications');
        
        let title = "Security Action";
        let message = `Command "${actionName}" sent successfully.`;
        let type = "security";
        
        if (actionName === 'ring') {
            title = "Alarm Triggered";
            message = `Alarm sound sent to ${count > 1 ? count + ' devices' : singleDeviceName}.`;
            type = "security";
        } else if (actionName === 'lost') {
            title = "Lost Mode Active";
            message = `${count > 1 ? count + ' devices marked' : singleDeviceName + ' marked'} as Lost.`;
            type = "lost-mode";
        } else if (actionName === 'found') {
            title = "Device Recovered";
            message = `${count > 1 ? count + ' devices marked' : singleDeviceName + ' marked'} as Found.`;
            type = "success";
        } else if (actionName === 'wipe') {
            title = "Wipe Initiated";
            message = `Wipe command sent to ${count > 1 ? count + ' devices' : singleDeviceName}.`;
            type = "danger";
        }
        
        await addDoc(notifRef, {
            title: title,
            message: message,
            type: type,
            read: false,
            timestamp: serverTimestamp()
        });
        
        showToast('Success', 'Command sent and logged.', 'success');
        
        if (actionName === 'wipe') {
            selectedDeviceIds.clear();
            renderDeviceList();
            updateSelectionState();
        }
    } catch (error) {
        console.error("Error executing action:", error);
        showToast('Error', 'Could not send command.', 'error');
    }
}

// --- Logic for Viewing Photos & Messages (kept from original) ---

async function loadAndShowPhotos() {
    if (selectedDeviceIds.size !== 1) return;
    const deviceId = selectedDeviceIds.values().next().value;
    const device = allDevices.find(d => d.id === deviceId);
    const userId = window.currentUserId;

    // Reset State
    photoList = [];
    photoIndex = 0;
    
    // 1. Add Current (Latest) Photo from device document if it exists
    if (device.finder_photo_url) {
        photoList.push({
            url: device.finder_photo_url,
            time: device.finder_data_timestamp ? device.finder_data_timestamp.toDate() : new Date(),
            id: 'latest'
        });
    }

    // 2. Fetch History from 'evidence_logs'
    try {
        const logsRef = collection(fbDB, 'user_data', userId, 'devices', deviceId, 'evidence_logs');
        const q = query(logsRef, orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.photo_url && data.photo_url !== device.finder_photo_url) {
                photoList.push({
                    url: data.photo_url,
                    time: data.timestamp ? data.timestamp.toDate() : new Date(),
                    id: doc.id
                });
            }
        });

        updatePhotoModalUI();
        elements.photoModal.classList.add('active');

    } catch (e) {
        console.error("Error loading photo history:", e);
        showToast("Error", "Could not load history. Showing latest only.", "warning");
        updatePhotoModalUI();
        elements.photoModal.classList.add('active');
    }
}

function updatePhotoModalUI() {
    if (photoList.length > 0) {
        const item = photoList[photoIndex];
        elements.photoImg.src = item.url;
        elements.photoImg.classList.remove('hidden');
        elements.photoPlaceholder.classList.add('hidden');
        
        elements.photoTimestamp.textContent = `Captured: ${formatDateTime(item.time)}`;
        elements.photoIndexIndicator.textContent = `${photoIndex + 1} / ${photoList.length}`;
        
        elements.btnPrevPhoto.disabled = (photoIndex === 0);
        elements.btnNextPhoto.disabled = (photoIndex === photoList.length - 1);
        elements.btnPrevPhoto.style.opacity = (photoIndex === 0) ? '0' : '1';
        elements.btnNextPhoto.style.opacity = (photoIndex === photoList.length - 1) ? '0' : '1';

    } else {
        elements.photoImg.classList.add('hidden');
        elements.photoPlaceholder.classList.remove('hidden');
        elements.photoTimestamp.textContent = "No photos available";
        elements.photoIndexIndicator.textContent = "";
        elements.btnPrevPhoto.disabled = true;
        elements.btnNextPhoto.disabled = true;
    }
}

function changePhoto(dir) {
    if (dir === -1 && photoIndex > 0) photoIndex--;
    if (dir === 1 && photoIndex < photoList.length - 1) photoIndex++;
    updatePhotoModalUI();
}

async function loadAndShowMessages() {
    if (selectedDeviceIds.size !== 1) return;
    const deviceId = selectedDeviceIds.values().next().value;
    const device = allDevices.find(d => d.id === deviceId);
    const userId = window.currentUserId;

    messageList = [];
    messageIndex = 0;

    // 1. Add Current (Latest) Message
    if (device.finder_message) {
        messageList.push({
            text: device.finder_message,
            time: device.finder_data_timestamp ? device.finder_data_timestamp.toDate() : new Date(),
            id: 'latest'
        });
    }

    // 2. Fetch History from 'evidence_logs'
    try {
        const logsRef = collection(fbDB, 'user_data', userId, 'devices', deviceId, 'evidence_logs');
        const q = query(logsRef, orderBy('timestamp', 'desc'));
        const snapshot = await getDocs(q);

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.message) {
                 const msgContent = data.message;
                 if (msgContent !== device.finder_message) { 
                    messageList.push({
                        text: msgContent,
                        time: data.timestamp ? data.timestamp.toDate() : new Date(),
                        id: doc.id
                    });
                 }
            }
        });

        updateMessageModalUI();
        elements.msgModal.classList.add('active');
    } catch (e) {
        console.error("Error loading messages:", e);
        updateMessageModalUI();
        elements.msgModal.classList.add('active');
    }
}

function updateMessageModalUI() {
    if (messageList.length > 0) {
        const item = messageList[messageIndex];
        elements.msgText.textContent = `"${item.text}"`;
        elements.msgText.classList.remove('hidden');
        if(elements.msgPlaceholder) elements.msgPlaceholder.classList.add('hidden');
        
        elements.msgTimestamp.textContent = `Received: ${formatDateTime(item.time)}`;
        elements.msgIndexIndicator.textContent = `${messageIndex + 1} / ${messageList.length}`;

        elements.btnPrevMsg.disabled = (messageIndex === 0);
        elements.btnNextMsg.disabled = (messageIndex === messageList.length - 1);
    } else {
        elements.msgText.classList.add('hidden');
        if(elements.msgPlaceholder) elements.msgPlaceholder.classList.remove('hidden');
        elements.msgTimestamp.textContent = "No messages available";
        elements.msgIndexIndicator.textContent = "";
    }
}

function changeMessage(dir) {
    if (dir === -1 && messageIndex > 0) messageIndex--;
    if (dir === 1 && messageIndex < messageList.length - 1) messageIndex++;
    updateMessageModalUI();
}