// TraceN Find/app/js/app-shell.js (FINAL CORRECTED VERSION)

// --- Libraries ---
// MODIFICATION: Updated all Firebase SDK imports to 12.6.0
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut, 
    updateProfile, 
    RecaptchaVerifier, 
    PhoneAuthProvider, 
    PhoneMultiFactorGenerator, 
    multiFactor 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

// BUG FIX: Added 'addDoc', 'getDocs', 'deleteDoc' to the import list
import { 
    getFirestore, 
    doc, 
    getDoc, 
    getDocs, 
    onSnapshot, 
    collection, 
    query, 
    orderBy, 
    where, 
    updateDoc, 
    setDoc, 
    serverTimestamp, 
    limit, 
    deleteDoc, 
    addDoc, 
    writeBatch 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";

import { 
    showToast, 
    showModal, 
    hideModal, 
    setLoadingState, 
    formatTimeAgo, 
    formatDateTime, 
    getDeviceIcon, 
    getDeviceColor, 
    getBatteryIcon, 
    debounce, 
    sanitizeHTML 
} from '/app/js/shared-utils.js';

// --- CRITICAL FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyAokTU8XIKQcaFv9RBVWMs_8iGEcni6sY4",
  authDomain: "trace-n--find.firebaseapp.com",
  projectId: "trace-n--find",
  storageBucket: "trace-n--find.firebasestorage.app",
  messagingSenderId: "1000921948484",
  appId: "1:1000921948484:web:92d821bd2cf4f2e5a67711",
  measurementId: "G-6BFEZXMG57"
};
// --- END CONFIGURATION ---

// --- GLOBALS ---
const app = initializeApp(firebaseConfig);
export const fbAuth = getAuth(app);
export const fbDB = getFirestore(app, "tracenfind");
export const fbStorage = getStorage(app);

// --- AUDIO SETUP (Global) ---
// Loads the kurukuru sound for notifications
const notificationSound = new Audio('/public/assets/audio/kurukuru.mp3');
let isFirstNotificationLoad = true;

// NOTE: window.librariesLoaded should be set true by the end of DOMContentLoaded if all required global libraries (Leaflet, Chart) are present.
// For this environment, we explicitly set it true later to ensure dependent modules run.
window.librariesLoaded = false;

// MODIFICATION: Changed to 'const' to prevent accidental reassignment of the state object.
export const appState = {
    isAuthenticated: false,
    currentUser: null,
    isSidebarMini: false,
    userDevices: [],
    // BUG FIX: Removed all the Firebase functions from this object.
    // They were not being exported correctly.
    previousDevices: {},
    isFirstLoad: true
};

let unsubscribeDevices = null;
let unsubscribeNotifications = null;

// --- EXPOSED UTILITY FUNCTIONS ---
// Export common utility functions used across different page logics
export { 
    updateProfile, 
    signOut, 
    ref, 
    uploadBytes, 
    getDownloadURL, 
    onAuthStateChanged, 
    RecaptchaVerifier, 
    PhoneAuthProvider, 
    PhoneMultiFactorGenerator, 
    multiFactor 
};

export { 
    showToast, 
    showModal, 
    hideModal, 
    setLoadingState, 
    formatTimeAgo, 
    formatDateTime,
    getDeviceIcon, 
    getDeviceColor, 
    getBatteryIcon, 
    debounce, 
    sanitizeHTML 
};

// --- SHARED SECURITY CONFIGURATION ---
export const SECURITY_BUTTONS = [
    { id: 'action-ring', icon: 'bi-bell-fill', label: 'Sound Alarm', type: 'info', textClass: 'text-blue-500' },
    { id: 'action-view-photos', icon: 'bi-images', label: 'View Photos', type: 'primary', textClass: 'text-indigo-500' },
    { id: 'action-view-messages', icon: 'bi-chat-quote-fill', label: 'View Messages', type: 'success', textClass: 'text-green-500' },
    { id: 'action-lost', icon: 'bi-exclamation-diamond-fill', label: 'Mark as Lost', type: 'danger', textClass: 'text-red-500' },
];

