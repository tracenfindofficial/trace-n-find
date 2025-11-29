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
    showToast,
    showModal,
    setLoadingState,
    updateProfile,
    sanitizeHTML
} from './app-shell.js'; // Use relative path

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
    sidebarUserName: document.querySelector('.user-name-display'),
    sidebarUserEmail: document.getElementById('userEmail'),
    allUserAvatars: document.querySelectorAll('.user-avatar-display'), // Gets header + sidebar
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
    elements.themeToggleSwitch.checked = currentTheme === 'dark';
}


/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners(userId) {
    elements.profileForm.addEventListener('submit', (e) => handleSaveProfile(e, userId));
    
    elements.preferencesForm.addEventListener('submit', (e) => handleSavePreferences(e, userId));
    
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


        // 4. Update UI dynamically
        if (elements.sidebarUserName) {
            elements.sidebarUserName.textContent = newName;
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
            // 1. Call a Cloud Function: `httpsB.onCall('deleteUserAccount')`
            // 2. The function would delete all subcollections (devices, geofences, etc.)
            // 3. The function would delete the user's auth record.
            // 4. The client would then sign out and redirect.
        },
        null, // onCancel
        { isHTML: true } // DESIGN/AESTHETICS FIX: Pass options object to render HTML
    );
}

// INTEGRATION BUG FIX: Removed the locally defined setLoadingState function.
// The imported version from app-shell.js will be used.