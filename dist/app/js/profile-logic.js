// dist/app/js/profile-logic.js

import { 
    getAuth, 
    onAuthStateChanged, 
    updateProfile, 
    updateEmail, 
    sendEmailVerification, 
    // MFA Imports
    PhoneAuthProvider,
    PhoneMultiFactorGenerator,
    RecaptchaVerifier,
    multiFactor
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    updateDoc, 
    setDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

// --- Firebase Init ---
const firebaseConfig = {
    apiKey: "AIzaSyAokTU8XIKQcaFv9RBVWMs_8iGEcni6sY4",
    authDomain: "trace-n--find.firebaseapp.com",
    projectId: "trace-n--find",
    storageBucket: "trace-n--find.firebasestorage.app",
    messagingSenderId: "1000921948484",
    appId: "1:1000921948484:web:92d821bd2cf4f2e5a67711",
    measurementId: "G-6BFEZXMG57"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "tracenfind");
const storage = getStorage(app);

// --- reCAPTCHA Configuration ---
const RECAPTCHA_SITE_KEY = '6LdnxQcsAAAAAOQl5jTa-VhC4aek_xTzDqSTp6zI';

// --- DOM Elements Cache ---
// Initialize as empty; populated by cacheDomElements()
let elements = {};

// --- State ---
let currentUser = null;
let originalData = {};

// --- Helper: executeRecaptcha ---
const executeRecaptcha = (actionName) => {
    return new Promise((resolve) => {
        if (typeof grecaptcha === 'undefined' || typeof grecaptcha.enterprise === 'undefined') {
            console.warn('reCAPTCHA Enterprise not loaded. Skipping bot check.');
            resolve(null);
            return;
        }
        grecaptcha.enterprise.ready(async () => {
            try {
                const token = await grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, {action: actionName});
                resolve(token);
            } catch (error) {
                console.warn('reCAPTCHA execution failed:', error);
                resolve(null);
            }
        });
    });
};

// --- Initialization ---
// FIX: Check readyState to ensure init runs even if DOMContentLoaded already fired
const initApp = () => {
    console.log("🚀 Initializing Profile App...");
    cacheDomElements();
    initProfile();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    // DOM is already ready (common with type="module")
    initApp();
}

function cacheDomElements() {
    elements = {
        profileForm: document.getElementById('profile-form'),
        displayNameInput: document.getElementById('profile-name'),
        emailInput: document.getElementById('profile-email'),
        phoneInput: document.getElementById('profile-phone'),
        bioInput: document.getElementById('profile-bio'),
        profileImage: document.getElementById('profile-avatar-img'),
        profileUpload: document.getElementById('profileUpload'),
        saveBtn: document.getElementById('save-profile-btn'),
        verifyEmailBtn: document.getElementById('verify-email-btn'),
        emailVerifiedBadge: document.getElementById('email-verified-badge'),
        emailUnverifiedBadge: document.getElementById('email-unverified-badge'),
        enableMfaBtn: document.getElementById('enable-mfa-btn'),
        disableMfaBtn: document.getElementById('disable-mfa-btn')
    };
    
    // Debug check
    if (!elements.displayNameInput) {
        console.warn("⚠️ Warning: Profile elements not found in DOM. Are you on the right page?");
    }
}

function initProfile() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("✅ Profile Logic: Auth ready, user detected:", user.uid);
            currentUser = user;
            // Re-cache just in case elements were injected late
            if (!elements.displayNameInput) cacheDomElements();
            await loadUserProfile(user);
            setupEventListeners();
        } else {
            console.log("❌ Profile Logic: No user found, redirecting...");
            if (!window.location.href.includes('login.html')) {
                window.location.href = '/public/auth/login.html';
            }
        }
    });
}

// --- Load Data ---
async function loadUserProfile(user) {
    try {
        // 1. Load Auth Data
        if (elements.displayNameInput) elements.displayNameInput.value = user.displayName || '';
        if (elements.emailInput) elements.emailInput.value = user.email || '';
        if (user.photoURL && elements.profileImage) elements.profileImage.src = user.photoURL;

        updateVerificationUI(user.emailVerified);

        // 2. CHECK MFA STATUS (The Fix)
        const enrolledFactors = multiFactor(user).enrolledFactors;
        const isMfaEnabled = enrolledFactors.length > 0;

        if (isMfaEnabled) {
            // --- ACTIVE STATE ---
            if (elements.enableMfaBtn) {
                // Show "Active" Badge
                elements.enableMfaBtn.innerHTML = `<i class="bi bi-shield-check text-lg"></i> <span>Two-Factor Authentication is Active</span>`;
                elements.enableMfaBtn.className = "w-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 cursor-default font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2";
                elements.enableMfaBtn.disabled = true;
            }
            if (elements.disableMfaBtn) elements.disableMfaBtn.classList.remove('hidden');
        } else {
            // --- INACTIVE STATE ---
            if (elements.enableMfaBtn) {
                // Show "Enable" Button
                elements.enableMfaBtn.innerHTML = `<i class="bi bi-shield-lock-fill"></i> <span>Enable 2FA</span>`;
                elements.enableMfaBtn.className = "w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 px-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-primary-600/20";
                elements.enableMfaBtn.disabled = false;
            }
            if (elements.disableMfaBtn) elements.disableMfaBtn.classList.add('hidden');
        }

        // 3. Sync Database (Self-Healing Logic)
        // If Auth says disabled, but we haven't checked DB yet, we will fix it below.

        // 4. Load Firestore Data
        const docRef = doc(db, 'user_data', user.uid, 'profile', 'settings');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (elements.phoneInput) elements.phoneInput.value = data.phone || '';
            if (elements.bioInput) elements.bioInput.value = data.bio || '';

            // FIX: If Database says Enabled, but Auth is NOT, fix the database immediately.
            if (data.mfa_enabled && !isMfaEnabled) {
                console.warn("Fixing mismatched MFA state in database...");
                await setDoc(docRef, { mfa_enabled: false }, { merge: true });
            }
        }

    } catch (error) {
        console.error("Error loading profile:", error);
    }
}

