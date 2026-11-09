// Google Analytics 4 settings shared by the tag (GoogleAnalytics.astro), the consent banner (ConsentBanner.astro)
// and the footers' cookie notice.

const measurementId: string = import.meta.env.PUBLIC_GA_MEASUREMENT_ID?.trim() ?? '';

/** The GA4 web stream's ID, when it is set in .env and looks right. */
export const gaMeasurementId = /^G-[A-Z0-9]+$/.test(measurementId) ? measurementId : '';

/** Only production builds send data, so local development never shows up in the real reports. */
export const analyticsEnabled = import.meta.env.PROD && Boolean(gaMeasurementId);

/** The banner and cookie notice also show in development, so they can be tried out; Google's script still never loads. */
export const consentEnabled = analyticsEnabled || import.meta.env.DEV;

/** Where the visitor's choice is kept: 'granted' or 'denied'. */
export const consentStorageKey = 'oz-analytics-consent';

/** Fired on window with the choice as `detail` when the visitor picks in the banner. */
export const consentEventName = 'oz-analytics-consent';