//
// BUG FIX: Add a new export block for all required Firestore functions.
// This will fix the "does not provide an export" errors in your other files.
//
export {
    collection,
    doc,
    getDoc,
    getDocs,
    writeBatch,
    query,
    orderBy,
    limit,
    where,
    onSnapshot,
    updateDoc,
    setDoc,
    deleteDoc,
    serverTimestamp,
    addDoc // This was the one causing the crash
};

// --- DOM ELEMENTS ---
const elements = {
    // Shell elements
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    mainContentArea: document.getElementById('main-content-area'),
    mobileMenuToggle: document.getElementById('mobileMenuToggle'),
    appPreloader: document.getElementById('app-preloader'),
    
    // Auth/User elements
    logoutButton: document.getElementById('logoutButton'),
    logoutButtonUserMenu: document.getElementById('logoutButtonUserMenu'),
    userMenuToggle: document.getElementById('userMenuToggle'),
    userMenu: document.getElementById('userMenu'),
    userAvatarDisplay: document.querySelectorAll('.user-avatar-display'),
    userNameDisplay: document.querySelectorAll('.user-name-display'),
    userEmail: document.getElementById('userEmail'),
    
    // UI elements
    themeToggle: document.getElementById('themeToggle'),
    toastContainer: document.getElementById('toastContainer'),
    confirmationModal: document.getElementById('confirmationModal'),
    modalClose: document.getElementById('modalClose'),
    modalTitle: document.getElementById('modalTitle'),
    modalMessage: document.getElementById('modalMessage'),
    modalConfirm: document.getElementById('modalConfirm'),
    modalCancel: document.getElementById('modalCancel'),
    
    // Sidebar elements
    sidebarDeviceCount: document.getElementById('sidebarDeviceCount'),
    
    // Notification elements (Global)
    notificationBadge: document.getElementById('notificationBadge')
};

// --- AUTHENTICATION & INITIALIZATION ---

// *** REDIRECT LOOP FIX ***
let authReady = false;

onAuthStateChanged(fbAuth, (user) => {
    // Mark that Firebase has given its first response
    authReady = true; 

    if (user) {
        // User is logged in, this is good.
        appState.isAuthenticated = true;
        appState.currentUser = {
            uid: user.uid,
            displayName: user.displayName || 'User',
            email: user.email,
            photoURL: user.photoURL || 'https://ui-avatars.com/api/?name=' + (user.displayName || 'User') + '&background=4361ee&color=fff'
        };
        
        // Expose UID globally for legacy or specific modules
        window.currentUserId = user.uid; 
        
        // 1. Fetch profile (This function will hide the preloader on success)
        fetchUserProfile(user.uid);
        
        // 2. Load devices listener
        listenForUserDevices(user.uid);
        
        // 3. Start Global Notification Listener (Sound + Badge)
        initGlobalNotifications(user.uid);

        loadPageSpecificLibraries();

    } else {
        // User is null.
        appState.isAuthenticated = false;
        appState.currentUser = null;
        
        if (unsubscribeDevices) {
            unsubscribeDevices();
            unsubscribeDevices = null;
        }
        if (unsubscribeNotifications) {
            unsubscribeNotifications();
            unsubscribeNotifications = null;
        }
        
        // *** REDIRECT LOOP FIX ***
        // Only redirect to login IF we are currently on an app page
        if (window.location.pathname.startsWith('/app/')) {
            console.log("Auth state is null on app page. Redirecting to login.");
            // **INTEGRATION FIX**: Use root-relative path
            window.location.href = '/public/auth/login.html';
        } else {
            // We are on a public page (like /public/auth/login.html)
            // and auth is null, which is correct. Just hide the preloader.
            hidePreloader();
        }
    }
});

// *** REDIRECT LOOP FIX ***
setTimeout(() => {
    if (!authReady && window.location.pathname.startsWith('/app/')) {
        console.warn("Auth initialization timeout. Forcing redirect.");
        // **INTEGRATION FIX**: Use root-relative path
        window.location.href = '/public/auth/login.html';
    } else if (!authReady) {
        // We're on a public page and auth is slow, just show the page.
        hidePreloader();
    }
}, 2500); // 2.5 second timeout

