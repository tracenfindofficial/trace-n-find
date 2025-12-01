// --- Trace'N Find Authentication Logic ---
// This single file powers login.html, register.html, and recovery.html.

// FIX: Import initializeApp from firebase-app.js (Correct Source)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

// FIX: Import Auth functions from firebase-auth.js (Correct Source)
import { 
    getAuth, 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    sendPasswordResetEmail,
    getAdditionalUserInfo,
    // MFA Imports
    getMultiFactorResolver,
    PhoneAuthProvider,
    PhoneMultiFactorGenerator,
    RecaptchaVerifier,
    TotpMultiFactorGenerator, // Add this
    TotpSecret,               // Add this
    multiFactor 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import { 
    getFirestore, 
    doc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyAokTU8XIKQcaFv9RBVWMs_8iGEcni6sY4",
  authDomain: "trace-n--find.firebaseapp.com",
  projectId: "trace-n--find",
  storageBucket: "trace-n--find.firebasestorage.app",
  messagingSenderId: "1000921948484",
  appId: "1:1000921948484:web:92d821bd2cf4f2e5a67711",
  measurementId: "G-6BFEZXMG57"
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const fbAuth = getAuth(app);
const fbDB = getFirestore(app, "tracenfind"); 
const fbGoogleProvider = new GoogleAuthProvider();

// --- reCAPTCHA Configuration ---
const RECAPTCHA_SITE_KEY = '6LdnxQcsAAAAAOQl5jTa-VhC4aek_xTzDqSTp6zI';

// --- Global State ---
const state = {
    isSubmitting: false,
    theme: 'light',
    passwordVisible: false,
    currentStep: 1,
    registrationData: {
        username: '',
        email: '',
        password: '',
        phone: ''
    }
};

// --- DOM Elements (Common) ---
const toastContainer = document.getElementById('toastContainer');
const themeToggle = document.getElementById('theme-toggle');

// Shared Modal Elements (Initialized on load)
let sharedOtpModal = {
    modal: null,
    close: null,
    cancel: null,
    verify: null,
    input: null
};

// --- Main Initializer ---
document.addEventListener('DOMContentLoaded', () => {
    // Note: Theme is now set by the render-blocking script in <head>.
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    syncThemeToggleButton(); 

    // Initialize Shared OTP Modal Elements
    sharedOtpModal.modal = document.getElementById('otpModal');
    sharedOtpModal.close = document.getElementById('otpModalClose');
    sharedOtpModal.cancel = document.getElementById('otpModalCancel');
    sharedOtpModal.verify = document.getElementById('otpModalVerify');
    sharedOtpModal.input = document.getElementById('otpInput');
    
    // Bind Close Events for Shared Modal
    if (sharedOtpModal.close) sharedOtpModal.close.addEventListener('click', hideSharedOtpModal);
    if (sharedOtpModal.cancel) sharedOtpModal.cancel.addEventListener('click', hideSharedOtpModal);

    // Check which page we're on and initialize its specific logic
    if (document.getElementById('loginForm')) {
        initLoginPage();
    } else if (document.getElementById('registerFormStep1')) {
        initRegisterPage();
    } else if (document.getElementById('recoveryForm')) {
        initRecoveryPage();
    }
});

// ========================================================================
// RECAPTCHA HELPER (Bot Protection)
// ========================================================================
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
                console.log(`reCAPTCHA (Bot Protection) Token for ${actionName}:`, token);
                resolve(token);
            } catch (error) {
                console.warn('reCAPTCHA execution failed:', error);
                resolve(null);
            }
        });
    });
};

// ========================================================================
// SHARED MODAL FUNCTIONS
// ========================================================================

function showSharedOtpModal(callback) {
    if (!sharedOtpModal.modal) return;
    
    sharedOtpModal.input.value = '';
    sharedOtpModal.modal.classList.add('active');
    
    const verifyHandler = () => {
        const code = sharedOtpModal.input.value.trim();
        if (code) {
            callback(code);
        } else {
            showToast("Error", "Please enter the code.", "error");
        }
    };
    
    // One-time bind
    sharedOtpModal.verify.onclick = verifyHandler;
}

