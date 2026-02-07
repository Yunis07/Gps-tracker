// Import Firebase modules (using your config for v12.9.0)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getDatabase, ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-analytics.js";

// Your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyCeZTrOMHaOPXla7H_YB9IvUrPASFAjPQw",
    authDomain: "real-07.firebaseapp.com",
    databaseURL: "https://real-07-default-rtdb.firebaseio.com",
    projectId: "real-07",
    storageBucket: "real-07.firebasestorage.app",
    messagingSenderId: "975359536334",
    appId: "1:975359536334:web:0f5bd55c816e6fec08349f",
    measurementId: "G-927MV64R4S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const database = getDatabase(app);

// Global variables
let roomCode = null;
let myId = Math.random().toString(36).substr(2, 9); // Unique ID for this device
let map;
let markers = {}; // Object to hold markers for up to 3 devices
let polylines = {}; // Object to hold polylines for routes between devices
let destination = null; // For offline destination path
let offlineLayer = null; // For offline tiles
let watchId = null; // To stop GPS tracking

// Initialize map with offline support
function initMap() {
    map = L.map('map').setView([0, 0], 2);
    
    // Online tile layer (fallback)
    const onlineTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    });
    
    // Offline tile layer (using local storage)
    offlineLayer = L.tileLayer.offline('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        subdomains: 'abc',
        minZoom: 10,
        maxZoom: 16,
        crossOrigin: true
    });
    
    // Add layers (offline takes priority if tiles are downloaded)
    map.addLayer(offlineLayer);
    map.addLayer(onlineTiles);
    
    // Register PWA service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(() => {
            console.log('Service Worker registered');
        });
    }
    
    // Check online/offline status
    updateOfflineStatus();
    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
}

// Update offline status
function updateOfflineStatus() {
    const status = navigator.onLine ? 'Online' : 'Offline';
    document.getElementById('offline-status').innerText = `Offline Status: ${status}`;
}

// Join a room
function joinRoom() {
    roomCode = document.getElementById('code').value.trim();
    if (!roomCode) return alert('Please enter a shared code!');
    
    // Check if room is full (more than 3 devices)
    onValue(ref(database, roomCode + '/locations'), (snapshot) => {
        const locations = snapshot.val() || {};
        const deviceCount = Object.keys(locations).length;
        if (deviceCount >= 3) {
            alert('Room is full (max 3 devices). Try a different code.');
            return;
        }
        document.getElementById('status').innerText = `Joined room: ${roomCode}. Sharing GPS and routes...`;
        initMap();
        startTracking();
    }, { onlyOnce: true });
}

