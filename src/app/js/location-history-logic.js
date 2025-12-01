// --- Trace'N Find Location History Logic (FIXED ROUTING + BREADCRUMBS) ---
import { 
    fbDB,
    collection, 
    query,
    showToast,
    formatTimeAgo,
    getDeviceIcon,
    getDeviceColor,
    orderBy,
    doc,
    getDoc,
    getDocs,
    sanitizeHTML
    // REMOVED: where, onSnapshot (handled globally in app-shell.js)
} from '/app/js/app-shell.js';

// Import Google Map Styles
import { mapStyles } from '/public/js/map-tiles.js';

// --- Global State ---
let map = null;
let historyPolyline = null; // Store the main path
let markers = []; // Store array of marker objects
let deviceCache = {};

// --- DOM Elements ---
const elements = {
    mapContainer: document.getElementById('map'),
    deviceFilter: document.getElementById('deviceFilter'),
    dateFilter: document.getElementById('dateFilter'),
    refreshButton: document.getElementById('refreshButton'),
    timelineList: document.getElementById('timeline-list'),
    timelineEmpty: document.getElementById('timeline-empty'),
    historyTitleHeader: document.getElementById('history-title-header'),
    
    // REMOVED: notificationBadge reference to prevent conflict with app-shell.js
    
    // Stats Elements
    statTotalPoints: document.getElementById('stat-total-points'),
    statTotalDistance: document.getElementById('stat-total-distance'),
    statMostVisited: document.getElementById('stat-most-visited'),
    statDuration: document.getElementById('stat-duration'),
};

/**
 * Force the date input to today's local date on load.
 */
function setDateToToday() {
    const dateInput = document.getElementById('dateFilter');
    if (dateInput && !dateInput.value) {
        // Get local date correctly (handling timezone offset)
        const today = new Date();
        const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000))
            .toISOString()
            .split('T')[0];
            
        dateInput.value = localDate;
        return localDate;
    }
    return dateInput ? dateInput.value : null;
}

// Initialize Auth Waiter
function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
            callback(window.currentUserId);
        } else {
            requestAnimationFrame(check);
        }
    };
    // Check immediately first
    if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined') {
        callback(window.currentUserId);
    } else {
        requestAnimationFrame(check);
    }
}

// --- Main Entry Point ---
waitForAuth((userId) => {
    initMap();
    setupEventListeners(userId);
    // REMOVED: listenForUnreadNotifications(userId);
    // The global app-shell.js now handles the badge count with proper deduplication.
    setDateToToday();
    loadDeviceOptions(userId);
});

function setupEventListeners(userId) {
    if(elements.refreshButton) elements.refreshButton.addEventListener('click', () => loadHistoryData(userId));
    if(elements.deviceFilter) elements.deviceFilter.addEventListener('change', () => loadHistoryData(userId));
    if(elements.dateFilter) elements.dateFilter.addEventListener('change', () => loadHistoryData(userId));

    window.addEventListener('themeChanged', (e) => {
        if (map && mapStyles) {
            const newStyles = (e.detail.theme === 'dark') ? mapStyles.dark : mapStyles.light;
            map.setOptions({ styles: newStyles });
        }
    });
}

async function loadDeviceOptions(userId) {
    const devicesRef = collection(fbDB, 'user_data', userId, 'devices');
    const q = query(devicesRef, orderBy('name', 'asc'));
    
    try {
        const snapshot = await getDocs(q);
        if(elements.deviceFilter) elements.deviceFilter.innerHTML = ''; 
        deviceCache = {}; 

        if (snapshot.empty) {
            if(elements.deviceFilter) elements.deviceFilter.innerHTML = '<option value="">No Devices</option>';
            return;
        }

        let firstDeviceId = null;
        let isFirst = true;

        snapshot.forEach((doc) => {
            const data = doc.data();
            deviceCache[doc.id] = data; 
            
            if (isFirst) {
                firstDeviceId = doc.id;
                isFirst = false;
            }

            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = data.name || data.model || 'Unnamed Device';
            if(elements.deviceFilter) elements.deviceFilter.appendChild(option);
        });
        
        if (firstDeviceId && elements.deviceFilter) {
            elements.deviceFilter.value = firstDeviceId;
            // Load history for the first device automatically
            loadHistoryData(userId);
        }

    } catch (e) {
        console.error("Error loading devices:", e);
        showToast('Error', 'Could not load devices.', 'error');
    }
}

