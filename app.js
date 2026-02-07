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
let markers = [];
let routes = [];
let watchId = null;
let trackingStarted = false;
let lastUpdate = 0;
let myLat = 0, myLng = 0;

// Initialize MapLibre map
window.onload = function() {
    const MAPTILER_KEY = '0ji8c4Ac7rZvNXeSUoKl';
    try {
        map = new maplibregl.Map({
            container: 'map',
            style: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
            center: [-0.09, 51.505],
            zoom: 13
        });
        map.on('load', () => {
            console.log('Map loaded successfully');
            const defaultMarker = new maplibregl.Marker().setLngLat([-0.09, 51.505]).setPopup(new maplibregl.Popup().setHTML('Start tracking.')).addTo(map);
            markers.push(defaultMarker);
            map.on('click', (e) => {
                const features = map.queryRenderedFeatures(e.point);
                if (features.length) {
                    new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<strong>${features[0].properties.name || 'Feature'}</strong>`).addTo(map);
                }
            });
        });
        map.on('error', (e) => {
            console.error('Map error:', e);
            alert('Map failed.');
        });
    } catch (error) {
        console.error('Map init error:', error);
        alert('Map library failed.');
    }
};

// Start tracking
function startTracking() {
    myName = document.getElementById('name').value.trim();
    if (!myName) return alert('Enter your name.');
    if (trackingStarted) return alert('Already tracking.');
    if (!navigator.geolocation) return alert('GPS not supported.');
    
    document.getElementById('tracking-spinner').style.display = 'inline-block';
    navigator.geolocation.getCurrentPosition((position) => {
        myLat = position.coords.latitude;
        myLng = position.coords.longitude;
        map.flyTo({ center: [myLng, myLat], zoom: 15, duration: 2000 });
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
        document.getElementById('status').innerText = `Tracking ${myName}.`;
        document.getElementById('tracking-spinner').style.display = 'none';
    }, (error) => {
        alert('Location denied.');
        document.getElementById('tracking-spinner').style.display = 'none';
    });
}

// Update position
function updateLocalPosition(lat, lng) {
    if (markers.length === 1) {
        markers[0].remove();
        markers = [];
    }
    if (markers.length === 0) {
        const marker = new maplibregl.Marker({ color: 'red' }).setLngLat([lng, lat]).setPopup(new maplibregl.Popup().setHTML(`${myName}: Your Location`)).addTo(map);
        markers.push(marker);
    } else {
        markers[0].setLngLat([lng, lat]);
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
    if (!navigator.onLine) return alert('Need internet.');
    roomCode = document.getElementById('code').value.trim();
    if (!roomCode) return alert('Enter room code.');
    onValue(ref(database, roomCode + '/locations'), (snapshot) => {
        const locations = snapshot.val() || {};
        if (Object.keys(locations).length >= 4) return alert('Room full.');
        document.getElementById('status').innerText = `Joined ${roomCode}.`;
        startRoomTracking();
    }, { onlyOnce: true });
}

// Start room tracking
function startRoomTracking() {
    onValue(ref(database, roomCode + '/locations'), (snapshot) => {
        const locations = snapshot.val() || {};
        const keys = Object.keys(locations);
        console.log('Locations updated:', locations);
        const deviceList = document.getElementById('devices');
        deviceList.innerHTML = '';
        keys.forEach((key, index) => {
            const loc = locations[key];
            const name = loc.name || `User ${index + 1}`;
            if (!markers[index + 1]) {
                const marker = new maplibregl.Marker({ color: ['blue', 'green', 'orange', 'purple'][index] }).setLngLat([loc.lng, loc.lat]).setPopup(new maplibregl.Popup().setHTML(`${name}: Lat ${loc.lat.toFixed(4)}, Lng ${loc.lng.toFixed(4)}`)).addTo(map);
                markers.push(marker);
            } else {
                markers[index + 1].setLngLat([loc.lng, loc.lat]);
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
            alert(`${data.name} joined!`);
        }
    });
}

// Update routes with logging
async function updateRoutes(locations, keys) {
    console.log('Updating routes for keys:', keys);
    routes.forEach(route => route.remove());
    routes = [];
    
    if (keys.length < 2) {
        console.log('Not enough users for routes');
        return;
    }
    const colors = ['#0000FF', '#800080', '#FFFF00', '#00FFFF'];
    let colorIndex = 0;
    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const loc1 = locations[keys[i]], loc2 = locations[keys[j]];
            console.log(`Fetching route from ${loc1.lat},${loc1.lng} to ${loc2.lat},${loc2.lng}`);
            try {
                const response = await fetch(`http://router.project-osrm.org/route/v1/driving/${loc1.lng},${loc1.lat};${loc2.lng},${loc2.lat}?overview=full&geometries=geojson`);
                if (!response.ok) throw new Error(`OSRM failed: ${response.status}`);
                const data = await response.json();
                if (data.routes && data.routes[0]) {
                    const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[0], coord[1]]);
                    const distance = (data.routes[0].distance / 1000).toFixed(2);
                    const duration = (data.routes[0].duration / 60).toFixed(1);
                    const route = {
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'LineString', coordinates }
                    };
                    const routeId = `route-${keys[i]}-${keys[j]}`;
                    map.addSource(routeId, { type: 'geojson', data: route });
                    map.addLayer({
                        id: routeId,
                        type: 'line',
                        source: routeId,
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: { 'line-color': colors[colorIndex % colors.length], 'line-width': 8, 'line-opacity': 0.9 }
                    });
                    routes.push({
                        remove: () => {
                            if (map.getLayer(routeId)) map.removeLayer(routeId);
                            if (map.getSource(routeId)) map.removeSource(routeId);
                        }
                    });
                    console.log('Route added:', routeId);
                    // Add distance/ETA
                    const deviceList = document.getElementById('devices');
                    const li = deviceList.querySelector(`li:nth-child(${j + 1})`);
                    if (li) li.textContent += ` | ${distance} km, ${duration} min`;
                    colorIndex++;
                } else {
                    console.warn('No routes in OSRM response');
                }
            } catch (error) {
                console.error('Route fetch failed:', error);
            }
        }
    }
}

// Clear routes
function clearRoutes() {
    routes.forEach(route => route.remove());
    routes = [];
    alert('Routes cleared.');
}

// Download area
function downloadArea() {
    alert('Offline download not implemented.');
}

// Leave room
function leaveRoom() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (roomCode && navigator.onLine) remove(ref(database, roomCode + '/locations/' + myId));
    roomCode = null;
    trackingStarted = false;
    document.getElementById('status').innerText = 'Left room.';
    document.getElementById('devices').innerHTML = '';
    markers.forEach(marker => marker.remove());
    routes.forEach(route => route.remove());
    markers = [];
    routes = [];
}

// Expose functions
window.startTracking = startTracking;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.leaveRoom = leaveRoom;
window.clearRoutes = clearRoutes;
window.downloadArea = downloadArea;
