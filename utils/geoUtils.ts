/**
 * Geo Utilities for Delivery Zone Detection
 * 
 * This module provides geographic calculation functions for:
 * - Calculating distances between coordinates
 * - Detecting if a point is within a circular zone
 * - Finding the nearest delivery zone
 */

import type { DeliveryZone } from '../types';

/**
 * Calculate the distance between two geographic points using the Haversine formula
 * 
 * @param lat1 - Latitude of first point
 * @param lng1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lng2 - Longitude of second point
 * @returns Distance in meters
 */
export function calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

/**
 * Check if a point is within a circular zone
 * 
 * @param pointLat - Latitude of the point to check
 * @param pointLng - Longitude of the point to check
 * @param centerLat - Latitude of the circle center
 * @param centerLng - Longitude of the circle center
 * @param radiusMeters - Radius of the circle in meters
 * @returns True if the point is within the circle
 */
export function isPointInCircle(
    pointLat: number,
    pointLng: number,
    centerLat: number,
    centerLng: number,
    radiusMeters: number
): boolean {
    const distance = calculateDistance(pointLat, pointLng, centerLat, centerLng);
    return distance <= radiusMeters;
}

/**
 * Find the nearest delivery zone to a given location
 * 
 * @param userLocation - User's GPS coordinates
 * @param zones - Array of delivery zones
 * @returns The nearest zone, or null if no zones available
 */
export function findNearestDeliveryZone(
    userLocation: { lat: number; lng: number },
    zones: DeliveryZone[]
): DeliveryZone | null {
    if (zones.length === 0) return null;

    // First, try to find zones with defined coordinates
    const zonesWithCoords = zones.filter(
        (zone) => zone.coordinates && zone.coordinates.lat && zone.coordinates.lng
    );

    if (zonesWithCoords.length === 0) {
        // If no zones have coordinates, return the first active zone as fallback
        return zones.find((z) => z.isActive) || zones[0] || null;
    }

    // Check if user is within any zone's radius
    for (const zone of zonesWithCoords) {
        if (!zone.coordinates) continue;

        const isInside = isPointInCircle(
            userLocation.lat,
            userLocation.lng,
            zone.coordinates.lat,
            zone.coordinates.lng,
            zone.coordinates.radius
        );

        if (isInside && zone.isActive) {
            return zone;
        }
    }

    // If not inside any zone, find the nearest one
    let nearestZone: DeliveryZone | null = null;
    let minDistance = Infinity;

    for (const zone of zonesWithCoords) {
        if (!zone.coordinates) continue;

        const distance = calculateDistance(
            userLocation.lat,
            userLocation.lng,
            zone.coordinates.lat,
            zone.coordinates.lng
        );

        if (distance < minDistance) {
            minDistance = distance;
            nearestZone = zone;
        }
    }

    return nearestZone;
}

/**
 * Check if a user's location matches their selected delivery zone
 * 
 * @param userLocation - User's GPS coordinates
 * @param selectedZone - The zone selected by the user
 * @returns Object with match status and distance info
 */
export function verifyZoneMatch(
    userLocation: { lat: number; lng: number },
    selectedZone: DeliveryZone
): {
    matches: boolean;
    distance?: number;
    isInside?: boolean;
} {
    if (!selectedZone.coordinates) {
        // Cannot verify without coordinates
        return { matches: true };
    }

    const distance = calculateDistance(
        userLocation.lat,
        userLocation.lng,
        selectedZone.coordinates.lat,
        selectedZone.coordinates.lng
    );

    const isInside = isPointInCircle(
        userLocation.lat,
        userLocation.lng,
        selectedZone.coordinates.lat,
        selectedZone.coordinates.lng,
        selectedZone.coordinates.radius
    );

    return {
        matches: isInside,
        distance,
        isInside,
    };
}

/**
 * Format distance for display
 * 
 * @param meters - Distance in meters
 * @param language - Language for formatting ('ar' or 'en')
 * @returns Formatted distance string
 */
export function formatDistance(meters: number, language: 'ar' | 'en' = 'ar'): string {
    if (meters < 1000) {
        return language === 'ar'
            ? `${Math.round(meters)} متر`
            : `${Math.round(meters)}m`;
    }

    const km = meters / 1000;
    return language === 'ar'
        ? `${km.toFixed(1)} كم`
        : `${km.toFixed(1)}km`;
}
