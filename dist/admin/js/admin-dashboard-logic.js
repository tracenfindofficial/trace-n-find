// --- Trace'N Find Admin Dashboard Logic ---
// This file handles all logic *specific* to admin/dashboard.html.
// It assumes `admin-app-shell.js` has already been loaded and has authenticated the user.

// SCALABILITY/INTEGRATION FIX: All imports now come from the central admin-app-shell.js
import { 
    fbDB,
    collection, 
    onSnapshot, 
    query,
    where,
    orderBy,
    limit,
    getDocs,
    showToast,
    collectionGroup
} from './admin-app-shell.js';

// --- DOM Elements ---
const elements = {
    // Stats
    statTotalUsers: document.getElementById('stat-total-users'),
    statTotalDevices: document.getElementById('stat-total-devices'),
    statOpenTickets: document.getElementById('stat-open-tickets'),
    statSecurityAlerts: document.getElementById('stat-security-alerts'),
    // Recent Tickets
    recentTicketsList: document.getElementById('recent-tickets-list'),
    ticketsEmptyState: document.getElementById('tickets-empty-state'),
    // Recent Users
    recentUsersList: document.getElementById('recent-users-list'),
    usersEmptyState: document.getElementById('users-empty-state'),
};

// --- Initialization ---
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserIsAdmin) {
            console.log("Admin Dashboard Logic: Auth is ready.");
            callback(window.currentUserId);
        } else {
            // admin-app-shell is handling redirection, just wait.
            console.log("Admin Dashboard logic waiting for admin authentication...");
            requestAnimationFrame(check);
        }
    };
    requestAnimationFrame(check);
}

waitForAuth((adminId) => {
    // Start all real-time listeners
    listenForStats();
    listenForRecentTickets();
    listenForRecentUsers();
});

// --- Firestore Data Listeners ---

/**
 * Sets up listeners for the main dashboard stats.
 */
function listenForStats() {
    // 1. Total Users
    // We get this by counting the documents in the `user_data` root collection.
    const usersRef = collection(fbDB, 'user_data');
    onSnapshot(usersRef, (snapshot) => {
        elements.statTotalUsers.textContent = snapshot.size;
    }, (error) => {
        console.error("Error listening for total users:", error);
        elements.statTotalUsers.textContent = 'N/A';
    });

    // 2. Open Support Tickets
    const ticketsRef = collection(fbDB, 'support_tickets');
    const openTicketsQuery = query(ticketsRef, where('status', '==', 'new'));
    onSnapshot(openTicketsQuery, (snapshot) => {
        elements.statOpenTickets.textContent = snapshot.size;
    }, (error) => {
        console.error("Error listening for open tickets:", error);
        elements.statOpenTickets.textContent = 'N/A';
    });

    // 3. Total Devices
    // SCALABILITY NOTE: Querying all subcollections (`devices`) is not
    // efficient or scalable on the client. This should be a value
    // aggregated by a Cloud Function and stored in a 'stats' document.
    // For this demo, we will perform a collectionGroup query.
    const devicesCollection = collectionGroup(fbDB, 'devices');
    getDocs(devicesCollection).then(snapshot => {
         elements.statTotalDevices.textContent = snapshot.size;
    }).catch(error => {
        console.error("Error fetching total devices:", error);
        elements.statTotalDevices.textContent = 'N/A';
        showToast('Performance Warning', 'Device count is simulated. Use Cloud Function in production.', 'info');
    });
    
    // 4. Security Alerts (Example: 'lost' devices)
    const lostDevicesQuery = query(collectionGroup(fbDB, 'devices'), where('status', '==', 'lost'));
    onSnapshot(lostDevicesQuery, (snapshot) => {
        elements.statSecurityAlerts.textContent = snapshot.size;
    }, (error) => {
        console.error("Error listening for security alerts:", error);
        elements.statSecurityAlerts.textContent = 'N/A';
    });
}

/**
 * Sets up a listener for the 5 most recent support tickets.
 */
