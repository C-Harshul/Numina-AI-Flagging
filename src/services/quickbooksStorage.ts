/**
 * Service for managing QuickBooks credentials in localStorage
 * Persists credentials across page refreshes and navigation
 */

const STORAGE_KEY = 'quickbooks_credentials';

export interface QuickBooksCredentials {
  realmId: string;
  accessToken: string;
  entity: string;
  oauthConnected?: boolean; // Indicates if connected via OAuth
}

export class QuickBooksStorage {
  /**
   * Save QuickBooks credentials to localStorage
   */
  static saveCredentials(credentials: QuickBooksCredentials): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    } catch (error) {
      console.error('Failed to save QuickBooks credentials:', error);
    }
  }

  /**
   * Load QuickBooks credentials from localStorage
   */
  static loadCredentials(): QuickBooksCredentials | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      
      const credentials = JSON.parse(stored) as QuickBooksCredentials;
      
      // Validate that required fields are present
      // For OAuth connections, we only need realmId
      if (credentials.realmId) {
        // Set defaults for missing fields
        if (!credentials.entity) {
          credentials.entity = 'Expense';
        }
        return credentials;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to load QuickBooks credentials:', error);
      return null;
    }
  }

  /**
   * Update a specific credential field
   */
  static updateCredential<K extends keyof QuickBooksCredentials>(
    field: K,
    value: QuickBooksCredentials[K]
  ): void {
    const current = this.loadCredentials() || {
      realmId: '',
      accessToken: '',
      entity: 'Expense'
    };
    
    current[field] = value;
    this.saveCredentials(current);
  }

  /**
   * Clear all QuickBooks credentials from localStorage
   */
  static clearCredentials(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear QuickBooks credentials:', error);
    }
  }

  /**
   * Check if credentials are stored
   */
  static hasCredentials(): boolean {
    return this.loadCredentials() !== null;
  }

  /**
   * Save OAuth connection (realmId only, tokens stored server-side)
   */
  static saveOAuthConnection(realmId: string, entity: string = 'Expense'): void {
    const current = this.loadCredentials() || {
      realmId: '',
      accessToken: '',
      entity: 'Expense',
      oauthConnected: false
    };
    
    current.realmId = realmId;
    current.entity = entity;
    current.oauthConnected = true;
    // Don't clear accessToken in case user wants to use manual token as fallback
    
    this.saveCredentials(current);
  }

  /**
   * Check if OAuth is connected
   */
  static isOAuthConnected(): boolean {
    const credentials = this.loadCredentials();
    return credentials?.oauthConnected === true && !!credentials.realmId;
  }
}

