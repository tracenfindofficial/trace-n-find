import { 
    getAuth, 
    onAuthStateChanged, 
    updateProfile, 
    sendEmailVerification, 
    PhoneAuthProvider,
    PhoneMultiFactorGenerator,
    RecaptchaVerifier,
    multiFactor,
    signOut // Added signOut to handle re-auth redirect
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc,
    serverTimestamp,
    collection,
    query,
    where,
    onSnapshot
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

// CONFIG CHECK: This key MUST match the key in your HTML <script> tag AND Firebase Console
const RECAPTCHA_SITE_KEY = '6LdnxQcsAAAAAOQl5jTa-VhC4aek_xTzDqSTp6zI';

// --- Helper: executeRecaptcha (Bot Protection) ---
const executeRecaptcha = async (actionName) => {
    if (typeof grecaptcha === 'undefined' || typeof grecaptcha.enterprise === 'undefined') {
        console.warn('reCAPTCHA Enterprise not loaded. Skipping bot check.');
        return null;
    }
    
    try {
        // This uses the key defined above. If it mismatches the loaded script, it throws "Invalid site key"
        const token = await grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, {action: actionName});
        return token;
    } catch (error) {
        console.warn('reCAPTCHA execution failed (Action: ' + actionName + '):', error);
        return null; 
    }
};

let elements = {};
let currentUser = null;

// --- Initialization ---
const initApp = () => {
    cacheDomElements();
    initProfile();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
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
        disableMfaBtn: document.getElementById('disable-mfa-btn'),
        // Notification Badge is now handled globally by app-shell.js
        // OTP Modal
        otpModal: document.getElementById('otpModal'),
        otpModalClose: document.getElementById('otpModalClose'),
        otpModalCancel: document.getElementById('otpModalCancel'),
        otpModalVerify: document.getElementById('otpModalVerify'),
        otpInput: document.getElementById('otpInput'),
        // Container for MFA ReCaptcha
        recaptchaContainer: document.getElementById('recaptcha-container-profile')
    };
}

function initProfile() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            await loadUserProfile(user);
            setupEventListeners();
            // NOTE: Notification listener removed from here as it's now in app-shell.js
        } else {
            window.location.replace('/public/auth/login.html');
        }
    });
}

// --- Load Data ---
async function loadUserProfile(user) {
    try {
        if (elements.displayNameInput) elements.displayNameInput.value = user.displayName || '';
        if (elements.emailInput) elements.emailInput.value = user.email || '';
        if (user.photoURL && elements.profileImage) elements.profileImage.src = user.photoURL;

        updateVerificationUI(user.emailVerified);

        const enrolledFactors = multiFactor(user).enrolledFactors;
        const isMfaEnabled = enrolledFactors.length > 0;

        if (isMfaEnabled) {
            if (elements.enableMfaBtn) {
                elements.enableMfaBtn.innerHTML = `<i class="bi bi-shield-check text-lg"></i> <span>Two-Factor Authentication is Active</span>`;
                elements.enableMfaBtn.className = "w-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 cursor-default font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2";
                elements.enableMfaBtn.disabled = true;
            }
            if (elements.disableMfaBtn) elements.disableMfaBtn.classList.remove('hidden');
        } else {
            if (elements.enableMfaBtn) {
                elements.enableMfaBtn.innerHTML = `<i class="bi bi-shield-lock-fill"></i> <span>Enable 2FA</span>`;
                elements.enableMfaBtn.className = "w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 px-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-primary-600/20";
                elements.enableMfaBtn.disabled = false;
            }
            if (elements.disableMfaBtn) elements.disableMfaBtn.classList.add('hidden');
        }

        const docRef = doc(db, 'user_data', user.uid, 'profile', 'settings');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (elements.phoneInput) elements.phoneInput.value = data.phone || '';
            if (elements.bioInput) elements.bioInput.value = data.bio || '';
            
            if (data.mfa_enabled && !isMfaEnabled) {
                await setDoc(docRef, { mfa_enabled: false }, { merge: true });
            }
        }
    } catch (error) {
        console.error("Error loading profile:", error);
    }
}

