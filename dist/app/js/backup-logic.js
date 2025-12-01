// --- Trace'N Find Backup & Restore Logic ---
// This file handles all logic *specific* to backup.html.

import { 
    fbDB,
    collection, 
    onSnapshot, 
    query,
    doc,
    getDocs,
    getDoc, 
    addDoc,
    deleteDoc,
    setDoc, 
    updateDoc, 
    writeBatch,
    serverTimestamp,
    orderBy,
    showToast,
    showModal,
    setLoadingState,
    where
} from '/app/js/app-shell.js';

// --- Global State for this Page ---
let allBackups = [];
let backupListener = null;

// --- DOM Elements ---
const elements = {
    createBackupBtn: document.getElementById('create-backup-btn'),
    uploadBackupLabel: document.getElementById('upload-backup-label'),
    uploadBackupInput: document.getElementById('upload-backup-input'),
    backupList: document.getElementById('backup-list'),
    backupListEmpty: document.getElementById('backup-list-empty'),
    notificationBadge: document.getElementById('notificationBadge'),
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
    if (window.currentUserId) {
        callback(window.currentUserId);
    } else {
        requestAnimationFrame(check);
    }
}

waitForAuth((userId) => {
    setupEventListeners(userId);
    listenForBackups(userId);
    listenForUnreadNotifications(userId);
});

function setupEventListeners(userId) {
    if (elements.createBackupBtn) {
        elements.createBackupBtn.addEventListener('click', () => createBackup(userId));
    }
    
    if (elements.uploadBackupInput) {
        elements.uploadBackupInput.addEventListener('change', (e) => handleRestoreUpload(e, userId));
    }

    // Event delegation for list buttons
    if (elements.backupList) {
        elements.backupList.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;

            const backupId = target.dataset.id;
            if (target.matches('.btn-restore')) {
                handleRestore(backupId, userId);
            } else if (target.matches('.btn-download')) {
                handleDownload(backupId);
            } else if (target.matches('.btn-delete')) {
                handleDelete(backupId, userId);
            }
        });
    }
}

