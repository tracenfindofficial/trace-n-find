// --- Trace'N Find Device Details Logic ---
// This file handles all logic *specific* to device-details.html

import { 
    fbDB,
    doc, 
    onSnapshot,
    collection,
    query,
    orderBy,
    limit,
    showToast,
    formatTimeAgo,
    getDeviceIcon,
    getDeviceColor,
    sanitizeHTML,
    where
} from '/app/js/app-shell.js'; 

// IMPORT GOOGLE MAP STYLES
import { mapStyles } from '/public/js/map-tiles.js';

// --- Global State ---
let currentDeviceId = null;
let deviceData = null;
let deviceListener = null; 
let activityListener = null;

let map = null;
let deviceMarker = null;
let infoWindow = null;

// --- DOM Elements ---
const elements = {
    loader: document.getElementById('skeleton-loader'),
    content: document.getElementById('device-content'),
    
    // Notification Badge
    notificationBadge: document.getElementById('notificationBadge'),
    
    // Header
    headerName: document.getElementById('header-device-name'),
    deviceName: document.getElementById('device-name'),
    deviceIcon: document.getElementById('device-icon'),
    deviceModel: document.getElementById('device-model'),
    deviceStatus: document.getElementById('device-status-badge'),
    deviceLastSeen: document.getElementById('device-last-seen'),
    
    // Quick Stats
    statBattery: document.getElementById('battery-level-text'),
    statStorage: document.getElementById('storage-text'),
    statNetwork: document.getElementById('network-type-text'),
    statSignal: document.getElementById('signal-strength-text'),
    
    // Map
    mapContainer: document.getElementById('map'),
    
    // Activity
    activityList: document.getElementById('activity-timeline'),
    
    // Info
    infoOS: document.getElementById('device-os'),
    // UPDATED: Renamed from infoSerial to infoCarrierStatus
    infoCarrierStatus: document.getElementById('device-carrier-status'),
    infoIP: document.getElementById('device-ip'),
    // UPDATED: Renamed from infoIMEI to infoCarrier
    infoCarrier: document.getElementById('device-carrier'),
    infoMAC: document.getElementById('device-mac'),
    
    // Charts
    batteryChart: document.getElementById('battery-chart'),
    networkChart: document.getElementById('network-chart'),
    storageChart: document.getElementById('storage-chart'),
    signalChart: document.getElementById('signal-chart'),
};

// --- Initialization ---

function waitForAuth(callback) {
    const check = () => {
        // Check for Google Maps global instead of Leaflet
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && typeof Chart !== 'undefined' && mapStyles) {
            callback(window.currentUserId);
        } else {
            requestAnimationFrame(check);
        }
    };
    check();
}

waitForAuth((userId) => {
    const urlParams = new URLSearchParams(window.location.search);
    currentDeviceId = urlParams.get('id');
    
    if (currentDeviceId) {
        console.log(`Initializing details for device: ${currentDeviceId}`);
        initPage(userId, currentDeviceId);
        // Start listening for notifications
        listenForUnreadNotifications(userId);
    } else {
        window.location.href = '/app/devices.html';
    }
});

function initPage(userId, deviceId) {
    initMap();
    initCharts();
    
    listenForDeviceData(userId, deviceId);
    listenForActivityData(userId, deviceId);
}

// --- Notification Logic ---
function listenForUnreadNotifications(userId) {
    const notifsRef = collection(fbDB, 'user_data', userId, 'notifications');
    
    // Query specifically for unread items to get an accurate count
    const q = query(notifsRef, where("read", "==", false));

    onSnapshot(q, (snapshot) => {
        updateBadgeCount(snapshot.size);
    }, (error) => {
        console.error("Error listening for unread count:", error);
    });
}

