// --- Trace'N Find Map View Logic ---
// This file handles all logic *specific* to map-view.html
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

import { 
    fbDB,
    showToast,
    formatTimeAgo,
    getDeviceIcon,
    getDeviceColor,
    getBatteryIcon,
    collection,
    onSnapshot,
    query,
    orderBy,
    sanitizeHTML
} from '/app/js/app-shell.js';

// Import Google Map Styles
import { mapStyles } from '/public/js/map-tiles.js';

// --- Global State for this Page ---
let map = null;
let markers = {}; // Map of deviceId -> google.maps.Marker
let markerCluster = null;
let currentDeviceId = null;
let allDevices = [];
let deviceListener = null; // To store the Firestore unsubscribe function
let userLocationMarker = null;

// --- DOM Elements ---
const elements = {
    mapContainer: document.getElementById('map'),
    deviceListContainer: document.getElementById('deviceListContainer'),
    deviceListEmpty: document.getElementById('device-list-empty'),
    mapSidebarPanel: document.getElementById('mapSidebarPanel'),
    
    // Controls
    toggleDeviceListBtn: document.getElementById('toggleDeviceListBtn'),
    closeMapSidebarBtn: document.getElementById('closeMapSidebarBtn'),
    locateMeBtn: document.getElementById('locateMeBtn'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    toggleFullscreenBtn: document.getElementById('toggleFullscreenBtn')
};

// --- Initialization ---

/**
 * PERFORMANCE FIX: Waits for the user ID AND shared libraries
 * to be initialized by app-shell.js before proceeding.
 */
function waitForAuth(callback) {
    const check = () => {
        // Check for google maps global instead of L (Leaflet)
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
            console.log("Map logic: Auth, libraries (Google Maps), and styles are ready.");
            callback(window.currentUserId);
        } else if (!window.currentUserId) {
            console.log("Map logic waiting for authentication...");
            requestAnimationFrame(check);
        } else if (!window.librariesLoaded) {
            console.log("Map logic waiting for libraries...");
            // Listen for the custom event from app-shell.js
            window.addEventListener('librariesLoaded', () => check(), { once: true });
        } else {
             requestAnimationFrame(check);
        }
    };
    
    // Check immediately
    if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
        callback(window.currentUserId);
    } else {
        requestAnimationFrame(check);
    }
}

waitForAuth((userId) => {
    initMap();
    setupEventListeners();
    listenForDevices(userId); // Start listening for real-time device data
});

/**
 * Initializes the Google Map and the marker clustering.
 */
function initMap() {
    if (!elements.mapContainer) return;
    
    // Check current theme
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const styles = (currentTheme === 'dark') ? mapStyles.dark : mapStyles.light;

    // Initialize Google Map
    map = new google.maps.Map(elements.mapContainer, {
        center: { lat: 2.9436, lng: 101.7949 }, // Centered on GMI, Kajang
        zoom: 12,
        disableDefaultUI: true, // We use custom controls
        styles: styles,
        mapTypeId: 'roadmap'
    });
    
    // Initialize MarkerClusterer
    // Note: renderer config allows customizing the cluster icons if needed, 
    // but the default blue/yellow/red clusters are standard.
    if (typeof markerClusterer !== 'undefined') {
        markerCluster = new markerClusterer.MarkerClusterer({ 
            map: map,
            markers: [] 
        });
    } else {
        console.warn("MarkerClusterer library not loaded.");
    }

    const handleResize = () => {
        if (map) {
            google.maps.event.trigger(map, "resize");
        }
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('appResize', handleResize);

    // Listen for theme changes to update map style
    window.addEventListener('themeChanged', (e) => {
        if (map && mapStyles) {
            const newStyles = (e.detail.theme === 'dark') ? mapStyles.dark : mapStyles.light;
            map.setOptions({ styles: newStyles });
        }
    });
}

/**
 * Attaches all event listeners for the map page controls.
 */
function setupEventListeners() {
    // Map controls
    if (elements.locateMeBtn) elements.locateMeBtn.addEventListener('click', locateUser);
    if (elements.zoomInBtn) elements.zoomInBtn.addEventListener('click', () => map.setZoom(map.getZoom() + 1));
    if (elements.zoomOutBtn) elements.zoomOutBtn.addEventListener('click', () => map.setZoom(map.getZoom() - 1));
    if (elements.toggleFullscreenBtn) elements.toggleFullscreenBtn.addEventListener('click', toggleFullscreen);
    
    // Sidebar controls (Mobile view logic)
    if (elements.toggleDeviceListBtn) {
        elements.toggleDeviceListBtn.addEventListener('click', () => {
            elements.mapSidebarPanel.classList.toggle('open');
            elements.mapSidebarPanel.classList.toggle('-translate-x-full');
        });
    }
    if (elements.closeMapSidebarBtn) {
        elements.closeMapSidebarBtn.addEventListener('click', () => {
            elements.mapSidebarPanel.classList.remove('open');
            elements.mapSidebarPanel.classList.add('-translate-x-full');
        });
    }

    // Event delegation for device list clicks
    if (elements.deviceListContainer) {
        elements.deviceListContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.device-item-map');
            if (item) {
                selectDevice(item.dataset.deviceId);
            }
        });
    }
}

