// --- Trace'N Find Add Device Logic ---
// This file handles all logic *specific* to add-device.html
// It supports both "add" and "edit" modes.
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

// SCALABILITY FIX: All imports now come from the central app-shell.js
import {
    fbDB,
    showToast,
    addDoc,
    collection,
    serverTimestamp,
    doc,
    getDoc, // Added for edit mode
    setDoc  // Added for edit mode
} from '/app/js/app-shell.js'; // INTEGRATION FIX: Use root-relative path

// --- State ---
let currentStep = 1;
let isEditMode = false;
let editDeviceId = null;
const formData = {
    type: null,
    name: '',
    model: '',
    serial: '',
    os: 'Android', // Default OS
    features: {
        tracking: true,
        remoteLock: true,
        dataWipe: true,
    }
};
let isSubmitting = false;

// --- DOM Elements ---
const elements = {
    // Page Title
    pageTitle: document.getElementById('page-title'),
    
    // Step 1
    step1: document.getElementById('step-1'),
    stepCards: document.querySelectorAll('.step-card'),
    deviceTypeError: document.getElementById('device-type-error'),
    btnNextStep2: document.getElementById('btn-next-step-2'),
    
    // Step 2
    step2: document.getElementById('step-2'),
    btnScanQR: document.getElementById('btn-scan-qr'),
    deviceName: document.getElementById('deviceName'),
    deviceModel: document.getElementById('deviceModel'),
    deviceSerial: document.getElementById('deviceSerial'),
    deviceOS: document.getElementById('deviceOS'),
    btnBackStep1: document.getElementById('btn-back-step-1'),
    btnNextStep3: document.getElementById('btn-next-step-3'),

    // Step 3
    step3: document.getElementById('step-3'),
    enableTracking: document.getElementById('enableTracking'),
    enableRemoteLock: document.getElementById('enableRemoteLock'),
    enableDataWipe: document.getElementById('enableDataWipe'),
    btnBackStep2: document.getElementById('btn-back-step-2'),
    btnAddDevice: document.getElementById('btn-add-device'),
    btnAddDeviceText: document.querySelector('#btn-add-device .button-text'),

    // Progress Bar
    stepDot1: document.getElementById('step-dot-1'),
    stepDot2: document.getElementById('step-dot-2'),
    stepDot3: document.getElementById('step-dot-3'),
    stepName1: document.getElementById('step-name-1'),
    stepName2: document.getElementById('step-name-2'),
    stepName3: document.getElementById('step-name-3'),
    progressBar1: document.getElementById('progress-bar-1'),
    progressBar2: document.getElementById('progress-bar-2'),
};

/**
 * Main initialization function for the page logic.
 */
function initAddDevice() {
    if (!window.currentUserId) {
        console.error("User not authenticated. Add-device logic cannot run.");
        // The app-shell auth guard will handle redirection.
        return;
    }
    
    // Check for Edit Mode
    const params = new URLSearchParams(window.location.search);
    isEditMode = params.get('edit') === 'true';
    editDeviceId = params.get('id');

    if (isEditMode && editDeviceId) {
        // We are in "Edit" mode
        loadDeviceForEditing(window.currentUserId, editDeviceId);
    } else {
        // We are in "Add" mode
        updateButtonStates();
    }
    
    setupEventListeners();
}

/**
 * Fetches the device data and populates the form for editing.
 */
