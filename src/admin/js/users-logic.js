// --- Trace'N Find User Management Logic ---
// This file handles all logic *specific* to admin/users.html.
// It assumes `admin-app-shell.js` has already been loaded and has authenticated the user.

// SCALABILITY/INTEGRATION FIX: All imports now come from the central admin-app-shell.js
import { 
    fbDB,
    collection, 
    onSnapshot, 
    query,
    doc,
    getDoc,
    getDocs,
    showToast,
    showModal,
    orderBy
} from './admin-app-shell.js';

// --- Global State ---
let allUsers = [];
let userListener = null;

// --- DOM Elements ---
const elements = {
    usersTableBody: document.getElementById('users-table-body'),
    usersEmptyState: document.getElementById('users-empty-state'),
    usersLoadingState: document.getElementById('users-loading-state'),
    searchInput: document.getElementById('user-search-input'),
};

// --- Initialization ---
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserIsAdmin) {
            console.log("User Management Logic: Auth is ready.");
            callback(window.currentUserId);
        } else {
            // admin-app-shell is handling redirection, just wait.
            console.log("User Management logic waiting for admin authentication...");
            requestAnimationFrame(check);
        }
    };
    requestAnimationFrame(check);
}

waitForAuth((adminId) => {
    listenForUsers();
    setupEventListeners();
});

/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners() {
    elements.searchInput.addEventListener('input', (e) => {
        renderUserList(allUsers, e.target.value.toLowerCase());
    });

    // Event delegation for action buttons
    elements.usersTableBody.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const userId = target.dataset.id;
        if (target.matches('.btn-delete-user')) {
            handleDeleteUser(userId);
        }
        // TODO: Add edit user logic
    });
}

// --- Firestore Data ---

/**
 * Sets up a real-time listener for all users.
 * This is a scalable approach that fetches the user list first.
 * Then, it asynchronously fetches individual profile details.
 */
function listenForUsers() {
    setLoadingState(true);
    
    const usersRef = collection(fbDB, 'user_data');
    // We can't order by profile.fullName, as it's in a subcollection.
    // In a real app, you'd duplicate `fullName` and `createdAt` to the
    // `user_data/{userId}` doc to allow for server-side ordering.
    const q = query(usersRef);

    if (userListener) userListener();

    userListener = onSnapshot(q, (snapshot) => {
        setLoadingState(false);
        if (snapshot.empty) {
            elements.usersEmptyState.style.display = 'table-row';
            elements.usersTableBody.innerHTML = ''; // Clear
            elements.usersTableBody.appendChild(elements.usersEmptyState);
            return;
        }

        // Fetch all profile details
        const userPromises = snapshot.docs.map(userDoc => {
            return fetchUserProfile(userDoc.id);
        });

        Promise.all(userPromises).then(users => {
            allUsers = users;
            renderUserList(allUsers, elements.searchInput.value.toLowerCase());
        });

    }, (error) => {
        console.error("Error listening for users:", error);
        showToast('Error', 'Could not load user data.', 'error');
        setLoadingState(false);
        elements.usersEmptyState.style.display = 'table-row';
    });
}

/**
 * Helper to fetch a single user's profile information.
 * @param {string} userId - The ID of the user.
 * @returns {object} An object containing user data.
 */
async function fetchUserProfile(userId) {
    try {
        const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
        const profileSnap = await getDoc(profileRef);
        
        // SCALABILITY NOTE:
        // We are NOT fetching device count here (e.g., `getDocs(collection(fbDB, 'user_data', userId, 'devices'))`)
        // as this would be an N+1 query problem and very slow.
        // In a real app, `deviceCount` would be a field on the `user_data/{userId}`
        // document, updated by a Cloud Function.

        if (profileSnap.exists()) {
            const profile = profileSnap.data();
            return {
                id: userId,
                fullName: profile.fullName || 'New User',
                email: profile.email || 'No Email Provided', // Assuming email is stored here
                deviceCount: profile.deviceCount || 'N/A', // Reading the aggregated field
                status: profile.status || 'Active', // e.g., 'Active', 'Suspended'
            };
        } else {
            return {
                id: userId,
                fullName: 'New User',
                email: 'Email not found',
                deviceCount: 'N/A',
                status: 'Active',
            };
        }
    } catch (error) {
        console.warn("Could not fetch profile for user:", userId, error);
        return { id: userId, fullName: 'Error Loading', email: '', deviceCount: 'N/A', status: 'Error' };
    }
}