/**
 * Sets up a real-time listener for the user's devices in Firestore.
 * @param {string} userId - The authenticated user's ID.
 */
function listenForDevices(userId) {
    if (deviceListener) deviceListener(); // Unsubscribe from old listener
    
    const devicesRef = collection(fbDB, 'user_data', userId, 'devices');
    const q = query(devicesRef, orderBy('lastSeen', 'desc'));

    // Real-time listener for devices
    deviceListener = onSnapshot(q, (snapshot) => {
        allDevices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDeviceList(allDevices);
        updateMapMarkers(allDevices);
    }, (error) => {
        console.error("Error listening for devices:", error);
        showToast('Error', 'Could not load real-time device data.', 'error');
    });
}

/**
 * Renders the list of devices in the side panel.
 * @param {Array} devices - Array of device objects.
 */
function renderDeviceList(devices) {
    if (!elements.deviceListContainer) return;
    elements.deviceListContainer.innerHTML = ''; // Clear list
    
    if (!devices || devices.length === 0) {
        if (elements.deviceListEmpty) elements.deviceListEmpty.classList.remove('hidden');
        return;
    }
    
    if (elements.deviceListEmpty) elements.deviceListEmpty.classList.add('hidden');
    
    devices.forEach(device => {
        const isActive = currentDeviceId === device.id;
        const deviceElement = document.createElement('div');
        deviceElement.className = `device-item-map ${isActive ? 'active' : ''}`;
        deviceElement.setAttribute('data-device-id', device.id);
        
        // Data Formatting
        const lastSeenDate = device.lastSeen && typeof device.lastSeen.toDate === 'function' ? device.lastSeen.toDate() : null;
        const lastSeen = lastSeenDate ? formatTimeAgo(lastSeenDate) : 'Never';
        const battery = device.battery || 0;
        const status = device.status || 'offline';
        const statusText = status.charAt(0).toUpperCase() + status.slice(1);
        
        deviceElement.innerHTML = `
            <div class="device-item-icon" style="background-color: ${getDeviceColor(status)}">
                <i class="bi ${getDeviceIcon(device.type)}"></i>
            </div>
            <div class="device-item-info">
                <div class="device-item-name">${sanitizeHTML(device.name || 'Unnamed Device')}</div>
                <div class="device-item-status">
                    <span class="font-medium" style="color: ${getDeviceColor(status)}">${statusText}</span>
                    <span class="device-item-battery ml-2">
                        <i class="bi ${getBatteryIcon(battery)}"></i>
                        ${battery}%
                    </span>
                </div>
                <div class="text-xs text-text-secondary dark:text-dark-text-secondary">${lastSeen}</div>
            </div>
        `;
        elements.deviceListContainer.appendChild(deviceElement);
    });
}

/**
 * Updates all markers on the map using Google Maps and Clustering.
 * @param {Array} devices - Array of device objects.
 */
