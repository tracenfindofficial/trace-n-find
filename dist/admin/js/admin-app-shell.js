/*
 * ======================================================================
 * ADMIN APP SHELL
 * ======================================================================
 *
 * This file is the central JS entry point for the ENTIRE Admin Panel.
 * It handles:
 * 1. Firebase Initialization
 * 2. CRITICAL: Admin Authentication & Security Guard
 * 3. Global UI elements (Sidebar, Header, Theme Toggle, Modals, Toasts)
 * 4. Exports all necessary functions (Firebase utils, UI utils)
 *
 * This is a MODIFIED version of the user-facing app-shell.js.
 */

// --- Firebase Imports ---
// MODIFICATION: Updated all Firebase SDK imports to 12.6.0 for consistency.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut,
    sendPasswordResetEmail // Added for admin settings page
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    collection,
    onSnapshot,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
    collectionGroup
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { showToast, showModal, hideModal, setLoadingState } from '../app/js/shared-utils.js';

// ---
// CRITICAL FIX: The firebaseConfig was using placeholders.
// This is the correct config from your auth.js and app-shell.js files.
// ---
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAokTU8XIKQcaFv9RBVWMs_8iGEcni6sY4",
  authDomain: "trace-n--find.firebaseapp.com",
  projectId: "trace-n--find",
  storageBucket: "trace-n--find.firebasestorage.app",
  messagingSenderId: "1000921948484",
  appId: "1:1000921948484:web:92d821bd2cf4f2e5a67711",
  measurementId: "G-6BFEZXMG57"
};

// --- Firebase Exports ---
// MODIFICATION: Initialized as const and exported directly.
export const fbApp = initializeApp(firebaseConfig);
export const fbAuth = getAuth(fbApp);
export const fbDB = getFirestore(fbApp, "tracenfind");

// --- Global DOM Elements ---
const gElements = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    mobileMenuToggle: document.getElementById('mobileMenuToggle'),
    mainContent: document.querySelector('.main-content'),
    themeToggle: document.getElementById('themeToggle'),
    userMenuToggle: document.getElementById('userMenuToggle'),
    userMenu: document.getElementById('userMenu'),
    userAvatarDisplays: document.querySelectorAll('.user-avatar-display'),
    userNameDisplays: document.querySelectorAll('.user-name-display'),
    userEmailDisplay: document.getElementById('userEmail'),
    logoutButtons: document.querySelectorAll('.logout-button'), // Catches both
    preloader: document.getElementById('app-preloader'),
    toastContainer: document.getElementById('toastContainer'),
    // Modal Elements (matches user-facing app-shell.js)
    modal: document.getElementById('confirmationModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalMessage: document.getElementById('modalMessage'),
    modalConfirm: document.getElementById('modalConfirm'),
    modalCancel: document.getElementById('modalCancel'),
    modalClose: document.getElementById('modalClose'),
};

/**
 * Initializes all Firebase services
 */
function initFirebase() {
    try {
        // **AUTH GUARD**
        // This runs immediately. It's the security for the *entire* admin panel.
        onAuthStateChanged(fbAuth, (user) => {
            if (user) {
                // 1. User is logged in. Now, check if they are an admin.
                console.log("Admin Shell: User authenticated. Checking admin role...");
                checkAdminRole(user);
            } else {
                // 2. No user is logged in. Redirect to login.
                console.warn("Admin Shell: No user found. Redirecting to login.");
                redirectToLogin();
            }
        });

    } catch (error) {
        console.error("Critical Firebase Init Error:", error);
        document.body.innerHTML = "<h1>Error: Could not connect to Firebase.</h1>";
    }
}

/**
 * SECURITY: Checks if the logged-in user has the 'admin' role in Firestore.
 * If not, logs them out and redirects.
 * @param {object} user - The Firebase Auth user object.
 */
async function checkAdminRole(user) {
    // INTEGRATION FIX: This path MUST match your auth.js registration
    // and your firestore.rules.
    const docRef = doc(fbDB, 'user_data', user.uid, 'profile', 'settings');
    try {
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists() && docSnap.data().role === 'admin') {
            // --- ADMIN ACCESS GRANTED ---
            console.log("Auth Guard: Admin access GRANTED.");
            window.currentUserId = user.uid;
            window.currentUserIsAdmin = true; // Flag for page-specific logic
            
            // User is an admin, proceed to load the app
            initializeAppShell(user, docSnap.data());
            
        } else {
            // --- ACCESS DENIED: Not an admin ---
            console.warn("Auth Guard: Access DENIED. User is not an admin.");
            logout();
        }
    } catch (error) {
        // --- ACCESS DENIED: Error ---
        console.error("Auth Guard: Error checking admin role:", error);
        logout();
    }
}

