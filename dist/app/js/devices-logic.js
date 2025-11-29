// --- Trace'N Find Device Management Logic ---
// This file handles all logic *specific* to devices.html
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

// SCALABILITY FIX: All imports now come from the central app-shell.js
import { 
    fbDB,
    appState,
    showToast,
    showModal,
    collection, 
    doc,  
    query, 
    deleteDoc,
    onSnapshot,  // <-- ADDED
    orderBy,
    formatTimeAgo,
    getDeviceIcon,
    getBatteryIcon,
    getDeviceColor,
    debounce // Import debounce helper
} from '/app/js/app-shell.js'; // INTEGRATION FIX: Use root-relative path

// Wait for the global userId to be available from app-shell.js
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId) {
            console.log("Devices logic: Auth is ready.");
            callback();
        } else {
            console.log("Devices logic waiting for authentication...");
            requestAnimationFrame(check);
        }
    };
    
    // Check immediately in case everything is already loaded
    if (window.currentUserId) {
        callback();
    } else {
        requestAnimationFrame(check);
    }
}

// --- Main Device Page Init ---
waitForAuth(() => {
    console.log(`Device logic initializating for user: ${window.currentUserId}`);
    
    // --- Initialize all dashboard components ---
    const devices = new DevicePageManager(window.currentUserId);
    devices.init();
});


class DevicePageManager {
    constructor(userId) {
        this.userId = userId;
        
        // --- DOM Elements ---
        this.elements = {
            loadingSkeleton: document.getElementById('loadingSkeleton'),
            devicesContainer: document.getElementById('devicesContainer'),
            gridView: document.getElementById('gridView'),
            tableView: document.getElementById('tableView'),
            emptyState: document.getElementById('emptyState'),
            
            searchInput: document.getElementById('searchInput'),
            statusFilter: document.getElementById('statusFilter'),
            typeFilter: document.getElementById('typeFilter'),
            
            gridViewBtn: document.getElementById('gridViewBtn'),
            tableViewBtn: document.getElementById('tableViewBtn'),
        };

        // --- Internal State ---
        this.state = {
            viewMode: 'grid', // 'grid' or 'table'
            allDevices: [],
            filteredDevices: [],
            filter: {
                search: '',
                status: 'all',
                type: 'all'
            }
        };

        // --- Firestore Listeners ---
        this.deviceListener = null;
    }

    init() {
        this.setupEventListeners();
        
        // This is the original, reliable logic.
        // It shows the skeleton, then calls its own data-fetching function.
        this.setLoading(true); // Show loading skeleton immediately
        this.listenForDevices(); // Call the listener function
        
        this.setViewMode(localStorage.getItem('deviceViewMode') || 'grid');
    }

    listenForDevices() {
        const devicesRef = collection(fbDB, 'user_data', this.userId, 'devices');

        // --- THIS IS THE FIX ---
        // Restore the original, correct query that sorts devices.
        // This query was missing 'orderBy'.
        const q = query(devicesRef, orderBy('lastSeen', 'desc')); 
        // --- END OF FIX ---

        this.deviceListener = onSnapshot(q, (snapshot) => {
            const devices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.handleDevicesLoaded(devices); // Use the existing handler
        }, (error) => {
            console.error("Error listening for devices:", error);
            showToast('Error', 'Could not load devices.', 'error');
            this.setLoading(false); // Hide loading on error
            this.handleDevicesLoaded([]); // Show empty state
        });
    }