// --- Notification Logic ---
function listenForUnreadNotifications(userId) {
    const notifsRef = collection(fbDB, 'user_data', userId, 'notifications');
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

// --- Firestore Data ---

function listenForBackups(userId) {
    if (backupListener) backupListener();
    
    const backupsRef = collection(fbDB, 'user_data', userId, 'backups');
    const q = query(backupsRef, orderBy('createdAt', 'desc'));

    backupListener = onSnapshot(q, (snapshot) => {
        allBackups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderBackupList();
    }, (error) => {
        console.error("Error listening for backups:", error);
        showToast('Error', 'Could not load backup history.', 'error');
        if(elements.backupListEmpty) elements.backupListEmpty.style.display = 'block';
    });
}

// --- UI Rendering ---

function renderBackupList() {
    if (!elements.backupList) return;
    elements.backupList.innerHTML = '';
    
    if (!allBackups || allBackups.length === 0) {
        elements.backupList.appendChild(elements.backupListEmpty);
        elements.backupListEmpty.style.display = 'block';
        return;
    }
    
    elements.backupListEmpty.style.display = 'none';
    
    allBackups.forEach((backup, index) => {
        const item = document.createElement('div');
        item.className = 'backup-list-item';
        item.style.animationDelay = `${index * 30}ms`;
        
        const backupDate = backup.createdAt?.toDate() ? backup.createdAt.toDate().toLocaleString() : 'Just now';
        
        // Data indicators
        const hasProfile = backup.hasProfile;
        const type = backup.type || 'full'; 
        
        let detailsText = "";
        let iconClass = "bi-hdd-network"; 

        if (type === 'contact_only') {
            // New Contact Only Backup
            detailsText = `<span class="text-success font-medium"><i class="bi bi-person-check-fill"></i> Contact Information Only</span>`;
            iconClass = "bi-person-rolodex";
        } else {
            // Legacy/Full Backup
            const deviceCount = backup.deviceCount || 0;
            const geofenceCount = backup.geofenceCount || 0;
            detailsText = `<span class="text-text-secondary">${deviceCount} devices, ${geofenceCount} geofences</span>`;
            if (hasProfile) detailsText += ` <span class="text-success text-xs mx-1">• Profile</span>`;
        }

        item.innerHTML = `
            <div class="backup-icon-wrapper">
                <i class="bi ${iconClass}"></i>
            </div>
            <div class="flex-1">
                <div class="font-semibold text-text-primary dark:text-dark-text-primary">Snapshot - ${backupDate}</div>
                <div class="text-sm text-text-secondary dark:text-dark-text-secondary mt-0.5">${detailsText}</div>
            </div>
            <div class="flex flex-col sm:flex-row gap-2">
                <button class="btn btn-sm btn-secondary btn-restore" data-id="${backup.id}" title="Restore">
                    <i class="bi bi-arrow-counterclockwise mr-1"></i> Restore
                </button>
                <button class="btn btn-sm btn-secondary btn-download" data-id="${backup.id}" title="Download">
                    <i class="bi bi-download mr-1"></i> JSON
                </button>
                <button class="btn btn-sm btn-secondary btn-delete" data-id="${backup.id}" title="Delete">
                    <i class="bi bi-trash-fill text-danger"></i>
                </button>
            </div>
        `;
        elements.backupList.appendChild(item);
    });
}

// --- Core Logic ---

/**
 * Creates a backup of CONTACT INFORMATION ONLY.
 * Nested Structure: devices > {uid} > backup > contacts
 */
async function createBackup(userId) {
    setLoadingState(elements.createBackupBtn, true);
    
    try {
        const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
        const profileSnapshot = await getDoc(profileRef);

        if (!profileSnapshot.exists()) {
            showToast('Warning', 'No contact information found to backup.', 'warning');
            return;
        }

        // --- NEW DATA STRUCTURE ---
        const profileData = profileSnapshot.data();
        
        // We create the nested structure as requested
        const backupData = {
            devices: {
                [userId]: {
                    backup: {
                        contacts: profileData // Save the profile data here
                    }
                }
            }
        };

        // 1. Create the Backup Document
        const backupsRef = collection(fbDB, 'user_data', userId, 'backups');
        await addDoc(backupsRef, {
            createdAt: serverTimestamp(),
            deviceCount: 0, 
            geofenceCount: 0,
            hasProfile: true,
            type: 'contact_only',
            data: JSON.stringify(backupData), // Serialize the nested structure
        });

        // 2. Update Pending Action Status
        await setDoc(profileRef, { 
            pending_action: 'backup_complete',
            last_backup: serverTimestamp() 
        }, { merge: true });

        showToast('Success', 'Contact info saved to nested structure.', 'success');

    } catch (error) {
        console.error("Error creating backup:", error);
        showToast('Error', 'Could not create backup.', 'error');
    } finally {
        setLoadingState(elements.createBackupBtn, false);
    }
}

function handleRestoreUpload(e, userId) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== 'application/json') {
        showToast('Error', 'Invalid file type. Please upload a .json file.', 'error');
        return;
    }

    setLoadingState(elements.uploadBackupLabel, true, true);
    
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const backupData = JSON.parse(event.target.result);
            
            // Basic validation for new or old structure
            let isValid = false;
            // Check for new structure
            if (backupData.devices && backupData.devices[userId] && backupData.devices[userId].backup) isValid = true;
            // Check for old structure
            if (backupData.profile || (backupData.devices && Array.isArray(backupData.devices))) isValid = true;

            if (!isValid) {
                throw new Error("Invalid backup file format.");
            }
            confirmRestore(backupData, userId, elements.uploadBackupLabel);
        } catch (error) {
            console.error("Error parsing backup file:", error);
            showToast('Error', 'Invalid or corrupt backup file.', 'error');
            setLoadingState(elements.uploadBackupLabel, false, true);
        }
    };
    reader.readAsText(file);
    e.target.value = null;
}

function handleRestore(backupId, userId) {
    const backup = allBackups.find(b => b.id === backupId);
    if (!backup) {
        showToast('Error', 'Backup not found.', 'error');
        return;
    }

    try {
        const backupData = JSON.parse(backup.data);
        confirmRestore(backupData, userId);
    } catch (error) {
        console.error("Error parsing backup data:", error);
        showToast('Error', 'Corrupt backup data.', 'error');
    }
}

