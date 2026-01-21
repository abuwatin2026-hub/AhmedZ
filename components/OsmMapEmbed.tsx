
import type React from 'react';

type Coords = { lat: number; lng: number };

type OsmMapEmbedProps = {
    center: Coords;
    delta?: number;
    title?: string;
    className?: string;
    heightClassName?: string;
    showLink?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildOsmEmbedUrl = (center: Coords, delta: number) => {
    const lat = clamp(center.lat, -85, 85);
    const lng = clamp(center.lng, -180, 180);

    const latMin = clamp(lat - delta, -85, 85);
    const latMax = clamp(lat + delta, -85, 85);
    const lngMin = clamp(lng - delta, -180, 180);
    const lngMax = clamp(lng + delta, -180, 180);

    const bbox = `${lngMin}%2C${latMin}%2C${lngMax}%2C${latMax}`;
    const marker = `${lat}%2C${lng}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
};

const buildOsmLinkUrl = (center: Coords, delta: number) => {
    const lat = clamp(center.lat, -85, 85);
    const lng = clamp(center.lng, -180, 180);

    const latMin = clamp(lat - delta, -85, 85);
    const latMax = clamp(lat + delta, -85, 85);
    const lngMin = clamp(lng - delta, -180, 180);
    const lngMax = clamp(lng + delta, -180, 180);

    const bbox = `${lngMin}%2C${latMin}%2C${lngMax}%2C${latMax}`;
    const marker = `${lat}%2C${lng}`;
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}&bbox=${bbox}&marker=${marker}`;
};

const OsmMapEmbed: React.FC<OsmMapEmbedProps> = ({ center, delta = 0.01, title, className, heightClassName = 'h-64', showLink = true }) => {
    const src = buildOsmEmbedUrl(center, delta);
    const link = buildOsmLinkUrl(center, delta);

    return (
        <div className={className}>
            <div className={`w-full ${heightClassName} rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700`}>
                <iframe title={title || 'Map'} src={src} className="w-full h-full" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            </div>
            {showLink && (
                <div className="mt-2 text-xs">
                    <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                        OpenStreetMap
                    </a>
                </div>
            )}
        </div>
    );
};

export default OsmMapEmbed;
