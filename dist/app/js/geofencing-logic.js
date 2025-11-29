// --- Trace'N Find Geofencing Logic ---
// This file handles all logic *specific* to geofencing.html.
// It assumes `app-shell.js` has already been loaded and has authenticated the user.

import { 
    fbDB,
    showToast,
    showModal,
    getDeviceIcon, 
    getDeviceColor,
    collection,
    doc,
    addDoc,
    onSnapshot,
    query,
    setDoc,
    deleteDoc,
    serverTimestamp,
    orderBy,
    sanitizeHTML,
    formatTimeAgo
} from '/app/js/app-shell.js';

// Import Google Map Styles
import { mapStyles } from '/public/js/map-tiles.js';

// --- Global State for this Page ---
let map = null;
// Geofence State
let geofences = [];
let fenceMarkers = {}; // Markers for the center of geofences
let fenceCircles = {}; // The visual circles

// Device State
let devices = [];
let deviceMarkers = {}; 
//  - Visualizing how the state map tracks device vs fence status
let deviceStates = new Map(); // Tracks { deviceId: { fenceId: 'inside' | 'outside' } } to prevent spamming alerts

let currentGeofenceId = null;
let isEditMode = false;
let geofenceListener = null; 
let deviceListener = null; 
let tempMarker = null; 

// --- DOM Elements ---
const elements = {
    // Map
    mapContainer: document.getElementById('map'),
    mapClickPrompt: document.getElementById('map-click-prompt'),
    
    // List
    geofenceList: document.getElementById('geofence-list'),
    geofenceListEmpty: document.getElementById('geofence-list-empty'),
    addGeofenceBtn: document.getElementById('add-geofence-btn'),
    
    // Modal
    formPanel: document.getElementById('geofence-form-panel'),
    panelTitle: document.getElementById('geofence-panel-title'),
    modalCancelBtn: document.getElementById('geofence-modal-cancel'),
    modalSaveBtn: document.getElementById('geofence-modal-save'),
    modalSpinner: document.querySelector('#geofence-modal-save .button-spinner'),
    modalSaveText: document.querySelector('#geofence-modal-save .button-text'),
    
    // Form
    form: document.getElementById('geofence-form'),
    formLat: document.getElementById('geofence-lat'),
    formLng: document.getElementById('geofence-lng'),
    formName: document.getElementById('geofence-name'),
    formAddress: document.getElementById('geofence-address'),
    formRadius: document.getElementById('geofence-radius'),
    formAlertEntry: document.getElementById('alert-entry'),
    formAlertExit: document.getElementById('alert-exit')
};

// --- Initialization ---

function waitForAuth(callback) {
    const check = () => {
        if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
            console.log("Geofencing: Auth, libraries (Google Maps), and styles are ready.");
            callback(window.currentUserId);
        } else if (!window.currentUserId) {
            requestAnimationFrame(check);
        } else if (!window.librariesLoaded) {
            window.addEventListener('librariesLoaded', () => check(), { once: true });
        } else {
            requestAnimationFrame(check);
        }
    };
    
    if (window.currentUserId && window.librariesLoaded && typeof google !== 'undefined' && mapStyles) {
        callback(window.currentUserId);
    } else {
        requestAnimationFrame(check);
    }
}

waitForAuth((userId) => {
    initMap();
    setupEventListeners(userId);
    listenForGeofences(userId);
    listenForDevices(userId); 
});

/**
 * Initializes the Google Map.
 */
function initMap() {
    if (!elements.mapContainer) return;
    
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const styles = (currentTheme === 'dark') ? mapStyles.dark : mapStyles.light;

    map = new google.maps.Map(elements.mapContainer, {
        center: { lat: 2.9436, lng: 101.7949 }, // Default: GMI, Kajang
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        styles: styles
    });
    
    // Map click listener for adding new geofences
    map.addListener("click", onMapClick);

    // Listen for theme changes to update map style
    window.addEventListener('themeChanged', (e) => {
        if (map && mapStyles) {
            const newStyles = (e.detail.theme === 'dark') ? mapStyles.dark : mapStyles.light;
            map.setOptions({ styles: newStyles });
        }
    });
}

