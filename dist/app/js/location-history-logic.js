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
    sanitizeHTML
} from '/app/js/app-shell.js';

// Import Google Map Styles
import { mapStyles } from '/public/js/map-tiles.js';

// --- Global State ---
let map = null;
let pathPolyline = null; // Store the Google Maps Polyline
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
            
        // Only update if different to avoid UI flickering
        if (dateInput.value !== localDate) {
            dateInput.value = localDate;
            // Also update the internal element reference if it exists
            if (elements.dateFilter) elements.dateFilter.value = localDate;
            console.log("Date enforced to Today:", localDate);
        }
        return localDate;
    }
    return null;
}

// 1. Run immediately on script load
setDateToToday();

// 2. Run whenever the page is shown (fixes Back/Forward cache issues)
window.addEventListener('pageshow', setDateToToday);

function waitForAuth(callback) {
    const check = () => {
        // Check for Google Maps global instead of Leaflet
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
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

waitForAuth((userId) => {
    console.log("INIT: Auth ready. User:", userId);

    initMap();
    setupEventListeners(userId);

    // FIX: The "Enforcer" Logic
    // We check and reset the date every 100ms for 1 second.
    // This beats the browser's auto-restore feature which might happen slightly after load.
    let attempts = 0;
    const dateEnforcer = setInterval(() => {
        setDateToToday();
        attempts++;
        if (attempts >= 10) clearInterval(dateEnforcer); // Stop after 1 second
    }, 100);

    // 3. Load Devices (This will eventually call loadHistoryData, using the date we just set)
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

// --- Load Devices ---
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
        
        // Automatically load data for the first device
        if (firstDeviceId && elements.deviceFilter) {
            elements.deviceFilter.value = firstDeviceId;
            loadHistoryData(userId);
        }

    } catch (e) {
        console.error("Error loading devices:", e);
        showToast('Error', 'Could not load devices.', 'error');
    }
}

// --- Initialize Map ---
function initMap() {
    if (!elements.mapContainer) return;

    const currentTheme = document.documentElement.getAttribute('data-theme');
    const styles = (currentTheme === 'dark') ? mapStyles.dark : mapStyles.light;

    map = new google.maps.Map(elements.mapContainer, {
        center: { lat: 2.9436, lng: 101.7949 }, // Default: GMI, Kajang
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        styles: styles,
        mapTypeId: 'roadmap'
    });
}

// --- Load History Data ---
async function loadHistoryData(userId) {
    const deviceId = elements.deviceFilter.value;
    const dateString = elements.dateFilter.value; 

    if (!deviceId || !dateString) return;

    // --- FIX: Update Header Text ---
    if (elements.historyTitleHeader) {
        // Get today's date in YYYY-MM-DD format (local time)
        const today = new Date();
        const localToday = new Date(today.getTime() - (today.getTimezoneOffset() * 60000))
            .toISOString()
            .split('T')[0];

        if (dateString === localToday) {
            elements.historyTitleHeader.textContent = "History for Today";
        } else {
            // Format readable date (e.g., "Nov 19, 2025")
            const dateObj = new Date(dateString);
            const readableDate = dateObj.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                timeZone: 'UTC' // Important: Treat the input date as UTC to avoid day shifting
            });
            elements.historyTitleHeader.textContent = `History of ${readableDate}`;
        }
    }

    try {
        const docRef = doc(fbDB, 'user_data', userId, 'devices', deviceId, 'location_history', dateString);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            console.log("No history document found.");
            updateStats(0, 0, "0h 0m"); // Reset stats
            renderMapMarkers([], deviceId); 
            renderTimeline([]);
            return;
        }

        const data = docSnap.data();
        // Support multiple field names for compatibility
        const historyPoints = data.route || data.points || data.locations || data.history || [];

        console.log(`Found ${historyPoints.length} history points.`);
        
        // 1. Calculate Distance
        const distance = calculateTotalDistance(historyPoints);
        
        // 2. Calculate Duration
        const duration = calculateDuration(historyPoints);
        
        // 3. Update UI
        updateStats(historyPoints.length, distance, duration);
        renderMapMarkers(historyPoints, deviceId);
        renderTimeline(historyPoints);

    } catch (error) {
        console.error("Error loading history:", error);
        showToast('Error', 'Could not load history.', 'error');
    }
}

// --- Update Stats UI ---
function updateStats(points, distance, duration) {
    if(elements.statTotalPoints) elements.statTotalPoints.textContent = points;
    if(elements.statTotalDistance) elements.statTotalDistance.textContent = `${distance.toFixed(2)} km`;
    
    if(elements.statDuration && duration) {
        elements.statDuration.textContent = duration;
    }
}

