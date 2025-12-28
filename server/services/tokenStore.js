// Shared token store for OAuth tokens
// In production, use a database or Redis instead of in-memory storage
export const tokenStore = new Map(); // realmId -> token data

