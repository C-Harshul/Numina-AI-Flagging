// Shared OAuth state store for CSRF protection
// In production, use a database or Redis instead of in-memory storage
export const oauthStateStore = new Map();