    setupEventListeners() {
        // View toggles
        this.elements.gridViewBtn.addEventListener('click', () => this.setViewMode('grid'));
        this.elements.tableViewBtn.addEventListener('click', () => this.setViewMode('table'));

        // Filters
        this.elements.searchInput.addEventListener('input', debounce(() => {
            this.state.filter.search = this.elements.searchInput.value.toLowerCase();
            this.applyFilters();
        }, 300));
        this.elements.statusFilter.addEventListener('change', (e) => {
            this.state.filter.status = e.target.value;
            this.applyFilters();
        });
        this.elements.typeFilter.addEventListener('change', (e) => {
            this.state.filter.type = e.target.value;
            this.applyFilters();
        });

        // Event delegation for actions (edit, delete)
        this.elements.devicesContainer.addEventListener('click', (e) => {
            const actionButton = e.target.closest('.action-btn');
            if (!actionButton) return;

            const deviceId = actionButton.dataset.id;
            const action = actionButton.dataset.action;
            
            if (action === 'edit') {
                this.handleEdit(deviceId);
            } else if (action === 'delete') {
                this.handleDelete(deviceId);
            }
        });
    }

    handleDevicesLoaded(devices) {
        this.state.allDevices = devices;
        this.applyFilters(); // This will also call renderDeviceViews
        this.setLoading(false); // Hide the skeleton
    }

    // --- View & Filter Logic ---

    setViewMode(mode) {
        this.state.viewMode = mode;
        localStorage.setItem('deviceViewMode', mode);
        
        const gridBtn = this.elements.gridViewBtn;
        const tableBtn = this.elements.tableViewBtn;
        const gridView = this.elements.gridView;
        const tableView = this.elements.tableView;

        const activeClasses = ['active', 'bg-bg-card', 'dark:bg-dark-bg-card', 'shadow', 'text-primary-600', 'dark:text-primary-400'];
        const inactiveClasses = ['text-text-secondary', 'dark:text-dark-text-secondary'];

        if (mode === 'grid') {
            gridView.classList.remove('hidden');
            tableView.classList.add('hidden');
            gridBtn.classList.add(...activeClasses);
            gridBtn.classList.remove(...inactiveClasses);
            tableBtn.classList.add(...inactiveClasses);
            tableBtn.classList.remove(...activeClasses);
        } else {
            gridView.classList.add('hidden');
            tableView.classList.remove('hidden');
            gridBtn.classList.add(...inactiveClasses);
            gridBtn.classList.remove(...activeClasses);
            tableBtn.classList.add(...activeClasses);
            tableBtn.classList.remove(...inactiveClasses);
        }
    }


    applyFilters() {
        const { search, status, type } = this.state.filter;
        
        this.state.filteredDevices = this.state.allDevices.filter(device => {
            // Ensure device fields are not null before calling toLowerCase
            const deviceName = device.name || '';
            const deviceModel = device.model || '';
            const deviceStatus = device.status || '';
            const deviceType = device.type || '';
    
            const statusMatch = status === 'all' || deviceStatus === status;
            const typeMatch = type === 'all' || deviceType.toLowerCase() === type.toLowerCase();
            const searchMatch = !search ||
                                deviceName.toLowerCase().includes(search) ||
                                deviceModel.toLowerCase().includes(search);
            return statusMatch && typeMatch && searchMatch;
        });

        this.renderDeviceViews();
    }
    
    //
    // SYNTAX FIX: This function was missing/broken. It is now correct.
    //
    setLoading(isLoading) {
        if (isLoading) {
            // BUG FIX: Use classList to hide/show
            this.elements.loadingSkeleton.classList.remove('hidden');
            this.elements.gridView.classList.add('hidden');
            this.elements.tableView.classList.add('hidden');
            this.elements.emptyState.classList.add('hidden');
        } else {
            this.elements.loadingSkeleton.classList.add('hidden');
            // The view visibility will be handled by renderDeviceViews
        }
    }

    // --- UI Rendering ---