function listenForRecentTickets() {
    const ticketsRef = collection(fbDB, 'support_tickets');
    const q = query(ticketsRef, orderBy('createdAt', 'desc'), limit(5));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            elements.recentTicketsList.innerHTML = ''; // Clear list
            elements.recentTicketsList.appendChild(elements.ticketsEmptyState);
            elements.ticketsEmptyState.style.display = 'table-row';
            return;
        }

        elements.recentTicketsList.innerHTML = ''; // Clear list
        elements.ticketsEmptyState.style.display = 'none';

        snapshot.docs.forEach(doc => {
            const ticket = doc.data();
            const tr = document.createElement('tr');
            tr.className = 'table-clickable-row';
            tr.dataset.id = doc.id;
            
            const statusClass = ticket.status === 'new' ? 'badge-warning' : 'badge-success';
            const statusText = ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1);
            const date = ticket.createdAt?.toDate ? ticket.createdAt.toDate().toLocaleDateString() : 'N/A';
            
            tr.innerHTML = `
                <td>
                    <div class="font-medium text-text-primary dark:text-dark-text-primary">${ticket.fullName}</div>
                    <div class="text-xs text-text-secondary dark:text-dark-text-secondary">${ticket.email}</div>
                </td>
                <td class="text-text-secondary dark:text-dark-text-secondary">${ticket.subject}</td>
                <td><span class"badge ${statusClass}">${statusText}</span></td>
                <td class="text-text-secondary dark:text-dark-text-secondary">${date}</td>
            `;
            elements.recentTicketsList.appendChild(tr);
        });
    }, (error) => {
        console.error("Error listening for recent tickets:", error);
        elements.recentTicketsList.innerHTML = ''; // Clear list
        elements.recentTicketsList.appendChild(elements.ticketsEmptyState);
        elements.ticketsEmptyState.style.display = 'table-row';
    });
}

/**
 * Sets up a listener for the 5 most recent users.
 */
function listenForRecentUsers() {
    // This query is tricky, as user data is split. We'll just get *any* 5 users
    // by querying the 'user_data' collection.
    // A 'createdAt' field on the user_data doc itself would be needed to get "newest".
    // For now, we just limit to 5.
    const usersRef = collection(fbDB, 'user_data');
    const q = query(usersRef, limit(5));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            elements.recentUsersList.innerHTML = ''; // Clear list
            elements.recentUsersList.appendChild(elements.usersEmptyState);
            elements.usersEmptyState.style.display = 'block';
            return;
        }

        elements.recentUsersList.innerHTML = ''; // Clear list
        elements.usersEmptyState.style.display = 'none';

        snapshot.docs.forEach(async (userDoc) => {
            const userId = userDoc.id;
            let userName = 'New User';
            let userEmail = 'Email not available';
            
            // We need to fetch the profile doc to get the name
            try {
                const profileRef = doc(fbDB, 'user_data', userId, 'profile', 'settings');
                const profileSnap = await getDoc(profileRef);
                if (profileSnap.exists() && profileSnap.data().fullName) {
                    userName = profileSnap.data().fullName;
                }
                
                // Note: We can't easily get the auth email here, so we'll use what we have.
                // A better structure would be to save the email in the profile doc.
                
            } catch (error) {
                console.warn("Could not fetch profile for user:", userId);
            }

            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 p-4 table-clickable-row';
            item.dataset.id = userId;
            
            const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=4361ee&color=fff&size=40`;
            
            item.innerHTML = `
                <img src="${avatarUrl}" alt="${userName}" class="w-10 h-10 rounded-full flex-shrink-0">
                <div class="flex-1 overflow-hidden">
                    <div class="font-medium text-text-primary dark:text-dark-text-primary truncate">${userName}</div>
                    <div class="text-sm text-text-secondary dark:text-dark-text-secondary truncate">${userId}</div>
                </div>
                <i class="bi bi-chevron-right text-text-secondary dark:text-dark-text-secondary"></i>
            `;
            elements.recentUsersList.appendChild(item);
        });

    }, (error) => {
        console.error("Error listening for recent users:", error);
        elements.recentUsersList.innerHTML = ''; // Clear list
        elements.recentUsersList.appendChild(elements.usersEmptyState);
        elements.usersEmptyState.style.display = 'block';
    });
}