function hideSharedOtpModal() {
    if (sharedOtpModal.modal) {
        sharedOtpModal.modal.classList.remove('active');
    }
    if (sharedOtpModal.verify) {
        sharedOtpModal.verify.onclick = null;
    }
    state.isSubmitting = false;
    
    // Reset buttons if on login page
    const loginBtn = document.getElementById('loginButton');
    const googleBtn = document.getElementById('googleBtn');
    if(loginBtn) setLoadingState(false, loginBtn);
    if(googleBtn) setLoadingState(false, googleBtn);
}

// ========================================================================
// LOGIN PAGE LOGIC
// ========================================================================
function initLoginPage() {
    const elements = {
        loginForm: document.getElementById('loginForm'),
        emailInput: document.getElementById('email'),
        passwordInput: document.getElementById('password'),
        passwordToggle: document.getElementById('passwordToggle'),
        rememberMe: document.getElementById('rememberMe'),
        loginButton: document.getElementById('loginButton'),
        googleBtn: document.getElementById('googleBtn')
    };

    if (!elements.loginForm) return; 
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.passwordToggle.addEventListener('click', () => togglePasswordVisibility(elements.passwordInput, elements.passwordToggle));
    elements.googleBtn.addEventListener('click', () => handleSocialLogin('google'));
    
    elements.emailInput.addEventListener('input', debounce(() => validateLoginEmail(true), 300));
    elements.passwordInput.addEventListener('input', debounce(() => validateLoginPassword(true), 300));

    onAuthStateChanged(fbAuth, (user) => {
        if (user && !state.isSubmitting) {
            localStorage.setItem('authToken', user.accessToken);
            window.location.replace('/app/dashboard.html'); 
        } else if (user && state.isSubmitting) {
             console.log("Auth state changed, but login is in progress. Waiting for success handler.");
        } else {
            const savedEmail = localStorage.getItem('rememberedEmail');
            if (savedEmail) {
                elements.emailInput.value = savedEmail;
                elements.rememberMe.checked = true;
            }
        }
    });
    
    async function handleLogin(e) {
        e.preventDefault();
        if (state.isSubmitting) return;
        state.isSubmitting = true;

        const email = elements.emailInput.value;
        const password = elements.passwordInput.value;

        if (!validateLoginEmail() || !validateLoginPassword()) {
            showToast('Error', 'Please fix the errors in the form.', 'error');
            state.isSubmitting = false; 
            return;
        }

        setLoadingState(true, elements.loginButton);

        try {
            await executeRecaptcha('LOGIN');
            const persistence = elements.rememberMe.checked ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(fbAuth, persistence);
            const userCredential = await signInWithEmailAndPassword(fbAuth, email, password);
            
            if (elements.rememberMe.checked) localStorage.setItem('rememberedEmail', email);
            else localStorage.removeItem('rememberedEmail');
            
            handleLoginSuccess(userCredential.user);

        } catch (error) {
            if (error.code === 'auth/multi-factor-auth-required') {
                handleMfaChallenge(error);
            } else {
                handleFirebaseError(error, 'login');
                setLoadingState(false, elements.loginButton);
                state.isSubmitting = false;
            }
        }
    }

    function validateLoginEmail(showSuccessMsg = false) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!elements.emailInput.value) return showError(elements.emailInput, 'email-error', 'Email is required.');
        if (!emailRegex.test(elements.emailInput.value)) return showError(elements.emailInput, 'email-error', 'Please enter a valid email address.');
        return showSuccessMsg ? showSuccess(elements.emailInput, 'email-error') : true;
    }

    function validateLoginPassword(showSuccessMsg = false) {
        if (!elements.passwordInput.value) return showError(elements.passwordInput, 'password-error', 'Password is required.');
        if (elements.passwordInput.value.length < 6) return showError(elements.passwordInput, 'password-error', 'Password must be at least 6 characters.');
        return showSuccessMsg ? showSuccess(elements.passwordInput, 'password-error') : true;
    }
}

