/* Our Journey — Google Drive bridge configuration
 *
 * The Google Client ID is public and safe to ship in a browser app.
 * The Cloudflare Worker URL is the only required value here.
 * NEVER place the Google OAuth Client Secret or refresh token in this file.
 */
window.OUR_JOURNEY_CONFIG = Object.freeze({
  GOOGLE_CLIENT_ID: "352730696085-iq5q2o0uct9c44n96mfdvp9dmhjmq94o.apps.googleusercontent.com",
  DRIVE_API_BASE: "https://our-journey-drive-api.myintmoehein0115024.workers.dev",
  // Optional hint. The Worker verifies it first, then falls back to finding
  // the accessible "Our-Journey" folder by name in the owner Drive.
  DRIVE_FOLDER_ID: "1HW4yhcGESSUoRTBuDO23E65ErBiPL6i"
});
