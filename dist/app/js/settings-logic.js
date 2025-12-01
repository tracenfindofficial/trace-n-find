// --- Trace'N Find Settings Logic ---
// This file handles all logic *specific* to settings.html.
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

// SCALABILITY/INTEGRATION FIX: All imports now come from the central app-shell.js
// MODIFICATION: Added appState and updateProfile. Removed getDoc (no longer needed).
import { 
    fbDB,
    fbAuth,
    appState, // Import global state
    doc,
    setDoc,
    updateDoc,
    showToast,
    showModal,
    setLoadingState,
    updateProfile,
    sanitizeHTML,
    RecaptchaVerifier, 
    PhoneAuthProvider, 
    multiFactor, 
    PhoneMultiFactorGenerator
    // REMOVED: collection, query, where, onSnapshot (handled globally in app-shell.js)
} from '/app/js/app-shell.js'; // Use relative path

// --- DOM Elements ---
const elements = {
    // Profile
    profileForm: document.getElementById('profile-settings-form'),
    profileName: document.getElementById('profile-name'),
    profileEmail: document.getElementById('profile-email'),
    saveProfileBtn: document.getElementById('save-profile-btn'),

    // Preferences
    preferencesForm: document.getElementById('preferences-form'),
    themeToggleSwitch: document.getElementById('theme-toggle-switch'),
    savePreferencesBtn: document.getElementById('save-preferences-btn'),

    // Security
    deleteAccountBtn: document.getElementById('delete-account-btn'),

    // Sidebar (for updating user display)
    // FIX: Select ALL elements with this class to ensure header AND sidebar update
    allUserNames: document.querySelectorAll('.user-name-display'),
    sidebarUserEmail: document.getElementById('userEmail'),
    allUserAvatars: document.querySelectorAll('.user-avatar-display'), // Gets header + sidebar
    
    // REMOVED: notificationBadge reference to prevent conflict with app-shell.js
};

// --- Initialization ---
// PERFORMANCE FIX: Wait for appState.currentUser to be populated by app-shell.js
function waitForAuth(callback) {
    const check = () => {
        if (appState.currentUser) {
            console.log("Settings Logic: Auth is ready.");
            callback(appState.currentUser); // Pass the fully populated user object
        } else {
            console.log("Settings logic waiting for authentication...");
            requestAnimationFrame(check);
        }
    };
    requestAnimationFrame(check);
}

waitForAuth((user) => {
    loadUserSettings(user);
    setupEventListeners(user.uid);
    initMfaLogic(user);
    // REMOVED: listenForUnreadNotifications(user.uid); 
    // The global app-shell.js now handles the badge count with proper deduplication.
});

/**
 * PERFORMANCE FIX: This function no longer fetches from Firestore.
 * It reads the data that app-shell.js already fetched and stored in appState.
 * @param {object} user - The populated appState.currentUser object.
 */
async function loadUserSettings(user) {
    // 1. Populate Auth data
    if (user.email) {
        elements.profileEmail.value = user.email;
    }

    // 2. Populate data from appState (which already has Firestore data merged)
    // app-shell already merged `fullName` into `displayName`
    elements.profileName.value = user.displayName || 'New User';
    
    // 3. Populate preferences
    const currentTheme = user.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if(elements.themeToggleSwitch) elements.themeToggleSwitch.checked = currentTheme === 'dark';
}


/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners(userId) {
    elements.profileForm.addEventListener('submit', (e) => handleSaveProfile(e, userId));
    
    if(elements.preferencesForm) elements.preferencesForm.addEventListener('submit', (e) => handleSavePreferences(e, userId));
    
    elements.deleteAccountBtn.addEventListener('click', () => handleDeleteAccount(userId));
}

// --- Core Logic ---

/**
 * Handles saving changes to the user's profile.
 * @param {Event} e - The form submit event.
 * @param {string} userId - The authenticated user's ID.
 */
