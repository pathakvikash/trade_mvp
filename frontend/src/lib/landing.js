// Pages a user may pick as their post-login landing page (mirrors the backend enum); anything else falls back to the dashboard.
export const LANDING_PAGES = ['dashboard', 'trade', 'market', 'portfolio', 'derivatives', 'liquidation'];
export const landingPath = (prefs) => `/${LANDING_PAGES.includes(prefs?.landingPage) ? prefs.landingPage : 'dashboard'}`;
