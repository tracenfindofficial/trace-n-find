// --- Trace'N Find Dashboard Logic ---
// This file handles all logic *specific* to dashboard.html

import { 
    fbDB,
    showToast,
    showModal,
    debounce,
    formatTimeAgo,
    formatDateTime,
    getDeviceIcon,
    getDeviceColor,
    getBatteryIcon,
    collection,
    doc,
    getDocs,
    onSnapshot,
    query,
    setDoc,
    addDoc, // Required for creating new notifications
    serverTimestamp,
    orderBy,
    limit,
    where,
    SECURITY_BUTTONS,
    sanitizeHTML
} from '/app/js/app-shell.js';

// Updated import to match the "mapStyles" export from map-tiles.js
import { mapStyles } from '/public/js/map-tiles.js';

/**
 * Wait for Auth & Libraries before starting
 */
function waitForAuth(callback) {
    const check = () => {
        // Check for google maps global instead of L (Leaflet)
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && typeof Chart !== 'undefined' && mapStyles) {
            callback(window.currentUserId);
        } else {
            requestAnimationFrame(check);
        }
    };
    // Initial check
    if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined') {
        callback(window.currentUserId);
    } else {
        requestAnimationFrame(check);
    }
}

// --- Main Init ---
waitForAuth((userId) => {
    const dashboard = new DashboardManager(userId);
    dashboard.init();
});

class DashboardManager {
    constructor(userId) {
        this.userId = userId;
        
        // Browsing State for Modals
        this.browsing = {
            photoList: [],
            photoIndex: 0,
            messageList: [],
            messageIndex: 0
        };

        // --- DOM Elements ---
        this.elements = {
            statCards: {
                total: document.getElementById('totalDevices'),
                online: document.getElementById('onlineDevices'),
                warning: document.getElementById('warningDevices'),
                offline: document.getElementById('offlineDevices'),
                lost: document.getElementById('lostDevices'), 
            },
            devicesList: document.getElementById('devicesList'),
            notificationsList: document.getElementById('notificationsList'),
            map: document.getElementById('map'),
            filterButtons: document.querySelectorAll('.filter-btn'),
            searchInput: document.getElementById('searchInput'),
            
            // Notification Badge
            notificationBadge: document.getElementById('notificationBadge'),
            
            // Action Buttons Container
            actionsContainer: document.getElementById('dashboard-actions-container'),
            actionsPrompt: document.getElementById('actions-prompt'),
            
            // Will be populated in init()
            actions: {}, 

            // Charts
            deviceStatusChart: document.getElementById('deviceStatusChart'),

            // --- Modals ---
            photoModal: {
                overlay: document.getElementById('viewPhotoModal'),
                img: document.getElementById('finderPhotoImg'),
                placeholder: document.getElementById('photoPlaceholder'),
                timestamp: document.getElementById('photoTimestamp'),
                indicator: document.getElementById('photoIndexIndicator'),
                prevBtn: document.getElementById('prevPhotoBtn'),
                nextBtn: document.getElementById('nextPhotoBtn'),
                closeBtns: [document.getElementById('viewPhotoClose'), document.getElementById('viewPhotoDone')]
            },

            msgModal: {
                overlay: document.getElementById('viewMessageModal'),
                text: document.getElementById('finderMessageText'),
                placeholder: document.getElementById('msgPlaceholder'),
                timestamp: document.getElementById('msgTimestamp'),
                indicator: document.getElementById('msgIndexIndicator'),
                prevBtn: document.getElementById('prevMsgBtn'),
                nextBtn: document.getElementById('nextMsgBtn'),
                closeBtns: [document.getElementById('viewMsgClose'), document.getElementById('viewMsgDone')]
            }
        };

        // --- Internal State ---
        this.state = {
            currentFilter: 'all',
            currentDeviceId: null,
            allDevices: [],
            filteredDevices: [],
            map: null,
            markers: {}, // Map of deviceId -> google.maps.Marker
            markerCluster: null,
            charts: {},

            lastCounts: { online: -1, warning: -1, offline: -1, lost: -1 }
        };
    }

