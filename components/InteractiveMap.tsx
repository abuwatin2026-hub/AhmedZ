import React, { useEffect, useRef } from 'react';

interface InteractiveMapProps {
    center: { lat: number; lng: number };
    zoom?: number;
    radius?: number; // meters
    onCenterChange?: (center: { lat: number; lng: number }) => void;
    readOnly?: boolean;
    heightClassName?: string;
    title?: string;
    markers?: Array<{ lat: number; lng: number; title?: string }>;
}

const InteractiveMap: React.FC<InteractiveMapProps> = ({
    center,
    zoom = 13,
    radius,
    onCenterChange,
    readOnly = false,
    heightClassName = 'h-64',
    title = 'Map',
    markers = []
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const circleRef = useRef<any>(null);
    const markersLayerRef = useRef<any>(null);

    // Initialize Map
    useEffect(() => {
        if (!mapContainerRef.current || !window.L) return;

        // Prevent double initialization
        if (mapInstanceRef.current) return;

        const L = window.L;
        const initialLat = center?.lat || 15.369445;
        const initialLng = center?.lng || 44.191006;

        const map = L.map(mapContainerRef.current).setView([initialLat, initialLng], zoom);

        // Add Tile Layer (OpenStreetMap)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        mapInstanceRef.current = map;

        // Custom Icon
        const DefaultIcon = L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });
        L.Marker.prototype.options.icon = DefaultIcon;

        // Cleaning up on unmount
        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, []); // Only run once on mount

    // Update Map View and Main Marker
    useEffect(() => {
        if (!mapInstanceRef.current || !window.L) return;

        const L = window.L;
        const map = mapInstanceRef.current;
        const lat = center?.lat || 15.369445;
        const lng = center?.lng || 44.191006;

        // Update view
        map.setView([lat, lng], zoom);

        // Update Main Marker
        if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng]);
        } else {
            const marker = L.marker([lat, lng], { draggable: !readOnly }).addTo(map);
            markerRef.current = marker;

            marker.on('dragend', function () {
                const position = marker.getLatLng();
                if (onCenterChange) {
                    onCenterChange({ lat: position.lat, lng: position.lng });
                    map.panTo(position); // Ensure map follows marker
                }
            });
        }

        // Click handler to move marker
        if (!readOnly) {
            map.off('click'); // Remove previous listeners
            map.on('click', function (e: any) {
                const { lat, lng } = e.latlng;
                if (markerRef.current) {
                    markerRef.current.setLatLng([lat, lng]);
                }
                if (onCenterChange) {
                    onCenterChange({ lat, lng });
                }
            });
        }

    }, [center, zoom, readOnly, onCenterChange]);

    // Update Radius Circle
    useEffect(() => {
        if (!mapInstanceRef.current || !window.L) return;
        const L = window.L;
        const map = mapInstanceRef.current;
        const lat = center?.lat || 15.369445;
        const lng = center?.lng || 44.191006;

        if (radius && radius > 0) {
            if (circleRef.current) {
                circleRef.current.setLatLng([lat, lng]);
                circleRef.current.setRadius(radius);
            } else {
                circleRef.current = L.circle([lat, lng], {
                    color: '#D4AF37', // Gold color
                    fillColor: '#D4AF37',
                    fillOpacity: 0.2,
                    radius: radius
                }).addTo(map);
            }
        } else {
            if (circleRef.current) {
                map.removeLayer(circleRef.current);
                circleRef.current = null;
            }
        }
    }, [center, radius]);

    // Update Additional Markers
    useEffect(() => {
        if (!mapInstanceRef.current || !window.L) return;
        const L = window.L;
        const map = mapInstanceRef.current;

        // Clear existing markers layer group
        if (markersLayerRef.current) {
            map.removeLayer(markersLayerRef.current);
        }

        if (markers && markers.length > 0) {
            const markersGroup = L.layerGroup().addTo(map);
            markersLayerRef.current = markersGroup;

            markers.forEach((m) => {
                L.marker([m.lat, m.lng], {
                    title: m.title,
                    opacity: 0.7
                })
                    .bindPopup(m.title || '')
                    .addTo(markersGroup);
            });
        }

    }, [markers]);


    return (
        <div title={title} className={`w-full ${heightClassName} rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 relative z-0`}>
            <div ref={mapContainerRef} className="w-full h-full" />
            <div className="absolute top-0 right-0 p-1 text-[10px] text-gray-500 bg-white/80 rounded-bl backdrop-blur-sm z-[1000]">
                Interactive Map
            </div>
        </div>
    );
};

export default InteractiveMap;