/**
 * Attaches all event listeners for the page.
 */
function setupEventListeners(userId) {
    // Modal controls
    elements.addGeofenceBtn.addEventListener('click', () => openGeofenceModal(null));
    elements.modalCancelBtn.addEventListener('click', closeGeofenceModal);
    
    // Form submission
    elements.form.addEventListener('submit', (e) => handleFormSubmit(e, userId));

    // Event delegation for list item clicks
    elements.geofenceList.addEventListener('click', (e) => {
        const item = e.target.closest('.geofence-item');
        const editBtn = e.target.closest('.action-btn-sm.edit');
        const deleteBtn = e.target.closest('.action-btn-sm.delete');

        if (deleteBtn) {
            e.stopPropagation(); // Prevent item click
            handleDelete(deleteBtn.dataset.id);
        } else if (editBtn) {
            e.stopPropagation(); // Prevent item click
            const fence = geofences.find(f => f.id === editBtn.dataset.id);
            openGeofenceModal(fence);
        } else if (item) {
            selectGeofence(item.dataset.id);
        }
    });
}

// --- Firestore Data ---

function listenForGeofences(userId) {
    if (geofenceListener) geofenceListener(); 
    
    const geofencesRef = collection(fbDB, 'user_data', userId, 'geofences');
    const q = query(geofencesRef, orderBy('name', 'asc'));

    geofenceListener = onSnapshot(q, (snapshot) => {
        geofences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderGeofenceList();
        renderGeofencesOnMap();
        checkGeofenceViolations(); // Re-check whenever geofences change
    }, (error) => {
        console.error("Error listening for geofences:", error);
        showToast('Error', 'Could not load geofences.', 'error');
    });
}

// Listen for devices to show them on the map AND check boundaries
function listenForDevices(userId) {
    if (deviceListener) deviceListener();

    const devicesRef = collection(fbDB, 'user_data', userId, 'devices');
    const q = query(devicesRef); // Get all devices

    deviceListener = onSnapshot(q, (snapshot) => {
        devices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDevicesOnMap();
        checkGeofenceViolations(); // Check boundaries whenever devices move
    }, (error) => {
        console.error("Error listening for devices in geofencing:", error);
    });
}

// --- Geofencing Logic (Alerts) ---

function checkGeofenceViolations() {
    // Need Google Maps Geometry library and data to proceed
    if (!map || !google.maps.geometry || devices.length === 0 || geofences.length === 0) return;

    devices.forEach(device => {
        // Skip devices without location
        if (!device.location) return;
        
        let lat = device.location.lat ?? device.location.latitude;
        let lng = device.location.lng ?? device.location.longitude;
        if (lat === undefined || lng === undefined) return;

        const devicePos = new google.maps.LatLng(parseFloat(lat), parseFloat(lng));

        // Initialize tracking map for this device if needed
        if (!deviceStates.has(device.id)) {
            deviceStates.set(device.id, new Map());
        }
        const deviceFenceStates = deviceStates.get(device.id);

        geofences.forEach(fence => {
            const fencePos = new google.maps.LatLng(fence.lat, fence.lng);
            
            // Calculate distance in meters
            const distance = google.maps.geometry.spherical.computeDistanceBetween(devicePos, fencePos);
            const isInside = distance <= fence.radius;
            const currentState = isInside ? 'inside' : 'outside';
            
            // Get previous state to compare
            const prevState = deviceFenceStates.get(fence.id);

            // Initial state setting (don't alert on first load to prevent spamming notifications on refresh)
            if (!prevState) {
                deviceFenceStates.set(fence.id, currentState);
                return;
            }

            // If state changed, trigger alert logic
            if (currentState !== prevState) {
                // Update state immediately to prevent duplicate alerts
                deviceFenceStates.set(fence.id, currentState);
                
                // Case 1: Device Exited Zone
                if (currentState === 'outside' && fence.alertOnExit) {
                    createGeofenceNotification(
                        'Geofence Alert', 
                        `${device.name} has left the safe zone: ${fence.name}`, 
                        'geofence-exit',
                        device.id // Pass device ID to log activity
                    );
                } 
                // Case 2: Device Entered Zone
                else if (currentState === 'inside' && fence.alertOnEntry) {
                    createGeofenceNotification(
                        'Geofence Entry', 
                        `${device.name} has arrived at: ${fence.name}`, 
                        'geofence-enter',
                        device.id // Pass device ID to log activity
                    );
                }
            }
        });
    });
}

