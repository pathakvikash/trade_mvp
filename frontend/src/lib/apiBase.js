// Dependency-free (no axios) so any module or test can import it. Backend base URL, no trailing slash; empty = same origin.
export const API = (process.env.REACT_APP_API_URL || '').replace(/\/+$/, '');