// ========================================================================
// SOCIAL LOGIN (With MFA Fix)
// ========================================================================
async function handleSocialLogin(providerName) {
    if (state.isSubmitting) return;
    state.isSubmitting = true; 
    setLoadingState(true, document.getElementById('googleBtn'));

    const provider = fbGoogleProvider;

    try {
        await executeRecaptcha('SOCIAL_LOGIN');
        await setPersistence(fbAuth, browserLocalPersistence);
        const result = await signInWithPopup(fbAuth, provider);
        const user = result.user;
        const additionalInfo = getAdditionalUserInfo(result);
        
        if (additionalInfo?.isNewUser) {
            await createProfileDocument(user, user.displayName, user.phoneNumber);
        }
        
        handleLoginSuccess(user);

    } catch (error) {
        // --- FIX: Handle MFA Challenge for Social Login ---
        if (error.code === 'auth/multi-factor-auth-required') {
            handleMfaChallenge(error);
        } else {
            handleFirebaseError(error, 'social');
            setLoadingState(false, document.getElementById('googleBtn'));
            state.isSubmitting = false; 
        }
    }
}

/**
 * Shared function to handle MFA challenges from Login or Social Auth
 */
async function handleMfaChallenge(error) {
    try {
        const resolver = getMultiFactorResolver(fbAuth, error);
        const phoneHint = resolver.hints.find(hint => hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID);

        if (phoneHint) {
            showToast('MFA Required', 'Sending verification code...', 'info');

            if (window.recaptchaVerifier) {
                try { window.recaptchaVerifier.clear(); } catch(e){}
                window.recaptchaVerifier = null;
            }

            window.recaptchaVerifier = new RecaptchaVerifier(fbAuth, 'recaptcha-container', {
                'size': 'invisible'
            });
            
            const phoneInfoOptions = {
                multiFactorHint: phoneHint,
                session: resolver.session
            };
            
            const phoneAuthProvider = new PhoneAuthProvider(fbAuth);
            const verificationId = await phoneAuthProvider.verifyPhoneNumber(phoneInfoOptions, window.recaptchaVerifier);
            
            // Use the SHARED modal
            showSharedOtpModal(async (verificationCode) => {
                try {
                    const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
                    const multiFactorAssertion = PhoneMultiFactorGenerator.assertion(cred);
                    
                    const userCredential = await resolver.resolveSignIn(multiFactorAssertion);
                    hideSharedOtpModal();
                    handleLoginSuccess(userCredential.user);
                } catch (otpError) {
                    showToast('Error', 'Verification failed: ' + otpError.message, 'error');
                }
            });

        } else {
            showToast('Error', 'No supported MFA method found.', 'error');
            state.isSubmitting = false;
        }
    } catch (mfaError) {
        console.error("MFA Error:", mfaError);
        showToast('Error', 'Authentication failed: ' + mfaError.message, 'error');
        state.isSubmitting = false;
        
        // Reset UI
        setLoadingState(false, document.getElementById('loginButton'));
        setLoadingState(false, document.getElementById('googleBtn'));
    }
}

