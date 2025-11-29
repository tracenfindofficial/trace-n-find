// --- Trace'N Find Authentication Logic ---
// This single file powers login.html, register.html, and recovery.html.

// MODIFICATION: Updated all Firebase imports from 9.22.1 to 12.6.0
// Import all necessary Firebase SDK functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
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
    multiFactor // Added for MFA Enrollment
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
    isSubmitting: false, // CRITICAL FLAG for fixing redirect loop
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

// --- Main Initializer ---
document.addEventListener('DOMContentLoaded', () => {
    // Note: Theme is now set by the render-blocking script in <head>.
    // This just attaches the toggle listener.
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    syncThemeToggleButton(); // Sync icon on load

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
            resolve(null); // Fail open so users aren't blocked if script fails
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
// LOGIN PAGE LOGIC (`login.html`)
// ========================================================================
function initLoginPage() {
    const elements = {
        loginForm: document.getElementById('loginForm'),
        emailInput: document.getElementById('email'),
        passwordInput: document.getElementById('password'),
        passwordToggle: document.getElementById('passwordToggle'),
        rememberMe: document.getElementById('rememberMe'),
        loginButton: document.getElementById('loginButton'),
        googleBtn: document.getElementById('googleBtn'),
    };

    // --- Event Listeners ---
    if (!elements.loginForm) return; 
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.passwordToggle.addEventListener('click', () => togglePasswordVisibility(elements.passwordInput, elements.passwordToggle));
    elements.googleBtn.addEventListener('click', () => handleSocialLogin('google'));
    
    elements.emailInput.addEventListener('input', debounce(() => validateLoginEmail(true), 300));
    elements.passwordInput.addEventListener('input', debounce(() => validateLoginPassword(true), 300));
    
    // --- Auth State Check ---
    onAuthStateChanged(fbAuth, (user) => {
        // *** REDIRECT LOOP FIX ***
        // Only redirect if a user is found AND we are not in the middle of a login submission.
        if (user && !state.isSubmitting) {
            console.log("User already signed in, redirecting to dashboard.");
            localStorage.setItem('authToken', user.accessToken);
            window.location.replace('/app/dashboard.html'); 
        } else if (user && state.isSubmitting) {
             console.log("Auth state changed, but login is in progress. Waiting for success handler.");
        } else {
            // User is null, show the login page.
            const savedEmail = localStorage.getItem('rememberedEmail');
            if (savedEmail) {
                elements.emailInput.value = savedEmail;
                elements.rememberMe.checked = true;
            }
        }
    });
    
    // Check for URL parameters from registration or recovery
    const params = new URLSearchParams(window.location.search);
    if (params.has('registered')) {
        showToast('Account Created!', 'You can now sign in with your new account.', 'success');
    }
    if (params.has('recovered')) {
        showToast('Password Reset!', 'Your password has been successfully reset. You can now log in.', 'success');
    }

    // --- Login Handlers ---
    async function handleLogin(e) {
        e.preventDefault();
        if (state.isSubmitting) return;
        
        state.isSubmitting = true; // Set flag

        const email = elements.emailInput.value;
        const password = elements.passwordInput.value;

        const isEmailValid = validateLoginEmail();
        const isPasswordValid = validateLoginPassword();
        if (!isEmailValid || !isPasswordValid) {
            showToast('Error', 'Please fix the errors in the form.', 'error');
            state.isSubmitting = false; 
            return;
        }

        setLoadingState(true, elements.loginButton);

        try {
            // 1. Execute reCAPTCHA (Bot Protection)
            await executeRecaptcha('LOGIN');

            // 2. Proceed with Firebase Login
            const persistence = elements.rememberMe.checked ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(fbAuth, persistence);
            
            const userCredential = await signInWithEmailAndPassword(fbAuth, email, password);
            
            if (elements.rememberMe.checked) {
                localStorage.setItem('rememberedEmail', email);
            } else {
                localStorage.removeItem('rememberedEmail');
            }
            
            handleLoginSuccess(userCredential.user);

        } catch (error) {
            console.log("Login error code:", error.code); 

            // --- MFA HANDLING START ---
            if (error.code === 'auth/multi-factor-auth-required') {
                try {
                    // 1. Get the resolver from the error
                    const resolver = getMultiFactorResolver(fbAuth, error);
                    const phoneHint = resolver.hints.find(hint => hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID);

                    if (phoneHint) {
                        showToast('MFA Required', 'Sending verification code...', 'info');

                        // Clear any existing verifier
                        if (window.recaptchaVerifier) {
                            try { window.recaptchaVerifier.clear(); } catch(e){}
                            window.recaptchaVerifier = null;
                        }

                        // NOTE: This uses the invisible recaptcha for MFA, separate from Enterprise bot check
                        window.recaptchaVerifier = new RecaptchaVerifier(fbAuth, 'recaptcha-container', {
                            'size': 'invisible',
                            'callback': (response) => {
                                console.log("MFA reCAPTCHA solved");
                            }
                        });
                        
                        const phoneInfoOptions = {
                            multiFactorHint: phoneHint,
                            session: resolver.session
                        };
                        
                        const phoneAuthProvider = new PhoneAuthProvider(fbAuth);
                        const verificationId = await phoneAuthProvider.verifyPhoneNumber(phoneInfoOptions, window.recaptchaVerifier);
                        
                        const verificationCode = prompt(`Enter the SMS code sent to ${phoneHint.phoneNumber}`);
                        
                        if (verificationCode) {
                            const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
                            const multiFactorAssertion = PhoneMultiFactorGenerator.assertion(cred);
                            
                            const userCredential = await resolver.resolveSignIn(multiFactorAssertion);
                            handleLoginSuccess(userCredential.user);
                            return; 
                        } else {
                             showToast('Info', 'Login cancelled (MFA code not entered).', 'info');
                             setLoadingState(false, elements.loginButton);
                             state.isSubmitting = false;
                             return;
                        }
                    } else {
                        showToast('Error', 'No supported MFA method found.', 'error');
                    }
                } catch (mfaError) {
                    console.error("MFA Error:", mfaError);
                    if (window.recaptchaVerifier) {
                        try { window.recaptchaVerifier.clear(); } catch (e) {}
                        window.recaptchaVerifier = null;
                    }
                    showToast('Error', 'Multi-factor authentication failed: ' + mfaError.message, 'error');
                    setLoadingState(false, elements.loginButton);
                    state.isSubmitting = false;
                    return;
                }
            }
            // --- MFA HANDLING END ---

            handleFirebaseError(error, 'login');
            setLoadingState(false, elements.loginButton);
            state.isSubmitting = false;
        }
    }

    // --- Validation (Login) ---
    function validateLoginEmail(showSuccessMsg = false) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!elements.emailInput.value) {
            return showError(elements.emailInput, 'email-error', 'Email is required.');
        }
        if (!emailRegex.test(elements.emailInput.value)) {
            return showError(elements.emailInput, 'email-error', 'Please enter a valid email address.');
        }
        return showSuccessMsg ? showSuccess(elements.emailInput, 'email-error') : true;
    }

    function validateLoginPassword(showSuccessMsg = false) {
        if (!elements.passwordInput.value) {
            return showError(elements.passwordInput, 'password-error', 'Password is required.');
        }
        if (elements.passwordInput.value.length < 6) {
            return showError(elements.passwordInput, 'password-error', 'Password must be at least 6 characters.');
        }
        return showSuccessMsg ? showSuccess(elements.passwordInput, 'password-error') : true;
    }
}

