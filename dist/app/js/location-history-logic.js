// --- Trace'N Find Location History Logic ---
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
    sanitizeHTML,
    where,
    onSnapshot
} from '/app/js/app-shell.js';

// Import Google Map Styles
import { mapStyles } from '/public/js/map-tiles.js';

// --- Global State ---
let map = null;
let pathPolyline = null; // Store the Google Maps Polyline fallback
let markers = []; // Store array of marker objects
let deviceCache = {};
let directionsService = null;
let directionsRenderer = null;

// --- DOM Elements ---
const elements = {
    mapContainer: document.getElementById('map'),
    deviceFilter: document.getElementById('deviceFilter'),
    dateFilter: document.getElementById('dateFilter'),
    refreshButton: document.getElementById('refreshButton'),
    timelineList: document.getElementById('timeline-list'),
    timelineEmpty: document.getElementById('timeline-empty'),
    historyTitleHeader: document.getElementById('history-title-header'),
    
    // Notification Badge
    notificationBadge: document.getElementById('notificationBadge'),
    
    // Stats Elements
    statTotalPoints: document.getElementById('stat-total-points'),
    statTotalDistance: document.getElementById('stat-total-distance'),
    statMostVisited: document.getElementById('stat-most-visited'),
    statDuration: document.getElementById('stat-duration'),
};

/**
 * Force the date input to today's local date.
 * Returns the date string used.
 */
function setDateToToday() {
    const dateInput = document.getElementById('dateFilter');
    if (dateInput) {
        // Get local date correctly (handling timezone offset)
        const today = new Date();
        const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000))
            .toISOString()
            .split('T')[0];
            
        if (dateInput.value !== localDate) {
            dateInput.value = localDate;
            if (elements.dateFilter) elements.dateFilter.value = localDate;
        }
        return localDate;
    }
    return null;
}

setDateToToday();
window.addEventListener('pageshow', setDateToToday);

function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
            callback(window.currentUserId);
        } else {
            requestAnimationFrame(check);
        }
    };
    if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined') {
        callback(window.currentUserId);
    } else {
        requestAnimationFrame(check);
    }
}

waitForAuth((userId) => {
    initMap();
    setupEventListeners(userId);
    listenForUnreadNotifications(userId);

    let attempts = 0;
    const dateEnforcer = setInterval(() => {
        setDateToToday();
        attempts++;
        if (attempts >= 10) clearInterval(dateEnforcer);
    }, 100);

    loadDeviceOptions(userId);
});

function listenForUnreadNotifications(userId) {
    const notifsRef = collection(fbDB, 'user_data', userId, 'notifications');
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

    // Initialize Directions Service for "Snap to Road" style routing
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: true, // We use our own custom markers
        preserveViewport: false, // Allow map to fit to route
        polylineOptions: {
            strokeColor: "#4361ee",
            strokeWeight: 5,
            strokeOpacity: 0.8
        }
    });
}

async function loadHistoryData(userId) {
    const deviceId = elements.deviceFilter.value;
    const dateString = elements.dateFilter.value; 

    if (!deviceId || !dateString) return;

    if (elements.historyTitleHeader) {
        const today = new Date();
        const localToday = new Date(today.getTime() - (today.getTimezoneOffset() * 60000))
            .toISOString()
            .split('T')[0];

        if (dateString === localToday) {
            elements.historyTitleHeader.textContent = "History for Today";
        } else {
            const dateObj = new Date(dateString);
            const readableDate = dateObj.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                timeZone: 'UTC' 
            });
            elements.historyTitleHeader.textContent = `History of ${readableDate}`;
        }
    }

    try {
        const docRef = doc(fbDB, 'user_data', userId, 'devices', deviceId, 'location_history', dateString);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            console.log("No history document found.");
            updateStats(0, 0, "0h 0m");
            renderMapMarkers([], deviceId); 
            renderTimeline([]);
            return;
        }

        const data = docSnap.data();
        const historyPoints = data.route || data.points || data.locations || data.history || [];

        console.log(`Found ${historyPoints.length} history points.`);
        
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