async function handleSaveProfile(e, userId) {
    e.preventDefault();
    setLoadingState(elements.saveProfileBtn, true);

    const newName = sanitizeHTML(elements.profileName.value.trim());
    if (newName.length < 2) {
        showToast('Error', 'Name must be at least 2 characters.', 'error');
        setLoadingState(elements.saveProfileBtn, false);
        return;
    }

    try {
        // 1. Save to Firestore
        const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
        await setDoc(profileRef, { fullName: newName }, { merge: true });

        // 2. INTEGRATION FIX: Update the Firebase Auth object itself for consistency
        if (fbAuth.currentUser) {
            await updateProfile(fbAuth.currentUser, { displayName: newName });
        }
        
        // 3. INTEGRATION FIX: Update the global appState
        appState.currentUser.displayName = newName;
        appState.currentUser.fullName = newName; // Keep both in sync
        const shellAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=4361ee&color=fff&size=40`;
        appState.currentUser.photoURL = shellAvatarUrl;


        // 4. Update UI dynamically (FIXED: Update ALL instances)
        if (elements.allUserNames) {
            elements.allUserNames.forEach(el => el.textContent = newName);
        }
        // Update all avatars in the shell (header + sidebar)
        elements.allUserAvatars.forEach(img => img.src = shellAvatarUrl);

        showToast('Success', 'Profile updated successfully!', 'success');
    } catch (error) {
        console.error("Error saving profile:", error);
        showToast('Error', 'Could not save profile.', 'error');
    } finally {
        setLoadingState(elements.saveProfileBtn, false);
    }
}

/**
 * Handles saving changes to the user's preferences.
 * @param {Event} e - The form submit event.
 * @param {string} userId - The authenticated user's ID.
 */
async function handleSavePreferences(e, userId) {
    e.preventDefault();
    setLoadingState(elements.savePreferencesBtn, true);

    const newTheme = elements.themeToggleSwitch.checked ? 'dark' : 'light';

    try {
        // 1. Save to Firestore
        const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
        await setDoc(profileRef, { theme: newTheme }, { merge: true });

        // 2. INTEGRATION FIX: Update global appState
        appState.currentUser.theme = newTheme;

        // 3. Apply theme immediately
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
        document.documentElement.classList.toggle('dark', newTheme === 'dark');

        // 4. Update the theme toggle icon in the header (from app-shell)
        const themeToggleIcon = document.querySelector('#themeToggle i');
        if (themeToggleIcon) {
            themeToggleIcon.className = newTheme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
        }

        showToast('Success', 'Preferences saved!', 'success');
    } catch (error) {
        console.error("Error saving preferences:", error);
        showToast('Error', 'Could not save preferences.', 'error');
    } finally {
        setLoadingState(elements.savePreferencesBtn, false);
    }
}

/**
 * Handles the "Delete Account" button click.
 * @param {string} userId - The authenticated user's ID.
 */
function handleDeleteAccount(userId) {
    showModal(
        'Delete Your Account?', // title
        'This is permanent. All your devices, geofences, and settings will be erased. <strong>This action cannot be undone.</strong> Are you absolutely sure?', // message
        'danger', // type
        async () => { // onConfirm
            // Confirm callback
            // SCALABILITY/SECURITY FIX: This is a complex, destructive operation.
            // It should be handled by a secure Cloud Function that deletes all
            // subcollections and the user's auth record.
            console.log(`User ${userId} confirmed account deletion. Triggering Cloud Function (demo)...`);
            showToast(
                'Request Sent', 
                'Account deletion request sent. This must be handled by a secure server function.', 
                'info'
            );
            
            // In a real app, you would:
            // 1. Call a Cloud Function: `https.onCall('deleteUserAccount')`
            // 2. The function would delete all subcollections (devices, geofences, etc.)
            // 3. The function would delete the user's auth record.
            // 4. The client would then sign out and redirect.
        },
        null, // onCancel
        { isHTML: true } // DESIGN/AESTHETICS FIX: Pass options object to render HTML
    );
}

/**
 * Initializes the MFA button state based on the current user.
 * @param {object} user - The authenticated Firebase user.
 */
function initMfaLogic(user) {
    const mfaBtn = document.getElementById('mfa-toggle-btn');
    
    if (mfaBtn) {
        // Check initial state: Is MFA already enabled?
        // Note: We use the 'user' passed from waitForAuth which is fully loaded
        if (multiFactor(user).enrolledFactors.length > 0) {
            mfaBtn.textContent = "Disable MFA";
            mfaBtn.classList.remove('btn-primary'); // Remove primary class
            mfaBtn.classList.add('btn-danger');     // Add danger class
        }
        
        // Add click listener
        mfaBtn.addEventListener('click', handleMfaToggle);
    }
}

/**
 * Handles the MFA Toggle (Enable/Disable) Logic
 */
async function handleMfaToggle() {
    const user = fbAuth.currentUser;
    if (!user) return;

    // A. IF ALREADY ENABLED -> DISABLE IT
    if (multiFactor(user).enrolledFactors.length > 0) {
        showModal(
            'Disable MFA?',
            'Are you sure you want to disable Multi-Factor Authentication? Your account will be less secure.',
            'warning',
            async () => {
                try {
                    const enrolledFactor = multiFactor(user).enrolledFactors[0];
                    await multiFactor(user).unenroll(enrolledFactor);
                    
                    // Update Firestore status
                    try {
                        const userRef = doc(fbDB, 'user_data', user.uid, 'profile', 'settings');
                        await updateDoc(userRef, { mfa_enabled: false });
                    } catch(e) { console.log("Profile sync skipped"); }

                    showToast("Success", "MFA has been disabled.", "warning");
                    setTimeout(() => location.reload(), 1000);
                } catch (e) {
                    showToast("Error", e.message, "error");
                }
            }
        );
        return;
    }

    // B. IF DISABLED -> ENABLE IT
    try {
        // 1. Setup Invisible Recaptcha
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(fbAuth, 'recaptcha-container', {
                'size': 'invisible'
            });
        }

        // 2. Get Phone Number (Try profile first, then prompt)
        let phone = user.phoneNumber;
        if (!phone) {
            phone = prompt("Please enter your phone number for MFA (e.g., +60123456789):");
        }
        
        if (!phone) return; // User cancelled

        showToast("Info", "Sending verification code...", "info");

        // 3. Verify Phone
        const session = await new PhoneAuthProvider(fbAuth).verifyPhoneNumber(
            { phoneNumber: phone, session: null },
            window.recaptchaVerifier
        );

        // 4. Ask for Code
        const code = prompt(`Enter the SMS code sent to ${phone}:`);
        if (!code) return;

        // 5. Enroll
        const cred = PhoneAuthProvider.credential(session, code);
        const assertion = PhoneMultiFactorGenerator.assertion(cred);
        await multiFactor(user).enroll(assertion, "My Phone Number");
        
        // 6. Update Firestore
        try {
             const userRef = doc(fbDB, 'user_data', user.uid, 'profile', 'settings');
             await updateDoc(userRef, { mfa_enabled: true });
        } catch(e) { console.log("Profile update skipped"); }

        showToast("Success", "MFA Enabled! Please login again.", "success");
        setTimeout(() => location.reload(), 1500);

    } catch (error) {
        console.error(error);
        showToast("Error", "MFA Setup Failed: " + error.message, "error");
        
        // Reset Recaptcha on error
        if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch(e){}
            window.recaptchaVerifier = null;
        }
    }
}

// INTEGRATION BUG FIX: Removed the locally defined setLoadingState function.
// The imported version from app-shell.js will be used.