async function createGeofenceNotification(title, message, type, deviceId) {
    const userId = window.currentUserId;
    if (!userId) return;

    try {
        // 1. Create Global Notification (for Dashboard/Bell)
        const notifRef = collection(fbDB, 'user_data', userId, 'notifications');
        await addDoc(notifRef, {
            title: title,
            message: message,
            type: type, // 'geofence-enter' or 'geofence-exit'
            read: false,
            timestamp: serverTimestamp()
        });
        
        // 2. Create Device-Specific Activity Log (for Device Details page)
        if (deviceId) {
            const activityRef = collection(fbDB, 'user_data', userId, 'devices', deviceId, 'activity');
            await addDoc(activityRef, {
                type: type === 'geofence-exit' ? 'warning' : 'info',
                message: message,
                timestamp: serverTimestamp()
            });
        }
        
        // Also show a toast for immediate feedback while on the page
        const toastType = type === 'geofence-exit' ? 'warning' : 'success';
        showToast(title, message, toastType);
        
    } catch (error) {
        console.error("Error creating geofence notification:", error);
    }
}

// --- UI Rendering ---

function renderGeofenceList() {
    elements.geofenceList.innerHTML = '';
    
    if (!geofences || geofences.length === 0) {
        elements.geofenceListEmpty.style.display = 'block';
        return;
    }
    
    elements.geofenceListEmpty.style.display = 'none';
    
    geofences.forEach((fence, index) => {
        const item = document.createElement('div');
        item.className = 'geofence-item';
        if (fence.id === currentGeofenceId) {
            item.classList.add('active');
        }
        item.setAttribute('data-id', fence.id);
        item.style.animationDelay = `${index * 50}ms`; 
        
        const icon = fence.icon || 'bi-pin-map-fill';
        const radius = fence.radius ? `${fence.radius}m` : 'N/A';
        const alerts = [];
        if (fence.alertOnEntry) alerts.push('Entry');
        if (fence.alertOnExit) alerts.push('Exit');
        const alertText = alerts.length > 0 ? `Alerts: ${alerts.join(', ')}` : 'No Alerts';

        item.innerHTML = `
            <div class="geofence-item-icon">
                <i class="bi ${icon}"></i>
            </div>
            <div class="geofence-item-info">
                <div class="geofence-item-name">${sanitizeHTML(fence.name)}</div>
                <div class="geofence-item-details">${radius} &bull; ${alertText}</div>
            </div>
            <div class="geofence-item-actions">
                <button class="action-btn-sm edit" data-id="${fence.id}" aria-label="Edit geofence">
                    <i class="bi bi-pencil-fill"></i>
                </button>
                <button class="action-btn-sm delete" data-id="${fence.id}" aria-label="Delete geofence">
                    <i class="bi bi-trash-fill"></i>
                </button>
            </div>
        `;
        elements.geofenceList.appendChild(item);
    });
}