function updateVerificationUI(isVerified) {
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
    if (elements.profileForm) elements.profileForm.addEventListener('submit', handleSaveProfile);
    if (elements.profileUpload) elements.profileUpload.addEventListener('change', handleImageUpload);
    if (elements.verifyEmailBtn) elements.verifyEmailBtn.addEventListener('click', handleVerifyEmail);
    if (elements.enableMfaBtn) elements.enableMfaBtn.addEventListener('click', handleEnableMFA);
    if (elements.disableMfaBtn) elements.disableMfaBtn.addEventListener('click', handleDisableMFA);
    
    if (elements.otpModalClose) elements.otpModalClose.addEventListener('click', hideOtpModal);
    if (elements.otpModalCancel) elements.otpModalCancel.addEventListener('click', hideOtpModal);
}

// --- Modal Helpers ---
function showOtpModal(callback) {
    elements.otpInput.value = '';
    elements.otpModal.classList.add('active');
    setTimeout(() => elements.otpInput.focus(), 100);
    
    elements.otpModalVerify.onclick = () => {
        const code = elements.otpInput.value.trim();
        if (code) {
            callback(code);
        } else {
            showToast("Error", "Please enter the code.", "error");
        }
    };
}

function hideOtpModal() {
    elements.otpModal.classList.remove('active');
    elements.otpModalVerify.onclick = null;
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
        showToast("Success", "Verification email sent!", "success");
        btn.textContent = "Sent!";
    } catch (error) {
        console.error("Verification Email Error:", error);
        if (error.code === 'auth/too-many-requests') {
            showToast("Warning", "Too many requests. Try again later.", "warning");
        } else {
            showToast("Error", "Failed to send email.", "error");
        }
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast("Error", "Please select an image.", "error");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        if (elements.profileImage) elements.profileImage.src = e.target.result;
    };
    reader.readAsDataURL(file);

    try {
        showToast("Info", "Uploading...", "info");
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
        showToast("Error", "Failed to upload.", "error");
    }
}

async function handleSaveProfile(e) {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);

    const newDisplayName = elements.displayNameInput ? elements.displayNameInput.value.trim() : '';
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
            phone: newPhone,
            bio: newBio,
            updatedAt: serverTimestamp()
        }, { merge: true }));

        await Promise.all(updates);
        showToast("Success", "Profile updated!", "success");

    } catch (error) {
        console.error("Save Profile Error:", error);
        showToast("Error", "Failed to save: " + error.message, "error");
    } finally {
        setLoading(false);
    }
}