function initMap() {
    if (!elements.mapContainer) return;

    const currentTheme = document.documentElement.getAttribute('data-theme');
    const styles = (currentTheme === 'dark') ? mapStyles.dark : mapStyles.light;

    map = new google.maps.Map(elements.mapContainer, {
        center: { lat: 2.9436, lng: 101.7949 }, 
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        styles: styles,
        mapTypeId: 'roadmap'
    });
}

async function loadHistoryData(userId) {
    const deviceId = elements.deviceFilter.value;
    const dateString = elements.dateFilter.value; 

    if (!deviceId || !dateString) return;

    // --- 1. Update Header UI ---
    if (elements.historyTitleHeader) {
        const dateObj = new Date(dateString);
        // Use UTC to prevent date shifting
        const readableDate = dateObj.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            timeZone: 'UTC' 
        });
        elements.historyTitleHeader.textContent = `History of ${readableDate}`;
    }

    try {
        // --- 2. Fetch Data ---
        const docRef = doc(fbDB, 'user_data', userId, 'devices', deviceId, 'location_history', dateString);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            console.log("No history document found.");
            updateStats(0, 0, "0h 0m");
            renderMapMarkers([], deviceId); 
            renderTimeline([]);
            showToast('Info', 'No history found for this date.', 'info');
            return;
        }

        const data = docSnap.data();
        let historyPoints = data.route || [];

        // --- 3. THE CRITICAL FIX: SORT BY TIME ---
        // We must ensure points are ordered chronologically before drawing lines.
        historyPoints.sort((a, b) => {
            const timeA = parseDateHelper(a)?.getTime() || 0;
            const timeB = parseDateHelper(b)?.getTime() || 0;
            return timeA - timeB;
        });

        console.log(`Found ${historyPoints.length} sorted history points.`);
        
        // --- 4. Update UI ---
        const distance = calculateTotalDistance(historyPoints);
        const duration = calculateDuration(historyPoints);
        
        updateStats(historyPoints.length, distance, duration);
        renderMapMarkers(historyPoints, deviceId);
        renderTimeline(historyPoints);

    } catch (error) {
        console.error("Error loading history:", error);
        showToast('Error', 'Could not load history.', 'error');
    }
}

function updateStats(points, distance, duration) {
    if(elements.statTotalPoints) elements.statTotalPoints.textContent = points;
    if(elements.statTotalDistance) elements.statTotalDistance.textContent = `${distance.toFixed(2)} km`;
    if(elements.statDuration && duration) {
        elements.statDuration.textContent = duration;
    }
}

