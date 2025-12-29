class ApiClient {
  private baseURL: string;

  constructor() {
    this.baseURL = import.meta.env.VITE_API_URL || '/api';
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        // Create an error object that preserves the full error response
        const error = new Error(data.error || `HTTP error! status: ${response.status}`) as Error & { suggestions?: string[]; data?: any; success?: boolean };
        error.suggestions = data.suggestions;
        error.data = data;
        error.success = data.success;
        throw error;
      }

      return data;
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    return this.request('/health');
  }

  // Rule endpoints
  async getRules(activeOnly = false) {
    const query = activeOnly ? '?active=true' : '';
    return this.request(`/rules${query}`);
  }

  async getRule(id: string) {
    return this.request(`/rules/${id}`);
  }

  async createRule(parsedRule: any, originalInstruction: string, createdBy = 'user') {
    return this.request('/rules', {
      method: 'POST',
      body: JSON.stringify({
        parsedRule,
        originalInstruction,
        createdBy
      }),
    });
  }

  async updateRule(id: string, updates: any) {
    return this.request(`/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteRule(id: string) {
    return this.request(`/rules/${id}`, {
      method: 'DELETE',
    });
  }

  async getRuleVersions(ruleType: string) {
    return this.request(`/rules/versions/${ruleType}`);
  }

  async rollbackRule(ruleType: string, version: number) {
    return this.request(`/rules/rollback/${ruleType}/${version}`, {
      method: 'POST',
    });
  }

  async exportRules() {
    return this.request('/rules/export/all');
  }

  async importRules(rules: any[]) {
    return this.request('/rules/import', {
      method: 'POST',
      body: JSON.stringify({ rules }),
    });
  }

  async clearAllRules() {
    return this.request('/rules/clear/all', {
      method: 'DELETE',
    });
  }

  async getRuleStats() {
    return this.request('/rules/stats/overview');
  }

  // Gemini endpoints
  async getGeminiStatus() {
    return this.request('/gemini/status');
  }

  async parseInstruction(instruction: string, realmId: string, accessToken: string | null = null, entity: string) {
    // If accessToken is not provided, OAuth will be used automatically on the backend
    const body: any = { instruction, realmId, entity };
    if (accessToken) {
      body.accessToken = accessToken;
    }
    return this.request('/gemini/parse', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Execution endpoints
  async executeRule(rule: any, realmId: string, accessToken: string | null = null, entity: string) {
    const body: any = { rule, realmId, entity };
    if (accessToken) {
      body.accessToken = accessToken;
    }
    return this.request('/execution/rule', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async executeRules(rules: any[], realmId: string, accessToken: string | null = null, entity: string) {
    const body: any = { rules, realmId, entity };
    if (accessToken) {
      body.accessToken = accessToken;
    }
    return this.request('/execution/rules', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async executeAllActiveRules(rules: any[], realmId: string, accessToken: string | null = null, entity: string) {
    const body: any = { rules, realmId, entity };
    if (accessToken) {
      body.accessToken = accessToken;
    }
    return this.request('/execution/all-active', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Get complete QuickBooks data context for analysis
  async getDataContext(realmId: string, accessToken: string | null = null, entity: string) {
    const params = new URLSearchParams({ realmId, entity });
    if (accessToken) {
      params.set('accessToken', accessToken);
    }
    return this.request(`/execution/data-context?${params}`);
  }
}

export const apiClient = new ApiClient();