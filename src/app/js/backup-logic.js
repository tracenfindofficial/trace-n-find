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
    writeBatch,
    serverTimestamp,
    orderBy,
    showToast,
    showModal,
    setLoadingState,
} from '/app/js/app-shell.js';

// --- Global State for this Page ---
let allBackups = [];
let backupListener = null;

// --- DOM Elements ---
const elements = {
    createBackupBtn: document.getElementById('create-backup-btn'),
    backupList: document.getElementById('backup-list'),
    backupListEmpty: document.getElementById('backup-list-empty'),
    backupScopeSelect: document.getElementById('backupScope'),
    deviceOptionsGroup: document.getElementById('deviceOptions'),
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
    populateBackupOptions(userId); 
});

function setupEventListeners(userId) {
    if (elements.createBackupBtn) {
        elements.createBackupBtn.addEventListener('click', () => createBackup(userId));
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

// --- Population Logic ---

async function populateBackupOptions(userId) {
    if (!elements.deviceOptionsGroup) return;

    try {
        const devicesRef = collection(fbDB, 'user_data', userId, 'devices');
        const snapshot = await getDocs(devicesRef);
        
        elements.deviceOptionsGroup.innerHTML = ''; 
        
        if (snapshot.empty) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.textContent = "No devices found";
            elements.deviceOptionsGroup.appendChild(opt);
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const option = document.createElement('option');
            option.value = doc.id; 
            const name = data.nickname || data.model || `Device ${doc.id.substring(0, 6)}`;
            option.textContent = name;
            elements.deviceOptionsGroup.appendChild(option);
        });

    } catch (error) {
        console.error("Error loading devices for backup options:", error);
        elements.deviceOptionsGroup.innerHTML = '<option disabled>Error loading devices</option>';
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
        
        const hasProfile = backup.hasProfile;
        const contactCount = backup.contactCount || 0; // New count
        const type = backup.type || 'full'; 
        
        let detailsText = "";
        let iconClass = "bi-hdd-network"; 

        if (type === 'contact_only') {
            detailsText = `<span class="text-success font-medium"><i class="bi bi-person-lines-fill"></i> ${contactCount} Contacts & Profile</span>`;
            iconClass = "bi-person-rolodex";
        } else if (type === 'single_device') {
             const deviceName = backup.deviceName || 'Unknown Device';
             detailsText = `<span class="text-primary font-medium"><i class="bi bi-phone"></i> ${deviceName}</span>`;
             iconClass = "bi-phone";
        } else {
            const deviceCount = backup.deviceCount || 0;
            const geofenceCount = backup.geofenceCount || 0;
            detailsText = `<span class="text-text-secondary">${deviceCount} devices, ${geofenceCount} geofences, ${contactCount} contacts</span>`;
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
 * Creates a backup based on the selected scope.
 */
async function createBackup(userId) {
    setLoadingState(elements.createBackupBtn, true);
    
    const scope = elements.backupScopeSelect.value;
    
    try {
        let backupData = {};
        let backupMeta = {
            createdAt: serverTimestamp(),
            type: 'full', 
            deviceCount: 0,
            geofenceCount: 0,
            contactCount: 0, // Metadata for contacts
            hasProfile: false,
            deviceName: null,
            data: ''
        };

        // --- 1. PROFILE & CONTACTS ---
        if (scope === 'full' || scope === 'contacts') {
             // A. Profile Settings
             const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
             const profileSnap = await getDoc(profileRef);
             if (profileSnap.exists()) {
                 backupData.profile = profileSnap.data();
                 backupMeta.hasProfile = true;
             }

             // B. Contacts Collection (NEW ADDITION)
             // Backs up 'user_data/{uid}/contacts'
             const contactsRef = collection(fbDB, 'user_data', userId, 'contacts');
             const contactsSnap = await getDocs(contactsRef);
             if (!contactsSnap.empty) {
                 backupData.contactsList = contactsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                 backupMeta.contactCount = backupData.contactsList.length;
             }
        }

        // --- 2. SINGLE DEVICE ---
        if (scope !== 'full' && scope !== 'contacts') {
            const deviceId = scope;
            const deviceRef = doc(fbDB, 'user_data', userId, 'devices', deviceId);
            const deviceSnap = await getDoc(deviceRef);

            if (!deviceSnap.exists()) {
                throw new Error("Selected device not found.");
            }

            const deviceData = { id: deviceSnap.id, ...deviceSnap.data() };
            backupData.devices = [deviceData];
            
            backupMeta.type = 'single_device';
            backupMeta.deviceCount = 1;
            backupMeta.deviceName = deviceData.nickname || deviceData.model || deviceId;
        }

        // --- 3. FULL BACKUP ---
        if (scope === 'full') {
            const devicesRef = collection(fbDB, 'user_data', userId, 'devices');
            const devicesSnap = await getDocs(devicesRef);
            backupData.devices = devicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            backupMeta.deviceCount = backupData.devices.length;

            const geofencesRef = collection(fbDB, 'user_data', userId, 'geofences');
            const geoSnap = await getDocs(geofencesRef);
            backupData.geofences = geoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            backupMeta.geofenceCount = backupData.geofences.length;
        }
        
        if (scope === 'contacts') {
            backupMeta.type = 'contact_only';
        }

        // --- SERIALIZE & SAVE ---
        backupMeta.data = JSON.stringify(backupData);

        const backupsRef = collection(fbDB, 'user_data', userId, 'backups');
        await addDoc(backupsRef, backupMeta);

        const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
        await setDoc(profileRef, { 
            pending_action: 'backup_complete',
            last_backup: serverTimestamp() 
        }, { merge: true });

        showToast('Success', 'Backup snapshot created successfully.', 'success');

    } catch (error) {
        console.error("Error creating backup:", error);
        showToast('Error', 'Could not create backup. ' + error.message, 'error');
    } finally {
        setLoadingState(elements.createBackupBtn, false);
    }
}

function handleRestore(backupId, userId) {
    const backup = allBackups.find(b => b.id === backupId);
    if (!backup) {
        showToast('Error', 'Backup not found.', 'error');
        return;
    }

    try {
        const backupData = JSON.parse(backup.data);
        confirmRestore(backupData, userId, null, backup.type, backup.deviceName);
    } catch (error) {
        console.error("Error parsing backup data:", error);
        showToast('Error', 'Corrupt backup data.', 'error');
    }
}

function confirmRestore(backupData, userId, buttonToReset = null, backupType = 'full', deviceName = '') {
    // --- PARSE DATA ---
    let contactInfo = backupData.profile || null;
    let contactsList = backupData.contactsList || []; // Restore list
    let devicesToRestore = backupData.devices || [];
    let geofencesToRestore = backupData.geofences || [];

    // Fallback for older backups or different formats
    if (!Array.isArray(devicesToRestore) && backupData.devices && typeof backupData.devices === 'object') {
         if (backupData.devices[userId]?.backup?.contacts) {
             contactInfo = backupData.devices[userId].backup.contacts;
         }
    }

    // --- CONSTRUCT CONFIRMATION MESSAGE ---
    let title = "Restore Data?";
    let msg = "Are you sure you want to restore this data?";
    
    if (backupType === 'contact_only') {
        title = "Restore Contacts?";
        msg = `Are you sure you want to restore <strong>${contactsList.length} contacts</strong> and profile settings?`;
    } else if (backupType === 'single_device') {
        title = `Restore ${deviceName}?`;
        msg = `Are you sure you want to restore data for <strong>${deviceName}</strong>? <br>Current data for this specific device will be overwritten.`;
    } else {
        title = "Restore Full Account?";
        msg = `This will overwrite <strong>${devicesToRestore.length} devices</strong>, <strong>${geofencesToRestore.length} geofences</strong>, and <strong>${contactsList.length} contacts</strong>.`;
    }

    showModal(
        title,
        msg,
        'warning',
        async () => {
            if (buttonToReset) setLoadingState(buttonToReset, true, true);
            showToast('Restoring...', 'Applying data...', 'info');
            
            try {
                const batch = writeBatch(fbDB);
                let opCount = 0;
                
                // 1. Restore Profile Settings
                if (contactInfo) {
                    const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
                    batch.set(profileRef, contactInfo, { merge: true });
                    opCount++;
                }

                // 2. Restore Contacts List (NEW)
                if (contactsList.length > 0) {
                    contactsList.forEach(contact => {
                        if(contact.id) {
                            const docRef = doc(fbDB, 'user_data', userId, 'contacts', contact.id);
                            batch.set(docRef, contact);
                            opCount++;
                        }
                    });
                }

                // 3. Restore Devices
                if (devicesToRestore.length > 0) {
                    devicesToRestore.forEach(device => {
                        if(device.id) {
                            const docRef = doc(fbDB, 'user_data', userId, 'devices', device.id);
                            batch.set(docRef, device);
                            opCount++;
                        }
                    });
                }

                // 4. Restore Geofences
                if (geofencesToRestore.length > 0) {
                    geofencesToRestore.forEach(geofence => {
                        if(geofence.id) {
                            const docRef = doc(fbDB, 'user_data', userId, 'geofences', geofence.id);
                            batch.set(docRef, geofence);
                            opCount++;
                        }
                    });
                }

                if (opCount > 0) {
                    await batch.commit();
                    showToast('Success', 'Data restored successfully.', 'success');
                } else {
                    showToast('Info', 'No data found in backup to restore.', 'info');
                }

            } catch (error) {
                console.error("Error restoring data:", error);
                showToast('Error', 'Could not restore data.', 'error');
            } finally {
                if (buttonToReset) setLoadingState(buttonToReset, false, true);
            }
        },
        () => {
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
        let typeStr = 'full';
        if (backup.type === 'contact_only') typeStr = 'contact';
        if (backup.type === 'single_device') typeStr = 'device';
        
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