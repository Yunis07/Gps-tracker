// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getDatabase, ref, set, onValue, remove, onChildAdded } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

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
const database = getDatabase(app);

// Global variables
let roomCode = null;
let myId = Math.random().toString(36).substr(2, 9);
let myName = '';
let map;
let markers = {};
let routes = {};  // For routing machine instances
let watchId = null;
let trackingStarted = false;
let lastUpdate = 0;
let myLat = 0, myLng = 0;

// Initialize map with transport layer for clearer roads
window.onload = function() {
    try {
        map = L.map('map').setView([51.505, -0.09], 13);
        L.tileLayer('https://tile-{s}.openstreetmap.fr/hot/{z}/{x}/{y}.png', {  // Transport-style layer for road emphasis
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style of Humanitarian OpenStreetMap Team'
        }).addTo(map);
        L.marker([51.5, -0.09]).addTo(map).bindPopup('Start tracking to see locations.').openPopup();
        console.log('Map ready with road-focused tiles');
    } catch (error) {
        alert('Map failed. Refresh or check connection.');
    }
};

// Start tracking
function startTracking() {
    myName = document.getElementById('name').value.trim();
    if (!myName) return alert('Enter your name.');
    if (trackingStarted) return;
    if (!navigator.geolocation) return alert('GPS not supported.');
    
    navigator.geolocation.getCurrentPosition((position) => {
        myLat = position.coords.latitude;
        myLng = position.coords.longitude;
        updateLocalPosition(myLat, myLng);
        watchId = navigator.geolocation.watchPosition((pos) => {
            myLat = pos.coords.latitude;
            myLng = pos.coords.longitude;
            const now = Date.now();
            if (now - lastUpdate > 10000) {
                updateLocalPosition(myLat, myLng);
                lastUpdate = now;
            }
        }, (error) => alert('GPS error: ' + error.message), { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 });
        trackingStarted = true;
        document.getElementById('status').innerText = `Tracking ${myName}. Low data mode.`;
    }, (error) => {
        alert('Location denied. Enable in settings.');
    });
}

// Update local position
function updateLocalPosition(lat, lng) {
    if (!markers['me']) {
        markers['me'] = L.marker([lat, lng], { icon: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup(`${myName}: Your Location`).openPopup();
    } else {
        markers['me'].setLatLng([lat, lng]);
    }
    if (roomCode && navigator.onLine) {
        set(ref(database, roomCode + '/locations/' + myId), { lat, lng, name: myName, timestamp: Date.now() });
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
    if (!navigator.onLine) return alert('Need internet to join rooms.');
    roomCode = document.getElementById('code').value.trim();
    if (!roomCode) return alert('Enter room code.');
    onValue(ref(database, roomCode + '/locations'), (snapshot) => {
        const locations = snapshot.val() || {};
        if (Object.keys(locations).length >= 4) return alert('Room full (max 4).');
        document.getElementById('status').innerText = `Joined ${roomCode}. Sharing locations.`;
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
            const name = loc.name || `User ${index + 1}`;
            if (!markers[key]) {
                const colors = ['blue', 'green', 'orange', 'purple'];
                markers[key] = L.marker([loc.lat, loc.lng], { icon: L.icon({ iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${colors[index] || 'grey'}.png`, shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map).bindPopup(`${name}: Lat ${loc.lat.toFixed(4)}, Lng ${loc.lng.toFixed(4)}`);
            } else {
                markers[key].setLatLng([loc.lat, loc.lng]);
            }
            const li = document.createElement('li');
            li.textContent = `${name}: Lat ${loc.lat.toFixed(4)}, Lng ${loc.lng.toFixed(4)}`;
            deviceList.appendChild(li);
        });
        updateRoutes(locations, keys);
    });

    onChildAdded(ref(database, roomCode + '/locations'), (snapshot) => {
        const data = snapshot.val();
        if (data.name !== myName) {
            alert(`${data.name} joined! Path highlighted.`);
            drawRouteToUser(data.lat, data.lng, data.name);
        }
    });
}

// Update routes with routing machine for street highlighting
function updateRoutes(locations, keys) {
    Object.values(routes).forEach(route => map.removeControl(route));
    routes = {};
    if (keys.length < 2) return;
    const colors = ['#0000FF', '#800080', '#FFFF00', '#00FFFF'];  // Blue, purple, yellow, cyan
    let colorIndex = 0;
    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const key1 = keys[i], key2 = keys[j];
            const loc1 = locations[key1], loc2 = locations[key2];
            const routeId = `${key1}-${key2}`;
            routes[routeId] = L.Routing.control({
                waypoints: [L.latLng(loc1.lat, loc1.lng), L.latLng(loc2.lat, loc2.lng)],
                router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
                lineOptions: { styles: [{ color: colors[colorIndex % colors.length], weight: 6, opacity: 0.8 }] },  // Thick, highlighted line
                createMarker: () => null,  // No extra markers
                addWaypoints: false
            }).addTo(map);
            colorIndex++;
        }
    }
}

// Draw route to new user with highlighting
function drawRouteToUser(lat, lng, name) {
    const routeId = `to-${name}`;
    if (routes[routeId]) map.removeControl(routes[routeId]);
    routes[routeId] = L.Routing.control({
        waypoints: [L.latLng(myLat, myLng), L.latLng(lat, lng)],
        router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
        lineOptions: { styles: [{ color: 'green', weight: 7, opacity: 0.9 }] },  // Prominent green highlight
        createMarker: () => null,
        addWaypoints: false
    }).addTo(map);
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
    Object.values(routes).forEach(route => map.removeControl(route));
    markers = {};
    routes = {};
}

// Expose functions
window.startTracking = startTracking;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.leaveRoom = leaveRoom;
