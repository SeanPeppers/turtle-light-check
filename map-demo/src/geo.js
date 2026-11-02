import exifr from "exifr";

// Default demo location: Fort Myers Beach, Estero Blvd area
export const ORIGIN = { lat: 26.45, lng: -81.955 };

/** Phone photo -> {lat,lng} from EXIF GPS, or null if location was stripped. */
export async function gpsFromPhoto(file) {
  try {
    const gps = await exifr.gps(file);
    return gps ? { lat: gps.latitude, lng: gps.longitude } : null;
  } catch {
    return null;
  }
}

/** Browser location fallback (needs https or localhost). */
export function gpsFromBrowser(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs }
    );
  });
}

/** Gazebo pose in meters (x = east, y = north) -> lat/lng around a real beach origin. */
export function gazeboToLatLng(x, y, origin = ORIGIN) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat + y / mPerDegLat, lng: origin.lng + x / mPerDegLng };
}

/**
 * Parse Gazebo poses CSV. Expected header: t,x,y  (seconds, meters).
 * Returns [{t, x, y, lat, lng}] sorted by t.
 */
export function parsePosesCsv(text, origin = ORIGIN) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(",").map((h) => h.trim().toLowerCase());
  const iT = header.indexOf("t"), iX = header.indexOf("x"), iY = header.indexOf("y");
  if (iT < 0 || iX < 0 || iY < 0) throw new Error("poses.csv needs columns t,x,y");
  return lines
    .map((l) => l.split(",").map(Number))
    .filter((r) => r.length > Math.max(iT, iX, iY) && r.every((n) => !Number.isNaN(n)))
    .map((r) => ({ t: r[iT], x: r[iX], y: r[iY], ...gazeboToLatLng(r[iX], r[iY], origin) }))
    .sort((a, b) => a.t - b.t);
}

/** frame_0007.jpg -> 7 (seconds, from tools/extract_frames.py). */
export function frameTimeFromName(name) {
  const m = name.match(/(\d+)(?=\.\w+$)/);
  return m ? Number(m[1]) : null;
}

/** Nearest pose to time t. */
export function poseAt(poses, t) {
  let best = poses[0];
  for (const p of poses) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}
