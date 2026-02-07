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
let myName = '';
let map;
let markers = {};
let polylines = {};
let destination = null;
let offlineLayer = null;
let watchId = null;
let trackingStarted = false;

// Initialize map on page load
window.onload = function() {
    try {
        map = L.map('map').setView([51.505, -0.09], 13);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        L.marker([51.5, -0.09]).addTo(map)
            .bindPopup('Welcome! Start tracking to see your location.')
            .openPopup();
        console.log('Map initialized successfully');
    } catch (error) {
        console.error('Map initialization failed:', error);
        alert('Map failed to load. Check internet or refresh.');
        document.getElementById('map').innerHTML = '<p>Map unavailable.</p>';
    }

    // Register PWA (only if sw.js exists)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.warn('PWA not available:', err));
    }
    updateOfflineStatus();
    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);
};

// Update offline status
function updateOfflineStatus() {
    const status = navigator.onLine ? 'Online' : 'Offline';
    document.getElementById('offline-status').innerText = `Offline Status: ${status}`;
}

// Start tracking
function startTracking() {
    myName = document.getElementById('name').value.trim();
    if (!myName) return alert('Please enter your name.');
    if (trackingStarted) return alert('Tracking already started.');
    if (!navigator.geolocation) return alert('Geolocation not supported.');
    
    navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        map.setView([lat, lng], 15);
        updateLocalPosition(lat, lng);
        watchId = navigator.geolocation.watchPosition((pos) => {
            updateLocalPosition(pos.coords.latitude, pos.coords.longitude);
        }, (error) => alert('GPS error: ' + error.message), { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 });
        trackingStarted = true;
        document.getElementById('status').innerText = `Tracking started. Your name: ${myName}`;
    }, (error) => {
        alert('Location permission denied: ' + error.message + '. Enable in browser settings.');
    });
}

// Update local position
function updateLocalPosition(lat, lng) {
    if (!markers['me']) {
        markers['me'] = L.marker([lat, lng], { icon: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup(`${myName}: Your Location`).openPopup();
    } else {
        markers['me'].setLatLng([lat, lng]);
    }
    if (destination) {
        const line = turf.lineString([[lng, lat], [destination.lng, destination.lat]]);
        const distance = turf.length(line, { units: 'kilometers' });
        if (polylines['destination']) map.removeLayer(polylines['destination']);
        polylines['destination'] = L.polyline([[lat, lng], [destination.lat, destination.lng]], { color: 'blue', weight: 4, opacity: 0.7 }).addTo(map).bindPopup(`Path to Destination: ${distance.toFixed(2)} km`);
    }
}

// Create room
function createRoom() {
    if (!trackingStarted) return alert('Start tracking first.');
    roomCode = Math.random().toString(36).substr(2, 9) + Math.random().toString(36).substr(2, 9);
    document.getElementById('code').value = roomCode;
    joinRoom();
}

// Join room
function joinRoom() {
    if (!trackingStarted) return alert('Start tracking first.');
    if (!navigator.onLine) return alert('Joining rooms requires internet. Go online to sync with others.');
    roomCode = document.getElementById('code').value.trim();
    if (!roomCode) return alert('Enter a room code!');
    onValue(ref(database, roomCode + '/locations'), (snapshot) => {
        const locations = snapshot.val() || {};
        const deviceCount = Object.keys(locations).length;
        if (deviceCount >= 3) return alert('Room full (max 3).');
        document.getElementById('status').innerText = `Joined room: ${roomCode}`;
        startRoomTracking();
    }, { onlyOnce: true });
}

// Start room tracking
function startRoomTracking() {
    onValue(ref(database, roomCode + '/locations'), (snapshot) => {
        const locations = snapshot.val() || {};
        const keys = Object.keys(locations);
        const deviceList = document.getElementById('devices');
        deviceList.innerHTML = '';
        keys.forEach((key, index) => {
            const loc = locations[key];
            const name = loc.name || `Device ${index + 1}`;
            const deviceName = key === myId ? `${myName} (You)` : name;
            if (!markers[key]) {
                const colors = ['blue', 'green', 'orange'];
                markers[key] = L.marker([loc.lat, loc.lng], { icon: L.icon({ iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${colors[index] || 'grey'}.png`, shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup(`${deviceName}: Lat ${loc.lat.toFixed(4)}, Lng ${loc.lng.toFixed(4)}`);
            } else {
                markers[key].setLatLng([loc.lat, loc.lng]);
            }
            const li = document.createElement('li');
            li.textContent = `${deviceName}: Lat ${loc.lat.toFixed(4)}, Lng ${loc.lng.toFixed(4)}`;
            deviceList.appendChild(li);
        });
        if (keys.length > 0) map.setView([locations[keys[0]].lat, locations[keys[0]].lng], 15);
        Object.keys(markers).forEach(key => {
            if (!keys.includes(key) && key !== 'me') {
                map.removeLayer(markers[key]);
                delete markers[key];
            }
        });
        if (navigator.onLine) updateRoutes(locations, keys);
    });
}

// Update routes
async function updateRoutes(locations, keys) {
    Object.values(polylines).forEach(polyline => map.removeLayer(polyline));
    polylines = {};
    if (keys.length < 2) return;
    const colors = ['red', 'purple', 'yellow'];
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
                    polylines[`${key1}-${key2}`] = L.polyline(route, { color, weight: 4, opacity: 0.7 }).addTo(map).bindPopup(`Route from ${loc1.name || 'Device'} to ${loc2.name || 'Device'} (${(data.routes[0].distance / 1000).toFixed(2)} km, ${(data.routes[0].duration / 60).toFixed(1)} min)`);
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
    if (!map) return alert('Map not ready.');
    alert('Tile download not fully implemented. Zoom to your area and use browser cache.');
}

// Set destination
function setDestination() {
    if (!map) return alert('Map not ready.');
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
    if (roomCode && navigator.onLine) remove(ref(database, roomCode + '/locations/' + myId));
    roomCode = null;
    trackingStarted = false;
    document.getElementById('status').innerText = 'Left room.';
    document.getElementById('devices').innerHTML = '';
    Object.values(markers).forEach(marker => map.removeLayer(marker));
    Object.values(polylines).forEach(polyline => map.removeLayer(polyline));
    markers = {};
    polylines = {};
}

// Expose functions
window.startTracking = startTracking;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.leaveRoom = leaveRoom;
window.downloadTiles = downloadTiles;
window.setDestination = setDestination;