// --- GLOBAL NOTIFICATION LOGIC (Sound + Badge + Deduplication) ---
function initGlobalNotifications(userId) {

    if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
    }

    const notifsRef = collection(fbDB, 'user_data', userId, 'notifications');
    // Only listen for unread notifications to be efficient
    const q = query(notifsRef, where("read", "==", false));

    unsubscribeNotifications = onSnapshot(q, (snapshot) => {
        // FIX: Previously we just did snapshot.size, which counted duplicates.
        // Now we fetch the data and deduplicate it before counting.
        
        const rawNotifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // CRITICAL FIX: Sort client-side by timestamp descending.
        // This ensures consistent deduplication with the Notification Page logic.
        // Without this, 'getUniqueNotifications' might process items in a different order
        // (e.g., ID order) and pick a different "unique" item, leading to mismatched counts.
        rawNotifications.sort((a, b) => getTimestampMs(b) - getTimestampMs(a));

        const uniqueNotifications = getUniqueNotifications(rawNotifications);
        const count = uniqueNotifications.length;
        
        // 1. Update All Badges (Header, Sidebar, etc.)
        updateGlobalBadges(count);

        // 2. Play Sound Logic (Only if NEW items added to the raw list)
        if (!isFirstNotificationLoad) {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    // We play sound even for duplicates because the event physically happened
                    // but we could limit this if it's too noisy.
                    try {
                        notificationSound.currentTime = 0; // Reset to start
                        notificationSound.play().catch(e => console.warn("Audio autoplay blocked:", e));
                    } catch (e) {
                        console.warn("Could not play notification sound", e);
                    }
                }
            });
        } else {
            // Skip sound on the very first load (so it doesn't ding on page refresh)
            isFirstNotificationLoad = false;
        }

    }, (error) => {
        console.error("Error listening for global notifications:", error);
    });
}

// --- Helper Functions for Notifications ---

function updateGlobalBadges(count) {
    // Identify ALL badge elements on the page (Header, Sidebar, Mobile Menu)
    const badgeSelectors = [
        '#notificationBadge',           // Main Header Badge
        '#sidebar-notification-count',  // Sidebar Badge (Common ID)
        '.notification-badge',          // Generic Class
        '.badge-notification',          // Generic Class
        '[data-notification-count]'     // Data Attribute
    ];
    
    // Combine selectors and find all matching elements
    const badges = document.querySelectorAll(badgeSelectors.join(','));

    badges.forEach(badge => {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.classList.remove('hidden');
            badge.style.display = ''; 
            badge.classList.add('animate-pulse');
        } else {
            badge.classList.add('hidden');
            badge.style.display = 'none';
            badge.classList.remove('animate-pulse');
        }
    });

    // Update Title
    if (count > 0) {
        document.title = `(${count}) ${document.title.replace(/^\(\d+\)\s/, '')}`;
    } else {
        document.title = document.title.replace(/^\(\d+\)\s/, '');
    }
}

/**
 * Filters the raw list to show only unique notifications.
 * (Ported from notifications-logic.js to ensure global consistency)
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

/**
 * Dynamically loads a JavaScript file.
 * @param {string} src - The URL of the script.
 * @returns {Promise<void>}
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

/**
 * Dynamically loads a CSS file.
 * @param {string} href - The URL of the stylesheet.
 * @returns {Promise<void>}
 */
