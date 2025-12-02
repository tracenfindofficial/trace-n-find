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

import { animateMarkerTo } from '/app/js/shared-utils.js';
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
let bounds = null; // For fitting map bounds if needed

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
    liveIndicator: document.getElementById('live-indicator'),
    
    // Quick Stats
    statBattery: document.getElementById('battery-level-text'),
    statStorage: document.getElementById('storage-text'),
    statNetwork: document.getElementById('network-type-text'),
    statSignal: document.getElementById('signal-strength-text'),
    
    // Map
    mapContainer: document.getElementById('map'),
    
    // Activity
    activityList: document.getElementById('activity-timeline'),
    // Note: activityEmpty is not needed here as we will render it dynamically
    
    // Info
    infoOS: document.getElementById('device-os'),
    infoCarrierStatus: document.getElementById('device-carrier-status'),
    infoIP: document.getElementById('device-ip'),
    infoCarrier: document.getElementById('device-carrier'),
    infoMAC: document.getElementById('device-mac'),
    
    // Charts (Placeholders for future implementation)
    batteryChart: document.getElementById('battery-chart'),
    networkChart: document.getElementById('network-chart'),
    storageChart: document.getElementById('storage-chart'),
    signalChart: document.getElementById('signal-chart'),
};

// --- Initialization ---

function waitForAuth(callback) {
    const check = () => {
        // Check for Google Maps global and currentUserId
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
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
        // Start listening for notifications (Badge count)
        listenForUnreadNotifications(userId);
    } else {
        // Redirect if no ID provided
        window.location.href = '/app/devices.html';
    }
});

function initPage(userId, deviceId) {
    initMap();
    // initCharts(); // Placeholder for chart logic
    
    listenForDeviceData(userId, deviceId);
    listenForActivityData(userId, deviceId);
}

// --- Notification Logic (Deduplicated Badge Count) ---