function updateVerificationUI(isVerified) {
    // Safety check in case elements are missing
    if (!elements.emailVerifiedBadge) return;

    if (isVerified) {
        elements.emailVerifiedBadge.classList.remove('hidden');
        if(elements.emailUnverifiedBadge) elements.emailUnverifiedBadge.classList.add('hidden');
        if(elements.verifyEmailBtn) elements.verifyEmailBtn.classList.add('hidden');
    } else {
        elements.emailVerifiedBadge.classList.add('hidden');
        if(elements.emailUnverifiedBadge) elements.emailUnverifiedBadge.classList.remove('hidden');
        if(elements.verifyEmailBtn) elements.verifyEmailBtn.classList.remove('hidden');
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    if (elements.profileForm) {
        elements.profileForm.addEventListener('submit', handleSaveProfile);
    }
    if (elements.profileUpload) {
        elements.profileUpload.addEventListener('change', handleImageUpload);
    }
    if (elements.verifyEmailBtn) {
        elements.verifyEmailBtn.addEventListener('click', handleVerifyEmail);
    }
    if (elements.enableMfaBtn) {
        elements.enableMfaBtn.addEventListener('click', handleEnableMFA);
    }
    if (elements.disableMfaBtn) {
        elements.disableMfaBtn.addEventListener('click', handleDisableMFA);
    }
}

// --- Handlers ---

async function handleVerifyEmail(e) {
    e.preventDefault();
    if (!currentUser) return;

    const btn = elements.verifyEmailBtn;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        await executeRecaptcha('VERIFY_EMAIL');
        await sendEmailVerification(currentUser);
        showToast("Success", "Verification email sent! Please check your inbox.", "success");
        btn.textContent = "Sent!";
    } catch (error) {
        console.error("Verification Email Error:", error);
        if (error.code === 'auth/too-many-requests') {
            showToast("Warning", "Too many requests. Please try again later.", "warning");
        } else {
            showToast("Error", "Failed to send verification email: " + error.message, "error");
        }
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast("Error", "Please select an image file.", "error");
        return;
    }

    // Optimistic UI update
    const reader = new FileReader();
    reader.onload = (e) => {
        if (elements.profileImage) elements.profileImage.src = e.target.result;
    };
    reader.readAsDataURL(file);

    try {
        showToast("Info", "Uploading image...", "info");
        
        const storageRef = ref(storage, `users/${currentUser.uid}/profile_${Date.now()}.jpg`);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        await updateProfile(currentUser, { photoURL: downloadURL });
        
        const userRef = doc(db, 'user_data', currentUser.uid, 'profile', 'settings');
        await setDoc(userRef, { 
            photoURL: downloadURL,
            updatedAt: serverTimestamp() 
        }, { merge: true });

        showToast("Success", "Profile picture updated!", "success");

    } catch (error) {
        console.error("Image Upload Error:", error);
        showToast("Error", "Failed to upload image.", "error");
    }
}

async function handleSaveProfile(e) {
    e.preventDefault();
    if (!currentUser) return;

    setLoading(true);

    const newDisplayName = elements.displayNameInput ? elements.displayNameInput.value.trim() : '';
    const newEmail = elements.emailInput ? elements.emailInput.value.trim() : '';
    const newPhone = elements.phoneInput ? elements.phoneInput.value.trim() : '';
    const newBio = elements.bioInput ? elements.bioInput.value.trim() : '';

    try {
        await executeRecaptcha('UPDATE_PROFILE');

        const updates = [];

        if (newDisplayName && newDisplayName !== currentUser.displayName) {
            updates.push(updateProfile(currentUser, { displayName: newDisplayName }));
        }

        const userRef = doc(db, 'user_data', currentUser.uid, 'profile', 'settings');
        updates.push(setDoc(userRef, {
            fullName: newDisplayName,
            email: newEmail,
            phone: newPhone,
            bio: newBio,
            updatedAt: serverTimestamp()
        }, { merge: true }));

        await Promise.all(updates);
        showToast("Success", "Profile updated successfully!", "success");

    } catch (error) {
        console.error("Save Profile Error:", error);
        showToast("Error", "Failed to save changes: " + error.message, "error");
    } finally {
        setLoading(false);
    }
}

