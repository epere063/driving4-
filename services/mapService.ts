
import { checkViewQuality, verifySubjectMatch, performSmartScout } from './geminiService';
import { SmartScoutTarget, PropertyMetadata } from '../types';

interface Coordinates {
  lat: number;
  lng: number;
}

interface StreetViewMetadata {
  pano_id: string;
  location: {
    lat: number;
    lng: number;
  };
  date?: string; // YYYY-MM
  status: string;
  error_message?: string;
}

interface GeocodingResponse {
  status: string;
  error_message?: string;
  results: {
    geometry: {
      location: Coordinates;
    };
  }[];
}

const FALLBACK_MAPS_KEY = "AIzaSyDU8Cf93OJlWJfSjuBXDwPDsKTiMMMm_Yc";
const MAX_IMG_SIZE = "640x480"; // Landscape (4:3)

// Calculate heading from Camera (lat1, lon1) to House (lat2, lon2)
function calculateHeading(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  let brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

// Calculate a new coordinate given a starting point, bearing, and distance (meters)
function getOffsetCoordinate(lat: number, lng: number, bearing: number, distanceMeters: number): Coordinates {
    const R = 6378137; // Earth Radius in meters
    const d = distanceMeters;
    const brng = bearing * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lng * Math.PI / 180;

    const lat2 = Math.asin( Math.sin(lat1)*Math.cos(d/R) +
         Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng) );
    const lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1),
         Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2));

    return {
        lat: lat2 * 180 / Math.PI,
        lng: lon2 * 180 / Math.PI
    };
}

async function getApiKey(): Promise<string> {
  let rawKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!rawKey && process.env.API_KEY && process.env.API_KEY.startsWith("AIza")) {
    rawKey = process.env.API_KEY;
  }
  if (rawKey && rawKey.startsWith("GEMIN")) {
     rawKey = undefined;
  }
  if (!rawKey) {
     console.warn("Using fallback API key for Google Maps service.");
     rawKey = FALLBACK_MAPS_KEY;
  }
  return rawKey.trim().replace(/^['"]|['"]$/g, '');
}

// Helper to check if dateA is newer than dateB (YYYY-MM string comparison)
function isNewer(dateA: string | undefined, dateB: string | undefined): boolean {
    if (!dateA) return false;
    if (!dateB) return true;
    return dateA > dateB; 
}

// Recency Sweep: Search adjacent points to find the newest image
async function findNewestPanorama(
    baseMeta: StreetViewMetadata,
    houseLoc: Coordinates,
    apiKey: string
): Promise<StreetViewMetadata> {
    const currentYear = new Date().getFullYear();
    if (baseMeta.date && parseInt(baseMeta.date.split('-')[0]) >= currentYear - 2) {
        return baseMeta;
    }

    console.log(`Initial Pano Date: ${baseMeta.date || 'Unknown'}. Attempting to find newer imagery...`);
    const headingToHouse = calculateHeading(baseMeta.location.lat, baseMeta.location.lng, houseLoc.lat, houseLoc.lng);
    
    const checks = [
        { dist: 10, bearingOffset: 90 },
        { dist: 20, bearingOffset: 90 },
        { dist: 10, bearingOffset: -90 },
        { dist: 20, bearingOffset: -90 },
    ];

    let bestCandidate = baseMeta;

    for (const check of checks) {
        const sweepBearing = (headingToHouse + check.bearingOffset + 360) % 360;
        const scanPos = getOffsetCoordinate(baseMeta.location.lat, baseMeta.location.lng, sweepBearing, check.dist);
        const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${scanPos.lat},${scanPos.lng}&radius=10&key=${apiKey}`;
        
        try {
            const res = await fetch(url);
            const candidate: StreetViewMetadata = await res.json();
            if (candidate.status === "OK" && candidate.date) {
                if (isNewer(candidate.date, bestCandidate.date)) {
                    console.log(`Found newer pano! ${candidate.date} (vs ${bestCandidate.date || 'old'})`);
                    bestCandidate = candidate;
                }
            }
        } catch (e) { console.warn(e); }
    }
    return bestCandidate;
}

// Helper to fetch a single Street View image with specific parameters
async function fetchSingleStreetView(
  location: Coordinates, 
  heading: number,
  pitch: number,
  fov: number,
  panoId: string | null,
  apiKey: string,
  name: string
): Promise<File | null> {
    const locationParam = panoId ? `pano=${panoId}` : `location=${location.lat},${location.lng}`;
    const url = `https://maps.googleapis.com/maps/api/streetview?size=${MAX_IMG_SIZE}&${locationParam}&fov=${fov}&heading=${heading}&pitch=${pitch}&key=${apiKey}`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            return new File([await res.blob()], `${name}.jpg`, { type: "image/jpeg" });
        }
    } catch (e) {
        console.warn(`Failed to fetch ${name}`, e);
    }
    return null;
}

