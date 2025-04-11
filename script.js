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

    // Store markers
    let markers = [];

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
                        'fill-opacity': 0.3, // Reduced opacity for better map visibility
                        'fill-outline-color': color
                    },
                    filter: ['==', ['get', 'contour'], parseInt(minutes)]
                });
            });

        } catch (error) {
            console.error('Error fetching isochrones:', error);
        }
    }

    // Load and display bike stations
    async function loadBikeStations() {
        try {
            const response = await fetch('https://rest.publibike.ch/v1/public/stations');
            if (!response.ok) {
                throw new Error('Failed to fetch bike stations');
            }
            const stations = await response.json();

            // Clear existing markers
            markers.forEach(marker => marker.remove());
            markers = [];

            // Add markers for each station
            stations.forEach(station => {
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

                // Create the marker
                const marker = new mapboxgl.Marker({
                    element: el,
                    anchor: 'center'
                })
                    .setLngLat([station.longitude, station.latitude])
                    .setPopup(new mapboxgl.Popup({ offset: 25 })
                        .setHTML(`
                            <div style="padding: 10px;">
                                <h3 style="margin: 0 0 5px 0;">Station ${station.id}</h3>
                                <p style="margin: 0;">Status: ${station.state.name}</p>
                            </div>
                        `))
                    .addTo(map);

                // Add click event for isochrones
                el.addEventListener('click', () => {
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