// --- UPDATED ROUTE RENDERING (Option 1: Breadcrumbs) ---
function renderMapMarkers(data, currentDeviceId) {
    if (!map) return;

    // 1. Clear previous layers
    if (historyPolyline) {
        historyPolyline.setMap(null);
        historyPolyline = null;
    }
    
    // Clear markers
    markers.forEach(m => m.setMap(null));
    markers = [];

    const device = deviceCache[currentDeviceId];
    if (!device) return;

    // --- CASE A: No History -> Show Current Location ---
    if (!data || data.length === 0) {
        if (device.location) {
            const pos = parseLatLng(device.location);
            if (pos) {
                const marker = new google.maps.Marker({
                    position: pos,
                    map: map,
                    title: "Current Location",
                    animation: google.maps.Animation.DROP
                });
                
                const infoWindow = new google.maps.InfoWindow({
                    content: `<b>${sanitizeHTML(device.name)}</b><br>Current Location<br><small>No history for this date</small>`
                });
                
                marker.addListener('click', () => infoWindow.open(map, marker));
                map.setCenter(pos);
                map.setZoom(15);
                markers.push(marker);
            }
        }
        return;
    }

    // --- CASE B: History Exists (Draw Polyline + Breadcrumbs) ---
    const bounds = new google.maps.LatLngBounds();
    const validPoints = [];
    
    // Filter and collect points
    data.forEach(pt => {
        const latLng = parseLatLng(pt);
        if (latLng) {
            validPoints.push(latLng);
            bounds.extend(latLng);
        }
    });

    if (validPoints.length > 1) {
        // Draw the path using Polyline (Exact tracking)
        drawPolylinePath(validPoints);
        
        // Fit bounds to show whole route
        map.fitBounds(bounds);
        
        // Add padding to bounds
        const padding = { top: 50, right: 50, bottom: 50, left: 50 };
        map.fitBounds(bounds, padding);
    } else if (validPoints.length === 1) {
        map.setCenter(validPoints[0]);
        map.setZoom(16);
    }

    // 3. Add Start/End Markers AND Breadcrumbs
    if (data.length > 0) {
        // A. Start Point (Green)
        const startLoc = data[0];
        addEndpointMarker(startLoc, "Start Point", false, device);

        // B. Intermediate Breadcrumbs (Small Blue Dots)
        if (data.length > 2) {
            for (let i = 1; i < data.length - 1; i++) {
                const pt = data[i];
                const position = parseLatLng(pt);
                if (position) {
                    const marker = new google.maps.Marker({
                        position: position,
                        map: map,
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 3, // Small, unobtrusive dot
                            fillColor: "#4361ee", // Primary Blue
                            fillOpacity: 0.8,
                            strokeWeight: 0
                        },
                        title: parseDateHelper(pt)?.toLocaleTimeString() || "History Point",
                        zIndex: 1 // Keep below start/end markers
                    });
                    
                    // Optional: Make breadcrumbs clickable if desired
                    /* marker.addListener('click', () => {
                        new google.maps.InfoWindow({
                            content: `<small>${marker.title}</small>`
                        }).open(map, marker);
                    }); 
                    */
                    
                    markers.push(marker);
                }
            }
        }

        // C. End Point (Custom Pin)
        const endLoc = data[data.length - 1];
        addEndpointMarker(endLoc, "End Point (Latest)", true, device);
    }
}

/**
 * Draws a Polyline connecting the GPS points.
 * Includes directional arrows repeating every 100px.
 */
function drawPolylinePath(coordinates) {
    const lineSymbol = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 3,
        strokeColor: '#4361ee',
        fillColor: '#4361ee',
        fillOpacity: 1
    };

    historyPolyline = new google.maps.Polyline({
        path: coordinates,
        geodesic: true,
        strokeColor: "#4361ee", // Primary Blue
        strokeOpacity: 0.8,
        strokeWeight: 5,
        icons: [{
            icon: lineSymbol,
            offset: '0',    // Start immediately
            repeat: '100px' // Arrow every 100 pixels (better than %)
        }]
    });

    historyPolyline.setMap(map);
}