function updateBadgeCount(count) {
    const badge = elements.notificationBadge;
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

function listenForDeviceData(userId, deviceId) {
    const deviceRef = doc(fbDB, 'user_data', userId, 'devices', deviceId);

    deviceListener = onSnapshot(deviceRef, (docSnap) => {
        if (docSnap.exists()) {
            deviceData = { id: docSnap.id, ...docSnap.data() };
            updateUI(deviceData);
        } else {
            showToast('Error', 'Device not found.', 'error');
        }
    });
}

function listenForActivityData(userId, deviceId) {
    const activityRef = collection(fbDB, 'user_data', userId, 'devices', deviceId, 'activity');
    
    // Order by 'timestamp' to match the new data format used in Notifications/Dashboard
    const q = query(activityRef, orderBy('timestamp', 'desc'), limit(10));

    activityListener = onSnapshot(q, (snapshot) => {
        const activities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderActivityList(activities);
    });
}

// --- UI Rendering ---

function updateUI(device) {
    // 1. SAFETY: Create safe nested objects if they are missing
    // This allows us to check device.info.type without crashing if device.info is undefined
    const info = device.info || {};
    const network = device.network || {};
    const sim = device.sim || {};
    const storage = device.storage || {};
    
    // 2. Update Header Info
    // Use the helper to sanitize and provide a fallback
    elements.headerName.textContent = device.name || 'Unknown Device';
    elements.deviceName.textContent = device.name || 'Unknown Device';
    elements.deviceModel.textContent = device.model || info.model || 'Unknown Model';
    
    // Status Color & Icon
    const statusColor = getDeviceColor(device.status);
    elements.deviceIcon.style.backgroundColor = `${statusColor}20`; 
    elements.deviceIcon.style.color = statusColor;
    elements.deviceIcon.innerHTML = `<i class="bi ${getDeviceIcon(device.type || info.type)}"></i>`;

    // Status Badge
    elements.deviceStatus.textContent = device.status || 'Offline';
    elements.deviceStatus.style.color = statusColor;
    elements.deviceStatus.className = `text-sm font-semibold uppercase px-3 py-1 rounded-full border border-current`;

    // Last Seen
    elements.deviceLastSeen.textContent = formatTimeAgo(device.lastSeen || device.last_updated);
    
    // 3. Stats (Battery, Storage, Network, Signal)
    // We check both the top-level field and the nested field
    const battLevel = device.battery ?? device.battery_level ?? 0;
    elements.statBattery.textContent = `${battLevel}%`;
    
    const storageUsed = storage.used || device.storage_used || 0;
    const storageTotal = storage.total || device.storage_total || 0;
    elements.statStorage.textContent = (storageTotal > 0) ? `${storageUsed}GB / ${storageTotal}GB` : 'N/A';
    
    // Network: Check device.network (string), device.network.type, or device.wifi_ssid
    elements.statNetwork.textContent = network.type || device.network || (device.wifi_ssid ? 'WiFi' : 'Cellular');
    
    // Signal: Check device.signal (number) or nested
    const signal = network.signal_strength ?? device.signal ?? device.signal_level;
    elements.statSignal.textContent = (signal) ? `${signal} dBm` : 'N/A';
    
    // 4. Info Grid (The part likely missing in your screenshot)
    // We strictly check the nested 'info' object, then fall back to top-level
    elements.infoOS.textContent = device.os_version || device.os || info.os || 'N/A';
    elements.infoIP.textContent = device.ip_address || device.ip || info.ip || 'N/A';
    
    if(elements.infoMAC) {
        elements.infoMAC.textContent = device.mac_address || device.mac || info.mac || 'N/A';
    }

    // Carrier Info
    const carrierName = sim.carrier || device.carrier || 'Unknown Carrier';
    elements.infoCarrier.textContent = carrierName;
    
    const carrierStatus = sim.status || device.carrierStatus || device.sim_status || 'Unknown';
    elements.infoCarrierStatus.textContent = carrierStatus;
    
    // Color coding for Carrier Status
    elements.infoCarrierStatus.className = 'font-medium'; // Reset classes
    if (['active', 'online', 'ready'].includes(carrierStatus.toLowerCase())) {
        elements.infoCarrierStatus.classList.add('text-success-500');
    } else if (['inactive', 'blocked', 'missing', 'removed'].includes(carrierStatus.toLowerCase())) {
        elements.infoCarrierStatus.classList.add('text-danger-500');
    }

    // 5. Reveal Content
    elements.loader.style.display = 'none';
    elements.content.classList.remove('hidden');
    elements.content.classList.add('animate-fade-in');
    elements.content.style.opacity = '1'; 

    // Update Map & Charts
    updateMapMarker(device);
    updateCharts(device);
}

function renderActivityList(activities) {
    elements.activityList.innerHTML = '';
    if (activities.length === 0) {
        elements.activityList.innerHTML = '<li class="p-4 text-center text-text-secondary dark:text-dark-text-secondary">No recent activity.</li>';
        return;
    }
    
    activities.forEach(activity => {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-3 p-4 border-b border-border-color dark:border-dark-border-color';
        
        let icon = 'bi-info-circle-fill text-info';
        if (activity.type === 'security') icon = 'bi-shield-lock-fill text-danger';
        if (activity.type === 'warning') icon = 'bi-exclamation-triangle-fill text-warning';
        if (activity.type === 'lost-mode') icon = 'bi-exclamation-diamond-fill text-danger';
        
        let timeVal = activity.timestamp || activity.time;
        let timeAgo = 'Just now';
        
        if (timeVal) {
             if (typeof timeVal.toDate === 'function') {
                 timeAgo = formatTimeAgo(timeVal.toDate());
             } else if (timeVal instanceof Date) {
                 timeAgo = formatTimeAgo(timeVal);
             } else if (typeof timeVal === 'string') {
                 const d = new Date(timeVal);
                 if(!isNaN(d)) timeAgo = formatTimeAgo(d);
             }
        }

        li.innerHTML = `
            <i class="bi ${icon} text-2xl"></i>
            <div class="flex-1">
                <p class="font-medium text-text-primary dark:text-dark-text-primary">${sanitizeHTML(activity.message)}</p>
                <p class="text-sm text-text-secondary dark:text-dark-text-secondary">${timeAgo}</p>
            </div>
        `;
        elements.activityList.appendChild(li);
    });
}

// --- Google Maps Logic ---

function initMap() {
    if (!elements.mapContainer) return;
    
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const styles = (currentTheme === 'dark') ? mapStyles.dark : mapStyles.light;

    map = new google.maps.Map(elements.mapContainer, {
        center: { lat: 2.9436, lng: 101.7949 }, // Default: GMI, Kajang
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        styles: styles
    });

    // Initialize InfoWindow
    infoWindow = new google.maps.InfoWindow();

    // Handle Theme Changes
    window.addEventListener('themeChanged', (e) => {
        if (map && mapStyles) {
            const newStyles = (e.detail.theme === 'dark') ? mapStyles.dark : mapStyles.light;
            map.setOptions({ styles: newStyles });
        }
    });
}

function updateMapMarker(device) {
    if (!map) return;

    let lat, lng;

    // Robust coordinate parsing
    if (device.location) {
        if (device.location.lat !== undefined) lat = parseFloat(device.location.lat);
        else if (device.location.latitude !== undefined) lat = parseFloat(device.location.latitude);

        if (device.location.lng !== undefined) lng = parseFloat(device.location.lng);
        else if (device.location.longitude !== undefined) lng = parseFloat(device.location.longitude);
    }

    let isValid = (typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng));
    
    if (!isValid) {
        // Keep map centered on default if no valid location
        return;
    }

    const position = { lat, lng };

    // If marker doesn't exist, create it
    // --- 1. PREPARE ICON ---
    const colorMap = {
        online: "#10b981", found: "#10b981",
        offline: "#ef4444", lost: "#ef4444",
        warning: "#f59e0b"
    };
    const pinColor = colorMap[device.status] || "#64748b";

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

    const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon);
    const iconConfig = {
        url: iconUrl,
        scaledSize: new google.maps.Size(48, 48), 
        anchor: new google.maps.Point(24, 24) 
    };

    // --- 2. CREATE OR UPDATE MARKER ---
    if (!deviceMarker) {
        deviceMarker = new google.maps.Marker({
            position: position,
            map: map,
            title: device.name,
            icon: iconConfig,
            optimized: false
        });

        // Add click listener for InfoWindow
        deviceMarker.addListener('click', () => {
            const content = `
                <div style="color:black">
                    <b>${sanitizeHTML(device.name)}</b><br>
                    Last seen: ${formatTimeAgo(device.lastSeen)}
                </div>
            `;
            infoWindow.setContent(content);
            infoWindow.open(map, deviceMarker);
        });
    } else {
        // Update existing marker
        deviceMarker.setPosition(position);
        // If info window is open, update content
        if (infoWindow.getMap()) {
             const content = `
                <div style="color:black">
                    <b>${sanitizeHTML(device.name)}</b><br>
                    Last seen: ${formatTimeAgo(device.lastSeen)}
                </div>
            `;
            infoWindow.setContent(content);
        }
    }

    // Smoothly pan to new location
    map.panTo(position);
    map.setZoom(16);
}

function initCharts() {
    // Chart.js logic would go here if needed
}
function updateCharts(device) {
    // Update charts with live data if needed
}