async function handleEnableMFA() {
    if (!currentUser) return;
    
    const phoneNumber = elements.phoneInput ? elements.phoneInput.value.trim() : '';
    
    if (!phoneNumber) {
        showToast("Error", "Please enter a phone number above first to enable MFA.", "error");
        return;
    }

    try {
        // 1. Clear existing verifier to prevent "already rendered" errors
        if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch(e) {}
            window.recaptchaVerifier = null;
        }

        // 2. Initialize RecaptchaVerifier
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container-profile', {
            'size': 'invisible',
            'callback': (response) => {
                console.log("Profile MFA reCAPTCHA solved");
            }
        });

        showToast("Info", "Preparing security session...", "info");

        // 3. [CRITICAL FIX] Get the MultiFactor Session
        // This proves to Firebase that the user is logged in and authorized to add a second factor.
        const multiFactorSession = await multiFactor(currentUser).getSession();

        showToast("Info", "Sending verification code...", "info");
        
        // 4. Verify Phone Number with the Session
        const phoneOptions = {
            phoneNumber: phoneNumber,
            session: multiFactorSession // <--- THIS WAS NULL BEFORE, NOW IT'S FIXED
        };

        const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber(
            phoneOptions,
            window.recaptchaVerifier
        );

        // 5. Ask for Code
        const code = prompt(`MFA Setup: Enter the SMS code sent to ${phoneNumber}`);

        if (code) {
            const cred = PhoneAuthProvider.credential(verificationId, code);
            const assertion = PhoneMultiFactorGenerator.assertion(cred);
            
            // 6. Finalize Enrollment
            await multiFactor(currentUser).enroll(assertion, "My Phone Number");
            
            // Update Firestore setting
             try {
                 const userRef = doc(db, 'user_data', currentUser.uid, 'profile', 'settings');
                 await setDoc(userRef, { mfa_enabled: true }, { merge: true });
            } catch(e) { console.log("Profile sync skipped"); }

            showToast('Success', 'MFA Enabled Successfully!', 'success');

            // --- FIX: RELOAD USER & REDRAW UI ---
            // Instead of manually changing text, we reload the user profile
            // so it uses the main logic to draw the "Active Badge" correctly.
            await currentUser.reload(); 
            loadUserProfile(currentUser); 

        } else {
            showToast('Info', 'MFA setup skipped (no code entered).', 'warning');
        }
    } catch (mfaError) {
        console.error("MFA Enrollment Error:", mfaError);
        
        // Clean up verifier on error
        if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch(e) {}
            window.recaptchaVerifier = null;
        }

        if (mfaError.code === 'auth/requires-recent-login') {
            showToast('Security Check', 'For security, you must log in again to enable 2FA.', 'warning');
            
            // Wait 2 seconds then redirect to login
            setTimeout(() => {
                // Optional: Sign out properly before redirecting
                auth.signOut().then(() => {
                    window.location.href = '/public/auth/login.html';
                });
            }, 2000);
            return;
        }
        
        showToast('Error', 'MFA setup failed: ' + mfaError.message, 'error');
    }
}

async function handleDisableMFA() {
    if (!currentUser) return;

    if (!confirm("Are you sure you want to disable 2FA? This will make your account less secure.")) {
        return;
    }

    try {
        const enrolledFactors = multiFactor(currentUser).enrolledFactors;
        if (enrolledFactors.length === 0) return;

        // 1. Unenroll the factor
        const factorUid = enrolledFactors[0].uid;
        
        showToast("Info", "Disabling 2FA...", "info");
        await multiFactor(currentUser).unenroll(factorUid);

        // 2. Update Firestore
        const userRef = doc(db, 'user_data', currentUser.uid, 'profile', 'settings');
        await setDoc(userRef, { mfa_enabled: false }, { merge: true });

        showToast("Success", "2FA has been disabled.", "success");

        // --- FIX: RELOAD USER & REDRAW UI ---
        // This ensures the button goes back to the "Standard Blue Enable Button"
        // exactly as it appears on page load.
        await currentUser.reload();
        loadUserProfile(currentUser);

    } catch (error) {
        console.error("Disable MFA Error:", error);
        
        if (error.code === 'auth/requires-recent-login') {
            showToast('Security Check', 'Please log in again to disable 2FA.', 'warning');
            setTimeout(() => {
                auth.signOut().then(() => window.location.href = '/public/auth/login.html');
            }, 2000);
        } else {
            showToast("Error", "Failed to disable 2FA: " + error.message, "error");
        }
    }
}

// --- UI Helpers ---
function setLoading(isLoading) {
    const btn = elements.saveBtn;
    if (!btn) return;
    
    const spinner = btn.querySelector('.button-spinner');
    const text = btn.querySelector('.button-text');

    if (isLoading) {
        btn.disabled = true;
        if (spinner) spinner.classList.remove('hidden');
        if (text) text.textContent = "Saving...";
    } else {
        btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (text) text.textContent = 'Save Changes';
    }
}

function showToast(title, message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(title, message, type);
    } else {
        alert(`${title}: ${message}`);
    }
}