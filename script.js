function initializeMap() {
    if (!window.CONFIG || !window.CONFIG.MAPBOX_API_KEY) {
        console.error('Mapbox API key not found in configuration');
        return;
    }

    mapboxgl.accessToken = window.CONFIG.MAPBOX_API_KEY;
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [8.5417, 47.3769], // Center on Zurich, Switzerland
        zoom: 12 // Adjusted zoom level for better city view
    });

    map.getCanvas().style.cursor = 'crosshair';

    // Store selected stations and route data
    let selectedStations = [];
    let routeSource = null;

    // Add home button functionality
    const homeButton = document.getElementById('home-button');
    homeButton.addEventListener('click', () => {
        map.flyTo({
            center: [8.5417, 47.3769],
            zoom: 12,
            bearing: 0, // Reset rotation to north
            pitch: 0,   // Reset tilt to flat
            essential: true
        });
    });

    // Function to check if a point is within an isochrone
    async function isPointInIsochrone(lng, lat, targetLng, targetLat, minutes) {
        try {
            const response = await fetch(
                `https://api.mapbox.com/isochrone/v1/mapbox/cycling/${lng},${lat}?contours_minutes=${minutes}&polygons=true&access_token=${mapboxgl.accessToken}`
            );
            
            if (!response.ok) {
                throw new Error('Failed to fetch isochrone');
            }

            const data = await response.json();
            const point = turf.point([targetLng, targetLat]);
            const polygon = turf.polygon(data.features[0].geometry.coordinates);
            
            return turf.booleanPointInPolygon(point, polygon);
        } catch (error) {
            console.error('Error checking isochrone:', error);
            return false;
        }
    }

    // Function to calculate distance between stations using binary search
    async function calculateDistance(fromStation, toStation) {
        // Binary search parameters
        let left = 1;  // minimum 1 minute
        let right = 60; // maximum 60 minutes
        let result = 60; // default to maximum if not found

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const isReachable = await isPointInIsochrone(
                fromStation.longitude,
                fromStation.latitude,
                toStation.longitude,
                toStation.latitude,
                mid
            );

            if (isReachable) {
                result = mid;
                right = mid - 1; // try to find a smaller time
            } else {
                left = mid + 1; // need more time
            }
        }

        return result;
    }

    // Function to fetch and display cycling directions
    async function showCyclingDirections(fromStation, toStation) {
        try {
            const response = await fetch(
                `https://api.mapbox.com/directions/v5/mapbox/cycling/${fromStation.longitude},${fromStation.latitude};${toStation.longitude},${toStation.latitude}?geometries=geojson&access_token=${mapboxgl.accessToken}`
            );
            
            if (!response.ok) {
                throw new Error('Failed to fetch cycling directions');
            }

            const data = await response.json();
            
            // Create a unique source ID for this segment
            const sourceId = `route-${fromStation.id}-${toStation.id}`;
            const layerId = `route-${fromStation.id}-${toStation.id}`;

            // Remove existing route layer and source if they exist
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);

            // Add the route source
            map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: data.routes[0].geometry
                }
            });

            // Add the route layer
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#0066cc',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });

            // Update route overview with distance and duration
            const distance = (data.routes[0].distance / 1000).toFixed(1); // Convert to km
            const duration = Math.round(data.routes[0].duration / 60); // Convert to minutes
            
            return { distance, duration, sourceId, layerId };
        } catch (error) {
            console.error('Error fetching cycling directions:', error);
            return null;
        }
    }

    // Function to update route overview
    async function updateRouteOverview() {
        const stationsContainer = document.getElementById('route-stations');
        const distancesContainer = document.getElementById('route-distances');
        
        // Update stations list with integrated distance information
        stationsContainer.innerHTML = await Promise.all(selectedStations.map(async (station, index) => {
            // Get station details from cache or fetch them
            let stationDetails = stationDetailsCache.get(station.id);
            if (!stationDetails) {
                try {
                    const response = await fetch(`https://rest.publibike.ch/v1/public/stations/${station.id}`);
                    if (!response.ok) throw new Error('Failed to fetch station details');
                    stationDetails = await response.json();
                    stationDetailsCache.set(station.id, stationDetails);
                } catch (error) {
                    console.error('Error fetching station details:', error);
                    stationDetails = { name: `Station ${station.id}` }; // Fallback to ID if fetch fails
                }
            }
            
            let html = `
                <div class="station-item">
                    <span>${index + 1}. ${stationDetails.name}</span>
                    <span class="remove-station" data-id="${station.id}">×</span>
                </div>
            `;

            // Add distance information between stations
            if (index < selectedStations.length - 1) {
                const nextStation = selectedStations[index + 1];
                const routeInfo = await showCyclingDirections(station, nextStation);
                if (routeInfo) {
                    html += `
                        <div class="distance-item">
                            ${routeInfo.distance} km • ${routeInfo.duration} min
                        </div>
                    `;
                }
            }

            return html;
        })).then(html => html.join(''));

        // Clear existing route layers and sources
        selectedStations.forEach((station, index) => {
            if (index < selectedStations.length - 1) {
                const nextStation = selectedStations[index + 1];
                const layerId = `route-${station.id}-${nextStation.id}`;
                const sourceId = `route-${station.id}-${nextStation.id}`;
                if (map.getLayer(layerId)) map.removeLayer(layerId);
                if (map.getSource(sourceId)) map.removeSource(sourceId);
            }
        });

        
        // Update distances and show cycling directions
        distancesContainer.innerHTML = '';
        for (let i = 0; i < selectedStations.length - 1; i++) {
            const fromStation = selectedStations[i];
            const toStation = selectedStations[i + 1];
                        
            await showCyclingDirections(fromStation, toStation);
        }


        // Add event listeners for remove buttons
        document.querySelectorAll('.remove-station').forEach(button => {
            button.addEventListener('click', (e) => {
                const stationId = parseInt(e.target.dataset.id);
                removeStation(stationId);
            });
        });

        // Add share route functionality
        document.getElementById('share-route').addEventListener('click', () => {
            if (selectedStations.length < 2) {
                alert('Please select at least two stations to share a route');
                return;
            }

            // Create Google Maps URL with waypoints and cycling mode
            const baseUrl = 'https://www.google.com/maps/dir/';
            const waypoints = selectedStations.map(station => 
                `${station.latitude},${station.longitude}`
            ).join('/');
            
            const url = `${baseUrl}${waypoints}/?travelmode=bicycling`;
            window.open(url, '_blank');
        });
    }

    // Function to remove a station from the route
    function removeStation(stationId) {
        // Find the index of the station to be removed
        const index = selectedStations.findIndex(station => station.id === stationId);
        if (index === -1) return;

        // Remove the station
        selectedStations.splice(index, 1);

        // Remove all existing route layers and sources
        map.getStyle().layers.forEach(layer => {
            if (layer.id.startsWith('route-')) {
                map.removeLayer(layer.id);
            }
        });
        Object.keys(map.getStyle().sources).forEach(sourceId => {
            if (sourceId.startsWith('route-')) {
                map.removeSource(sourceId);
            }
        });

        // Update markers and route overview
        updateMarkers();
        updateRouteOverview();

        // If there are still stations in the route, show isochrones for the last station
        if (selectedStations.length > 0) {
            const lastStation = selectedStations[selectedStations.length - 1];
            showIsochrones(lastStation.longitude, lastStation.latitude);
        } else {
            // If no stations left, remove all isochrone layers
            if (map.getLayer('isochrone-30')) map.removeLayer('isochrone-30');
            if (map.getLayer('isochrone-20')) map.removeLayer('isochrone-20');
            if (map.getLayer('isochrone-10')) map.removeLayer('isochrone-10');
            if (map.getSource('isochrones')) map.removeSource('isochrones');
        }
    }

    // Function to update marker styles
    function updateMarkers() {
        markers.forEach(marker => {
            const markerElement = marker.getElement();
            const stationId = markerElement.dataset.stationId;
            const isSelected = selectedStations.some(station => station.id === parseInt(stationId));
            
            // Remove any existing number
            const existingNumber = markerElement.querySelector('.marker-number');
            if (existingNumber) {
                existingNumber.remove();
            }
            
            if (isSelected) {
                markerElement.classList.add('selected');
                // Add number to the marker
                const index = selectedStations.findIndex(station => station.id === parseInt(stationId));
                const numberElement = document.createElement('div');
                numberElement.className = 'marker-number';
                numberElement.textContent = (index + 1).toString();
                markerElement.appendChild(numberElement);
            } else {
                markerElement.classList.remove('selected');
            }
        });
    }

    // Function to show isochrones for a location
    async function showIsochrones(lng, lat) {
        // Remove existing isochrone layers if they exist
        if (map.getLayer('isochrone-30')) map.removeLayer('isochrone-30');
        if (map.getLayer('isochrone-20')) map.removeLayer('isochrone-20');
        if (map.getLayer('isochrone-10')) map.removeLayer('isochrone-10');
        if (map.getSource('isochrones')) map.removeSource('isochrones');

        try {
            // Fetch isochrones for 10, 20, and 30 minutes
            const response = await fetch(
                `https://api.mapbox.com/isochrone/v1/mapbox/cycling/${lng},${lat}?contours_minutes=10,20,30&polygons=true&access_token=${mapboxgl.accessToken}`
            );
            
            if (!response.ok) {
                throw new Error('Failed to fetch isochrones');
            }

            const data = await response.json();

            // Add the isochrone source
            map.addSource('isochrones', {
                type: 'geojson',
                data: data
            });

            // Add layers for each isochrone
            const colors = {
                '10': '#ff0000', // red
                '20': '#ffa500', // orange
                '30': '#ffff00'  // yellow
            };

            // Add layers in reverse order (30 minutes first, then 20, then 10)
            Object.entries(colors).reverse().forEach(([minutes, color]) => {
                map.addLayer({
                    id: `isochrone-${minutes}`,
                    type: 'fill',
                    source: 'isochrones',
                    paint: {
                        'fill-color': color,
                        'fill-opacity': 0.2,
                        'fill-outline-color': color
                    },
                    filter: ['==', ['get', 'contour'], parseInt(minutes)]
                });
            });

        } catch (error) {
            console.error('Error fetching isochrones:', error);
        }
    }

    // Store markers
    let markers = [];
    // Cache for station details
    const stationDetailsCache = new Map();

    // Load and display bike stations
    async function loadBikeStations() {
        try {
            const response = await fetch('https://rest.publibike.ch/v1/public/all/stations');
            if (!response.ok) {
                throw new Error('Failed to fetch bike stations');
            }
            const data = await response.json();
            const publibikeStations = data.publibike.stations;
            const velospotStations = data.velospot.responseData;

            // Clear existing markers
            markers.forEach(marker => marker.remove());
            markers = [];

            // Create a map to store combined station data
            const combinedStations = new Map();

            // Process Publibike stations
            publibikeStations.forEach(station => {
                const key = `${station.latitude.toFixed(3)},${station.longitude.toFixed(3)}`;
                combinedStations.set(key, {
                    ...station,
                    source: 'publibike',
                    totalBikes: station.vehicles.length,
                    ebikes: station.vehicles.filter(v => v.type.name === 'E-Bike').length,
                    regularBikes: station.vehicles.filter(v => v.type.name === 'Velo').length
                });
            });

            // Process Velospot stations and combine with Publibike stations
            velospotStations.forEach(station => {
                const key = `${parseFloat(station.lat).toFixed(3)},${parseFloat(station.lng).toFixed(3)}`;
                const existingStation = combinedStations.get(key);
                
                if (existingStation) {
                    // Combine with existing Publibike station
                    combinedStations.set(key, {
                        ...existingStation,
                        source: 'both',
                        totalBikes: existingStation.totalBikes + parseInt(station.totalNonElectricalBike) + parseInt(station.totalElectricalBike),
                        ebikes: existingStation.ebikes + parseInt(station.totalElectricalBike),
                        regularBikes: existingStation.regularBikes + parseInt(station.totalNonElectricalBike)
                    });
                } else {
                    // Add new Velospot station
                    combinedStations.set(key, {
                        id: station.station_id,
                        name: station.station_name,
                        latitude: parseFloat(station.lat),
                        longitude: parseFloat(station.lng),
                        address: station.station_address,
                        state: { name: 'Aktiv' },
                        source: 'velospot',
                        totalBikes: parseInt(station.totalNonElectricalBike) + parseInt(station.totalElectricalBike),
                        ebikes: parseInt(station.totalElectricalBike),
                        regularBikes: parseInt(station.totalNonElectricalBike)
                    });
                }
            });

            // Add markers for each combined station
            combinedStations.forEach(station => {
                // Cache the station details
                stationDetailsCache.set(station.id, station);

                // Create a marker element
                const el = document.createElement('div');
                el.className = 'bike-marker';
                el.style.width = '20px';
                el.style.height = '20px';
                el.style.backgroundImage = 'url(https://publibike.ch/wp-content/themes/publibike/assets/images/logo.svg)';
                el.style.backgroundSize = 'cover';
                el.style.cursor = 'pointer';
                el.style.willChange = 'transform';
                el.style.transform = 'translate(-50%, -50%)';
                el.dataset.stationId = station.id;

                // Create the marker
                const marker = new mapboxgl.Marker({
                    element: el,
                    anchor: 'center'
                })
                    .setLngLat([station.longitude, station.latitude])
                    .setPopup(new mapboxgl.Popup({ offset: 25 })
                        .setHTML(`
                            <div style="padding: 10px;">
                                <h3 style="margin: 0 0 5px 0;">${station.name}</h3>
                                <p style="margin: 0;">${station.address}</p>
                                <p style="margin: 5px 0;">Status: ${station.state.name}</p>
                                <p style="margin: 0;">Total bikes: ${station.totalBikes}</p>
                                <p style="margin: 0;">E-bikes: ${station.ebikes}</p>
                                <p style="margin: 0;">Regular bikes: ${station.regularBikes}</p>
                                <p style="margin: 5px 0; color: #666;">Provider: ${station.source === 'both' ? 'Publibike & Velospot' : station.source}</p>
                            </div>
                        `))
                    .addTo(map);

                // Add hover event for basic information
                el.addEventListener('mouseenter', () => {
                    const popup = marker.getPopup();
                    popup.setHTML(`
                        <div style="padding: 10px;">
                            <h3 style="margin: 0 0 5px 0;">${station.name}</h3>
                            <p style="margin: 0;">Status: ${station.state.name}</p>
                            <p style="margin: 0;">Total bikes: ${station.totalBikes}</p>
                            <p style="margin: 5px 0;">E-bikes: ${station.ebikes}</p>
                        </div>
                    `);
                    popup.addTo(map);
                });

                // Add mouseleave event to close popup
                el.addEventListener('mouseleave', () => {
                    const popup = marker.getPopup();
                    if (!popup.isOpen()) return;
                    popup.remove();
                });

                // Add click event for selection and isochrones
                el.addEventListener('click', () => {
                    // Toggle station selection
                    const index = selectedStations.findIndex(s => s.id === station.id);
                    if (index === -1) {
                        // Check if the new station is within 30 minutes of the last station
                        if (selectedStations.length > 0) {
                            const lastStation = selectedStations[selectedStations.length - 1];
                            const distance = calculateDistance(lastStation, station);
                            if (distance > 30) {
                                alert('This station is too far from the last station in your route (must be ≤ 30 minutes)');
                                return;
                            }
                        }
                        selectedStations.push(station);
                    } else {
                        selectedStations.splice(index, 1);
                    }
                    updateRouteOverview();
                    updateMarkers();
                    showIsochrones(station.longitude, station.latitude);
                });

                // Store the marker
                markers.push(marker);
            });
        } catch (error) {
            console.error('Error loading bike stations:', error);
        }
    }

    // Load stations when the map is ready
    map.on('load', loadBikeStations);
}

// Wait for the config to be loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if config is already loaded
    if (window.CONFIG) {
        initializeMap();
    } else {
        // If not, wait for the config.js script to load
        const configScript = document.querySelector('script[src="/config.js"]');
        if (configScript) {
            configScript.addEventListener('load', initializeMap);
        }
    }
}); 