function loadCSS(href) {
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`));
        document.head.appendChild(link);
    });
}

/**
 * Loads page-specific libraries (Google Maps, Chart.js) based on the current page.
 * This is more efficient than loading everything on every page.
 */
async function loadPageSpecificLibraries() {
    const path = window.location.pathname;
    const promises = [];

    // --- Google Maps (Replaces Leaflet) ---
    // Needed on: dashboard, map-view, geofencing, location-history, device-details
    if (path.includes('/dashboard') || path.includes('/map-view') || path.includes('/geofencing') || path.includes('/location-history') || path.includes('/device-details')) {
        // Check if Google Maps is already loaded
        if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
            console.log("AppShell: Loading Google Maps...");
            // Using the user-provided API Key
            promises.push(loadScript('https://maps.googleapis.com/maps/api/js?key=AIzaSyAz4BSg4UhLy-ulJScq2g5SGCBsIlLx0ZU&libraries=marker,geometry,drawing'));
            
            // Load MarkerClusterer for Google Maps
            promises.push(loadScript('https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js'));
        }
    }

    // --- Chart.js (for charts) ---
    // Needed on: dashboard, device-details
    if (path.includes('/dashboard') || path.includes('/device-details')) {
        console.log("AppShell: Loading Chart.js...");
        promises.push(loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js'));
    }

    try {
        await Promise.all(promises);
        console.log("AppShell: All page-specific libraries loaded.");
        window.librariesLoaded = true;
        // Dispatch an event that logic files (like dashboard-logic.js) can listen for.
        window.dispatchEvent(new CustomEvent('librariesLoaded')); 
    } catch (error) {
        console.error("AppShell: Failed to load critical libraries.", error);
        showToast('Error', 'Failed to load page resources. Please refresh.', 'error');
    }
}

/**
 * Fetches user profile from Firestore to get additional details (like username).
 * @param {string} uid - The user's unique ID.
 */
async function fetchUserProfile(uid) {
    // Define a robust fallback profile in case Firestore access fails
    const fallbackProfile = {
        fullName: appState.currentUser.displayName || 'User',
        email: appState.currentUser.email || '',
        theme: 'dark', 
        role: 'user',
        plan: 'free',
        userId: uid
    };

    try {
        // *** DATABASE PATH FIX ***
        // This is the CRITICAL path to the user's settings document.
        const settingsDocRef = doc(fbDB, "user_data", uid, "profile", "settings");
        const settingsSnap = await getDoc(settingsDocRef);
        
        let firestoreData = {};
        if (settingsSnap.exists()) {
            firestoreData = { ...settingsSnap.data() };
        }

        if (Object.keys(firestoreData).length > 0) {
            // Success: Merge Firestore data with auth data
            // Use fullName from DB if it exists, otherwise fall back to displayName
            firestoreData.displayName = firestoreData.fullName || appState.currentUser.displayName;
            appState.currentUser = { ...appState.currentUser, ...firestoreData }; 
            populateUserInfo(appState.currentUser);
        } else {
            // Document not found - fall back to defaults and show warning
            console.warn("User profile document not found in Firestore. Using fallback data.");
            appState.currentUser = { ...appState.currentUser, ...fallbackProfile };
            populateUserInfo(appState.currentUser);
            showToast('Warning', 'Profile incomplete. Loading defaults.', 'warning'); 
        }
    } catch (error) {
        // CRITICAL: Handle the error (e.g., permission denied, network) but use the fallback data
        console.error("CRITICAL ERROR: Failed to fetch profile data. Check network/rules.", error);
        appState.currentUser = { ...appState.currentUser, ...fallbackProfile };
        populateUserInfo(appState.currentUser);
        // MODIFICATION: Upgraded toast to 'error' for severity.
        showToast('Error', 'Profile fetch failed. Loading defaults.', 'error'); 
    }
    
    // FIX: Hide the preloader only after the data fetch attempt is complete.
    hidePreloader();
}

/**
 * Sets up a real-time listener for the user's devices in Firestore.
 * @param {string} userId - The authenticated user's ID.
 */
function listenForUserDevices(userId) {

    if (unsubscribeDevices) {
        unsubscribeDevices();
        unsubscribeDevices = null;
    }

    // *** DATABASE PATH FIX ***
    // This path now correctly matches firestore.rules and auth.js.
    const devicesRef = collection(fbDB, 'user_data', userId, 'devices'); 
    const q = query(devicesRef, orderBy('name', 'asc'));

    unsubscribeDevices = onSnapshot(q, (snapshot) => {
        appState.userDevices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Update the device count badge in the sidebar
        if (elements.sidebarDeviceCount) {
            const count = appState.userDevices.length;
            elements.sidebarDeviceCount.textContent = count;
            elements.sidebarDeviceCount.classList.toggle('hidden', count === 0);
        }
        // Signal that device data has loaded (used by map-view, dashboard)
        window.dispatchEvent(new CustomEvent('devicesLoaded', { detail: appState.userDevices }));

        checkDeviceStatusChanges(userId, appState.userDevices);

    }, (error) => {
        console.error("Error listening for user devices:", error);
    });
}

// --- UI POPULATION & EVENT LISTENERS ---

function populateUserInfo(user) {
    // Use displayName, which is now populated from fullName or auth display name
    elements.userNameDisplay.forEach(el => el.textContent = user.displayName || 'User');
    if (elements.userEmail) elements.userEmail.textContent = user.email || '';
    elements.userAvatarDisplay.forEach(el => el.src = user.photoURL);
    // Apply the theme from the user's profile
    applyTheme(user.theme || 'light');
}

document.addEventListener('DOMContentLoaded', () => {
    // Check and apply theme preference from localStorage *first*
    // This will be overridden by the user's profile theme once it loads.
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    
    setupShellListeners();
});

// --- UI FUNCTIONS ---

function setupShellListeners() {
    // Sidebar toggle (desktop)
    elements.sidebarToggle?.addEventListener('click', toggleSidebar);

    // Mobile menu toggle
    elements.mobileMenuToggle?.addEventListener('click', () => {
        elements.sidebar?.classList.toggle('-translate-x-full');
        elements.sidebar?.classList.toggle('open');
    });

    // Theme toggle
    elements.themeToggle?.addEventListener('click', toggleTheme);

    // Logout buttons
    elements.logoutButton?.addEventListener('click', handleLogout);
    elements.logoutButtonUserMenu?.addEventListener('click', handleLogout);

    // User menu toggle
    elements.userMenuToggle?.addEventListener('click', toggleUserMenu);
    
    // Close user menu on outside click
    document.addEventListener('click', (event) => {
        if (elements.userMenu && !elements.userMenu.contains(event.target) && !elements.userMenuToggle.contains(event.target)) {
            elements.userMenu.classList.add('hidden');
        }
    });

    // Window resize listener to handle map resizing (for map-view.js)
    window.addEventListener('resize', () => {
         // Debounce event if necessary, but dispatching is fine for a custom event
         window.dispatchEvent(new Event('appResize'));
    });
}

function toggleSidebar() {
    elements.sidebar?.classList.toggle('sidebar-mini');
    // This class doesn't seem to be used, but we'll keep it for now.
    elements.mainContentArea?.classList.toggle('sidebar-mini'); 
    
    appState.isSidebarMini = !appState.isSidebarMini;
    
    // Toggle icon
    const icon = elements.sidebarToggle.querySelector('i');
    icon.classList.toggle('bi-chevron-bar-left');
    icon.classList.toggle('bi-chevron-bar-right');
    
    // Dispatch resize event to trigger map invalidation
    // Add a slight delay to allow sidebar animation to start
    setTimeout(() => window.dispatchEvent(new Event('appResize')), 100);
}

function toggleUserMenu() {
    elements.userMenu?.classList.toggle('hidden');
}

function handleLogout() {
    showModal('Confirm Logout', 'Are you sure you want to log out?', 'danger', () => {
            signOut(fbAuth).then(() => {
            // Cleanup state
            appState.isAuthenticated = false;
            appState.currentUser = null;
            localStorage.removeItem('theme'); // Clear theme to reset on next load
            // **INTEGRATION FIX**: Use root-relative path
            window.location.href = '/public/auth/login.html';
        }).catch((error) => {
            showToast('Error', 'Logout failed: ' + error.message, 'error');
        });
    });
}

function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') {
        theme = 'light'; // Default to light theme if value is invalid
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    
    if (elements.themeToggle) {
        const icon = elements.themeToggle.querySelector('i');
        if (icon) {
            icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
        }
    }
    
    localStorage.setItem('theme', theme);
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: theme } }));
}

async function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    
    // Save theme to user's profile in Firestore
    if (appState.currentUser) {
        try {
            // *** DATABASE PATH FIX ***
            const settingsRef = doc(fbDB, 'user_data', appState.currentUser.uid, 'profile', 'settings');
            await setDoc(settingsRef, { theme: newTheme }, { merge: true });
        } catch (error) {
            console.warn("Could not save theme to profile:", error);
        }
    }
}

function hidePreloader() {
    if (elements.appPreloader) {
        elements.appPreloader.style.opacity = '0';
        setTimeout(() => {
            if (elements.appPreloader) elements.appPreloader.style.display = 'none';
        }, 300);
    }
}

// --- GLOBAL DEVICE MONITORING LOGIC ---

function checkDeviceStatusChanges(userId, currentDevices) {
    if (appState.isFirstLoad) {
        // Initialize cache on first load
        currentDevices.forEach(device => {
            appState.previousDevices[device.id] = { ...device };
        });
        appState.isFirstLoad = false;
        return;
    }

    currentDevices.forEach(device => {
        const prev = appState.previousDevices[device.id];
        if (!prev) {
            appState.previousDevices[device.id] = { ...device };
            return;
        }

        // 1. Detect Tracking START (Offline -> Online)
        if (prev.status !== 'online' && device.status === 'online') {
            createAutoNotification(userId, device, 'tracking-start');
        }

        // 2. Detect Tracking STOP (Any -> Offline)
        if (prev.status !== 'offline' && device.status === 'offline') {
            createAutoNotification(userId, device, 'tracking-stop');
        }

        // 3. Detect SIM Eject / Change
        if (prev.security?.sim_status && device.security?.sim_status && 
            prev.security.sim_status !== device.security.sim_status && 
            device.security.sim_status.includes("🚨")) {
             createAutoNotification(userId, device, 'sim-alert');
        }

        // 4. Detect Finder Message
        if (device.finder_message && (!prev || prev.finder_message !== device.finder_message)) {
             createAutoNotification(userId, device, 'finder-message');
        }

        // 5. Detect Finder Photo
        if (device.finder_photo_url && (!prev || prev.finder_photo_url !== device.finder_photo_url)) {
             createAutoNotification(userId, device, 'finder-photo');
        }

        // Update Cache
        appState.previousDevices[device.id] = { ...device };
    });
}

async function createAutoNotification(userId, device, type) {
    const safeName = sanitizeHTML(device.name);
    let title, message, notifType, toastType;

    switch(type) {
        case 'tracking-start':
            title = 'Tracking Started';
            message = `${safeName} is now online and tracking.`;
            notifType = 'tracking-start'; 
            toastType = 'success';
            break;
        case 'tracking-stop':
            title = 'Tracking Stopped';
            message = `${safeName} has gone offline.`;
            notifType = 'tracking-stop';
            toastType = 'warning';
            break;
        case 'sim-alert':
            title = 'SIM Security Alert';
            message = `Critical: ${device.security.sim_status} detected on ${safeName}!`;
            notifType = 'sim-alert';
            toastType = 'error';
            break;
        case 'finder-message':
            title = 'New Message from Finder';
            message = `Message received from ${safeName}: "${sanitizeHTML(device.finder_message)}"`;
            notifType = 'message-received';
            toastType = 'info';
            break;
        case 'finder-photo':
            title = 'New Photo from Finder';
            message = `A new photo was captured from ${safeName}.`;
            notifType = 'photo-received';
            toastType = 'info';
            break;
        default:
            return;
    }

    // 1. Show Visual Toast (Always show this locally so the user sees it immediately)
    showToast(title, message, toastType);

    // --- FIX: DEDUPLICATION LOGIC ---
    // Check if a similar notification exists in the last 10 seconds to prevent
    // multiple tabs from creating the same notification.
    try {
        const notifsRef = collection(fbDB, 'user_data', userId, 'notifications');
        // Fetch only the 3 most recent notifications
        const q = query(notifsRef, orderBy('timestamp', 'desc'), limit(3));
        const snapshot = await getDocs(q);

        const isDuplicate = snapshot.docs.some(doc => {
            const data = doc.data();
            // Check if title matches AND it was created less than 10 seconds ago
            const now = new Date();
            const notifTime = data.timestamp ? data.timestamp.toDate() : new Date();
            const diffSeconds = (now - notifTime) / 1000;
            
            return data.title === title && data.message === message && diffSeconds < 10;
        });

        if (isDuplicate) {
            console.log(`Duplicate notification prevented: ${title}`);
            return; // STOP here, don't save to DB
        }

        // 2. If not duplicate, Save to Database
        await addDoc(notifsRef, {
            title: title,
            message: message,
            type: notifType,
            read: false,
            timestamp: serverTimestamp()
        });
        console.log(`Global Notification created: ${type}`);

    } catch(e) {
        console.error("Error managing notifications:", e);
    }
}