// --- Render Map Logic ---
function renderMapMarkers(data, currentDeviceId) {
    if (!map) return;

    // 1. Clear previous layers
    if (pathPolyline) {
        pathPolyline.setMap(null);
        pathPolyline = null;
    }
    markers.forEach(m => m.setMap(null));
    markers = [];

    // 2. Get Device Info
    const device = deviceCache[currentDeviceId];
    if (!device) return;

    // --- CASE A: No History -> Show Current Device Location ---
    if (!data || data.length === 0) {
        if (device.location) {
            // Robust coordinate parsing
            let lat = device.location.lat;
            let lng = device.location.lng;
            if (lat === undefined) lat = device.location.latitude;
            if (lng === undefined) lng = device.location.longitude;
            
            lat = parseFloat(lat);
            lng = parseFloat(lng);

            if (!isNaN(lat) && !isNaN(lng)) {
                const position = { lat, lng };
                const marker = new google.maps.Marker({
                    position: position,
                    map: map,
                    title: "Current Location",
                    // Default Google Maps red pin for current location
                });
                
                const infoWindow = new google.maps.InfoWindow({
                    content: `<b>${sanitizeHTML(device.name)}</b><br>Current Location<br><small>No history for this date</small>`
                });
                
                marker.addListener('click', () => infoWindow.open(map, marker));
                
                map.setCenter(position);
                map.setZoom(15);
                markers.push(marker);
            }
        }
        return;
    }

    // --- CASE B: History Exists -> Draw Path ---
    const pathCoordinates = [];
    const bounds = new google.maps.LatLngBounds();
    
    data.forEach((loc, index) => {
        // Robust parsing for history points
        let lat = loc.lat;
        let lng = loc.lng;
        if (lat === undefined) lat = loc.latitude;
        if (lng === undefined) lng = loc.longitude;
        
        lat = parseFloat(lat);
        lng = parseFloat(lng);

        if (isNaN(lat) || isNaN(lng)) return; // Skip bad points

        const position = { lat, lng };
        pathCoordinates.push(position);
        bounds.extend(position);

        // Add markers only for Start and End to avoid clutter
        const isStart = index === 0;
        const isEnd = index === data.length - 1;

        if (isStart || isEnd) {
            let icon = null;
            let title = "";

            if (isEnd) {
                // Latest Point (End) - Use Custom Animated Icon
                title = "End Point (Latest)";
                
                // Colors
                const colorMap = { online: "#10b981", found: "#10b981", offline: "#ef4444", lost: "#ef4444", warning: "#f59e0b" };
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
                
                icon = {
                    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgIcon),
                    scaledSize: new google.maps.Size(48, 48),
                    anchor: new google.maps.Point(24, 24)
                };
                
            } else {
                // Start Point - Green Dot
                title = "Start Point";
                icon = {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 5,
                    fillColor: "#10b981", // Green
                    fillOpacity: 1,
                    strokeWeight: 1,
                    strokeColor: "white",
                };
            }

            const marker = new google.maps.Marker({
                position: position,
                map: map,
                icon: icon,
                title: title,
                zIndex: isEnd ? 1000 : 100,
                optimized: false
            });
            
            // Format Time
            let timeStr = 'N/A';
            if (loc.timestamp && typeof loc.timestamp.toDate === 'function') {
                timeStr = loc.timestamp.toDate().toLocaleTimeString();
            } else if (loc.time && typeof loc.time.toDate === 'function') {
                timeStr = loc.time.toDate().toLocaleTimeString();
            } else if (typeof loc.time === 'string') {
                const d = new Date(loc.time);
                timeStr = !isNaN(d) ? d.toLocaleTimeString() : loc.time;
            }

            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div style="text-align:center; color:black">
                        <div style="font-weight:bold; color:#4361ee">${isEnd ? "End" : "Start"} Point</div>
                        <div style="font-size:12px; color:#666">${timeStr}</div>
                    </div>
                `
            });
            
            marker.addListener('click', () => infoWindow.open(map, marker));
            markers.push(marker);
        }
    });

    // Draw the blue line connecting points
    if (pathCoordinates.length > 0) {
        pathPolyline = new google.maps.Polyline({
            path: pathCoordinates,
            geodesic: true,
            strokeColor: "#4361ee",
            strokeOpacity: 1.0,
            strokeWeight: 4
        });
        pathPolyline.setMap(map);
        
        // Zoom map to fit the path
        map.fitBounds(bounds);
    }
}

// Helper: Calculate distance between points in km
function calculateTotalDistance(points) {
    if (!points || points.length < 2) return 0;
    let totalDist = 0;
    
    // Only works if google maps geometry library is loaded
    if (typeof google !== 'undefined' && google.maps.geometry) {
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i+1];
            
            const lat1 = p1.lat || p1.latitude;
            const lng1 = p1.lng || p1.longitude;
            const lat2 = p2.lat || p2.latitude;
            const lng2 = p2.lng || p2.longitude;
            
            const point1 = new google.maps.LatLng(lat1, lng1);
            const point2 = new google.maps.LatLng(lat2, lng2);
            
            totalDist += google.maps.geometry.spherical.computeDistanceBetween(point1, point2);
        }
    }
    
    return totalDist / 1000; // Convert meters to km
}

// --- Render Timeline ---
function renderTimeline(data) {
    const container = elements.timelineList;
    const emptyState = elements.timelineEmpty;

    if (!container) return;

    container.innerHTML = ''; // Clear "No location history" message

    if (!data || data.length === 0) {
        // FIX 1: Show the overlay if data is empty
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.classList.remove('hidden');
        }
        return;
    }

    if (emptyState) {
        emptyState.style.display = 'none';
        emptyState.classList.add('hidden');
    }
    
    // Create a wrapper for the list
    const listWrapper = document.createElement('div');
    listWrapper.className = "p-4 space-y-0"; // Tailwind classes

    // We reverse the data to show the LATEST time at the top
    const reversedData = [...data].reverse();

    reversedData.forEach((point, index) => {
        // Calculate Point Number
        const pointNumber = data.length - index;

        // 2. Calculate Original Index
        const originalIndex = (data.length - 1) - index;

        // Parse Time
        let timeDisplay = 'N/A';
        if (point.time && typeof point.time.toDate === 'function') {
            timeDisplay = point.time.toDate().toLocaleTimeString();
        } else if (typeof point.time === 'string') {
            if (point.time.includes('at')) {
                const parts = point.time.split('at');
                if (parts.length > 1) {
                    timeDisplay = parts[1].replace('UTC+8', '').trim();
                } else {
                    timeDisplay = point.time;
                }
            } else {
                timeDisplay = point.time;
            }
        } else if (point.timestamp && typeof point.timestamp.toDate === 'function') {
            timeDisplay = point.timestamp.toDate().toLocaleTimeString();
        }

        const item = document.createElement('div');
        // Styling for timeline item
        item.className = "flex gap-4 pb-4 relative";
        
        // Vertical line logic
        const isLast = index === reversedData.length - 1;
        const lineClass = isLast ? "" : "h-full";
        
        item.innerHTML = `
            <div class="flex flex-col items-center relative">
                <div class="w-6 h-6 bg-primary-600 text-white text-[10px] font-bold rounded-full z-10 ring-4 ring-white dark:ring-gray-800 flex items-center justify-center">
                    ${pointNumber}
                </div>
                <div class="w-0.5 bg-gray-200 dark:bg-gray-700 absolute top-3 ${lineClass}" style="height: calc(100% + 1rem);"></div>
            </div>
            
            <div class="flex-1 pb-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div class="flex justify-between items-center">
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">
                        ${timeDisplay}
                    </p>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                    ${parseFloat(point.lat || point.latitude).toFixed(5)}, ${parseFloat(point.lng || point.longitude).toFixed(5)}
                </p>
                <button class="text-xs text-primary-600 mt-1 hover:underline" 
                    onclick="window.focusMapOnPoint(${parseFloat(point.lat || point.latitude)}, ${parseFloat(point.lng || point.longitude)})">
                    View on Map
                </button>
            </div>
        `;
        listWrapper.appendChild(item);
    });

    container.appendChild(listWrapper);
}

// --- Duration Calculation Helper ---
function calculateDuration(points) {
    if (!points || points.length < 2) return "0h 0m";

    // Get Start and End times
    // Assuming points are ordered chronologically (Oldest -> Newest)
    const startPoint = points[0];
    const endPoint = points[points.length - 1];

    const startDate = parseDateHelper(startPoint);
    const endDate = parseDateHelper(endPoint);

    if (!startDate || !endDate) return "N/A";

    // Calculate difference in milliseconds
    const diffMs = Math.abs(endDate - startDate);
    
    // Convert to hours and minutes
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

// Helper to robustly parse your date strings or timestamps
function parseDateHelper(point) {
    if (!point) return null;

    // 1. Firestore Timestamp object
    if (point.timestamp && typeof point.timestamp.toDate === 'function') {
        return point.timestamp.toDate();
    }
    // 2. Also check 'time' property if it's a Timestamp
    if (point.time && typeof point.time.toDate === 'function') {
        return point.time.toDate();
    }

    // 3. String Format "November 20, 2025 at 12:03:28 AM UTC+8"
    if (typeof point.time === 'string') {
        // Remove 'at ' and 'UTC+8' to make it standard for JavaScript
        // JS Date() handles "November 20, 2025 12:03:28 AM" very well
        let cleanerString = point.time.replace('at', '').replace('UTC+8', '').trim();
        const d = new Date(cleanerString);
        if (!isNaN(d)) return d;
    }

    return null;
}

// Helper: Focus map on a specific point
window.focusMapOnPoint = (lat, lng) => {
    if (map && !isNaN(lat) && !isNaN(lng)) {
        const pos = { lat, lng };
        map.panTo(pos);
        map.setZoom(18);
        
        // Optional: Add a temporary bouncing marker
        const tempMarker = new google.maps.Marker({
            position: pos,
            map: map,
            animation: google.maps.Animation.DROP
        });
        setTimeout(() => tempMarker.setMap(null), 3000);
    }
};