// --- UI Rendering ---

/**
 * Renders the list of users into the table, applying any filters.
 * @param {Array} users - The complete list of user objects.
 * @param {string} filterText - The text to filter by.
 */
function renderUserList(users, filterText) {
    elements.usersTableBody.innerHTML = ''; // Clear list
    
    const filteredUsers = users.filter(user => 
        user.fullName.toLowerCase().includes(filterText) ||
        user.email.toLowerCase().includes(filterText) ||
        user.id.toLowerCase().includes(filterText)
    );

    if (filteredUsers.length === 0) {
        elements.usersEmptyState.style.display = 'table-row';
        elements.usersTableBody.appendChild(elements.usersEmptyState);
        return;
    }
    
    elements.usersEmptyState.style.display = 'none';

    filteredUsers.forEach(user => {
        const tr = document.createElement('tr');
        tr.className = 'animate-fade-in';
        
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.fullName)}&background=4361ee&color=fff&size=40`;
        const statusClass = user.status === 'Active' ? 'badge-success' : 'badge-danger';

        tr.innerHTML = `
            <!-- User Column -->
            <td>
                <div class="flex items-center gap-3">
                    <img src="${avatarUrl}" alt="${user.fullName}" class="w-10 h-10 rounded-full flex-shrink-0">
                    <div class="flex-1 overflow-hidden">
                        <div class="font-medium text-text-primary dark:text-dark-text-primary truncate">${user.fullName}</div>
                        <div class="text-sm text-text-secondary dark:text-dark-text-secondary truncate">${user.email}</div>
                    </div>
                </div>
            </td>
            <!-- User ID Column -->
            <td class="text-sm text-text-secondary dark:text-dark-text-secondary font-mono">${user.id}</td>
            <!-- Devices Column -->
            <td class="text-sm text-text-secondary dark:text-dark-text-secondary">${user.deviceCount}</td>
            <!-- Status Column -->
            <td>
                <span class="badge ${statusClass}">${user.status}</span>
            </td>
            <!-- Actions Column -->
            <td>
                <div class="flex gap-2">
                    <button class="btn btn-secondary btn-sm btn-edit-user" data-id="${user.id}" title="Edit User">
                        <i class="bi bi-pencil-fill"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm btn-delete-user" data-id="${user.id}" title="Delete User">
                        <i class="bi bi-trash-fill text-danger"></i>
                    </button>
                </div>
            </td>
        `;
        elements.usersTableBody.appendChild(tr);
    });
}

/**
 * Shows or hides the table loading state.
 * @param {boolean} isLoading - True to show loading, false to hide.
 */
function setLoadingState(isLoading) {
    if (isLoading) {
        elements.usersTableBody.innerHTML = '';
        elements.usersLoadingState.style.display = 'table-row';
        elements.usersEmptyState.style.display = 'none';
    } else {
        elements.usersLoadingState.style.display = 'none';
    }
}

// --- Core Logic ---

/**
 * Handles deleting a user.
 * @param {string} userId - The ID of the user to delete.
 */
function handleDeleteUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    const userName = user ? user.fullName : 'this user';

    showModal(
        true,
        'Delete User?',
        `Are you sure you want to permanently delete <strong>${userName}</strong>? This will erase all their associated data (devices, geofences, etc.) and cannot be undone.`,
        'Delete User',
        'btn-danger',
        () => {
            // Confirm callback
            // SCALABILITY/SECURITY: This MUST be a Cloud Function.
            // Deleting a user and all their subcollections from the client is
            // insecure and unreliable.
            console.log(`Requesting deletion for user: ${userId} (via Cloud Function)`);
            showToast(
                'Deletion Requested',
                `A request to delete ${userName} has been sent. This must be handled by a secure server function.`,
                'info'
            );
            // In a real app, you'd call:
            // const deleteUser = httpsCallable(fbFunctions, 'deleteUserAccount');
            // await deleteUser({ uid: userId });
            // The onSnapshot listener would then automatically remove the user from the list.
        }
    );
}