function listenForUnreadNotifications(userId) {
    const notifsRef = collection(fbDB, 'user_data', userId, 'notifications');
    
    // Query only unread items. We DO NOT use orderBy here to avoid needing a composite index (read + timestamp).
    // We will sort and deduplicate client-side.
    const q = query(notifsRef, where("read", "==", false));

    onSnapshot(q, (snapshot) => {
        const rawUnread = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // 1. Sort by timestamp descending (newest first) to ensure consistent deduplication
        rawUnread.sort((a, b) => getTimestampMs(b) - getTimestampMs(a));

        // 2. Deduplicate
        const uniqueUnread = getUniqueNotifications(rawUnread);

        // 3. Update Badge
        updateBadgeCount(uniqueUnread.length);
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
        document.title = `(${count}) ${elements.deviceName.textContent} - Trace'N Find`;
    } else {
        badge.classList.add('hidden');
        badge.classList.remove('animate-pulse');
        document.title = `${elements.deviceName.textContent || 'Device Details'} - Trace'N Find`;
    }
}

// Helper: Get unique notifications (Logic copied from notifications-logic.js)
function getUniqueNotifications(notifications) {
    const unique = [];
    const seenSignatures = new Map(); // key: "type|title|msg", value: timestamp

    notifications.forEach(notification => {
        const timeMs = getTimestampMs(notification);
        // Signature defines "sameness"
        const signature = `${notification.type}|${notification.title}|${notification.message}`;
        
        if (seenSignatures.has(signature)) {
            const lastTime = seenSignatures.get(signature);
            const timeDiff = Math.abs(timeMs - lastTime);
            
            // If the same message appears within 10 seconds, treat it as a duplicate
            if (timeDiff < 10000) { 
                return; // Skip this one (it's a duplicate)
            }
        }

        // It's unique (or significantly later), so keep it
        seenSignatures.set(signature, timeMs);
        unique.push(notification);
    });

    return unique;
}

// Helper: robust timestamp extraction
function getTimestampMs(notification) {
    if (notification.timestamp && typeof notification.timestamp.toMillis === 'function') {
        return notification.timestamp.toMillis();
    } else if (notification.time) {
        const d = new Date(notification.time);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    return 0;
}

// --- Device Data Logic ---
function listenForDeviceData(userId, deviceId) {
    const deviceRef = doc(fbDB, 'user_data', userId, 'devices', deviceId);

    deviceListener = onSnapshot(deviceRef, (docSnap) => {
        if (docSnap.exists()) {
            deviceData = { id: docSnap.id, ...docSnap.data() };
            updateUI(deviceData);
        } else {
            showToast('Error', 'Device not found.', 'error');
            setTimeout(() => window.location.href = '/app/devices.html', 2000);
        }
    });
}

// --- Activity Logic (Functional & Robust) ---
function listenForActivityData(userId, deviceId) {
    const notificationsRef = collection(fbDB, 'user_data', userId, 'notifications');

    // FIX: Filter inside the query so we get 50 items specifically for THIS device
    const q = query(
        notificationsRef, 
        where("deviceId", "==", deviceId), // Ensure your DB field is exactly "deviceId"
        orderBy('timestamp', 'desc'), 
        limit(50)
    );

    activityListener = onSnapshot(q, (snapshot) => {
        const deviceActivities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderActivityList(deviceActivities);
    }, (error) => {
        console.error("Activity Query Error:", error);
        
        // IMPORTANT: If you see this in the console, click the link provided 
        // by Firebase to create the Composite Index.
    });
}

// --- UI Rendering ---

function updateUI(device) {
    // 1. SAFETY: Create safe nested objects if they are missing
    const info = device.info || {};
    const sim = device.sim || {};
    const security = device.security || {}; 
    const location = device.location || {};
    
    // 2. Update Header Info
    const devName = device.name || device.model || 'Unknown Device';
    elements.headerName.textContent = devName;
    elements.deviceName.textContent = devName;
    elements.deviceModel.textContent = device.model || info.model || 'Unknown Model';
    
    // Status Color & Icon
    const statusColor = getDeviceColor(device.status);
    elements.deviceIcon.style.backgroundColor = `${statusColor}20`; // 20 = roughly 12% opacity
    elements.deviceIcon.style.color = statusColor;
    elements.deviceIcon.innerHTML = `<i class="bi ${getDeviceIcon(device.type || info.type)}"></i>`;

    // Status Badge
    elements.deviceStatus.textContent = device.status || 'Offline';
    elements.deviceStatus.style.borderColor = statusColor;
    elements.deviceStatus.style.color = statusColor;
    elements.deviceStatus.className = `text-sm font-semibold uppercase px-3 py-1 rounded-full border border-current bg-[${statusColor}10]`; // Tinted bg

    // Last Seen / Live Indicator
    const timeAgo = formatTimeAgo(device.lastSeen || device.last_updated);
    elements.deviceLastSeen.textContent = timeAgo;

    // Show "Live" indicator if online and updated recently (within 2 mins)
    const isOnline = (device.status === 'online' || device.status === 'active');
    // Simple check: if string implies seconds/minutes ago or "Just now"
    const isRecent = timeAgo.includes('Just now') || timeAgo.includes('sec') || (timeAgo.includes('min') && parseInt(timeAgo) < 5);
    
    if (isOnline && isRecent && elements.liveIndicator) {
        elements.liveIndicator.classList.remove('hidden');
        elements.liveIndicator.classList.add('flex');
    } else if (elements.liveIndicator) {
        elements.liveIndicator.classList.add('hidden');
        elements.liveIndicator.classList.remove('flex');
    }
    
    // 3. Stats (Battery, Storage, Network, Signal)
    
    // Battery
    const battLevel = device.battery ?? device.battery_level ?? 0;
    elements.statBattery.textContent = `${battLevel}%`;
    // Add color to battery text based on level
    if (battLevel < 20) elements.statBattery.className = "font-bold text-xl text-danger-500";
    else if (battLevel < 50) elements.statBattery.className = "font-bold text-xl text-warning-500";
    else elements.statBattery.className = "font-bold text-xl text-success-500";
    
    // Storage
    elements.statStorage.textContent = device.storage || 'N/A';
    
    // Network (Fallback to 'network' if 'network_display' is missing)
    elements.statNetwork.textContent = device.network_display || device.network || 'N/A';
    
    // Signal
    const signalRaw = device.signal_strength ?? device.signal ?? device.signal_level;
    if (signalRaw !== undefined && signalRaw !== null) {
        const signalClean = String(signalRaw).replace(/\s?dBm/gi, '').trim();
        elements.statSignal.textContent = `${signalClean} dBm`;
    } else {
        elements.statSignal.textContent = 'N/A';
    }
    
    // 4. Info Grid
    elements.infoOS.textContent = device.os_version || device.os || info.os || 'N/A';
    elements.infoIP.textContent = device.ip_address || device.ip || info.ip || 'N/A';
    
    if(elements.infoMAC) {
        elements.infoMAC.textContent = device.mac_address || device.mac || info.mac || 'N/A';
    }

    // Carrier Info
    const carrierName = sim.carrier || device.carrier || 'Unknown Carrier';
    elements.infoCarrier.textContent = carrierName;
    
    // Carrier Status
    const simStatus = device.sim_status || security.sim_status || sim.status || 'Unknown';
    elements.infoCarrierStatus.textContent = simStatus;
    
    elements.infoCarrierStatus.className = 'font-medium';
    const safeStatus = String(simStatus).toLowerCase();
    
    if (['active', 'online', 'ready', 'inserted'].includes(safeStatus)) {
        elements.infoCarrierStatus.classList.add('text-success-500');
    } else if (['inactive', 'blocked', 'missing', 'removed', 'absent', 'ejected'].includes(safeStatus)) {
        elements.infoCarrierStatus.classList.add('text-danger-500');
    }

    // 5. Reveal Content
    if (elements.loader) elements.loader.style.display = 'none';
    if (elements.content) {
        elements.content.classList.remove('hidden');
        elements.content.classList.add('animate-fade-in');
    }

    // Update Map
    updateMapMarker(device);
}

function renderActivityList(activities) {
    if (!elements.activityList) return;
    
    // CLEAR EVERYTHING first
    elements.activityList.innerHTML = '';
    
    // Handle Empty State by Injecting HTML directly
    if (!activities || activities.length === 0) {
        // We inject this directly. Note 'animation-fade-in' class to ensure visibility.
        // We use 'bg-primary-50' as a safe light background.
        elements.activityList.innerHTML = `
            <div id="activity-empty" class="text-center p-6 animation-fade-in">
                <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/20 mb-4">
                    <i class="bi bi-clock-history text-3xl text-text-secondary dark:text-dark-text-secondary opacity-70"></i>
                </div>
                <h3 class="text-base font-medium text-text-primary dark:text-dark-text-primary">No recent activity</h3>
                <p class="mt-1 text-sm text-text-secondary dark:text-dark-text-secondary">Notifications for this device will appear here.</p>
            </div>
        `;
        return;
    }
    
    // Render Items
    activities.forEach(activity => {
        const li = document.createElement('div');
        li.className = 'flex gap-4 p-4 rounded-xl hover:bg-bg-primary dark:hover:bg-dark-bg-primary transition-colors border border-transparent hover:border-border-color dark:hover:border-dark-border-color animation-fade-in';
        
        // Determine Icon and Color Style based on type
        let icon = 'bi-info-circle-fill';
        let bgClass = 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400';
        
        const type = (activity.type || 'info').toLowerCase();
        
        if (type.includes('security') || type.includes('alert') || type.includes('danger')) {
            icon = 'bi-shield-exclamation';
            bgClass = 'bg-danger-100 text-danger-600 dark:bg-danger-900/30 dark:text-danger-400';
        } else if (type.includes('warning') || type.includes('battery')) {
            icon = 'bi-exclamation-triangle-fill';
            bgClass = 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400';
        } else if (type.includes('lost') || type.includes('location')) {
            icon = 'bi-geo-alt-fill';
            bgClass = 'bg-info-100 text-info-600 dark:bg-info-900/30 dark:text-info-400';
        } else if (type.includes('success') || type.includes('found')) {
            icon = 'bi-check-circle-fill';
            bgClass = 'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400';
        }
        
        // Time formatting
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
             } else if (typeof timeVal === 'number') {
                 timeAgo = formatTimeAgo(new Date(timeVal));
             }
        }

        li.innerHTML = `
            <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${bgClass}">
                <i class="bi ${icon} text-lg"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="font-semibold text-sm text-text-primary dark:text-dark-text-primary truncate">
                    ${sanitizeHTML(activity.title || 'Notification')}
                </p>
                <p class="text-sm text-text-secondary dark:text-dark-text-secondary line-clamp-2">
                    ${sanitizeHTML(activity.message || activity.body || 'No details provided.')}
                </p>
                <p class="text-xs text-text-secondary dark:text-dark-text-secondary mt-1 opacity-70">
                    <i class="bi bi-clock"></i> ${timeAgo}
                </p>
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

    // Default center (Malaysia/GMI)
    const defaultCenter = { lat: 2.9436, lng: 101.7949 };

    map = new google.maps.Map(elements.mapContainer, {
        center: defaultCenter,
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        styles: styles,
        mapTypeId: 'roadmap'
    });

    bounds = new google.maps.LatLngBounds();
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
        // If device has no valid location, stay at default or previous center
        return;
    }

    const position = { lat, lng };

    // --- 1. PREPARE ICON ---
    const colorMap = {
        online: "#10b981", found: "#10b981", active: "#10b981",
        offline: "#64748b", inactive: "#64748b",
        warning: "#f59e0b",
        lost: "#ef4444", stolen: "#ef4444"
    };
    // Default to primary color if status unknown
    const pinColor = colorMap[device.status?.toLowerCase()] || "#4361ee"; 

    // Custom SVG Marker
    const svgIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 80 80">
            ${ (device.status === 'online' || device.status === 'active' || device.status === 'lost') ? `
            <circle cx="40" cy="40" r="18" fill="${pinColor}" fill-opacity="0.3">
                <animate attributeName="r" from="18" to="40" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
            </circle>
            ` : '' }
            <circle cx="40" cy="40" r="18" fill="${pinColor}" stroke="white" stroke-width="3" />
            <!-- Smartphone Icon Center -->
            <g transform="translate(28, 28) scale(0.9)">
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
            optimized: false // Required for SVG animations in some browsers
        });

        // Initial Pan
        map.panTo(position);

        // Add click listener for InfoWindow
        deviceMarker.addListener('click', () => {
            const content = `
                <div class="text-gray-800 p-1">
                    <h3 class="font-bold text-sm">${sanitizeHTML(device.name)}</h3>
                    <p class="text-xs mt-1">Status: <span style="color:${pinColor}" class="font-semibold uppercase">${device.status}</span></p>
                    <p class="text-xs text-gray-500 mt-1">Last seen: ${formatTimeAgo(device.lastSeen || device.last_updated)}</p>
                </div>
            `;
            infoWindow.setContent(content);
            infoWindow.open(map, deviceMarker);
        });
    } else {
        // Update Icon
        deviceMarker.setIcon(iconConfig);
        
        // Animate Movement
        animateMarkerTo(deviceMarker, position);
        
        // Update InfoWindow content if open
        if (infoWindow.getMap()) {
             const content = `
                <div class="text-gray-800 p-1">
                    <h3 class="font-bold text-sm">${sanitizeHTML(device.name)}</h3>
                    <p class="text-xs mt-1">Status: <span style="color:${pinColor}" class="font-semibold uppercase">${device.status}</span></p>
                    <p class="text-xs text-gray-500 mt-1">Last seen: ${formatTimeAgo(device.lastSeen || device.last_updated)}</p>
                </div>
            `;
            infoWindow.setContent(content);
        }
    }
}