function confirmRestore(backupData, userId, buttonToReset = null) {
    // --- PARSE DATA BASED ON STRUCTURE ---
    let contactInfo = null;
    let legacyDevices = [];
    let legacyGeofences = [];

    // Check for NEW Structure: devices > {uid} > backup > contacts
    if (backupData.devices && backupData.devices[userId] && backupData.devices[userId].backup && backupData.devices[userId].backup.contacts) {
        contactInfo = backupData.devices[userId].backup.contacts;
    } 
    // Fallback: Check for OLD Structure
    else if (backupData.profile) {
        contactInfo = backupData.profile;
        if (Array.isArray(backupData.devices)) legacyDevices = backupData.devices;
        if (Array.isArray(backupData.geofences)) legacyGeofences = backupData.geofences;
    }

    const hasProfile = !!contactInfo;
    const isContactOnly = legacyDevices.length === 0;
    
    let title = "Restore Contact Info?";
    let msg = "Are you sure you want to restore your <strong>Contact Information</strong>?";
    
    if (!isContactOnly) {
        title = "Restore Full Backup?";
        msg = `This will overwrite <strong>${legacyDevices.length} devices</strong> and settings. <br><span class="text-warning">Warning: Current data will be replaced.</span>`;
    }

    // Pass correct arguments to showModal (title first)
    showModal(
        title,
        msg,
        'warning',
        async () => {
            if (buttonToReset) setLoadingState(buttonToReset, true, true);
            showToast('Restoring...', 'Applying data...', 'info');
            
            try {
                const batch = writeBatch(fbDB);
                
                // 1. Restore Profile / Contacts
                if (contactInfo) {
                    const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
                    batch.set(profileRef, contactInfo, { merge: true });
                }

                // 2. Restore Legacy Data (If present)
                if (legacyDevices.length > 0) {
                    legacyDevices.forEach(device => {
                        const docRef = doc(fbDB, 'user_data', userId, 'devices', device.id);
                        batch.set(docRef, device);
                    });
                }
                if (legacyGeofences.length > 0) {
                    legacyGeofences.forEach(geofence => {
                        const docRef = doc(fbDB, 'user_data', userId, 'geofences', geofence.id);
                        batch.set(docRef, geofence);
                    });
                }

                await batch.commit();
                
                showToast('Success', 'Data restored successfully.', 'success');

            } catch (error) {
                console.error("Error restoring data:", error);
                showToast('Error', 'Could not restore data.', 'error');
            } finally {
                if (buttonToReset) setLoadingState(buttonToReset, false, true);
            }
        },
        () => {
            // Cancel callback
            if (buttonToReset) setLoadingState(buttonToReset, false, true);
        }
    );
}

function handleDownload(backupId) {
    const backup = allBackups.find(b => b.id === backupId);
    if (!backup || !backup.data) {
        showToast('Error', 'Backup data not found.', 'error');
        return;
    }

    try {
        const backupDate = backup.createdAt?.toDate() ? backup.createdAt.toDate().toISOString().split('T')[0] : 'backup';
        const typeStr = backup.type === 'contact_only' ? 'contact' : 'full';
        const filename = `tracenfind_${typeStr}_backup_${backupDate}.json`;
        
        const blob = new Blob([backup.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Downloading', 'Backup file downloading.', 'success');
    } catch (error) {
        console.error("Error creating download:", error);
        showToast('Error', 'Could not prepare download.', 'error');
    }
}

/**
 * Deletes a backup from the history.
 */
function handleDelete(backupId, userId) {
    showModal(
        'Delete Snapshot?',
        'Are you sure you want to delete this backup snapshot? This action cannot be undone.',
        'danger',
        async () => {
            try {
                const docRef = doc(fbDB, 'user_data', userId, 'backups', backupId);
                await deleteDoc(docRef);
                showToast('Success', 'Backup snapshot deleted.', 'success');
            } catch (error) {
                console.error("Error deleting backup:", error);
                showToast('Error', 'Could not delete backup.', 'error');
            }
        }
    );
}