async function loadDeviceForEditing(userId, deviceId) {
    if(elements.pageTitle) elements.pageTitle.textContent = "Edit Device";
    if(elements.btnAddDeviceText) {
        elements.btnAddDeviceText.innerHTML = `<i class="bi bi-save-fill mr-2"></i> Save Changes`;
    }
    
    try {
        const deviceRef = doc(fbDB, 'user_data', userId, 'devices', deviceId); // <-- FIX: Changed 'users' to 'user_data'
        const docSnap = await getDoc(deviceRef);

        if (docSnap.exists()) {
            const device = docSnap.data();
            
            // Populate formData
            formData.type = device.type;
            formData.name = device.name;
            formData.model = device.model;
            formData.serial = device.serial;
            formData.os = device.os;
            formData.features = device.features || { tracking: true, remoteLock: true, dataWipe: true }; // Fallback
            
            // --- Populate Step 1 ---
            elements.stepCards.forEach(card => {
                if (card.dataset.type === device.type) {
                    card.classList.add('selected', 'border-primary-600', 'dark:border-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
                }
            });
            
            // --- Populate Step 2 ---
            elements.deviceName.value = device.name;
            elements.deviceModel.value = device.model;
            elements.deviceSerial.value = device.serial;
            elements.deviceOS.value = device.os;
            
            // --- Populate Step 3 ---
            elements.enableTracking.checked = formData.features.tracking;
            elements.enableRemoteLock.checked = formData.features.remoteLock;
            elements.enableDataWipe.checked = formData.features.dataWipe;

            updateButtonStates();
            
        } else {
            console.error("No such device found!");
            showToast('Error', 'Device not found. Redirecting...', 'error');
            setTimeout(() => window.location.href = '/app/devices.html', 2000);
        }
    } catch (error) {
        console.error("Error loading device for edit:", error);
        showToast('Error', 'Could not load device data.', 'error');
    }
}


/**
 * Sets up all event listeners for the wizard.
 */
function setupEventListeners() {
    // Step 1: Device Type Selection
    elements.stepCards.forEach(card => {
        card.addEventListener('click', () => {
            // Remove 'selected' from all cards
            elements.stepCards.forEach(c => c.classList.remove('selected', 'border-primary-600', 'dark:border-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30'));
            // Add 'selected' to the clicked card
            card.classList.add('selected', 'border-primary-600', 'dark:border-primary-500', 'bg-primary-50', 'dark:bg-primary-900/30');
            // Store the selected type
            formData.type = card.dataset.type;
            elements.deviceTypeError.classList.add('hidden');
            updateButtonStates();
            updateOSDefault();
        });
    });

    elements.btnNextStep2.addEventListener('click', () => {
        if (validateStep1()) {
            goToStep(2);
        }
    });

    // Step 2: Device Details
    elements.btnScanQR.addEventListener('click', () => {
        // This is a demo. In a real app, this would open a camera.
        showToast('Demo Feature', 'QR Scanner would open here.', 'info');
        elements.deviceName.value = 'Demo Phone';
        elements.deviceModel.value = 'Pixel 8 Pro (Demo)';
        elements.deviceSerial.value = 'DEMO-123456';
    });

    elements.btnBackStep1.addEventListener('click', () => goToStep(1));
    elements.btnNextStep3.addEventListener('click', () => {
        if (validateStep2()) {
            goToStep(3);
        }
    });

    // Step 3: Security & Submission
    elements.btnBackStep2.addEventListener('click', () => goToStep(2));
    
    // Handle form submission
    document.getElementById('addDeviceForm').addEventListener('submit', handleFormSubmit);
}

/**
 * Automatically sets the OS based on device type, only if not in edit mode.
 */
function updateOSDefault() {
    if (isEditMode) return; // Don't override loaded data
    
    const type = formData.type.toLowerCase();
    if (type === 'phone' || type === 'tablet' || type === 'watch') {
        elements.deviceOS.value = 'Android';
    } else if (type === 'laptop') {
        elements.deviceOS.value = 'Windows';
    } else {
        elements.deviceOS.value = 'Other';
    }
}

/**
 * Manages the UI transition between wizard steps.
 * @param {number} stepNumber - The step to navigate to (1, 2, or 3).
 */
function goToStep(stepNumber) {
    currentStep = stepNumber;
    
    // Hide all steps
    [elements.step1, elements.step2, elements.step3].forEach(step => {
        if(step) step.classList.remove('active');
    });
    
    // Show the active step
    const activeStep = document.getElementById(`step-${stepNumber}`);
    if(activeStep) activeStep.classList.add('active');

    // Update Progress Bar
    const dots = [elements.stepDot1, elements.stepDot2, elements.stepDot3];
    const names = [elements.stepName1, elements.stepName2, elements.stepName3];
    const bars = [elements.progressBar1, elements.progressBar2];

    dots.forEach((dot, index) => {
        if (!dot) return;
        const step = index + 1;
        dot.classList.remove('active', 'complete');
        
        if (step < stepNumber) {
            dot.classList.add('complete');
            dot.innerHTML = `<i class="bi bi-check-lg"></i>`; // Checkmark
        } else if (step === stepNumber) {
            dot.classList.add('active');
            dot.textContent = step;
        } else {
            dot.textContent = step;
        }
    });

    names.forEach((name, index) => {
        if (!name) return;
        const step = index + 1;
        name.classList.remove('text-primary-600', 'dark:text-primary-400', 'text-text-secondary', 'dark:text-dark-text-secondary', 'font-semibold');

        if (step === stepNumber) {
            name.classList.add('text-primary-600', 'dark:text-primary-400', 'font-semibold');
        } else {
            name.classList.add('text-text-secondary', 'dark:text-dark-text-secondary');
        }
    });

    bars.forEach((bar, index) => {
        if (!bar) return;
        const step = index + 1;
        if (step < stepNumber) {
            bar.style.width = '100%';
        } else {
            bar.style.width = '0%';
        }
    });
}

/**
 * Updates the disabled state of the "Next" button on Step 1.
 */
function updateButtonStates() {
    elements.btnNextStep2.disabled = !formData.type;
}

/**
 * Validates the data for Step 1.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateStep1() {
    if (!formData.type) {
        elements.deviceTypeError.classList.remove('hidden');
        return false;
    }
    elements.deviceTypeError.classList.add('hidden');
    return true;
}

/**
 * Validates the data for Step 2.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateStep2() {
    let isValid = true;
    formData.name = elements.deviceName.value;
    formData.model = elements.deviceModel.value;
    formData.serial = elements.deviceSerial.value;
    formData.os = elements.deviceOS.value;

    if (formData.name.trim().length < 3) {
        showToast('Invalid Name', 'Device name must be at least 3 characters.', 'error');
        elements.deviceName.focus();
        isValid = false;
    } else if (formData.model.trim().length === 0) {
        showToast('Invalid Model', 'Device model is required.', 'error');
        elements.deviceModel.focus();
        isValid = false;
    }
    
    return isValid;
}

/**
 * Handles the final form submission (CREATE or UPDATE).
 * @param {Event} e - The form submit event.
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    if (isSubmitting || !window.currentUserId) return;

    // Collect data from Step 3
    formData.features.tracking = elements.enableTracking.checked;
    formData.features.remoteLock = elements.enableRemoteLock.checked;
    formData.features.dataWipe = elements.enableDataWipe.checked;
    
    setLoadingState(true);

    // Create the final device object
    const devicePayload = {
        type: formData.type,
        name: formData.name,
        model: formData.model,
        serial: formData.serial || '',
        os: formData.os,
        features: formData.features,
    };

    try {
        let docRef;
        let successMessage;

        if (isEditMode) {
            // --- UPDATE (Edit Mode) ---
            docRef = doc(fbDB, 'user_data', window.currentUserId, 'devices', editDeviceId);
            // We use setDoc with merge:true to update existing fields
            // and add new ones (like 'features') without overwriting status/location.
            await setDoc(docRef, devicePayload, { merge: true });
            successMessage = `${formData.name} has been updated.`;
            
        } else {
            // --- CREATE (Add Mode) ---
            // Add default values for a new device
            devicePayload.status = 'online';
            devicePayload.battery = 100;
            devicePayload.location = null; // Will be updated by the device app
            devicePayload.createdAt = serverTimestamp();
            devicePayload.lastSeen = serverTimestamp();
            
            const devicesCollectionRef = collection(fbDB, 'user_data', window.currentUserId, 'devices'); // <-- FIX: Changed 'users' to 'user_data'
            docRef = await addDoc(devicesCollectionRef, devicePayload);
            successMessage = `${formData.name} is now protected.`;
        }

        console.log("Document written/updated with ID: ", docRef.id);
        
        // Success
        showToast('Success!', successMessage, 'success');
        
        // Redirect to the device list page after a short delay
        setTimeout(() => {
            // INTEGRATION FIX: Root-relative path
            window.location.href = '/app/devices.html';
        }, 1500);

    } catch (error) {
        console.error("Error writing document: ", error);
        showToast('Error', `Could not ${isEditMode ? 'update' : 'add'} device. Please try again.`, 'error');
        setLoadingState(false);
    }
}

/**
 * Toggles the loading state of the submit button.
 * @param {boolean} isLoading - Whether to show the loading state.
 */
function setLoadingState(isLoading) {
    isSubmitting = isLoading;
    const btn = elements.btnAddDevice;
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

// --- Wait for app-shell to auth and then initialize ---
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId) {
            callback();
        } else {
            console.log("Add-device logic waiting for authentication...");
            requestAnimationFrame(check);
        }
    };

    if (window.currentUserId) {
        callback();
    } else {
        requestAnimationFrame(check);
    }
}

// Start the page logic only after authentication is confirmed
waitForAuth(initAddDevice);