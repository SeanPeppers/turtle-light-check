import exifr from 'exifr'

/** Phone photo -> GPS from EXIF, or null if location was stripped / turned off. */
export async function gpsFromPhoto(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const gps = await exifr.gps(file)
    return gps && Number.isFinite(gps.latitude) ? { lat: gps.latitude, lng: gps.longitude } : null
  } catch {
    return null
  }
}