    init() {
        // 1. Inject Action Buttons
        if (this.elements.actionsContainer && SECURITY_BUTTONS) {
            this.elements.actionsContainer.innerHTML = SECURITY_BUTTONS.map(btn => `
                <button id="${btn.id}" class="action-button" disabled>
                    <i class="bi ${btn.icon} ${btn.textClass}"></i>
                    <span>${btn.label}</span>
                </button>
            `).join('');
        
            // Bind DOM elements
            this.elements.actions = {
                ring: document.getElementById('action-ring'),
                viewPhotos: document.getElementById('action-view-photos'),
                viewMessages: document.getElementById('action-view-messages'),
                lost: document.getElementById('action-lost'),
            };
        }

        this.setupEventListeners();
        this.initMap();
        this.listenForDevices();
        this.listenForNotifications();
        this.listenForUnreadNotifications(); // NEW: For Badge Count
    }

    setupEventListeners() {
        // Filters
        this.elements.filterButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.currentFilter = btn.dataset.filter;
                this.elements.filterButtons.forEach(b => b.classList.toggle('active', b.dataset.filter === this.state.currentFilter));
                this.applyFilters();
            });
        });
        
        this.elements.searchInput.addEventListener('input', debounce(() => this.applyFilters(), 300));

        // --- Action Button Listeners ---
        if(this.elements.actions.ring) {
            this.elements.actions.ring.addEventListener('click', () => this.onSecurityAction('ring'));
        }
    
        if(this.elements.actions.lost) {
            this.elements.actions.lost.addEventListener('click', () => {
                const currentStatus = this.state.allDevices.find(d => d.id === this.state.currentDeviceId)?.status;
                this.onSecurityAction(currentStatus === 'lost' ? 'found' : 'lost');
            });
        }
        // --- NEW: Open Modals instead of Redirecting ---
        if(this.elements.actions.viewPhotos) {
            this.elements.actions.viewPhotos.addEventListener('click', () => this.openPhotoViewer());
        }
        if(this.elements.actions.viewMessages) {
            this.elements.actions.viewMessages.addEventListener('click', () => this.openMessageViewer());
        }
        
        // --- Modal Navigation Listeners ---
        if(this.elements.photoModal.prevBtn) this.elements.photoModal.prevBtn.addEventListener('click', () => this.changePhoto(-1));
        if(this.elements.photoModal.nextBtn) this.elements.photoModal.nextBtn.addEventListener('click', () => this.changePhoto(1));
        this.elements.photoModal.closeBtns.forEach(btn => btn?.addEventListener('click', () => this.elements.photoModal.overlay.classList.remove('active')));

        if(this.elements.msgModal.prevBtn) this.elements.msgModal.prevBtn.addEventListener('click', () => this.changeMessage(-1));
        if(this.elements.msgModal.nextBtn) this.elements.msgModal.nextBtn.addEventListener('click', () => this.changeMessage(1));
        this.elements.msgModal.closeBtns.forEach(btn => btn?.addEventListener('click', () => this.elements.msgModal.overlay.classList.remove('active')));
        
        window.addEventListener('themeChanged', (e) => this.updateTheme(e.detail.theme));
    }

    // --- Logic: Photo Viewer ---
    async openPhotoViewer() {
        const deviceId = this.state.currentDeviceId;
        if (!deviceId) return;
        
        const device = this.state.allDevices.find(d => d.id === deviceId);
        this.browsing.photoList = [];
        this.browsing.photoIndex = 0;

        if (device.finder_photo_url) {
            this.browsing.photoList.push({
                url: device.finder_photo_url,
                time: device.finder_data_timestamp ? device.finder_data_timestamp.toDate() : new Date()
            });
        }

        try {
            const logsRef = collection(fbDB, 'user_data', this.userId, 'devices', deviceId, 'evidence_logs');
            const q = query(logsRef, orderBy('timestamp', 'desc'));
            const snapshot = await getDocs(q);

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.photo_url && data.photo_url !== device.finder_photo_url) {
                    this.browsing.photoList.push({
                        url: data.photo_url,
                        time: data.timestamp ? data.timestamp.toDate() : new Date()
                    });
                }
            });
        } catch (e) {
            console.error("Error fetching photos", e);
        }

        this.updatePhotoUI();
        this.elements.photoModal.overlay.classList.add('active');
    }

    updatePhotoUI() {
        const ui = this.elements.photoModal;
        const list = this.browsing.photoList;
        const index = this.browsing.photoIndex;

        if (list.length > 0) {
            const item = list[index];
            ui.img.src = item.url;
            ui.img.classList.remove('hidden');
            ui.placeholder.classList.add('hidden');
            ui.timestamp.textContent = `Captured: ${formatDateTime(item.time)}`;
            ui.indicator.textContent = `${index + 1} / ${list.length}`;
            
            ui.prevBtn.disabled = index === 0;
            ui.nextBtn.disabled = index === list.length - 1;
        } else {
            ui.img.classList.add('hidden');
            ui.placeholder.classList.remove('hidden');
            ui.timestamp.textContent = "No photos available";
            ui.indicator.textContent = "";
        }
    }

    changePhoto(dir) {
        if (dir === -1 && this.browsing.photoIndex > 0) this.browsing.photoIndex--;
        if (dir === 1 && this.browsing.photoIndex < this.browsing.photoList.length - 1) this.browsing.photoIndex++;
        this.updatePhotoUI();
    }

    // --- Logic: Message Viewer ---
    async openMessageViewer() {
        const deviceId = this.state.currentDeviceId;
        if (!deviceId) return;

        const device = this.state.allDevices.find(d => d.id === deviceId);
        this.browsing.messageList = [];
        this.browsing.messageIndex = 0;

        if (device.finder_message) {
            this.browsing.messageList.push({
                text: device.finder_message,
                time: device.finder_data_timestamp ? device.finder_data_timestamp.toDate() : new Date()
            });
        }

        try {
            const logsRef = collection(fbDB, 'user_data', this.userId, 'devices', deviceId, 'evidence_logs');
            const q = query(logsRef, orderBy('timestamp', 'desc'));
            const snapshot = await getDocs(q);

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.message && data.message !== device.finder_message) {
                    this.browsing.messageList.push({
                        text: data.message,
                        time: data.timestamp ? data.timestamp.toDate() : new Date()
                    });
                }
            });
        } catch (e) {
            console.error("Error fetching messages", e);
        }

        this.updateMessageUI();
        this.elements.msgModal.overlay.classList.add('active');
    }

    updateMessageUI() {
        const ui = this.elements.msgModal;
        const list = this.browsing.messageList;
        const index = this.browsing.messageIndex;

        if (list.length > 0) {
            const item = list[index];
            ui.text.textContent = `"${item.text}"`;
            ui.text.classList.remove('hidden');
            ui.placeholder.classList.add('hidden');
            ui.timestamp.textContent = `Received: ${formatDateTime(item.time)}`;
            ui.indicator.textContent = `${index + 1} / ${list.length}`;
            
            ui.prevBtn.disabled = index === 0;
            ui.nextBtn.disabled = index === list.length - 1;
        } else {
            ui.text.classList.add('hidden');
            ui.placeholder.classList.remove('hidden');
            ui.timestamp.textContent = "No messages available";
            ui.indicator.textContent = "";
        }
    }

    changeMessage(dir) {
        if (dir === -1 && this.browsing.messageIndex > 0) this.browsing.messageIndex--;
        if (dir === 1 && this.browsing.messageIndex < this.browsing.messageList.length - 1) this.browsing.messageIndex++;
        this.updateMessageUI();
    }

    // --- Existing Dashboard Logic (Maps, Devices, etc.) ---

    listenForDevices() {
        const devicesRef = collection(fbDB, 'user_data', this.userId, 'devices');
        const q = query(devicesRef, orderBy('name', 'asc'));
        
        onSnapshot(q, (snapshot) => {
            this.state.allDevices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            this.updateStats();
            this.applyFilters();
            
            // BUG FIX: Re-evaluate button states if a device is currently selected.
            // This ensures that if 'status' changes in DB, the buttons update instantly.
            if (this.state.currentDeviceId) {
                const currentDevice = this.state.allDevices.find(d => d.id === this.state.currentDeviceId);
                if (currentDevice) {
                    this.updateActionButtons(currentDevice);
                } else {
                    // Device might have been deleted remotely
                    this.selectDevice(null); 
                }
            }
        });
    }

    // Logic to render the *list* of notifications (only last 5)
    listenForNotifications() {
        const notifsRef = collection(fbDB, 'user_data', this.userId, 'notifications');
        
        // FIX: Use 'timestamp' instead of 'time' to match security-actions-logic.js
        const q = query(notifsRef, orderBy('timestamp', 'desc'), limit(5));

        onSnapshot(q, (snapshot) => {
            const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.renderNotificationsList(notifications);
        });
    }

    // NEW: Logic to calculate *all* unread notifications for the badge
    listenForUnreadNotifications() {
        const notifsRef = collection(fbDB, 'user_data', this.userId, 'notifications');
        
        // Query specifically for unread items to get an accurate count
        const q = query(notifsRef, where("read", "==", false));

        onSnapshot(q, (snapshot) => {
            this.updateBadgeCount(snapshot.size);
        }, (error) => {
            console.error("Error listening for unread count:", error);
        });
    }

    updateBadgeCount(count) {
        const badge = this.elements.notificationBadge;
        if (!badge) return;

        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.classList.remove('hidden');
            badge.classList.add('animate-pulse');
        } else {
            badge.classList.add('hidden');
            badge.classList.remove('animate-pulse');
        }
    }

    // --- UPDATED STATS LOGIC ---
    updateStats() {
        const total = this.state.allDevices.length;
        
        // Strictly Online
        const online = this.state.allDevices.filter(d => d.status === 'online').length;
        
        // Strictly Offline
        const offline = this.state.allDevices.filter(d => d.status === 'offline').length;
        
        // Strictly Lost
        const lost = this.state.allDevices.filter(d => d.status === 'lost').length;
        
        // Low Battery Logic: Count devices with battery < 20 OR status 'warning'
        const warning = this.state.allDevices.filter(d => {
            const battery = parseInt(d.battery || 0, 10);
            return battery < 20 || d.status === 'warning';
        }).length;
        
        // Update DOM
        this.animateValue(this.elements.statCards.total, total);
        this.animateValue(this.elements.statCards.online, online);
        this.animateValue(this.elements.statCards.warning, warning);
        this.animateValue(this.elements.statCards.offline, offline);
        
        // Check if lost card exists before animating (safety check)
        if(this.elements.statCards.lost) {
            this.animateValue(this.elements.statCards.lost, lost);
        }
        
        // Update Chart with new data breakdown
        const prev = this.state.lastCounts;
        const hasChanged = 
            online !== prev.online ||
            warning !== prev.warning ||
            offline !== prev.offline ||
            lost !== prev.lost;

        if (hasChanged) {
            // Update the memory
            this.state.lastCounts = { online, warning, offline, lost };
            // Update the visual chart
            this.updateDashboardCharts({ online, warning, offline, lost });
        }
    }

    updateDashboardCharts(counts) {
        if (!this.elements.deviceStatusChart) return;

        const styles = getComputedStyle(document.documentElement);
        const fontColor = styles.getPropertyValue('--color-text-secondary');
        
        // Colors
        const c_online = styles.getPropertyValue('--color-success');
        const c_warning = styles.getPropertyValue('--color-warning');
        const c_offline = '#64748b'; // Manual grey for offline
        const c_lost = styles.getPropertyValue('--color-danger');

        const data = {
            labels: [
                `Online (${counts.online})`, 
                `Low Batt (${counts.warning})`, 
                `Offline (${counts.offline})`,
                `Lost (${counts.lost})`
            ],
            datasets: [{
                data: [counts.online, counts.warning, counts.offline, counts.lost],
                backgroundColor: [c_online, c_warning, c_offline, c_lost],
                borderColor: styles.getPropertyValue('--color-bg-card'),
                borderWidth: 4,
                cutout: '75%',
            }]
        };

        if (this.state.charts.deviceStatus) {
            this.state.charts.deviceStatus.data = data;
            this.state.charts.deviceStatus.update();
        } else {
            this.state.charts.deviceStatus = new Chart(this.elements.deviceStatusChart, {
                type: 'doughnut',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { 
                            position: 'bottom', 
                            labels: { color: fontColor, boxWidth: 12, padding: 20 } 
                        } 
                    }
                }
            });
        }
    }

    // --- GOOGLE MAPS INTEGRATION ---
    initMap() {
        if (!this.elements.map) return;

        const currentTheme = document.documentElement.getAttribute('data-theme');
        const styles = (currentTheme === 'dark') ? mapStyles.dark : mapStyles.light;

        this.state.map = new google.maps.Map(this.elements.map, {
            center: { lat: 2.9436, lng: 101.7949 }, // GMI, Kajang
            zoom: 12,
            disableDefaultUI: true,
            zoomControl: true,
            styles: styles
        });

        // Initialize MarkerClusterer
        this.state.markerCluster = new markerClusterer.MarkerClusterer({ 
            map: this.state.map,
            markers: [] 
        });
    }

    updateTheme(theme) {
        // Update Google Map Styles
        if (this.state.map && mapStyles) {
            const styles = (theme === 'dark') ? mapStyles.dark : mapStyles.light;
            this.state.map.setOptions({ styles: styles });
        }

        // Update Charts if needed (logic remains same)
    }

    applyFilters() {
        const searchTerm = this.elements.searchInput.value.toLowerCase();
        this.state.filteredDevices = this.state.allDevices.filter(device => {
            const statusMatch = this.state.currentFilter === 'all' || device.status === this.state.currentFilter;
            const searchMatch = !searchTerm || (device.name && device.name.toLowerCase().includes(searchTerm));
            return statusMatch && searchMatch;
        });
        this.renderDeviceList();
        this.renderMapMarkers();
    }

    selectDevice(deviceId, pan = true) {
        this.state.currentDeviceId = deviceId;
        const device = this.state.allDevices.find(d => d.id === deviceId);

        this.renderDeviceList();
        
        if (device && device.location && this.state.map && this.state.markers[deviceId]) {
            const marker = this.state.markers[deviceId];
            
            if (pan) {
                this.state.map.panTo(marker.getPosition());
                this.state.map.setZoom(16);
                
                // FIX: Only trigger click if panning (from external click)
                // This prevents the infinite loop where clicking the marker triggers
                // selectDevice which triggers the marker which triggers selectDevice...
                new google.maps.event.trigger(marker, 'click');
            }
        }
        
        // Refactored: Call the UI update helper
        this.updateActionButtons(device);
    }

    // Helper function to update button states based on device data
    updateActionButtons(device) {
        const buttons = this.elements.actions;
        if (device) {
            if(buttons.ring) buttons.ring.disabled = false;
            if(buttons.viewPhotos) buttons.viewPhotos.disabled = false;
            if(buttons.viewMessages) buttons.viewMessages.disabled = false;
            if(buttons.lost) buttons.lost.disabled = false;
            this.elements.actionsPrompt.classList.add('hidden');
            
            // Update Lost button appearance dynamically based on REAL data
            const lostBtn = buttons.lost;
            if (lostBtn) {
                const icon = lostBtn.querySelector('i');
                const text = lostBtn.querySelector('span');
                if (device.status === 'lost') {
                    icon.className = 'bi bi-check-circle-fill text-green-500';
                    text.textContent = 'Mark as Found';
                } else {
                    icon.className = 'bi bi-exclamation-diamond-fill text-red-500';
                    text.textContent = 'Mark as Lost';
                }
            }
        } else {
            if(buttons.ring) buttons.ring.disabled = true;
            if(buttons.viewPhotos) buttons.viewPhotos.disabled = true;
            if(buttons.viewMessages) buttons.viewMessages.disabled = true;
            if(buttons.lost) buttons.lost.disabled = true;
            this.elements.actionsPrompt.classList.remove('hidden');
        }
    }

    async onSecurityAction(action) {
        const device = this.state.allDevices.find(d => d.id === this.state.currentDeviceId);
        if (!device) return;
        const safeName = sanitizeHTML(device.name);

        const actionMap = {
            'ring': { title: 'Sound Alarm?', message: `Sound a loud alarm on <strong>${safeName}</strong>?`, type: 'info' },
            'lost': { title: 'Mark as Lost?', message: `Enable tracking and lock <strong>${safeName}</strong>?`, type: 'danger' },
            'found': { title: 'Mark as Found?', message: `Mark <strong>${safeName}</strong> as found?`, type: 'success' },
            'wipe': { title: 'Wipe Device?', message: `Irreversibly erase <strong>${safeName}</strong>?`, type: 'danger' }
        };
        
        const config = actionMap[action];
        if (!config) return;

        showModal(config.title, config.message, config.type, async () => {
            try {
                const deviceRef = doc(fbDB, 'user_data', this.userId, 'devices', device.id);
                
                // 1. Perform Device Update
                if (action === 'lost' || action === 'found') {
                    const newStatus = (action === 'lost') ? 'lost' : 'online';
                    await setDoc(deviceRef, { status: newStatus }, { merge: true });
                } else {
                    await setDoc(deviceRef, { pending_action: action, action_timestamp: serverTimestamp() }, { merge: true });
                }

                // 2. Create Notification
                // This fixes the "no notification" issue
                const notifRef = collection(fbDB, 'user_data', this.userId, 'notifications');
                
                let notifTitle = "Security Action";
                let notifMessage = `Command "${action}" sent to ${safeName}.`;
                let notifType = "info";

                // Customize notification based on action
                if (action === 'ring') { 
                    notifTitle = 'Alarm Triggered'; 
                    notifType = 'warning'; 
                } else if (action === 'lost') { 
                    notifTitle = 'Device Marked Lost'; 
                    notifType = 'lost-mode';
                    notifMessage = `${safeName} is now in Lost Mode.`;
                } else if (action === 'found') { 
                    notifTitle = 'Device Found'; 
                    notifType = 'success'; 
                    notifMessage = `${safeName} marked as found.`;
                } else if (action === 'wipe') { 
                    notifTitle = 'Wipe Command Sent'; 
                    notifType = 'security'; 
                    notifMessage = `Remote wipe initiated for ${safeName}.`;
                }

                await addDoc(notifRef, {
                    title: notifTitle,
                    message: notifMessage,
                    type: notifType,
                    read: false,
                    timestamp: serverTimestamp()
                });

                showToast('Action Sent', `Command sent to ${safeName}.`, 'success');
            } catch (error) {
                console.error("Error executing security action:", error);
                showToast('Error', 'Could not send command.', 'error');
            }
        }, null, { isHTML: true });
    }

    renderMapMarkers() {
        if (!this.state.map || !this.state.markerCluster) return;
        
        // Clear existing markers
        this.state.markerCluster.clearMarkers();
        this.state.markers = {};
        
        const bounds = new google.maps.LatLngBounds();
        let hasMarkers = false;

        this.state.filteredDevices.forEach(device => {
            // Handle logic for both {lat, lng} and {latitude, longitude} objects
            let lat = device.location?.lat;
            let lng = device.location?.lng;
            
            if (lat === undefined) lat = device.location?.latitude;
            if (lng === undefined) lng = device.location?.longitude;
            
            if (lat === undefined || lng === undefined) return;
            
            // Ensure numeric
            lat = parseFloat(lat);
            lng = parseFloat(lng);

            const position = { lat, lng };
            hasMarkers = true;
            bounds.extend(position);
            
// --- 1. DEFINE COLORS ---
            const colorMap = {
                online: "#10b981", // Green
                found: "#10b981",
                offline: "#64748b", // Gray
                lost: "#ef4444",
                warning: "#f59e0b" // Yellow
            };
            const pinColor = colorMap[device.status] || "#64748b";

            // --- 2. CREATE ANIMATED SVG ICON (High Visibility) ---
            const svgIcon = `
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 80 80">
                    
                    ${ (device.status !== 'offline') ? `
                    <circle cx="40" cy="40" r="18" fill="#4361ee" stroke="#4361ee" stroke-width="2" opacity="0.6">
                        <animate attributeName="r" from="18" to="40" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.8" to="0" dur="1.5s" repeatCount="indefinite" />
                    </circle>
                    ` : '' }

                    <circle cx="40" cy="40" r="18" fill="${pinColor}" stroke="white" stroke-width="3" />
                    
                    <g transform="translate(28, 28)">
                        <path fill="white" d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
                    </g>
                </svg>`;

            // Convert to Data URL
            const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon);

            // --- 3. CREATE MARKER ---
            const marker = new google.maps.Marker({
                position: position,
                title: device.name,
                icon: {
                    url: iconUrl,
                    // Size is 48x48 to accommodate the wave, but visually the pin looks like 24px
                    scaledSize: new google.maps.Size(48, 48), 
                    // Anchor is exactly half of 48 to ensure pin is dead-center
                    anchor: new google.maps.Point(24, 24) 
                },
                // Optimized: false is required for SVG animations to render smoothly in some browsers
                optimized: false 
            });

            // InfoWindow Content
            const lastSeenDate = device.lastSeen && typeof device.lastSeen.toDate === 'function' ? device.lastSeen.toDate() : null;
            const lastSeen = lastSeenDate ? formatTimeAgo(lastSeenDate) : 'Never';
            const battery = device.battery || 0;

            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="color: black; padding: 5px;">
                        <h3 style="margin: 0 0 5px 0; font-size: 16px;">${sanitizeHTML(device.name)}</h3>
                        <p style="margin: 0;">Status: <strong>${device.status}</strong></p>
                        <p style="margin: 0;">Battery: ${device.battery}%</p>
                        <p style="margin: 0; font-size: 12px; color: #666;">
                            Seen: ${formatTimeAgo(device.lastSeen?.toDate ? device.lastSeen.toDate() : new Date())}
                        </p>
                    </div>
                `
            });

            marker.addListener("click", () => {
                infoWindow.open(this.state.map, marker);
                this.selectDevice(device.id, false); // Don't pan again, just select (FALSE is critical to prevent loop)
            });

            this.state.markerCluster.addMarker(marker);
            this.state.markers[device.id] = marker;
        });

        // Fit bounds if we have markers and no specific device is selected
        if (hasMarkers && !this.state.currentDeviceId) {
            // Get the count of active markers on the map
            const markerCount = Object.keys(this.state.markers).length;

            if (markerCount === 1) {
                // Single Device: Center map and set a comfortable zoom (e.g., 15)
                // prevent excessive zooming into a single point
                this.state.map.setCenter(bounds.getCenter());
                this.state.map.setZoom(15);
            } else {
                // Multiple Devices: Fit bounds to show all of them
                this.state.map.fitBounds(bounds);
            }
        }
    }

    renderDeviceList() {
        this.elements.devicesList.innerHTML = '';
        this.state.filteredDevices.forEach(device => {
            const item = document.createElement('div');
            item.className = `device-item ${device.id === this.state.currentDeviceId ? 'active' : ''}`;
            item.onclick = () => this.selectDevice(device.id); // Implicit true for pan
            item.innerHTML = `
                <i class="bi ${getDeviceIcon(device.type)} text-2xl" style="color: ${getDeviceColor(device.status)}"></i>
                <div class="flex-1 overflow-hidden"><div class="font-medium truncate">${sanitizeHTML(device.name)}</div></div>
                <div class="text-sm text-right" style="color: ${getDeviceColor(device.status)}">${device.status}</div>
            `;
            this.elements.devicesList.appendChild(item);
        });
    }

    renderNotificationsList(notifications) {
        this.elements.notificationsList.innerHTML = '';
        notifications.forEach(n => {
            const item = document.createElement('div');
            item.className = 'notification-item';
            
            let timeVal = n.timestamp || n.time;
            let timeString = 'Just now';
            
            if (timeVal && typeof timeVal.toDate === 'function') {
                timeString = formatTimeAgo(timeVal.toDate());
            } else {
                timeString = formatTimeAgo(new Date());
            }

            item.innerHTML = `
                <i class="bi bi-info-circle text-blue-500"></i>
                <div class="flex-1">
                    <p class="text-sm">${sanitizeHTML(n.message || '')}</p>
                    <p class="text-xs text-gray-500">${timeString}</p>
                </div>
            `;
            this.elements.notificationsList.appendChild(item);
        });
    }

    animateValue(obj, end) {
        if (obj) obj.innerHTML = end;
    }
}