// --- CRITICAL FIX: MFA Logic with Error Handling ---
async function handleEnableMFA() {
    if (!currentUser) return;
    
    const phoneNumber = elements.phoneInput ? elements.phoneInput.value.trim() : '';
    if (!phoneNumber) {
        showToast("Error", "Please enter your phone number first.", "error");
        if(elements.phoneInput) elements.phoneInput.focus();
        return;
    }

    try {
        // 1. Ensure no lingering verifier exists
        if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch(e) { console.log("Verifier clear warning", e); }
            window.recaptchaVerifier = null;
        }

        // 2. Verify Container
        const container = document.getElementById('recaptcha-container-profile');
        if (!container) {
            console.error("CRITICAL: #recaptcha-container-profile missing in HTML.");
            showToast("System Error", "MFA setup container missing. Refresh page.", "error");
            return;
        }

        // 3. Initialize Invisible Recaptcha
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container-profile', {
            'size': 'invisible',
            'callback': (response) => {
                console.log("MFA reCAPTCHA Solved");
            },
            'expired-callback': () => {
                showToast('Warning', 'Security check expired. Try again.', 'warning');
            }
        });

        showToast("Info", "Preparing security session...", "info");
        const multiFactorSession = await multiFactor(currentUser).getSession();

        showToast("Info", "Sending verification code...", "info");
        const phoneOptions = {
            phoneNumber: phoneNumber,
            session: multiFactorSession
        };
        
        // 4. Send SMS with Specific Error Handling for Key Mismatch
        let verificationId;
        try {
             verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber(phoneOptions, window.recaptchaVerifier);
        } catch (innerError) {
            if (innerError.message && innerError.message.includes('Invalid site key')) {
                console.error("CRITICAL SITE KEY ERROR: The key loaded in HTML (script tag) does not match the key Firebase expects.");
                throw new Error("Configuration Error: reCAPTCHA Site Key mismatch. Please clear browser cache or check Firebase Console settings.");
            }
            throw innerError;
        }

        // 5. Show OTP Modal
        showOtpModal(async (code) => {
            try {
                const cred = PhoneAuthProvider.credential(verificationId, code);
                const assertion = PhoneMultiFactorGenerator.assertion(cred);
                
                await multiFactor(currentUser).enroll(assertion, "My Phone Number");
                
                 try {
                     const userRef = doc(db, 'user_data', currentUser.uid, 'profile', 'settings');
                     await setDoc(userRef, { mfa_enabled: true }, { merge: true });
                } catch(e) {}

                showToast('Success', 'MFA Enabled Successfully!', 'success');
                hideOtpModal();
                await currentUser.reload(); 
                loadUserProfile(currentUser); 

            } catch (err) {
                showToast('Error', 'Invalid code: ' + err.message, 'error');
            }
        });

    } catch (mfaError) {
        console.error("MFA Enrollment Error:", mfaError);
        
        if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch(e) {}
            window.recaptchaVerifier = null;
        }
        
        let msg = mfaError.message;
        if (mfaError.code === 'auth/captcha-check-failed') {
            msg = "Security check failed. Please refresh.";
        } else if (mfaError.code === 'auth/invalid-phone-number') {
            msg = "Invalid phone number format. Use +60...";
        } else if (mfaError.code === 'auth/quota-exceeded') {
            msg = "SMS quota exceeded for this project.";
        } else if (mfaError.message.includes('400')) {
             msg = "System blocked the request. If testing, ensure you are using a Test Number defined in Firebase Console.";
        } else if (mfaError.code === 'auth/requires-recent-login') {
            // *** FIX: Handle Requires Recent Login ***
            showToast('Security Requirement', 'For security, you must re-login to enable 2FA. Redirecting...', 'warning');
            setTimeout(async () => {
                await signOut(auth);
                window.location.replace('/public/auth/login.html');
            }, 2500);
            return;
        }

        showToast('Error', 'MFA Failed: ' + msg, 'error');
    }
}

async function handleDisableMFA() {
    if (!currentUser) return;
    
    if (!confirm("Are you sure you want to disable 2FA? This reduces account security.")) return;

    try {
        const enrolledFactors = multiFactor(currentUser).enrolledFactors;
        if (enrolledFactors.length === 0) return;

        const factorUid = enrolledFactors[0].uid;
        showToast("Info", "Disabling 2FA...", "info");
        await multiFactor(currentUser).unenroll(factorUid);

        const userRef = doc(db, 'user_data', currentUser.uid, 'profile', 'settings');
        await setDoc(userRef, { mfa_enabled: false }, { merge: true });

        showToast("Success", "2FA has been disabled.", "success");
        await currentUser.reload();
        loadUserProfile(currentUser);

    } catch (error) {
        console.error("Disable MFA Error:", error);
        showToast("Error", "Failed to disable 2FA.", "error");
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
        const container = document.getElementById('toastContainer');
        if(container) {
             const toast = document.createElement('div');
             toast.className = `toast toast-${type} show`;
             toast.innerHTML = `<div><b>${title}</b><br>${message}</div>`;
             container.appendChild(toast);
             setTimeout(() => toast.remove(), 3000);
        } else {
            alert(`${title}: ${message}`);
        }
    }
}