function addEndpointMarker(loc, title, isEnd, device) {
    const position = parseLatLng(loc);
    if (!position) return;

    let icon = null;

    if (isEnd) {
        // Custom Static Icon for End Point
        const colorMap = { online: "#10b981", found: "#10b981", offline: "#ef4444", lost: "#ef4444", warning: "#f59e0b" };
        const pinColor = colorMap[device.status] || "#64748b";

        const svgIcon = `
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="18" fill="${pinColor}" stroke="white" stroke-width="3" />
                <g transform="translate(28, 28)">
                    <path fill="white" d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
                </g>
            </svg>`;
        
        icon = {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon),
            scaledSize: new google.maps.Size(48, 48),
            anchor: new google.maps.Point(24, 24)
        };
    } else {
        // Start Point - Medium Green Dot with white border
        icon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: "#10b981",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "white",
        };
    }

    // Using standard Marker to support custom SVGs easily
    const marker = new google.maps.Marker({
        position: position,
        map: map,
        icon: icon,
        title: title,
        zIndex: isEnd ? 1000 : 900, // End point always on top, Start point below it
        animation: isEnd ? google.maps.Animation.DROP : null
    });

    // Info Window logic
    let timeStr = 'N/A';
    const dateObj = parseDateHelper(loc);
    if (dateObj) timeStr = dateObj.toLocaleTimeString();

    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="text-align:center; color:black; padding:5px;">
                <div style="font-weight:bold; color:#4361ee; margin-bottom:2px;">${title}</div>
                <div style="font-size:12px; color:#333">${timeStr}</div>
                <div style="font-size:10px; color:#666; margin-top:2px;">${position.lat().toFixed(5)}, ${position.lng().toFixed(5)}</div>
            </div>
        `
    });
    
    marker.addListener('click', () => infoWindow.open(map, marker));
    markers.push(marker);
}

function parseLatLng(loc) {
    if (!loc) return null;
    let lat = loc.lat ?? loc.latitude;
    let lng = loc.lng ?? loc.longitude;
    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (isNaN(lat) || isNaN(lng)) return null;
    return new google.maps.LatLng(lat, lng);
}

function calculateTotalDistance(points) {
    if (!points || points.length < 2) return 0;
    let totalDist = 0;
    if (typeof google !== 'undefined' && google.maps.geometry) {
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = parseLatLng(points[i]);
            const p2 = parseLatLng(points[i+1]);
            if (p1 && p2) {
                totalDist += google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
            }
        }
    }
    return totalDist / 1000; // km
}

function calculateDuration(points) {
    if (!points || points.length < 2) return "0h 0m";
    const startPoint = points[0];
    const endPoint = points[points.length - 1];
    const startDate = parseDateHelper(startPoint);
    const endDate = parseDateHelper(endPoint);

    if (!startDate || !endDate) return "N/A";
    const diffMs = Math.abs(endDate - startDate);
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

function parseDateHelper(point) {
    if (!point) return null;
    if (point.timestamp && typeof point.timestamp.toDate === 'function') return point.timestamp.toDate();
    if (point.time && typeof point.time.toDate === 'function') return point.time.toDate();
    if (typeof point.time === 'string') {
        let cleanerString = point.time.replace('at', '').replace('UTC+8', '').trim();
        const d = new Date(cleanerString);
        if (!isNaN(d)) return d;
    }
    return null;
}

function renderTimeline(data) {
    const container = elements.timelineList;
    if (!container) return;
    container.innerHTML = ''; 

    if (!data || data.length === 0) {
        if (elements.timelineEmpty) {
            elements.timelineEmpty.classList.remove('hidden');
        }
        return;
    }
    if (elements.timelineEmpty) {
        elements.timelineEmpty.classList.add('hidden');
    }
    
    const listWrapper = document.createElement('div');
    listWrapper.className = "p-4 space-y-0"; 

    // Reverse data to show latest first in timeline
    const reversedData = [...data].reverse();

    reversedData.forEach((point, index) => {
        const pointNumber = data.length - index;
        const lat = parseFloat(point.lat || point.latitude);
        const lng = parseFloat(point.lng || point.longitude);
        
        let timeDisplay = 'N/A';
        const dateObj = parseDateHelper(point);
        if (dateObj) timeDisplay = dateObj.toLocaleTimeString();

        const item = document.createElement('div');
        item.className = "flex gap-4 pb-4 relative";
        const lineClass = index === reversedData.length - 1 ? "" : "h-full";
        
        item.innerHTML = `
            <div class="flex flex-col items-center relative">
                <div class="w-6 h-6 bg-primary-600 text-white text-[10px] font-bold rounded-full z-10 ring-4 ring-white dark:ring-gray-800 flex items-center justify-center shadow-sm">
                    ${pointNumber}
                </div>
                <div class="w-0.5 bg-gray-200 dark:bg-gray-700 absolute top-3 ${lineClass}" style="height: calc(100% + 1rem);"></div>
            </div>
            <div class="flex-1 pb-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div class="flex justify-between items-center">
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${timeDisplay}</p>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                    ${lat.toFixed(5)}, ${lng.toFixed(5)}
                </p>
                <button class="text-xs text-primary-600 mt-1 hover:underline flex items-center gap-1" 
                    onclick="window.focusMapOnPoint(${lat}, ${lng})">
                    <i class="bi bi-crosshair"></i> View on Map
                </button>
            </div>
        `;
        listWrapper.appendChild(item);
    });
    container.appendChild(listWrapper);
}

// Global function for timeline click events
window.focusMapOnPoint = (lat, lng) => {
    if (map && !isNaN(lat) && !isNaN(lng)) {
        const pos = { lat, lng };
        map.panTo(pos);
        map.setZoom(18);
        
        // Brief highlight marker
        const highlight = new google.maps.Marker({
            position: pos,
            map: map,
            animation: google.maps.Animation.BOUNCE,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#f59e0b",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "white",
            }
        });
        setTimeout(() => highlight.setMap(null), 2000);
    }
};