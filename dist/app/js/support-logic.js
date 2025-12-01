// --- Trace'N Find Support Logic ---
// This file handles all logic *specific* to support.html.
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

// SCALABILITY/INTEGRATION FIX: All imports now come from the central app-shell.js
// MODIFICATION: Added appState, removed getDoc and fbAuth.
import { 
    fbDB,
    appState, // Import global state
    collection, 
    addDoc,
    serverTimestamp,
    showToast,
    doc,
    setLoadingState,
    sanitizeHTML
    // REMOVED: query, where, onSnapshot (handled globally in app-shell.js)
} from '/app/js/app-shell.js';

// --- DOM Elements ---
const elements = {
    supportForm: document.getElementById('support-form'),
    nameInput: document.getElementById('support-name'),
    emailInput: document.getElementById('support-email'),
    subjectInput: document.getElementById('support-subject'),
    messageInput: document.getElementById('support-message'),
    submitBtn: document.getElementById('submit-ticket-btn'),
    // REMOVED: notificationBadge reference to prevent conflict with app-shell.js
};

let isSubmitting = false; // Local state for submit button

// --- Initialization ---
// PERFORMANCE FIX: Wait for appState.currentUser to be populated by app-shell.js
function waitForAuth(callback) {
    const check = () => {
        if (appState.currentUser) {
            console.log("Support Logic: Auth is ready.");
            callback(appState.currentUser); // Pass the fully populated user object
        } else {
            console.log("Support logic waiting for authentication...");
            requestAnimationFrame(check); // Wait for app-shell to populate
        }
    };
    requestAnimationFrame(check);
}

waitForAuth((user) => {
    preFillForm(user);
    setupEventListeners(user.uid);
    // REMOVED: listenForUnreadNotifications(user.uid); 
    // The global app-shell.js now handles the badge count with proper deduplication.
    // BUG FIX: Removed the local re-definition of window.setLoadingState
});


/**
 * PERFORMANCE FIX: This function no longer fetches from Firestore.
 * It reads the data that app-shell.js already fetched and stored in appState.
 * @param {object} user - The populated appState.currentUser object.
 */
async function preFillForm(user) {
    // 1. Pre-fill email from appState
    if (user.email) {
        elements.emailInput.value = user.email;
        elements.emailInput.disabled = true; // Email is non-editable in this context
    }

    // 2. Get full name from appState
    // app-shell already merged `fullName` into `displayName`
    const userName = user.displayName || '';

    // 3. Set the name value
    if (userName) {
        elements.nameInput.value = userName;
    }
}

/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners(userId) {
    elements.supportForm.addEventListener('submit', (e) => handleSubmitTicket(e, userId));
}

// --- Core Logic ---

/**
 * Handles form submission and saves the support ticket to Firestore.
 * @param {Event} e - The form submit event.
 * @param {string} userId - The authenticated user's ID.
 */
async function handleSubmitTicket(e, userId) {
    e.preventDefault();
    if (isSubmitting) return;

    // Basic Validation
    // SECURITY FIX: Sanitize all text inputs before saving
    const name = sanitizeHTML(elements.nameInput.value.trim());
    const subject = sanitizeHTML(elements.subjectInput.value.trim());
    const message = sanitizeHTML(elements.messageInput.value.trim());

    if (!name || !subject || !message) {
        showToast('Validation Error', 'Please fill out all required fields.', 'error');
        return;
    }
    
    // INTEGRATION BUG FIX: Call the imported function directly
    isSubmitting = true;
    setLoadingState(elements.submitBtn, true);

    const ticketPayload = {
        userId: userId,
        fullName: name,
        email: elements.emailInput.value, // Get the pre-filled, disabled value (safe)
        subject: subject,
        message: message,
        status: 'new', // Default status for a new ticket
        createdAt: serverTimestamp(),
    };

    try {
        // SCALABILITY FIX: Save the ticket to the root-level 'support_tickets' collection.
        // This allows admins to query all tickets without needing user IDs.
        const ticketsCollectionRef = collection(fbDB, 'support_tickets');
        await addDoc(ticketsCollectionRef, ticketPayload);

        // Success Feedback
        showToast('Success', 'Your support ticket has been submitted. We will respond soon.', 'success');
        
        // Clear form fields (but keep pre-filled name/email)
        elements.subjectInput.value = '';
        elements.messageInput.value = '';

    } catch (error) {
        console.error("Error submitting support ticket:", error);
        showToast('Error', 'Could not submit ticket. Please try again later.', 'error');
    } finally {
        // INTEGRATION BUG FIX: Call the imported function directly
        isSubmitting = false;
        setLoadingState(elements.submitBtn, false);
    }
}