    renderDeviceViews() {
        // Clear both views
        this.elements.gridView.innerHTML = '';
        const tableBody = this.elements.tableView.querySelector('tbody');
        if (tableBody) tableBody.innerHTML = '';

        // BUG FIX: Use classList to correctly show/hide elements
        if (this.state.filteredDevices.length === 0) {
            this.elements.emptyState.classList.remove('hidden');
            this.elements.gridView.classList.add('hidden');
            this.elements.tableView.classList.add('hidden');
        } else {
            this.elements.emptyState.classList.add('hidden');
            
            // Ensure the correct view is visible based on state
            // BUG FIX: Use classList to correctly show/hide views
            if (this.state.viewMode === 'grid') {
                this.elements.gridView.classList.remove('hidden');
                this.elements.tableView.classList.add('hidden');
            } else {
                this.elements.gridView.classList.add('hidden');
                this.elements.tableView.classList.remove('hidden');
            }
            
            this.state.filteredDevices.forEach((device, index) => {
                this.elements.gridView.appendChild(this.createGridCard(device, index));
                if (tableBody) tableBody.appendChild(this.createTableRow(device, index));
            });
        }
    }


    createGridCard(device, index) {
        const card = document.createElement('div');
        card.className = 'bg-bg-card dark:bg-dark-bg-card rounded-xl shadow-soft p-6 border border-border-color dark:border-dark-border-color transition-all duration-300 hover:-translate-y-1 hover:shadow-lg animation-fade-in';
        card.style.animationDelay = `${index * 50}ms`;

        const statusColor = getDeviceColor(device.status);
        const statusText = device.status ? device.status.charAt(0).toUpperCase() + device.status.slice(1) : 'Unknown';
        const lastSeen = (device.lastSeen && typeof device.lastSeen.toDate === 'function') ? formatTimeAgo(device.lastSeen.toDate()) : 'Never';
        const batteryIcon = getBatteryIcon(device.battery);

        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background-color: ${statusColor}20;">
                    <i class="bi ${getDeviceIcon(device.type)} text-2xl" style="color: ${statusColor};"></i>
                </div>
                <span class="text-xs font-semibold uppercase px-3 py-1 rounded-full" style="background-color: ${statusColor}20; color: ${statusColor};">
                    ${statusText}
                </span>
            </div>
            <h3 class="font-heading font-semibold text-xl text-text-primary dark:text-dark-text-primary truncate mb-1">${device.name || 'Unnamed Device'}</h3>
            <p class="text-sm text-text-secondary dark:text-dark-text-secondary mb-4 truncate">${device.model || 'No model info'}</p>
            
            <div class="space-y-3 text-sm">
                <div class="flex justify-between">
                    <span class="text-text-secondary dark:text-dark-text-secondary font-medium">Battery</span>
                    <span class="font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-1.5">
                        <i class="bi ${batteryIcon}" style="color: ${getDeviceColor(device.battery > 20 ? 'online' : 'danger')};"></i>
                        ${device.battery !== null && device.battery !== undefined ? device.battery + '%' : 'N/A'}
                    </span>
                </div>
                <div class="flex justify-between">
                    <span class="text-text-secondary dark:text-dark-text-secondary font-medium">Last Seen</span>
                    <span class="font-semibold text-text-primary dark:text-dark-text-primary">${lastSeen}</span>
                </div>
            </div>

            <div class="border-t border-border-color dark:border-dark-border-color mt-5 pt-5 flex gap-2">
                <a href="/app/device-details.html?id=${device.id}" class="btn flex-1 bg-primary-600 text-white hover:bg-primary-700 text-sm py-2 px-3">
                    <i class="bi bi-eye mr-1.5"></i> Details
                </a>
                <button data-action="edit" data-id="${device.id}" class="action-btn btn flex-1 bg-slate-100 dark:bg-slate-700 text-text-primary dark:text-dark-text-primary hover:bg-slate-200 dark:hover:bg-slate-600 text-sm py-2 px-3">
                    <i class="bi bi-pencil mr-1.5"></i> Edit
                </button>
                <button data-action="delete" data-id="${device.id}" class="action-btn btn bg-red-100 dark:bg-red-900/30 text-danger hover:bg-red-200 dark:hover:bg-red-900/50 text-sm py-2 px-3">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        return card;
    }

