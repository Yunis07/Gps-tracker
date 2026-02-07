// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getDatabase, ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-analytics.js";

// Firebase config
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
let myId = Math.random().toString(36).substr(2, 9);
let map;
let markers = {};
let polylines = {};
let destination = null;
let offlineLayer = null;
let watchId = null;

// Initialize map with fallback
function initMap() {
    try {
        map = L.map('map').setView([0, 0], 2);
        const onlineTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        });
        offlineLayer = L.tileLayer.offline('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            subdomains: 'abc',
            minZoom: 10,
            maxZoom: 16,
            crossOrigin: true
        });
        map.addLayer(offlineLayer);
        map.addLayer(onlineTiles);
        console.log('Map initialized with Leaflet');
    } catch (error) {
        console.error('Leaflet failed, using OpenLayers fallback:', error);
        // Fallback to OpenLayers (free, efficient)
        const olMap = new ol.Map({
            target: 'map',
            layers: [new ol.layer.Tile({ source: new ol.source.OSM() })],
            view: new ol.View({ center: ol.proj.fromLonLat([0, 0]), zoom: 2 })
        });
        map = { addLayer: () => {}, removeLayer: () => {}, setView: () => {} }; // Dummy for compatibility
        alert('Map loaded with fallback. Some features may be limited.');
    }

    // Register PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(console.error);
    }
    updateOfflineStatus();
    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
}

// Update offline status
function updateOfflineStatus() {
    const status = navigator.onLine ? 'Online' : 'Offline';
    document.getElementById('offline-status').innerText = `Offline Status: ${status}`;
}

// Create a new room
function createRoom() {
    roomCode = Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9); // Alphanumeric ID
    document.getElementById('code').value = roomCode;
    joinRoom();
}

// Join a room
function joinRoom() {
    roomCode = document.getElementById('code').value.trim();
    if (!roomCode) return alert('Enter or create a room code!');
    onValue(ref(database, roomCode + '/locations'), (snapshot) => {
        const locations = snapshot.val() || {};
        const deviceCount = Object.keys(locations).length;
        if (deviceCount >= 3) return alert('Room full (max 3).');
        document.getElementById('status').innerText = `Joined room: ${roomCode}`;
        initMap();
        startTracking();
    }, { onlyOnce: true });
}

// Start tracking
function startTracking() {
    if (!navigator.geolocation) return alert('Geolocation not supported.');
    watchId = navigator.geolocation.watchPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if (navigator.onLine) set(ref(database, roomCode + '/locations/' + myId), { lat, lng, timestamp: Date.now() });
        updateLocalPosition(lat, lng);
    }, (error) => alert('GPS error: ' + error.message), { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 });

    if (navigator.onLine) {
        onValue(ref(database, roomCode + '/locations'), (snapshot) => {
            const locations = snapshot.val() || {};
            const keys = Object.keys(locations);
            const deviceList = document.getElementById('devices');
            deviceList.innerHTML = '';
            keys.forEach((key, index) => {
                const loc = locations[key];
                const deviceName = `Device ${index + 1} (${key === myId ? 'You' : 'Other'})`;
                if (!markers[key]) {
                    const colors = ['red', 'blue', 'green'];
                    markers[key] = L.marker([loc.lat, loc.lng], { icon: L.icon({ iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${colors[index] || 'grey'}.png`, shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup(deviceName);
                } else {
                    markers[key].setLatLng([loc.lat, loc.lng]);
                }
                const li = document.createElement('li');
                li.textContent = `${deviceName}: Lat ${loc.lat.toFixed(4)}, Lng ${loc.lng.toFixed(4)}`;
                deviceList.appendChild(li);
            });
            if (keys.length > 0) map.setView([locations[keys[0]].lat, locations[keys[0]].lng], 15);
            Object.keys(markers).forEach(key => {
                if (!keys.includes(key)) {
                    map.removeLayer(markers[key]);
                    delete markers[key];
                }
            });
            if (navigator.onLine) updateRoutes(locations, keys);
        });
    }
}

// Update local position
function updateLocalPosition(lat, lng) {
    if (!markers[myId]) {
        markers[myId] = L.marker([lat, lng], { icon: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup('You');
    } else {
        markers[myId].setLatLng([lat, lng]);
    }
    if (destination) {
        const line = turf.lineString([[lng, lat], [destination.lng, destination.lat]]);
        const distance = turf.length(line, { units: 'kilometers' });
        if (polylines['destination']) map.removeLayer(polylines['destination']);
        polylines['destination'] = L.polyline([[lat, lng], [destination.lat, destination.lng]], { color: 'blue', weight: 4, opacity: 0.7 }).addTo(map).bindPopup(`Path to Destination: ${distance.toFixed(2)} km`);
    }
}

// Update routes (online)
async function updateRoutes(locations, keys) {
    Object.values(polylines).forEach(polyline => map.removeLayer(polyline));
    polylines = {};
    if (keys.length < 2) return;
    const colors = ['red', 'blue', 'green'];
    let colorIndex = 0;
    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const key1 = keys[i], key2 = keys[j];
            const loc1 = locations[key1], loc2 = locations[key2];
            try {
                const response = await fetch(`http://router.project-osrm.org/route/v1/driving/${loc1.lng},${loc1.lat};${loc2.lng},${loc2.lat}?overview=full&geometries=geojson`);
                const data = await response.json();
                if (data.routes && data.routes[0]) {
                    const route = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                    const color = colors[colorIndex % colors.length];
                    polylines[`${key1}-${key2}`] = L.polyline(route, { color, weight: 4, opacity: 0.7 }).addTo(map).bindPopup(`Route from Device ${i + 1} to Device ${j + 1} (${(data.routes[0].distance / 1000).toFixed(2)} km, ${(data.routes[0].duration / 60).toFixed(1)} min)`);
                    colorIndex++;
                }
            } catch (error) {
                console.error('Route error:', error);
            }
        }
    }
}

// Download tiles
function downloadTiles() {
    if (!offlineLayer) return alert('Map not ready.');
    const bounds = map.getBounds();
    offlineLayer.saveTiles(10, 16, () => alert('Tiles downloaded!'), (error) => alert('Download failed: ' + error), bounds);
}

// Set destination
function setDestination() {
    alert('Click on the map to set destination.');
    map.once('click', (e) => {
        destination = e.latlng;
        L.marker(destination).addTo(map).bindPopup('Destination').openPopup();
        alert('Destination set.');
    });
}

// Leave room
function leaveRoom() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (roomCode) remove(ref(database, roomCode + '/locations/' + myId));
    roomCode = null;
    document.getElementById('status').innerText = 'Left room.';
    document.getElementById('devices').innerHTML = '';
    if (map) map.remove();
    markers = {};
    polylines = {};
}

// Expose functions
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.leaveRoom = leaveRoom;
window.downloadTiles = downloadTiles;
window.setDestination = setDestination;
