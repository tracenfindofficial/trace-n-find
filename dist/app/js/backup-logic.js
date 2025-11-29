// --- Trace'N Find Backup & Restore Logic ---
// This file handles all logic *specific* to backup.html.
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

// SCALABILITY/INTEGRATION FIX: All imports now come from the central app-shell.js
import { 
    fbDB,
    collection, 
    onSnapshot, 
    query,
    doc,
    getDocs,
    addDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
    orderBy,
    showToast,
    showModal,
    setLoadingState
} from '/app/js/app-shell.js';

// --- Global State for this Page ---
let allBackups = [];
let backupListener = null; // Unsubscribe function for Firestore

// --- DOM Elements ---
const elements = {
    createBackupBtn: document.getElementById('create-backup-btn'),
    uploadBackupLabel: document.getElementById('upload-backup-label'),
    uploadBackupInput: document.getElementById('upload-backup-input'),
    backupList: document.getElementById('backup-list'),
    backupListEmpty: document.getElementById('backup-list-empty'),
};

// --- Initialization ---
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId) {
            console.log("Backup Logic: Auth is ready.");
            callback(window.currentUserId);
        } else {
            console.log("Backup logic waiting for authentication...");
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
});

/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners(userId) {
    elements.createBackupBtn.addEventListener('click', () => createBackup(userId));
    
    elements.uploadBackupInput.addEventListener('change', (e) => handleRestoreUpload(e, userId));

    // Event delegation for list buttons
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

// --- Firestore Data ---

/**
 * Sets up a real-time listener for the user's backups.
 * @param {string} userId - The authenticated user's ID.
 */
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
        elements.backupListEmpty.style.display = 'block';
    });
}

// --- UI Rendering ---

/**
 * Renders the list of backups.
 */