    createTableRow(device, index) {
        const row = document.createElement('tr');
        row.className = 'animation-fade-in';
        row.style.animationDelay = `${index * 50}ms`;

        const statusColor = getDeviceColor(device.status);
        const statusText = device.status ? device.status.charAt(0).toUpperCase() + device.status.slice(1) : 'Unknown';
        const lastSeen = (device.lastSeen && typeof device.lastSeen.toDate === 'function')? formatTimeAgo(device.lastSeen.toDate()) : 'Never';
        const batteryIcon = getBatteryIcon(device.battery);

        row.innerHTML = `
            <td class="w-1/3">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style="background-color: ${statusColor}20;">
                        <i class="bi ${getDeviceIcon(device.type)} text-xl" style="color: ${statusColor};"></i>
                    </div>
                    <div>
                        <a href="/app/device-details.html?id=${device.id}" class="font-semibold text-text-primary dark:text-dark-text-primary hover:text-primary-600 dark:hover:text-primary-400 no-underline">${device.name || 'Unnamed Device'}</a>
                        <div class="text-sm text-text-secondary dark:text-dark-text-secondary">${device.model || 'No model info'}</div>
                    </div>
                </div>
            </td>
            <td>
                <span class="text-xs font-semibold uppercase px-3 py-1 rounded-full" style="background-color: ${statusColor}20; color: ${statusColor};">
                    ${statusText}
                </span>
            </td>
            <td>
                <span class="font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-1.5">
                    <i class="bi ${batteryIcon}" style="color: ${getDeviceColor(device.battery > 20 ? 'online' : 'danger')};"></i>
                    ${device.battery !== null && device.battery !== undefined ? device.battery + '%' : 'N/A'}
                </span>
            </td>
            <td>
                <span class="text-text-secondary dark:text-dark-text-secondary">${lastSeen}</span>
            </td>
            <td class="text-right">
                <a href="/app/device-details.html?id=${device.id}" class="btn bg-primary-600 text-white hover:bg-primary-700 text-xs py-1.5 px-3">
                    <i class="bi bi-eye"></i>
                </a>
                <button data-action="edit" data-id="${device.id}" class="action-btn btn bg-slate-100 dark:bg-slate-700 text-text-primary dark:text-dark-text-primary hover:bg-slate-200 dark:hover:bg-slate-600 text-xs py-1.5 px-3">
                    <i class="bi bi-pencil"></i>
                </button>
                <button data-action="delete" data-id="${device.id}" class="action-btn btn bg-red-100 dark:bg-red-900/30 text-danger hover:bg-red-200 dark:hover:bg-red-900/50 text-xs py-1.5 px-3">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        return row;
    }


    // --- CRUD Actions ---
    
    handleEdit(deviceId) {
        // In a real app, you might show a modal or go to a form page
        // For this project, it's best to link to the add-device page in "edit" mode
        showToast('Edit Device', 'Redirecting to device editor...', 'info');
        setTimeout(() => {
            // INTEGRATION FIX: Root-relative path
            window.location.href = `/app/add-device.html?edit=true&id=${deviceId}`;
        }, 1000);
    }

    handleDelete(deviceId) {
        const device = this.state.allDevices.find(d => d.id === deviceId);
        if (!device) return;

        // BUG FIX: Corrected showModal parameters
        showModal(
            'Delete Device?', 
            `Are you sure you want to delete <strong>${device.name}</strong>? This action cannot be undone.`, 
            'danger', // This should map to the 'btn-danger' class
            async () => {
                try {
                    const deviceRef = doc(fbDB, 'user_data', this.userId, 'devices', deviceId);
                    await deleteDoc(deviceRef);
                    
                    showToast('Device Deleted', `${device.name} has been successfully deleted.`, 'success');
                    
                    // SCALABILITY/INTEGRATION FIX:
                    // We don't need to do anything else. `app-shell.js`'s listener
                    // will see the change and send a new 'devicesLoaded' event,
                    // which will cause our page to re-render automatically.
                    
                } catch (error) {
                    console.error("Error deleting device:", error);
                    showToast('Error', 'Could not delete device. Please try again.', 'error');
                }
            },
            null, // onCancel
            { isHTML: true } // options
        );
    }
}