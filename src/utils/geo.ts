export interface IPoint {
    latitude: number;
    longitude: number;
}

const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_DEGREE = 111320;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const distanceMeters = (from: IPoint, to: IPoint) => {
    const dLat = toRadians(to.latitude - from.latitude);
    const dLng = toRadians(to.longitude - from.longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLng / 2) ** 2;

    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
};

export const boundingBox = (center: IPoint, radiusMeters: number) => {
    const latDelta = radiusMeters / METERS_PER_DEGREE;
    const lngDelta = radiusMeters / (METERS_PER_DEGREE * Math.max(Math.cos(toRadians(center.latitude)), 0.01));

    return {
        minLat: center.latitude - latDelta,
        maxLat: center.latitude + latDelta,
        minLng: center.longitude - lngDelta,
        maxLng: center.longitude + lngDelta,
    };
};

export const roundCoordinate = (value: number, digits = 4) => Number(value.toFixed(digits));