// ========================================================================
// REGISTER PAGE & RECOVERY
// ========================================================================
function initRegisterPage() {
    const elements = {
        progressBar1: document.getElementById('progress-bar-1'),
        progressBar2: document.getElementById('progress-bar-2'),
        stepDots: { 1: document.getElementById('step-dot-1'), 2: document.getElementById('step-dot-2'), 3: document.getElementById('step-dot-3') },
        step1: document.getElementById('step1'),
        username: document.getElementById('username'),
        email: document.getElementById('email'),
        password: document.getElementById('password'),
        togglePassword: document.getElementById('passwordToggle'),
        passwordStrengthBar: document.getElementById('passwordStrengthBar'),
        passwordStrengthText: document.getElementById('passwordStrengthText'),
        req: {
            length: document.getElementById('lengthReq'),
            uppercase: document.getElementById('uppercaseReq'),
            lowercase: document.getElementById('lowercaseReq'),
            number: document.getElementById('numberReq'),
        },
        termsCheckbox: document.getElementById('termsCheckbox'),
        nextToStep2: document.getElementById('nextToStep2'),
        googleBtn: document.getElementById('googleBtn'),
        step2: document.getElementById('step2'),
        phone: document.getElementById('phone'),
        backToStep1: document.getElementById('backToStep1'),
        createAccountBtn: document.getElementById('createAccountBtn'),
        skipMfaBtn: document.getElementById('skipMfaBtn'),
        step3: document.getElementById('step3'),
        welcomeUsername: document.getElementById('welcome-username'),
    };

    if (!elements.step1) return; 
    
    elements.password.addEventListener('input', () => {
        const pass = elements.password.value;
        checkPasswordStrength(pass, elements);
        checkPasswordRequirements(pass, elements);
        validateStep1(); 
    });
    elements.togglePassword.addEventListener('click', () => togglePasswordVisibility(elements.password, elements.togglePassword));
    elements.username.addEventListener('input', debounce(() => {
        validateField(elements.username, 'username-error', validateUsername);
        validateStep1();
    }, 300));
    elements.email.addEventListener('input', debounce(() => {
        validateField(elements.email, 'email-error', validateEmail);
        validateStep1();
    }, 300));
    elements.termsCheckbox.addEventListener('change', validateStep1);
    
    elements.nextToStep2.addEventListener('click', handleGoToStep2);
    elements.backToStep1.addEventListener('click', () => goToStep(1));
    elements.createAccountBtn.addEventListener('click', handleRegistration);
    elements.skipMfaBtn.addEventListener('click', handleRegistration); 
    elements.googleBtn.addEventListener('click', () => handleSocialLogin('google'));

    function goToStep(stepNumber) {
        state.currentStep = stepNumber;
        const steps = [elements.step1, elements.step2, elements.step3];
        const dots = [elements.stepDots[1], elements.stepDots[2], elements.stepDots[3]];
        
        steps.forEach((step, index) => {
            const stepEl = steps[index];
            if (!stepEl) return;
            const dotEl = dots[index];
            
            if ((index + 1) === stepNumber) {
                if (!stepEl.classList.contains('active')) {
                    stepEl.classList.remove('exiting');
                    stepEl.classList.add('active');
                }
                dotEl.classList.add('bg-primary-600', 'text-white');
                dotEl.classList.remove('bg-slate-200', 'dark:bg-slate-700', 'text-slate-500', 'dark:text-slate-400', 'bg-success-500');
                dotEl.innerHTML = (index + 1 === 3) ? `<i class="bi bi-check"></i>` : `${stepNumber}`;
            } else {
                if (stepEl.classList.contains('active')) {
                    stepEl.classList.add('exiting');
                    setTimeout(() => stepEl.classList.remove('active', 'exiting'), 400);
                }
                if ((index + 1) < stepNumber) {
                    dotEl.classList.add('bg-success-500', 'text-white');
                    dotEl.classList.remove('bg-primary-600', 'bg-slate-200', 'dark:bg-slate-700');
                    dotEl.innerHTML = `<i class="bi bi-check"></i>`;
                } else {
                    dotEl.classList.remove('bg-success-500', 'bg-primary-600', 'text-white');
                    dotEl.classList.add('bg-slate-200', 'dark:bg-slate-700', 'text-slate-500', 'dark:text-slate-400');
                    dotEl.innerHTML = (index + 1 === 3) ? `<i class="bi bi-check"></i>` : `${index + 1}`;
                }
            }
        });

        const bars = [elements.progressBar1, elements.progressBar2];
        bars.forEach((bar, index) => {
            if (index + 1 < stepNumber) {
                bar.classList.add('border-primary-600');
                bar.classList.remove('border-slate-300', 'dark:border-slate-600');
            } else {
                bar.classList.remove('border-primary-600');
                bar.classList.add('border-slate-300', 'dark:border-slate-600');
            }
        });
    }

    function handleGoToStep2() {
        if (validateStep1()) {
            state.registrationData.username = elements.username.value;
            state.registrationData.email = elements.email.value;
            state.registrationData.password = elements.password.value;
            goToStep(2);
        } else showToast('Error', 'Please fix the errors in the form.', 'error');
    }

    async function handleRegistration(e) {
        e.preventDefault(); 
        if (state.isSubmitting) return;
        
        state.isSubmitting = true; 
        state.registrationData.phone = elements.phone.value;
        
        setLoadingState(true, elements.createAccountBtn);
        setLoadingState(true, elements.skipMfaBtn);
        
        try {
            await executeRecaptcha('REGISTER');
            const userCredential = await createUserWithEmailAndPassword(fbAuth, state.registrationData.email, state.registrationData.password);
            const user = userCredential.user;
            
            await updateProfile(user, {
                displayName: state.registrationData.username,
                photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(state.registrationData.username)}&background=4361ee&color=fff&size=128`
            });

            await createProfileDocument(user, state.registrationData.username, state.registrationData.phone);
            
            if (state.registrationData.phone && e.target.id !== 'skipMfaBtn') {
                try {
                    if (window.recaptchaVerifier) {
                        try { window.recaptchaVerifier.clear(); } catch(e) {}
                        window.recaptchaVerifier = null;
                    }

                    window.recaptchaVerifier = new RecaptchaVerifier(fbAuth, 'recaptcha-container', {
                        'size': 'invisible'
                    });

                    const verificationId = await new PhoneAuthProvider(fbAuth).verifyPhoneNumber(
                        { phoneNumber: state.registrationData.phone, session: null },
                        window.recaptchaVerifier
                    );

                    const code = prompt(`MFA Setup: Enter the SMS code sent to ${state.registrationData.phone}`);

                    if (code) {
                        const cred = PhoneAuthProvider.credential(verificationId, code);
                        const assertion = PhoneMultiFactorGenerator.assertion(cred);
                        await multiFactor(user).enroll(assertion, "My Phone Number");
                        showToast('Success', 'MFA Enabled Successfully!', 'success');
                    } else {
                        showToast('Info', 'MFA setup skipped (no code entered).', 'warning');
                    }
                } catch (mfaError) {
                    console.error("MFA Enrollment Error:", mfaError);
                    showToast('Warning', 'Account created, but MFA setup failed: ' + mfaError.message, 'warning');
                }
            }

            await setPersistence(fbAuth, browserLocalPersistence);
            elements.welcomeUsername.textContent = state.registrationData.username;
            goToStep(3);
            setTimeout(() => window.location.replace('/app/dashboard.html'), 2000); 

        } catch (error) {
            handleFirebaseError(error, 'register');
            setLoadingState(false, elements.createAccountBtn);
            setLoadingState(false, elements.skipMfaBtn);
            state.isSubmitting = false; 
            if (error.code === 'auth/email-already-in-use' || error.code === 'auth/weak-password') goToStep(1);
        }
    }

    function validateStep1() {
        const isUsername = validateField(elements.username, 'username-error', validateUsername, false);
        const isEmail = validateField(elements.email, 'email-error', validateEmail, false);
        const isPassword = validateField(elements.password, 'password-error', validatePassword, false);
        const isTerms = elements.termsCheckbox.checked;
        elements.nextToStep2.disabled = !(isUsername && isEmail && isPassword && isTerms);
        return elements.nextToStep2.disabled === false;
    }
    
    function validateField(inputEl, errorElId, validator, showSuccessMsg = true) {
        return validator(inputEl, errorElId, showSuccessMsg);
    }

    function validateUsername(inputEl, errorElId, showSuccessMsg = true) {
        const username = inputEl.value;
        if (username.length < 3) return showError(inputEl, errorElId, 'Username must be at least 3 characters.');
        if (!/^[a-zA-Z0-9_]+$/.test(username)) return showError(inputEl, errorElId, 'Only letters, numbers, and underscores allowed.');
        return showSuccessMsg ? showSuccess(inputEl, errorElId) : true;
    }

    function validateEmail(inputEl, errorElId, showSuccessMsg = true) {
        const email = inputEl.value;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email) return showError(inputEl, errorElId, 'Email is required.');
        if (!emailRegex.test(email)) return showError(inputEl, errorElId, 'Please enter a valid email address.');
        return showSuccessMsg ? showSuccess(inputEl, errorElId) : true;
    }

    function validatePassword(inputEl, errorElId, showSuccessMsg = true) {
        const reqs = getPasswordReqs(inputEl.value);
        if (!Object.values(reqs).every(Boolean)) return showError(inputEl, errorElId, 'Password does not meet all requirements.');
        return showSuccessMsg ? showSuccess(inputEl, errorElId) : true;
    }
    
    function getPasswordReqs(password) {
        return {
            length: password.length >= 8,
            uppercase: /[A-Z]/.test(password),
            lowercase: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
        };
    }

    function checkPasswordStrength(password, els) {
        const reqs = getPasswordReqs(password);
        const strength = Object.values(reqs).filter(Boolean).length;
        let barClass = '';
        let text = '';

        if (password.length > 0) {
            if (strength <= 2) { barClass = 'w-1/3 bg-danger-500'; text = 'Weak'; } 
            else if (strength === 3) { barClass = 'w-2/3 bg-warning-500'; text = 'Medium'; } 
            else { barClass = 'w-full bg-success-500'; text = 'Strong'; }
        }
        els.passwordStrengthBar.className = `h-full transition-all duration-300 ${barClass}`;
        els.passwordStrengthText.textContent = text;
        els.passwordStrengthText.className = `text-xs text-right mt-1 font-medium ${
            strength <= 2 ? 'text-danger-500' : (strength === 3 ? 'text-warning-500' : 'text-success-500')
        }`;
    }
    
    function checkPasswordRequirements(password, els) {
        const reqs = getPasswordReqs(password);
        for (const key in reqs) {
            const el = els.req[key];
            if (!el) continue;
            const icon = el.querySelector('i');
            if (reqs[key]) {
                el.classList.add('text-success-500');
                el.classList.remove('text-slate-500', 'invalid');
                icon.className = 'bi bi-check-circle-fill mr-1.5';
            } else {
                el.classList.add('text-slate-500', 'invalid');
                el.classList.remove('text-success-500');
                icon.className = 'bi bi-x-circle mr-1.5';
            }
        }
    }
}

function initRecoveryPage() {
    const elements = {
        stepEmail: document.getElementById('stepEmail'),
        recoveryForm: document.getElementById('recoveryForm'),
        emailInput: document.getElementById('email'),
        recoveryButton: document.getElementById('recoveryButton'),
        stepSuccess: document.getElementById('stepSuccess'),
        sentEmail: document.getElementById('sentEmail'),
    };
    
    let currentStep = 1;
    if (!elements.recoveryForm) return; 
    elements.recoveryForm.addEventListener('submit', handleRecoverySubmit);
    elements.emailInput.addEventListener('input', debounce(() => validateRecoveryEmail(true), 300));
    
    function goToStep(stepName) {
        const currentStepEl = (currentStep === 1) ? elements.stepEmail : elements.stepSuccess;
        const nextStepEl = (stepName === 'email') ? elements.stepEmail : elements.stepSuccess;
        
        if (currentStepEl) {
            currentStepEl.classList.add('exiting');
            setTimeout(() => currentStepEl.classList.remove('active', 'exiting'), 400);
        }
        if (nextStepEl) setTimeout(() => nextStepEl.classList.add('active'), 100);
        currentStep = (stepName === 'email') ? 1 : 2;
    }

    async function handleRecoverySubmit(e) {
        e.preventDefault();
        if (state.isSubmitting) return;

        state.isSubmitting = true; 
        const email = elements.emailInput.value;
        if (!validateRecoveryEmail()) {
            showToast('Error', 'Please enter a valid email address.', 'error');
            state.isSubmitting = false; 
            return;
        }

        setLoadingState(true, elements.recoveryButton);

        try {
            await executeRecaptcha('RECOVERY');
            await sendPasswordResetEmail(fbAuth, email);
            elements.sentEmail.textContent = email;
            goToStep('success');
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                elements.sentEmail.textContent = email;
                goToStep('success');
            } else {
                handleFirebaseError(error, 'recovery');
            }
        } finally {
            setLoadingState(false, elements.recoveryButton);
            state.isSubmitting = false; 
        }
    }

    function validateRecoveryEmail(showSuccessMsg = false) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!elements.emailInput.value) return showError(elements.emailInput, 'email-error', 'Email is required.');
        if (!emailRegex.test(elements.emailInput.value)) return showError(elements.emailInput, 'email-error', 'Please enter a valid email address.');
        return showSuccessMsg ? showSuccess(elements.emailInput, 'email-error') : true;
    }
}

// --- Shared Functions ---

async function createProfileDocument(user, username, phone = '') {
    if (!user) return;
    const userProfileRef = doc(fbDB, 'user_data', user.uid, 'profile', 'settings');
    try {
        await setDoc(userProfileRef, {
            userId: user.uid,
            fullName: username || 'New User',
            email: user.email,
            phone: phone || '',
            createdAt: serverTimestamp(),
            theme: 'dark', 
            role: 'user',
        });
    } catch (e) {
        console.error("Profile creation error", e);
    }
}

function handleLoginSuccess(user) {
    showToast('Login Successful!', `Welcome, ${user.displayName || user.email}.`, 'success');
    localStorage.setItem('authToken', user.accessToken);
    setTimeout(() => window.location.replace('/app/dashboard.html'), 1000); 
}

function handleFirebaseError(error, context) {
    console.error(`Firebase Auth Error (${context}):`, error.code, error.message);
    let message = "An error occurred.";
    if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') message = "Invalid email or password.";
    else if (error.code === 'auth/popup-closed-by-user') message = "Sign-in cancelled.";
    showToast('Error', message, 'error');
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    state.theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('theme', state.theme);
    syncThemeToggleButton();
}

function syncThemeToggleButton() {
    const isDark = document.documentElement.classList.contains('dark');
    const allToggles = document.querySelectorAll('#theme-toggle');
    allToggles.forEach(toggle => {
        const moonIcon = toggle ? toggle.querySelector('.bi-moon-fill') : null;
        const sunIcon = toggle ? toggle.querySelector('.bi-sun-fill') : null;
        if (moonIcon) moonIcon.style.display = isDark ? 'block' : 'none'; 
        if (sunIcon) sunIcon.style.display = isDark ? 'none' : 'block'; 
    });
}

function togglePasswordVisibility(input, toggle) {
    input.type = input.type === 'password' ? 'text' : 'password';
    toggle.querySelector('i').className = input.type === 'password' ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
}

function setLoadingState(isLoading, btn) {
    if(!btn) return;
    const text = btn.querySelector('.button-text');
    const spinner = btn.querySelector('.button-spinner');
    btn.disabled = isLoading;
    if(text) text.classList.toggle('hidden', isLoading);
    if(spinner) spinner.classList.toggle('hidden', !isLoading);
}

function showToast(title, message, type='info') {
    if(!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`; 
    toast.innerHTML = `<div><b>${title}</b><br>${message}</div>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function showError(inputEl, errorElId, message) {
    const errorEl = document.getElementById(errorElId);
    if (!inputEl) return false;
    inputEl.classList.add('border-red-500', 'focus:ring-red-500');
    inputEl.classList.remove('border-green-500', 'focus:ring-green-500');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }
    return false;
}

function showSuccess(inputEl, errorElId) {
    const errorEl = document.getElementById(errorElId);
    if (!inputEl) return true;
    inputEl.classList.remove('border-red-500', 'focus:ring-red-500');
    inputEl.classList.add('border-green-500', 'focus:ring-green-500');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }
    return true;
}