function updateMapMarkers(devices) {
    if (!map || !markerCluster) return;
    
    // Clear existing markers from clusterer and local state
    markerCluster.clearMarkers();
    // Note: In Google Maps, markers persist until setMap(null) is called, 
    // but clearing the clusterer removes them from the map if they were managed by it.
    markers = {};
    
    const bounds = new google.maps.LatLngBounds();
    let hasMarkers = false;

    devices.forEach(device => {
        // Handle potential field names (lat/lng vs latitude/longitude)
        let lat = device.location?.lat;
        let lng = device.location?.lng;
        
        if (lat === undefined) lat = device.location?.latitude;
        if (lng === undefined) lng = device.location?.longitude;

        // Ensure numeric
        lat = parseFloat(lat);
        lng = parseFloat(lng);

        if (isNaN(lat) || isNaN(lng)) return; // Skip invalid

        const position = { lat, lng };
        hasMarkers = true;
        bounds.extend(position);

        // --- 1. DEFINE COLORS ---
        const colorMap = {
            online: "#10b981", // Green
            found: "#10b981",
            offline: "#ef4444", // Red
            lost: "#ef4444",
            warning: "#f59e0b" // Yellow
        };
        const pinColor = colorMap[device.status] || "#64748b";

        // --- 2. CREATE ANIMATED SVG ICON (Blue Wave) ---
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

        // --- 3. CREATE MARKER ---
        const marker = new google.maps.Marker({
            position: position,
            title: device.name,
            icon: {
                url: iconUrl,
                scaledSize: new google.maps.Size(48, 48), 
                anchor: new google.maps.Point(24, 24) 
            },
            optimized: false 
        });

        // InfoWindow Content
        const lastSeenDate = device.lastSeen && typeof device.lastSeen.toDate === 'function' ? device.lastSeen.toDate() : null;
        const lastSeen = lastSeenDate ? formatTimeAgo(lastSeenDate) : 'Never';
        const battery = device.battery || 0;

        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div class="device-popup-map" style="min-width: 200px; padding: 5px; color: #333;">
                    <h5 style="margin:0 0 5px; font-size: 16px; font-weight:bold;">${sanitizeHTML(device.name || 'Unnamed Device')}</h5>
                    <p style="margin:2px 0;"><i class="bi bi-info-circle"></i> <strong>Model:</strong> ${sanitizeHTML(device.model || 'N/A')}</p>
                    <p style="margin:2px 0;"><i class="bi ${getBatteryIcon(battery)}"></i> <strong>Battery:</strong> ${battery}%</p>
                    <p style="margin:2px 0;"><i class="bi bi-clock"></i> <strong>Last Seen:</strong> ${lastSeen}</p>
                    <p style="margin:2px 0;"><i class="bi bi-shield-check"></i> <strong>Status:</strong> <span style="color: ${getDeviceColor(device.status)}; font-weight:500; text-transform:capitalize;">${device.status}</span></p>
                    <a href="/app/device-details.html?id=${device.id}" class="btn" style="display:block; text-align:center; background:#4361ee; color:white; padding:5px; text-decoration:none; border-radius:4px; margin-top:8px;">
                        <i class="bi bi-search mr-1"></i> View Details
                    </a>
                </div>
            `
        });

        // Click listener
        marker.addListener("click", () => {
            // Close other open info windows if needed (global tracking required) or just open this one
            infoWindow.open(map, marker);
            selectDevice(device.id, false); // Select without re-panning excessively
        });

        markerCluster.addMarker(marker);
        markers[device.id] = marker;
    });

    // Fit map to bounds on initial load only (if no specific device selected)
    if (hasMarkers && !currentDeviceId) {
        // Check how many markers are actually on the map
        const markerCount = Object.keys(markers).length;

        if (markerCount === 1) {
            // Single Device: Center and use a reasonable zoom
            map.setCenter(bounds.getCenter());
            map.setZoom(15); 
        } else {
            // Multiple Devices: Fit bounds to show all
            map.fitBounds(bounds);
        }
    }
}
        
/**
 * Handles selecting a device (from list or map).
 * @param {string} deviceId - The ID of the device to select.
 * @param {boolean} [pan=true] - Whether to pan the map to the device.
 */
function selectDevice(deviceId, pan = true) {
    currentDeviceId = deviceId;
    
    // 1. Update list UI
    renderDeviceList(allDevices);
    
    // 2. Pan map
    const marker = markers[deviceId];
    if (marker) {
        if (pan) {
            map.panTo(marker.getPosition());
            map.setZoom(16);
            // Trigger click to open InfoWindow
            new google.maps.event.trigger(marker, 'click');
        }
    }
    
    // 3. Close sidebar on mobile after selection
    if (window.innerWidth < 1023) { 
        elements.mapSidebarPanel.classList.remove('open');
        elements.mapSidebarPanel.classList.add('-translate-x-full');
    }
}

/**
 * Tries to find the user's current location.
 */
function locateUser() {
    if (!navigator.geolocation) {
        showToast('Geolocation Error', 'Geolocation is not supported by your browser', 'error');
        return;
    }
    
    showToast('Locating', 'Getting your current location...', 'info');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const pos = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
            };

            // Remove existing user marker
            if (userLocationMarker) userLocationMarker.setMap(null);

            // Add User Marker (Blue Dot style)
            userLocationMarker = new google.maps.Marker({
                position: pos,
                map: map,
                title: "You are here",
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: "#4285F4",
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: "white",
                },
            });

            const infoWindow = new google.maps.InfoWindow({
                content: "<b>You are here</b>"
            });
            
            userLocationMarker.addListener("click", () => {
                infoWindow.open(map, userLocationMarker);
            });

            // Pan to user
            map.setCenter(pos);
            map.setZoom(15);
            showToast('Location Found', 'Showing your current location.', 'success');
        },
        (error) => {
            console.error("Geolocation failed:", error);
            showToast('Error', 'Could not find your location.', 'error');
        }
    );
}

/**
 * Toggles fullscreen mode for the map panel.
 */
function toggleFullscreen() {
    const elem = document.querySelector('.map-main-panel');
    const icon = elements.toggleFullscreenBtn?.querySelector('i');
    
    if (!elem) return;

    if (!document.fullscreenElement) {
        elem.requestFullscreen().catch(err => {
            showToast('Error', `Could not enable full-screen: ${err.message}`, 'error');
        });
        if(icon) icon.className = 'bi bi-fullscreen-exit';
    } else {
        if(document.exitFullscreen) {
            document.exitFullscreen();
        }
        if(icon) icon.className = 'bi bi-fullscreen';
    }
}