/**
 * Redirects the user to the login page.
 */
function redirectToLogin() {
    // INTEGRATION FIX: Use origin-based absolute URL to public auth for reliability.
    window.location.replace(`${location.origin}/public/auth/login.html`);
}

/**
 * Logs the user out and redirects to login.
 */
async function logout() {
    try {
        await signOut(fbAuth);
    } catch (error) {
        console.error("Logout Error:", error);
    } finally {
        redirectToLogin();
    }
}

/**
 * Runs after the user is confirmed as an admin.
 * @param {object} user - The Firebase Auth user object.
 * @param {object} profile - The user's profile data from Firestore.
 */
function initializeAppShell(user, profile) {
    // 1. Populate UI
    populateUserInfo(user, profile);
    
    // 2. Set up listeners
    setupShellEventListeners();
    
    // 3. Load theme
    const savedTheme = profile.theme || localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    
    // 4. Load sidebar state
    const sidebarMini = localStorage.getItem('adminSidebarMini') === 'true';
    applySidebarState(sidebarMini);
    
    // 5. Hide preloader
    if (gElements.preloader) {
        gElements.preloader.style.opacity = '0';
        setTimeout(() => gElements.preloader.style.display = 'none', 300);
    }
}

/**
 * Attaches all event listeners for the shared admin shell.
 */
function setupShellEventListeners() {
    if (gElements.sidebarToggle) {
        gElements.sidebarToggle.addEventListener('click', toggleSidebar);
    }
    if (gElements.mobileMenuToggle) {
        gElements.mobileMenuToggle.addEventListener('click', () => {
            gElements.sidebar.classList.add('open');
            gElements.sidebar.classList.remove('-translate-x-full');
        });
    }
    if (gElements.themeToggle) {
        gElements.themeToggle.addEventListener('click', toggleTheme);
    }
    if (gElements.userMenuToggle) {
        gElements.userMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            gElements.userMenu.classList.toggle('hidden');
        });
    }
    gElements.logoutButtons.forEach(btn => btn.addEventListener('click', logout));

    // MODIFICATION: Removed old modal listeners.
    // The new showModal function handles its own listeners dynamically.

    // Global click listener to close menus
    document.addEventListener('click', (e) => {
        if (gElements.userMenu && !gElements.userMenu.contains(e.target) && !gElements.userMenuToggle.contains(e.target)) {
            gElements.userMenu.classList.add('hidden');
        }
        if (window.innerWidth < 1024 && gElements.sidebar && !gElements.sidebar.contains(e.target) && !gElements.mobileMenuToggle.contains(e.target)) {
            gElements.sidebar.classList.remove('open');
            gElements.sidebar.classList.add('-translate-x-full');
        }
    });
}

/**
 * Populates all user-info elements in the shell.
 * @param {object} user - The Firebase Auth user object.
 * @param {object} profile - The user's profile data from Firestore.
 */
function populateUserInfo(user, profile) {
    const name = profile.fullName || user.displayName || 'Admin';
    const email = user.email || 'admin@tracenfind.com';
    const avatarUrl = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4361ee&color=fff&size=40`;
    
    gElements.userNameDisplays.forEach(el => el.textContent = name);
    gElements.userAvatarDisplays.forEach(el => el.src = avatarUrl);
    if (gElements.userEmailDisplay) gElements.userEmailDisplay.textContent = email;
}

// --- Theme ---
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    // You could also save this to the admin's profile doc in Firestore
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const themeIcon = gElements.themeToggle.querySelector('i');
    if (themeIcon) {
        themeIcon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
    // Dispatch event for charts
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
}

// --- Sidebar ---
function toggleSidebar() {
    const isMini = gElements.sidebar.classList.toggle('sidebar-mini');
    localStorage.setItem('adminSidebarMini', isMini);
    applySidebarState(isMini);
}

function applySidebarState(isMini) {
    const icon = gElements.sidebarToggle.querySelector('i');
    if (isMini && window.innerWidth >= 1024) {
        gElements.sidebar.classList.add('sidebar-mini');
        if (icon) icon.className = 'bi bi-chevron-bar-right';
    } else {
        gElements.sidebar.classList.remove('sidebar-mini');
        if (icon) icon.className = 'bi bi-chevron-bar-left';
    }
    // Dispatch event for maps/charts
    setTimeout(() => window.dispatchEvent(new Event('appResize')), 300);
}

// --- Start Application ---
initFirebase();

// --- Re-export Firebase modules for page-specific logic ---
export {
    doc,
    getDoc,
    collection,
    onSnapshot,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
    collectionGroup,
    sendPasswordResetEmail // Export for settings-logic.js
};