// ========================================================================
// REGISTER PAGE LOGIC (`register.html`)
// ========================================================================
function initRegisterPage() {
    const elements = {
        // Progress
        progressBar1: document.getElementById('progress-bar-1'),
        progressBar2: document.getElementById('progress-bar-2'),
        stepDots: {
            1: document.getElementById('step-dot-1'),
            2: document.getElementById('step-dot-2'),
            3: document.getElementById('step-dot-3'),
        },
        // Step 1
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
        // Step 2
        step2: document.getElementById('step2'),
        phone: document.getElementById('phone'),
        backToStep1: document.getElementById('backToStep1'),
        createAccountBtn: document.getElementById('createAccountBtn'),
        skipMfaBtn: document.getElementById('skipMfaBtn'),
        // Step 3
        step3: document.getElementById('step3'),
        welcomeUsername: document.getElementById('welcome-username'),
    };

    // --- Event Listeners ---
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
    
    // Step Navigation
    elements.nextToStep2.addEventListener('click', handleGoToStep2);
    elements.backToStep1.addEventListener('click', () => goToStep(1));
    
    // Form Submission
    elements.createAccountBtn.addEventListener('click', handleRegistration);
    elements.skipMfaBtn.addEventListener('click', handleRegistration); 
    
    // Social Logins
    elements.googleBtn.addEventListener('click', () => handleSocialLogin('google'));

    // --- Step Navigation (Register) ---
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
                    setTimeout(() => {
                        stepEl.classList.remove('active', 'exiting');
                    }, 400);
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

        // Update progress bar fill
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

    // --- Form Handlers (Register) ---
    function handleGoToStep2() {
        if (validateStep1()) {
            state.registrationData.username = elements.username.value;
            state.registrationData.email = elements.email.value;
            state.registrationData.password = elements.password.value;
            goToStep(2);
        } else {
            showToast('Error', 'Please fix the errors in the form.', 'error');
        }
    }

    // --- Handle Registration with MFA Enrollment ---
    async function handleRegistration(e) {
        e.preventDefault(); 
        if (state.isSubmitting) return;
        
        state.isSubmitting = true; // Set flag
        state.registrationData.phone = elements.phone.value;
        
        setLoadingState(true, elements.createAccountBtn);
        setLoadingState(true, elements.skipMfaBtn);
        
        try {
            // 1. Execute reCAPTCHA (Bot Protection)
            await executeRecaptcha('REGISTER');

            // 2. Create the user
            const userCredential = await createUserWithEmailAndPassword(fbAuth, state.registrationData.email, state.registrationData.password);
            const user = userCredential.user;
            
            // 3. Update Auth profile
            await updateProfile(user, {
                displayName: state.registrationData.username,
                photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(state.registrationData.username)}&background=4361ee&color=fff&size=128`
            });

            // 4. Create Firestore profile document
            await createProfileDocument(user, state.registrationData.username, state.registrationData.phone);
            
            // --- MFA ENROLLMENT LOGIC START ---
            // If the user entered a phone number and clicked "Create Account", try to enroll them
            if (state.registrationData.phone && e.target.id !== 'skipMfaBtn') {
                try {
                    // A. Initialize Invisible Recaptcha for MFA
                    if (window.recaptchaVerifier) {
                        try { window.recaptchaVerifier.clear(); } catch(e) {}
                        window.recaptchaVerifier = null;
                    }

                    window.recaptchaVerifier = new RecaptchaVerifier(fbAuth, 'recaptcha-container', {
                        'size': 'invisible',
                        'callback': (response) => {
                            console.log("MFA reCAPTCHA solved");
                        }
                    });

                    // B. Send SMS Verification Code
                    const verificationId = await new PhoneAuthProvider(fbAuth).verifyPhoneNumber(
                        { phoneNumber: state.registrationData.phone, session: null },
                        window.recaptchaVerifier
                    );

                    // C. Ask User for Code
                    const code = prompt(`MFA Setup: Enter the SMS code sent to ${state.registrationData.phone}`);

                    if (code) {
                        // D. Create Credential & Enroll
                        const cred = PhoneAuthProvider.credential(verificationId, code);
                        const assertion = PhoneMultiFactorGenerator.assertion(cred);
                        await multiFactor(user).enroll(assertion, "My Phone Number");
                        showToast('Success', 'MFA Enabled Successfully!', 'success');
                    } else {
                        showToast('Info', 'MFA setup skipped (no code entered).', 'warning');
                    }
                } catch (mfaError) {
                    console.error("MFA Enrollment Error:", mfaError);
                    if (window.recaptchaVerifier) {
                        try { window.recaptchaVerifier.clear(); } catch(e) {}
                        window.recaptchaVerifier = null;
                    }
                    showToast('Warning', 'Account created, but MFA setup failed: ' + mfaError.message, 'warning');
                    // Allow the flow to continue to dashboard so user isn't stuck
                }
            }
            // --- MFA ENROLLMENT LOGIC END ---

            await setPersistence(fbAuth, browserLocalPersistence);

            elements.welcomeUsername.textContent = state.registrationData.username;
            goToStep(3);
            
            setTimeout(() => {
                window.location.replace('/app/dashboard.html');
            }, 2000); 

        } catch (error) {
            handleFirebaseError(error, 'register');
            setLoadingState(false, elements.createAccountBtn);
            setLoadingState(false, elements.skipMfaBtn);
            state.isSubmitting = false; 
            // Go back to step 1 if the error was email/password related
            if (error.code === 'auth/email-already-in-use' || error.code === 'auth/weak-password') {
                goToStep(1);
            }
        }
    }

    // --- Validation (Register) ---
    function validateStep1() {
        const isUsername = validateField(elements.username, 'username-error', validateUsername, false);
        const isEmail = validateField(elements.email, 'email-error', validateEmail, false);
        const isPassword = validateField(elements.password, 'password-error', validatePassword, false);
        const isTerms = elements.termsCheckbox.checked;

        if (isUsername && isEmail && isPassword && isTerms) {
            elements.nextToStep2.disabled = false;
            return true;
        } else {
            elements.nextToStep2.disabled = true;
            return false;
        }
    }
    
    function validateField(inputEl, errorElId, validator, showSuccessMsg = true) {
        return validator(inputEl, errorElId, showSuccessMsg);
    }

    function validateUsername(inputEl, errorElId, showSuccessMsg = true) {
        const username = inputEl.value;
        if (username.length < 3) {
            return showError(inputEl, errorElId, 'Username must be at least 3 characters.');
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return showError(inputEl, errorElId, 'Only letters, numbers, and underscores allowed.');
        }
        return showSuccessMsg ? showSuccess(inputEl, errorElId) : true;
    }

    function validateEmail(inputEl, errorElId, showSuccessMsg = true) {
        const email = inputEl.value;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email) {
            return showError(inputEl, errorElId, 'Email is required.');
        }
        if (!emailRegex.test(email)) {
            return showError(inputEl, errorElId, 'Please enter a valid email address.');
        }
        return showSuccessMsg ? showSuccess(inputEl, errorElId) : true;
    }

    function validatePassword(inputEl, errorElId, showSuccessMsg = true) {
        const reqs = getPasswordReqs(inputEl.value);
        if (!Object.values(reqs).every(Boolean)) {
            return showError(inputEl, errorElId, 'Password does not meet all requirements.');
        }
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
            if (strength <= 2) {
                barClass = 'w-1/3 bg-danger-500'; text = 'Weak';
            } else if (strength === 3) {
                barClass = 'w-2/3 bg-warning-500'; text = 'Medium';
            } else {
                barClass = 'w-full bg-success-500'; text = 'Strong';
            }
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

// ========================================================================
// RECOVERY PAGE LOGIC (`recovery.html`)
// ========================================================================
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

    // --- Event Listeners ---
    if (!elements.recoveryForm) return; 
    
    elements.recoveryForm.addEventListener('submit', handleRecoverySubmit);
    elements.emailInput.addEventListener('input', debounce(() => validateRecoveryEmail(true), 300));
    
    // --- Step Navigation (Recovery) ---
    function goToStep(stepName) {
        const currentStepEl = (currentStep === 1) ? elements.stepEmail : elements.stepSuccess;
        const nextStepEl = (stepName === 'email') ? elements.stepEmail : elements.stepSuccess;
        
        if (currentStepEl) {
            currentStepEl.classList.add('exiting');
            setTimeout(() => {
                currentStepEl.classList.remove('active', 'exiting');
            }, 400);
        }
        if (nextStepEl) {
            setTimeout(() => {
                nextStepEl.classList.add('active');
            }, 100);
        }
        currentStep = (stepName === 'email') ? 1 : 2;
    }

    // --- Form Handlers (Recovery) ---
    async function handleRecoverySubmit(e) {
        e.preventDefault();
        if (state.isSubmitting) return;

        state.isSubmitting = true; // Set flag
        const email = elements.emailInput.value;
        if (!validateRecoveryEmail()) {
            showToast('Error', 'Please enter a valid email address.', 'error');
            state.isSubmitting = false; 
            return;
        }

        setLoadingState(true, elements.recoveryButton);

        try {
            // 1. Execute reCAPTCHA (Bot Protection)
            await executeRecaptcha('RECOVERY');

            // 2. Send Reset Email
            await sendPasswordResetEmail(fbAuth, email);
            elements.sentEmail.textContent = email;
            goToStep('success');
        } catch (error) {
            // For security, we also go to success step even if user not found
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

    // --- Validation (Recovery) ---
    function validateRecoveryEmail(showSuccessMsg = false) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!elements.emailInput.value) {
            return showError(elements.emailInput, 'email-error', 'Email is required.');
        }
        if (!emailRegex.test(elements.emailInput.value)) {
            return showError(elements.emailInput, 'email-error', 'Please enter a valid email address.');
        }
        return showSuccessMsg ? showSuccess(elements.emailInput, 'email-error') : true;
    }
}

// ========================================================================
// SHARED FUNCTIONS (used by all auth pages)
// ========================================================================

// --- Social Login (Shared) ---
async function handleSocialLogin(providerName) {
    if (state.isSubmitting) return;
    
    state.isSubmitting = true; 
    setLoadingState(true, document.getElementById('googleBtn'));

    const provider = fbGoogleProvider;

    try {
        // 1. Execute reCAPTCHA (Optional for social, but good practice)
        await executeRecaptcha('SOCIAL_LOGIN');

        await setPersistence(fbAuth, browserLocalPersistence);
        const result = await signInWithPopup(fbAuth, provider);
        const user = result.user;
        const additionalInfo = getAdditionalUserInfo(result);
        
        // Check if this is a new user. If so, create their profile documents.
        if (additionalInfo?.isNewUser) {
            console.log("New social user detected, creating profile...");
            await createProfileDocument(user, user.displayName, user.phoneNumber);
        }
        
        handleLoginSuccess(user);

    } catch (error) {
        handleFirebaseError(error, 'social');
        setLoadingState(false, document.getElementById('googleBtn'));
        state.isSubmitting = false; 
    }
}

/**
 * Creates the initial user profile document in Firestore
 */
async function createProfileDocument(user, username, phone = '') {
    if (!user) return;
    
    const userProfileRef = doc(fbDB, 'user_data', user.uid, 'profile', 'settings');
    
    const newUserProfile = {
        userId: user.uid,
        fullName: username || 'New User',
        email: user.email,
        phone: phone || '',
        createdAt: serverTimestamp(),
        theme: 'dark', 
        plan: 'free',
        role: 'user',
    };
    
    try {
        await setDoc(userProfileRef, newUserProfile);
        console.log(`Successfully created 'settings' document for user ${user.uid}`);
    } catch (e) {
        console.error("CRITICAL ERROR: Could not create user profile document.", e);
        showToast("Error", "Could not save user profile. Please update it in Settings.", "error");
    }
}


// --- Auth Success/Error (Shared) ---
function handleLoginSuccess(user) {
    showToast('Login Successful!', `Welcome, ${user.displayName || user.email}.`, 'success');
    localStorage.setItem('authToken', user.accessToken);
    
    if (document.getElementById('step3')) {
        // If on register page, go to step 3
        document.getElementById('welcome-username').textContent = user.displayName || 'User';
        if (typeof initRegisterPage.goToStep === 'function') {
            initRegisterPage.goToStep(3);
        }
    }

    setTimeout(() => {
       window.location.replace('/app/dashboard.html');
    }, 1000); 
}

function handleFirebaseError(error, context) {
    console.error(`Firebase Auth Error (${context}):`, error.code, error.message);
    let userMessage = 'An unknown error occurred. Please try again.';
    let emailError = false, passError = false;

    switch (error.code) {
        // Common
        case 'auth/invalid-email':
            userMessage = 'Please enter a valid email address.';
            emailError = true;
            break;
        case 'auth/network-request-failed':
            userMessage = 'Network error. Please check your internet connection.';
            break;
        case 'auth/too-many-requests':
            userMessage = 'Access temporarily disabled. Please reset your password or try again later.';
            break;
        
        // Login
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            userMessage = 'Invalid email or password. Please try again.';
            emailError = true; passError = true;
            break;
        
        // Register
        case 'auth/email-already-in-use':
            userMessage = 'This email is already in use. Please log in.';
            emailError = true;
            if (document.getElementById('step1') && typeof initRegisterPage.goToStep === 'function') {
                initRegisterPage.goToStep(1);
            }
            break;
        case 'auth/weak-password':
            userMessage = 'Password is too weak. Please choose a stronger one.';
            passError = true;
            if (document.getElementById('step1') && typeof initRegisterPage.goToStep === 'function') {
                initRegisterPage.goToStep(1);
            }
            break;

        // Social
        case 'auth/popup-closed-by-user':
            userMessage = 'Sign-in was cancelled.';
            break;
        case 'auth/account-exists-with-different-credential':
            userMessage = 'An account already exists with this email using a different sign-in method.';
            emailError = true;
            break;
            
        // Recovery
        case 'auth/user-not-found':
            userMessage = 'Recovery email sent (if account exists).';
            break;
    }
    
    if (emailError && document.getElementById('email')) {
        showError(document.getElementById('email'), 'email-error', context === 'login' ? ' ' : userMessage);
    }
    if (passError && document.getElementById('password')) {
        showError(document.getElementById('password'), 'password-error', context === 'login' ? userMessage : ' ');
    }
    
    if (error.code !== 'auth/user-not-found') {
        showToast('Error', userMessage, 'error');
    }
}


// --- UI & Validation Helpers (Shared) ---

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


function togglePasswordVisibility(passwordEl, toggleEl) {
    const isVisible = passwordEl.type === 'text';
    passwordEl.type = isVisible ? 'password' : 'text';
    const icon = toggleEl.querySelector('i');
    icon.className = isVisible ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
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

function setLoadingState(isLoading, buttonEl, loadingText = "Loading...") {
    if (!buttonEl) return;
    state.isSubmitting = isLoading;
    buttonEl.disabled = isLoading;
    
    const textEl = buttonEl.querySelector('.button-text');
    const spinnerEl = buttonEl.querySelector('.button-spinner');
    
    if (isLoading) {
        if(textEl) textEl.classList.add('hidden');
        if(spinnerEl) spinnerEl.classList.remove('hidden');
    } else {
        if(textEl) textEl.classList.remove('hidden');
        if(spinnerEl) spinnerEl.classList.add('hidden');
    }
}

function showToast(title, message, type = 'info') {
    if (!toastContainer) return;
    const icons = {
        success: 'bi-check-circle-fill text-green-500',
        error: 'bi-x-circle-fill text-red-500',
        warning: 'bi-exclamation-triangle-fill text-yellow-500',
        info: 'bi-info-circle-fill text-blue-500'
    };
    const borderColors = {
        success: 'border-green-500',
        error: 'border-red-500',
        warning: 'border-yellow-500',
        info: 'border-blue-500'
    };

    const toast = document.createElement('div');
    toast.className = `toast w-[350px] max-w-[90vw] p-4 rounded-lg bg-white dark:bg-slate-800 shadow-2xl border-l-4 ${borderColors[type]} flex items-start gap-3`;
    toast.setAttribute('role', 'alert');

    toast.innerHTML = `
        <i class="bi ${icons[type]} text-xl mt-1"></i>
        <div class="flex-1">
            <div class="font-semibold text-slate-900 dark:text-white">${title}</div>
            <div class="text-sm text-slate-600 dark:text-slate-300">${message}</div>
        </div>
        <button class="text-slate-400 hover:text-slate-600" onclick="this.parentElement.remove()"><i class="bi bi-x-lg"></i></button>
    `;

    toastContainer.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);

    setTimeout(() => {
        if(toast.parentElement) {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 400);
        }
    }, 5000);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}