// Start GPS tracking and listening
function startTracking() {
    if (!navigator.geolocation) return alert('Geolocation is not supported by your browser.');
    
    // Watch position and send to Firebase (if online)
    watchId = navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        // Send location to Firebase if online
        if (navigator.onLine) {
            set(ref(database, roomCode + '/locations/' + myId), { lat, lng, timestamp: Date.now() });
        }
        
        // Update local marker and path
        updateLocalPosition(lat, lng);
    }, (error) => {
        console.error('GPS Error:', error);
        alert('GPS error: ' + error.message);
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 });
    
    // Listen for updates from all devices in the room (if online)
    if (navigator.onLine) {
        onValue(ref(database, roomCode + '/locations'), (snapshot) => {
            const locations = snapshot.val() || {};
            const keys = Object.keys(locations);
            const deviceList = document.getElementById('devices');
            deviceList.innerHTML = ''; // Clear list
            
            keys.forEach((key, index) => {
                const loc = locations[key];
                const deviceName = `Device ${index + 1} (${key === myId ? 'You' : 'Other'})`;
                
                // Update or create marker
                if (!markers[key]) {
                    const colors = ['red', 'blue', 'green']; // Up to 3 colors
                    markers[key] = L.marker([loc.lat, loc.lng], { icon: L.icon({ iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${colors[index] || 'grey'}.png`, shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup(deviceName);
                } else {
                    markers[key].setLatLng([loc.lat, loc.lng]);
                }
                
                // Add to device list
                const li = document.createElement('li');
                li.textContent = `${deviceName}: Lat ${loc.lat.toFixed(4)}, Lng ${loc.lng.toFixed(4)}`;
                deviceList.appendChild(li);
            });
            
            // Center map on the first device if available
            if (keys.length > 0) {
                const firstLoc = locations[keys[0]];
                map.setView([firstLoc.lat, firstLoc.lng], 15);
            }
            
            // Remove markers for disconnected devices
            Object.keys(markers).forEach(key => {
                if (!keys.includes(key)) {
                    map.removeLayer(markers[key]);
                    delete markers[key];
                }
            });
            
            // Calculate and draw routes between all pairs of devices (if 2+ devices and online)
            if (navigator.onLine) updateRoutes(locations, keys);
        });
    }
}

// Update local position and path (offline)
function updateLocalPosition(lat, lng) {
    if (!markers[myId]) {
        markers[myId] = L.marker([lat, lng], { icon: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup('You');
    } else {
        markers[myId].setLatLng([lat, lng]);
    }
    
    // Draw straight-line path to destination if set (offline)
    if (destination) {
        const line = turf.lineString([[lng, lat], [destination.lng, destination.lat]]);
        const distance = turf.length(line, { units: 'kilometers' });
        
        if (polylines['destination']) map.removeLayer(polylines['destination']);
        polylines['destination'] = L.polyline([[lat, lng], [destination.lat, destination.lng]], { color: 'blue', weight: 4, opacity: 0.7 }).addTo(map).bindPopup(`Path to Destination: ${distance.toFixed(2)} km`);
    }
}

// Function to calculate and draw routes using OSRM (online only)
async function updateRoutes(locations, keys) {
    // Clear old polylines
    Object.values(polylines).forEach(polyline => map.removeLayer(polyline));
    polylines = {};
    
    if (keys.length < 2) return; // Need at least 2 devices for a route
    
    const colors = ['red', 'blue', 'green']; // Colors for routes
    let colorIndex = 0;
    
    // Generate pairs (e.g., 0-1, 0-2, 1-2 for 3 devices)
    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const key1 = keys[i];
            const key2 = keys[j];
            const loc1 = locations[key1];
            const loc2 = locations[key2];
            
            try {
                // Fetch route from OSRM (free public API, no key needed)
                const response = await fetch(`http://router.project-osrm.org/route/v1/driving/${loc1.lng},${loc1.lat};${loc2.lng},${loc2.lat}?overview=full&geometries=geojson`);
                const data = await response.json();
                
                if (data.routes && data.routes[0]) {
                    const route = data.routes[0].geometry.coordinates;
                    // Convert to Leaflet lat/lng format
                    const latlngs = route.map(coord => [coord[1], coord[0]]);
                    
                    // Draw polyline
                    const color = colors[colorIndex % colors.length];
                    polylines[`${key1}-${key2}`] = L.polyline(latlngs, { color, weight: 4, opacity: 0.7 }).addTo(map).bindPopup(`Route from Device ${i + 1} to Device ${j + 1} (${(data.routes[0].distance / 1000).toFixed(2)} km, ${(data.routes[0].duration / 60).toFixed(1)} min)`);
                    colorIndex++;
                }
            } catch (error) {
                console.error('Route calculation error:', error);
                // Optional: Draw straight line as fallback
                // polylines[`${key1}-${key2}`] = L.polyline([[loc1.lat, loc1.lng], [loc2.lat, loc2.lng]], { color: 'gray', weight: 2, dashArray: '5, 5' }).addTo(map);
            }
        }
    }
}

// Download map tiles for offline use
function downloadTiles() {
    if (!offlineLayer) return alert('Map not initialized.');
    const bounds = map.getBounds();
    offlineLayer.saveTiles(10, 16, () => {
        alert('Tiles downloaded for offline use!');
    }, (error) => {
        alert('Tile download failed: ' + error);
    }, bounds);
}

// Set destination by clicking on map
function setDestination() {
    alert('Click on the map to set your destination.');
    map.once('click', (e) => {
        destination = e.latlng;
        L.marker(destination).addTo(map).bindPopup('Destination').openPopup();
        alert('Destination set. Path will update as you move.');
    });
}

// Leave room
function leaveRoom() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (roomCode) {
        remove(ref(database, roomCode + '/locations/' + myId));
    }
    roomCode = null;
    document.getElementById('status').innerText = 'Left room.';
    document.getElementById('devices').innerHTML = '';
    if (map) map.remove();
    markers = {};
    polylines = {};
}

// Expose functions to global scope for onclick
window.joinRoom = joinRoom;
window.leaveRoom = leaveRoom;
window.downloadTiles = downloadTiles;
window.setDestination = setDestination;