// Render Geofences (Circles + Center Markers)
function renderGeofencesOnMap() {
    if (!map) return;

    // Clear existing
    Object.values(fenceMarkers).forEach(m => m.setMap(null));
    Object.values(fenceCircles).forEach(c => c.setMap(null));
    fenceMarkers = {};
    fenceCircles = {};

    const fenceColor = '#4361ee'; 
    
    geofences.forEach(fence => {
        const position = { lat: fence.lat, lng: fence.lng };
        
        // Center Marker
        const marker = new google.maps.Marker({
            position: position,
            map: map,
            title: fence.name,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 5,
                fillColor: fenceColor,
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "white",
            },
        });

        // InfoWindow
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="color:black">
                    <b>${sanitizeHTML(fence.name)}</b><br>
                    Geofence Center<br>
                    Radius: ${fence.radius}m
                </div>
            `
        });
        
        marker.addListener('click', () => {
            infoWindow.open(map, marker);
            selectGeofence(fence.id);
        });

        fenceMarkers[fence.id] = marker;

        // Circle
        const circle = new google.maps.Circle({
            strokeColor: fenceColor,
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: fenceColor,
            fillOpacity: 0.2, // Lighter fill to see devices inside
            map: map,
            center: position,
            radius: fence.radius
        });
        
        fenceCircles[fence.id] = circle;
    });
}

// Render Devices as Icons on the Map
function renderDevicesOnMap() {
    if (!map) return;

    // Clear existing device markers
    Object.values(deviceMarkers).forEach(m => m.setMap(null));
    deviceMarkers = {};

    devices.forEach(device => {
        let lat, lng;
        if (device.location) {
            lat = device.location.lat ?? device.location.latitude;
            lng = device.location.lng ?? device.location.longitude;
        }

        if (lat === undefined || lng === undefined) return;

        const position = { lat: parseFloat(lat), lng: parseFloat(lng) };
        
        // Create a simple marker for the device
        const marker = new google.maps.Marker({
            position: position,
            map: map,
            title: `Device: ${device.name}`,
            // Optimization: Standard red pin makes it easy to see devices vs blue geofences
        });

        // InfoWindow
        const lastSeen = device.lastSeen ? formatTimeAgo(device.lastSeen) : 'Unknown';
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="color:black">
                    <b>${sanitizeHTML(device.name)}</b><br>
                    <span style="color:${getDeviceColor(device.status)}">${device.status}</span><br>
                    Last Seen: ${lastSeen}
                </div>
            `
        });

        marker.addListener('click', () => {
            infoWindow.open(map, marker);
        });

        deviceMarkers[device.id] = marker;
    });
}

// --- Interactivity ---

function onMapClick(e) {
    if (elements.formPanel.classList.contains('hidden')) return;
    
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    
    elements.formLat.value = lat;
    elements.formLng.value = lng;
    elements.formAddress.value = `Coords: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    
    if (tempMarker) {
        tempMarker.setPosition(e.latLng);
    } else {
        tempMarker = new google.maps.Marker({
            position: e.latLng,
            map: map,
            draggable: true,
            title: "New Geofence Location"
        });
        
        tempMarker.addListener('dragend', (evt) => {
            const lat = evt.latLng.lat();
            const lng = evt.latLng.lng();
            elements.formLat.value = lat;
            elements.formLng.value = lng;
            elements.formAddress.value = `Coords: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        });
    }
    
    elements.formAddress.style.transition = 'none';
    elements.formAddress.style.backgroundColor = 'rgba(var(--color-primary-rgb), 0.2)';
    setTimeout(() => {
        elements.formAddress.style.transition = 'background-color 0.5s ease';
        elements.formAddress.style.backgroundColor = '';
    }, 100);
}