// Define the camera mechanics for each Smart Scout sector
const SECTOR_CONFIGS: Record<string, { pitch: number, headingOffset: number, fov: number }> = {
    'roof_left': { pitch: 10, headingOffset: -20, fov: 40 }, // Wide FOV, low pitch
    'roof_center': { pitch: 10, headingOffset: 0, fov: 40 },
    'roof_right': { pitch: 10, headingOffset: 20, fov: 40 },
    'facade_left': { pitch: 0, headingOffset: -20, fov: 30 },
    'facade_center': { pitch: 0, headingOffset: 0, fov: 30 }, // Super Zoom on front door/window
    'facade_right': { pitch: 0, headingOffset: 20, fov: 30 },
    'ground_left': { pitch: -10, headingOffset: -20, fov: 30 },
    'ground_center': { pitch: -10, headingOffset: 0, fov: 30 },
    'ground_right': { pitch: -10, headingOffset: 20, fov: 30 },
};

export async function getPropertyImages(address: string): Promise<{ files: File[], metadata: PropertyMetadata }> {
  const API_KEY = await getApiKey();
  const finalFiles: File[] = [];

  // Metadata Defaults
  const propMeta: PropertyMetadata = {
      streetview_available: false,
      streetview_date: null,
      streetview_year: null,
      aerial_available: false,
      aerial_date: null
  };

  // 1. Geocode
  const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
  const geoRes = await fetch(geoUrl);
  const geoData: GeocodingResponse = await geoRes.json();
  if (geoData.status !== "OK" || !geoData.results?.[0]) throw new Error(`Geocoding failed: ${geoData.status}`);
  const houseLocation = geoData.results[0].geometry.location;

  // 2. Fetch Aerial Views
  const aerialZooms = [{ z: 21, name: "aerial_ultra_detail" }, { z: 19, name: "aerial_context" }];
  let aerialSuccess = false;
  for (const az of aerialZooms) {
      const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${houseLocation.lat},${houseLocation.lng}&zoom=${az.z}&size=${MAX_IMG_SIZE}&maptype=satellite&key=${API_KEY}`;
      try {
        const satRes = await fetch(satUrl);
        if (satRes.ok) {
            finalFiles.push(new File([await satRes.blob()], `${az.name}.jpg`, { type: "image/jpeg" }));
            aerialSuccess = true;
        }
      } catch(e) { console.warn(`Aerial ${az.z} failed`, e); }
  }
  propMeta.aerial_available = aerialSuccess;

  // 3. Initial Street View Fetch & Verify
  const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${houseLocation.lat},${houseLocation.lng}&key=${API_KEY}`;
  const metaRes = await fetch(metaUrl);
  let metaData: StreetViewMetadata = await metaRes.json();
  
  if (metaData.status !== "OK" || !metaData.location) { 
      return { files: finalFiles, metadata: propMeta }; 
  }

  // Recency Check
  const bestPanoMeta = await findNewestPanorama(metaData, houseLocation, API_KEY);
  let finalPanoId = bestPanoMeta.pano_id;
  let finalLoc = bestPanoMeta.location;
  let finalHeading = calculateHeading(finalLoc.lat, finalLoc.lng, houseLocation.lat, houseLocation.lng);
  
  if (bestPanoMeta.date) {
      propMeta.streetview_date = bestPanoMeta.date;
      propMeta.streetview_year = parseInt(bestPanoMeta.date.split('-')[0]);
  }

  // Establish MASTER REFERENCE (The Front View)
  let masterReferenceImage: File | null = null;
  
  // Try to lock onto the best front view
  let attempt = 0;
  while (attempt < 5) {
      const label = attempt === 0 ? "front_center_master" : `front_center_retry_${attempt}`;
      const testImage = await fetchSingleStreetView(finalLoc, finalHeading, 0, 90, finalPanoId, API_KEY, label);
      if (!testImage) break;

      const quality = await checkViewQuality(testImage);
      if (quality.is_front_visible) {
          masterReferenceImage = testImage;
          finalFiles.push(masterReferenceImage); // Add Master to results
          break;
      }

      // Adjustment Logic
      if (quality.suggested_action === "ROTATE_CW") finalHeading = (finalHeading + quality.action_magnitude + 360) % 360;
      else if (quality.suggested_action === "ROTATE_CCW") finalHeading = (finalHeading - quality.action_magnitude + 360) % 360;
      else if (quality.suggested_action.includes("MOVE")) {
          const moveBearing = quality.suggested_action === "MOVE_RIGHT" ? (finalHeading + 90) % 360 : (finalHeading - 90 + 360) % 360;
          const newLoc = getOffsetCoordinate(finalLoc.lat, finalLoc.lng, moveBearing, quality.action_magnitude);
           // Simple check if new loc exists
          const mRes = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${newLoc.lat},${newLoc.lng}&radius=15&key=${API_KEY}`);
          const mData = await mRes.json();
          if (mData.status === "OK") {
               finalLoc = mData.location;
               finalPanoId = mData.pano_id;
               finalHeading = calculateHeading(finalLoc.lat, finalLoc.lng, houseLocation.lat, houseLocation.lng);
          }
      } else break; 
      attempt++;
  }

  if (!masterReferenceImage) {
      console.warn("Could not establish Master Reference for property.");
      propMeta.streetview_available = false; // Street view failed
      return { files: finalFiles, metadata: propMeta };
  }

  // Confirm Street View Availability
  propMeta.streetview_available = true;

  // 4. Smart Scout (Zooms)
  const smartTargets = await performSmartScout(masterReferenceImage);
  console.log(`Smart Scout targets:`, smartTargets.map(t => t.sector));

  const coreShots = ['facade_center', 'roof_center']; 
  const targetsToFetch = new Set([...coreShots, ...smartTargets.map(t => t.sector)]);
  
  for (const sectorKey of targetsToFetch) {
      const config = SECTOR_CONFIGS[sectorKey];
      if (config) {
         const targetHeading = (finalHeading + config.headingOffset + 360) % 360;
         const label = `zoom_${sectorKey}`;
         const candidate = await fetchSingleStreetView(finalLoc, targetHeading, config.pitch, config.fov, finalPanoId, API_KEY, label);
         
         if (candidate) {
             const verification = await verifySubjectMatch(masterReferenceImage, candidate);
             if (verification.is_match) finalFiles.push(candidate);
         }
      }
  }

  // 5. VIRTUAL DRIVE-BY (Side/Oblique Views)
  // Instead of panning from the same spot, we move the camera 15-20 meters down the street
  // perpendicular to the house heading, then look BACK at the house.
  
  const driveByConfigs = [
      { name: 'drive_by_left', bearingOffset: -90, distance: 15 },
      { name: 'drive_by_right', bearingOffset: 90, distance: 15 }
  ];

  for (const drive of driveByConfigs) {
      // 1. Calculate direction of the street (perpendicular to house heading)
      const streetBearing = (finalHeading + drive.bearingOffset + 360) % 360;
      
      // 2. Move camera to new position
      const driveByLoc = getOffsetCoordinate(finalLoc.lat, finalLoc.lng, streetBearing, drive.distance);

      // 3. Verify this new location actually has street view coverage
      const driveMetaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${driveByLoc.lat},${driveByLoc.lng}&radius=10&key=${API_KEY}`;
      
      try {
        const driveRes = await fetch(driveMetaUrl);
        const driveData: StreetViewMetadata = await driveRes.json();

        if (driveData.status === "OK" && driveData.pano_id) {
             // 4. Calculate NEW heading looking BACK at the house from new position
             const lookBackHeading = calculateHeading(driveData.location.lat, driveData.location.lng, houseLocation.lat, houseLocation.lng);
             
             const driveCandidate = await fetchSingleStreetView(
                 driveData.location, 
                 lookBackHeading, 
                 0, 
                 65, // Slightly wider FOV for context 
                 driveData.pano_id, 
                 API_KEY, 
                 drive.name
             );

             if (driveCandidate) {
                  // Verify it's still the same house (crucial for row houses)
                  const verification = await verifySubjectMatch(masterReferenceImage, driveCandidate);
                  if (verification.is_match) {
                      finalFiles.push(driveCandidate);
                      console.log(`Accepted ${drive.name}: ${verification.reason}`);
                  } else {
                      console.warn(`Rejected ${drive.name}: ${verification.reason}`);
                  }
             }
        }
      } catch(e) { console.warn(`Drive-by ${drive.name} failed`, e); }
  }

  return { files: finalFiles, metadata: propMeta };
}