function renderBackupList() {
    // Clear list but not the empty state
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
        const deviceCount = backup.deviceCount || 0;
        const geofenceCount = backup.geofenceCount || 0;

        item.innerHTML = `
            <div class="backup-icon-wrapper">
                <i class="bi bi-file-zip-fill"></i>
            </div>
            <div class="flex-1">
                <div class="font-semibold text-text-primary dark:text-dark-text-primary">Backup - ${backupDate}</div>
                <div class="text-sm text-text-secondary dark:text-dark-text-secondary">${deviceCount} devices, ${geofenceCount} geofences</div>
            </div>
            <div class="flex flex-col sm:flex-row gap-2">
                <button class="btn btn-sm btn-secondary btn-restore" data-id="${backup.id}" title="Restore">
                    <i class="bi bi-database-down mr-1"></i> Restore
                </button>
                <button class="btn btn-sm btn-secondary btn-download" data-id="${backup.id}" title="Download">
                    <i class="bi bi-download mr-1"></i> Download
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
 * Creates a new backup.
 * SCALABILITY NOTE: This runs on the client and fetches all data.
 * In a production app, this should be a Cloud Function for performance and scalability.
 * @param {string} userId - The authenticated user's ID.
 */
async function createBackup(userId) {
    setLoadingState(elements.createBackupBtn, true);
    
    try {
        // 1. Fetch all data to back up
        const devicesRef = collection(fbDB, 'user_data', userId, 'devices');
        const geofencesRef = collection(fbDB, 'user_data', userId, 'geofences');
        
        const devicesSnapshot = await getDocs(devicesRef);
        const geofencesSnapshot = await getDocs(geofencesRef);

        const backupData = {
            devices: devicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            geofences: geofencesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        };

        // 2. Save backup metadata and data (as a string) to a new doc
        const backupsRef = collection(fbDB, 'user_data', userId, 'backups');
        await addDoc(backupsRef, {
            createdAt: serverTimestamp(),
            deviceCount: backupData.devices.length,
            geofenceCount: backupData.geofences.length,
            data: JSON.stringify(backupData), // Store the whole backup as a JSON string
        });

        showToast('Success', 'Snapshot created successfully.', 'success');
    } catch (error) {
        console.error("Error creating backup:", error);
        showToast('Error', 'Could not create backup.', 'error');
    } finally {
        setLoadingState(elements.createBackupBtn, false);
    }
}

/**
 * Handles restoring data from an uploaded JSON file.
 * @param {Event} e - The file input change event.
 * @param {string} userId - The authenticated user's ID.
 */
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
            if (!backupData.devices || !backupData.geofences) {
                throw new Error("Invalid backup file format.");
            }
            // Ask for confirmation before proceeding
            confirmRestore(backupData, userId, elements.uploadBackupLabel);
        } catch (error) {
            console.error("Error parsing backup file:", error);
            showToast('Error', 'Invalid or corrupt backup file.', 'error');
            setLoadingState(elements.uploadBackupLabel, false, true);
        }
    };
    reader.readAsText(file);
    
    // Reset input to allow re-uploading the same file
    e.target.value = null;
}

/**
 * Handles restoring data from a backup history item.
 * @param {string} backupId - The ID of the backup doc.
 * @param {string} userId - The authenticated user's ID.
 */
function handleRestore(backupId, userId) {
    const backup = allBackups.find(b => b.id === backupId);
    if (!backup) {
        showToast('Error', 'Backup not found.', 'error');
        return;
    }

    try {
        const backupData = JSON.parse(backup.data);
        // Ask for confirmation before proceeding
        confirmRestore(backupData, userId);
    } catch (error) {
        console.error("Error parsing backup data:", error);
        showToast('Error', 'Corrupt backup data.', 'error');
    }
}

/**
 * Shows a confirmation modal and executes the restore if confirmed.
 * @param {object} backupData - The parsed backup data object.
 * @param {string} userId - The authenticated user's ID.
 * @param {HTMLElement} [buttonToReset] - Optional button to reset loading state.
 */
function confirmRestore(backupData, userId, buttonToReset = null) {
    const deviceCount = backupData.devices.length;
    const geofenceCount = backupData.geofenceCount.length;

    showModal(
        true,
        'Restore Backup?',
        `This will overwrite all current data. Are you sure you want to restore <strong>${deviceCount} devices</strong> and <strong>${geofenceCount} geofences</strong>? This action cannot be undone.`,
        'Restore Data',
        'btn-danger',
        async () => {
            // This is the confirm callback
            if (buttonToReset) setLoadingState(buttonToReset, true, true);
            showToast('Restoring...', 'Please wait, restoring your data.', 'info');
            
            try {
                const batch = writeBatch(fbDB);
                
                // Restore devices
                backupData.devices.forEach(device => {
                    const docRef = doc(fbDB, 'user_data', userId, 'devices', device.id);
                    batch.set(docRef, device);
                });

                // Restore geofences
                backupData.geofences.forEach(geofence => {
                    const docRef = doc(fbDB, 'user_data', userId, 'geofences', geofence.id);
                    batch.set(docRef, geofence);
                });

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
            // This is the cancel callback
            if (buttonToReset) setLoadingState(buttonToReset, false, true);
        }
    );
}

/**
 * Triggers a file download for a specific backup.
 * @param {string} backupId - The ID of the backup doc.
 */
function handleDownload(backupId) {
    const backup = allBackups.find(b => b.id === backupId);
    if (!backup || !backup.data) {
        showToast('Error', 'Backup data not found.', 'error');
        return;
    }

    try {
        const backupDate = backup.createdAt?.toDate() ? backup.createdAt.toDate().toISOString().split('T')[0] : 'backup';
        const filename = `tracenfind_backup_${backupDate}.json`;
        
        const blob = new Blob([backup.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Downloading', 'Your backup file is downloading.', 'success');
    } catch (error) {
        console.error("Error creating download:", error);
        showToast('Error', 'Could not prepare download.', 'error');
    }
}

/**
 * Deletes a backup from the history.
 * @param {string} backupId - The ID of the backup doc.
 * @param {string} userId - The authenticated user's ID.
 */
function handleDelete(backupId, userId) {
    showModal(
        true,
        'Delete Backup?',
        'Are you sure you want to delete this backup snapshot? This action cannot be undone.',
        'Delete',
        'btn-danger',
        async () => {
            // Confirm callback
            try {
                const docRef = doc(fbDB, 'user_data', userId, 'backups', backupId);
                await deleteDoc(docRef);
                showToast('Success', 'Backup deleted.', 'success');
            } catch (error) {
                console.error("Error deleting backup:", error);
                showToast('Error', 'Could not delete backup.', 'error');
            }
        }
    );
}

/**
 * Toggles the loading state of a button.
 * @param {HTMLElement} btn - The button element.
 * @param {boolean} isLoading - Whether to show the loading state.
 * @param {boolean} isSecondary - Optional: True if it's a secondary button.
 */