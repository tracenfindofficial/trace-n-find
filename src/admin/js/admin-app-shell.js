/*
 * ======================================================================
 * ADMIN APP SHELL (Fixed)
 * ======================================================================
 */

// --- Firebase Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut,
    sendPasswordResetEmail,
    updateProfile // Added for settings-logic.js
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, // Added for settings-logic.js
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
import { 
    showToast, 
    showModal, 
    hideModal, 
    setLoadingState,
    sanitizeHTML // Added for settings-logic.js
} from '../../app/js/shared-utils.js';

// --- Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyAokTU8XIKQcaFv9RBVWMs_8iGEcni6sY4",
  authDomain: "trace-n--find.firebaseapp.com",
  projectId: "trace-n--find",
  storageBucket: "trace-n--find.firebasestorage.app",
  messagingSenderId: "1000921948484",
  appId: "1:1000921948484:web:92d821bd2cf4f2e5a67711",
  measurementId: "G-6BFEZXMG57"
};

// --- Exports ---
export const fbApp = initializeApp(firebaseConfig);
export const fbAuth = getAuth(fbApp);
export const fbDB = getFirestore(fbApp, "tracenfind");

// --- Global State ---
// Added to satisfy settings-logic.js imports
export const appState = {
    currentUser: null
};

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
    logoutButtons: document.querySelectorAll('.logout-button'),
    preloader: document.getElementById('app-preloader'),
    toastContainer: document.getElementById('toastContainer')
};

/**
 * Initializes all Firebase services
 */
function initFirebase() {
    try {
        onAuthStateChanged(fbAuth, (user) => {
            if (user) {
                checkAdminRole(user);
            } else {
                redirectToLogin();
            }
        });
    } catch (error) {
        console.error("Critical Firebase Init Error:", error);
    }
}

/**
 * Checks if the logged-in user is an admin.
 */
async function checkAdminRole(user) {
    const docRef = doc(fbDB, 'user_data', user.uid, 'profile', 'settings');
    try {
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists() && docSnap.data().role === 'admin') {
            window.currentUserId = user.uid;
            window.currentUserIsAdmin = true;
            
            // Populate appState for other files to use
            appState.currentUser = { ...user, ...docSnap.data() };

            initializeAppShell(user, docSnap.data());
        } else {
            logout();
        }
    } catch (error) {
        console.error("Auth Guard Error:", error);
        logout();
    }
}

function redirectToLogin() {
    window.location.replace(`${location.origin}/public/auth/login.html`);
}

async function logout() {
    try {
        await signOut(fbAuth);
    } catch (error) {
        console.error("Logout Error:", error);
    } finally {
        redirectToLogin();
    }
}

function initializeAppShell(user, profile) {
    populateUserInfo(user, profile);
    setupShellEventListeners();
    
    const savedTheme = profile.theme || localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    
    const sidebarMini = localStorage.getItem('adminSidebarMini') === 'true';
    applySidebarState(sidebarMini);
    
    if (gElements.preloader) {
        gElements.preloader.style.opacity = '0';
        setTimeout(() => gElements.preloader.style.display = 'none', 300);
    }
}

function setupShellEventListeners() {
    if (gElements.sidebarToggle) gElements.sidebarToggle.addEventListener('click', toggleSidebar);
    if (gElements.mobileMenuToggle) {
        gElements.mobileMenuToggle.addEventListener('click', () => {
            gElements.sidebar.classList.add('open');
            gElements.sidebar.classList.remove('-translate-x-full');
        });
    }
    if (gElements.themeToggle) gElements.themeToggle.addEventListener('click', toggleTheme);
    if (gElements.userMenuToggle) {
        gElements.userMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            gElements.userMenu.classList.toggle('hidden');
        });
    }
    gElements.logoutButtons.forEach(btn => btn.addEventListener('click', logout));

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

function populateUserInfo(user, profile) {
    const name = profile.fullName || user.displayName || 'Admin';
    const email = user.email || 'admin@tracenfind.com';
    const avatarUrl = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4361ee&color=fff&size=40`;
    
    gElements.userNameDisplays.forEach(el => el.textContent = name);
    gElements.userAvatarDisplays.forEach(el => el.src = avatarUrl);
    if (gElements.userEmailDisplay) gElements.userEmailDisplay.textContent = email;
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const themeIcon = gElements.themeToggle.querySelector('i');
    if (themeIcon) {
        themeIcon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
}

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
    setTimeout(() => window.dispatchEvent(new Event('appResize')), 300);
}

// --- Start Application ---
initFirebase();

// --- RE-EXPORTS (Crucial for other logic files) ---
export {
    // Firebase Firestore
    doc,
    getDoc,
    setDoc, // Fixed: Exported now
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

    // Firebase Auth
    sendPasswordResetEmail,
    updateProfile, // Fixed: Exported now

    // UI Utilities
    showToast,
    showModal,
    hideModal,
    setLoadingState,
    sanitizeHTML // Fixed: Exported now
};