// --- ENHANCED MAP RENDERING (Snap to Roads Logic) ---
function renderMapMarkers(data, currentDeviceId) {
    if (!map) return;

    // 1. Clear previous layers
    if (pathPolyline) {
        pathPolyline.setMap(null);
        pathPolyline = null;
    }
    if (directionsRenderer) {
        directionsRenderer.setDirections({ routes: [] });
    }
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

    // --- CASE B: History Exists ---
    const bounds = new google.maps.LatLngBounds();
    
    // 1. Filter valid points
    // We filter out points that are too close to each other (jitter) to smooth the path
    const validPoints = [];
    let lastPt = null;
    
    data.forEach(pt => {
        const latLng = parseLatLng(pt);
        if (!latLng) return;

        if (!lastPt) {
            validPoints.push(latLng);
            lastPt = latLng;
        } else {
            // Only add if distance > 10 meters from last point
            const dist = google.maps.geometry.spherical.computeDistanceBetween(lastPt, latLng);
            if (dist > 10) {
                validPoints.push(latLng);
                lastPt = latLng;
            }
        }
        bounds.extend(latLng);
    });

    // 2. Draw Route using Directions API (Snap to Road)
    if (validPoints.length > 1) {
        drawRouteWithDirections(validPoints);
    } else if (validPoints.length === 1) {
        map.setCenter(validPoints[0]);
        map.setZoom(16);
    }

    // 3. Add Start/End Markers
    if (data.length > 0) {
        // Use raw data for markers to be exact with start/end times
        const startLoc = data[0];
        const endLoc = data[data.length - 1];
        addEndpointMarker(startLoc, "Start Point", false, device);
        addEndpointMarker(endLoc, "End Point (Latest)", true, device);
    }

    map.fitBounds(bounds);
}

/**
 * Uses Google Directions API to draw a path snapped to roads.
 * Handles the 23-waypoint limit by sampling points.
 */
function drawRouteWithDirections(points) {
    if (!directionsService || !directionsRenderer) {
        drawSimplePolyline(points);
        return;
    }

    const origin = points[0];
    const destination = points[points.length - 1];
    const waypoints = [];

    // Logic: Google Directions API allows max 25 waypoints (Origin + Dest + 23 intermediate)
    // We select up to 23 evenly distributed points from the middle of the array
    if (points.length > 2) {
        const maxIntermediate = 23;
        // Calculate step size to distribute points evenly
        const step = Math.max(1, Math.floor((points.length - 2) / maxIntermediate));
        
        for (let i = 1; i < points.length - 1; i += step) {
            if (waypoints.length < maxIntermediate) {
                waypoints.push({ location: points[i], stopover: false });
            }
        }
    }

    directionsService.route({
        origin: origin,
        destination: destination,
        waypoints: waypoints,
        travelMode: google.maps.TravelMode.DRIVING, // Snaps to roads
        optimizeWaypoints: false // Keep chronological order
    }, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            directionsRenderer.setDirections(result);
        } else {
            // Fallback if routing fails (e.g. quota exceeded, no road found)
            console.warn("Directions routing failed (" + status + "). Falling back to straight lines.");
            drawSimplePolyline(points);
        }
    });
}

function drawSimplePolyline(coordinates) {
    if (pathPolyline) pathPolyline.setMap(null);
    pathPolyline = new google.maps.Polyline({
        path: coordinates,
        geodesic: true,
        strokeColor: "#4361ee",
        strokeOpacity: 0.8,
        strokeWeight: 4
    });
    pathPolyline.setMap(map);
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
        // Start Point - Small Green Dot
        icon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: "#10b981",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "white",
        };
    }

    const marker = new google.maps.Marker({
        position: position,
        map: map,
        icon: icon,
        title: title,
        zIndex: isEnd ? 1000 : 100,
    });

    // Info Window
    let timeStr = 'N/A';
    if (loc.timestamp && typeof loc.timestamp.toDate === 'function') {
        timeStr = loc.timestamp.toDate().toLocaleTimeString();
    } else if (typeof loc.time === 'string') {
        const d = new Date(loc.time);
        timeStr = !isNaN(d) ? d.toLocaleTimeString() : loc.time;
    }

    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="text-align:center; color:black">
                <div style="font-weight:bold; color:#4361ee">${title}</div>
                <div style="font-size:12px; color:#666">${timeStr}</div>
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
            elements.timelineEmpty.style.display = 'flex';
            elements.timelineEmpty.classList.remove('hidden');
        }
        return;
    }
    if (elements.timelineEmpty) {
        elements.timelineEmpty.style.display = 'none';
        elements.timelineEmpty.classList.add('hidden');
    }
    
    const listWrapper = document.createElement('div');
    listWrapper.className = "p-4 space-y-0"; 

    // Reverse data to show latest first
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
                <div class="w-6 h-6 bg-primary-600 text-white text-[10px] font-bold rounded-full z-10 ring-4 ring-white dark:ring-gray-800 flex items-center justify-center">
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
                <button class="text-xs text-primary-600 mt-1 hover:underline" 
                    onclick="window.focusMapOnPoint(${lat}, ${lng})">
                    View on Map
                </button>
            </div>
        `;
        listWrapper.appendChild(item);
    });
    container.appendChild(listWrapper);
}

window.focusMapOnPoint = (lat, lng) => {
    if (map && !isNaN(lat) && !isNaN(lng)) {
        const pos = { lat, lng };
        map.panTo(pos);
        map.setZoom(18);
        new google.maps.Marker({
            position: pos,
            map: map,
            animation: google.maps.Animation.DROP
        });
    }
};