function openGeofenceModal(fence) {
    elements.form.reset(); 
    elements.mapClickPrompt.classList.remove('hidden'); 

    elements.geofenceList.classList.add('hidden');
    elements.geofenceListEmpty.style.display = 'none';
    elements.addGeofenceBtn.classList.add('hidden');
    elements.formPanel.classList.remove('hidden');

    if (fence) {
        isEditMode = true;
        currentGeofenceId = fence.id;
        elements.panelTitle.textContent = 'Edit Geofence';
        elements.modalSaveText.textContent = 'Save Changes';

        elements.formName.value = fence.name;
        elements.formAddress.value = fence.address || `Coords: ${fence.lat}, ${fence.lng}`;
        elements.formLat.value = fence.lat;
        elements.formLng.value = fence.lng;
        elements.formRadius.value = fence.radius;
        elements.formAlertEntry.checked = fence.alertOnEntry;
        elements.formAlertExit.checked = fence.alertOnExit;

        const position = { lat: fence.lat, lng: fence.lng };
        
        if (tempMarker) tempMarker.setMap(null);
        
        tempMarker = new google.maps.Marker({
            position: position,
            map: map,
            draggable: true
        });

        tempMarker.addListener('dragend', (evt) => {
            const lat = evt.latLng.lat();
            const lng = evt.latLng.lng();
            elements.formLat.value = lat;
            elements.formLng.value = lng;
            elements.formAddress.value = `Coords: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        });

        map.panTo(position);
        map.setZoom(15);

    } else {
        isEditMode = false;
        currentGeofenceId = null;
        elements.panelTitle.textContent = 'Add New Geofence';
        elements.modalSaveText.textContent = 'Save Geofence';
    }
}

function closeGeofenceModal() {
    elements.formPanel.classList.add('hidden');
    elements.geofenceList.classList.remove('hidden');
    elements.addGeofenceBtn.classList.remove('hidden');
    elements.panelTitle.textContent = 'My Geofences'; 

    if (geofences.length === 0) {
        elements.geofenceListEmpty.style.display = 'block';
    }
    
    elements.mapClickPrompt.classList.add('hidden');
    
    if (tempMarker) {
        tempMarker.setMap(null);
        tempMarker = null;
    }
    elements.form.reset();
}

async function handleFormSubmit(e, userId) {
    e.preventDefault();
    
    if (!elements.formLat.value || !elements.formLng.value) {
        showToast('Location Required', 'Please click on the map to set a location.', 'warning');
        return;
    }
    
    setLoadingState(true);
    
    const geofenceData = {
        name: elements.formName.value,
        address: elements.formAddress.value,
        lat: parseFloat(elements.formLat.value),
        lng: parseFloat(elements.formLng.value),
        radius: parseInt(elements.formRadius.value, 10),
        alertOnEntry: elements.formAlertEntry.checked,
        alertOnExit: elements.formAlertExit.checked,
        icon: 'bi-pin-map-fill',
        updatedAt: serverTimestamp()
    };

    try {
        const geofencesRef = collection(fbDB, 'user_data', userId, 'geofences');
        
        if (isEditMode) {
            const docRef = doc(geofencesRef, currentGeofenceId);
            await setDoc(docRef, geofenceData, { merge: true });
            showToast('Success', `Geofence "${sanitizeHTML(geofenceData.name)}" has been updated.`, 'success');
        } else {
            geofenceData.createdAt = serverTimestamp();
            await addDoc(geofencesRef, geofenceData);
            showToast('Success', `Geofence "${sanitizeHTML(geofenceData.name)}" has been created.`, 'success');
        }
        
        closeGeofenceModal();
        
    } catch (error) {
        console.error("Error saving geofence:", error);
        showToast('Error', 'Could not save geofence. Please try again.', 'error');
    } finally {
        setLoadingState(false);
    }
}

function handleDelete(id) {
    const fence = geofences.find(f => f.id === id);
    if (!fence) return;

    showModal(
        'Delete Geofence?', 
        `Are you sure you want to delete <strong>${sanitizeHTML(fence.name)}</strong>? This action cannot be undone.`, 
        'danger', 
        async () => {
            try {
                const docRef = doc(fbDB, 'user_data', window.currentUserId, 'geofences', id);
                await deleteDoc(docRef);
                showToast('Deleted', `Geofence "${sanitizeHTML(fence.name)}" has been deleted.`, 'success');
            } catch (error) {
                console.error("Error deleting geofence:", error);
                showToast('Error', 'Could not delete geofence.', 'error');
            }
        },
        null, 
        { isHTML: true } 
    );
}

function selectGeofence(id) {
    const fence = geofences.find(f => f.id === id);
    if (!fence) return;

    currentGeofenceId = id; 
    
    map.panTo({ lat: fence.lat, lng: fence.lng });
    map.setZoom(16); 
    
    document.querySelectorAll('.geofence-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === id);
    });
    
    const marker = fenceMarkers[id];
    if (marker) {
        Object.values(fenceMarkers).forEach(m => m.setAnimation(null));
        marker.setAnimation(google.maps.Animation.BOUNCE);
        setTimeout(() => marker.setAnimation(null), 2000);
    }
}

function setLoadingState(isLoading) {
    if (isLoading) {
        elements.modalSaveBtn.disabled = true;
        elements.modalSaveText.classList.add('hidden');
        elements.modalSpinner.classList.remove('hidden');
    } else {
        elements.modalSaveBtn.disabled = false;
        elements.modalSaveText.classList.remove('hidden');
        elements.modalSpinner.classList.add('hidden');
    }
}