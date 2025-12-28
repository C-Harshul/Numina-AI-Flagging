import { ConversionResult } from '../types/audit';
import { apiClient } from './apiClient';

export class RuleParser {
  static async parseInstruction(instruction: string, realmId: string, accessToken: string | null, entity: string): Promise<ConversionResult> {
    if (!instruction.trim()) {
      return {
        success: false,
        error: 'Instruction cannot be empty',
        suggestions: ['Please provide a clear audit instruction']
      };
    }

    try {
      const response = await apiClient.parseInstruction(instruction, realmId, accessToken, entity) as ConversionResult;
      return response;
    } catch (error) {
      console.error('Rule parsing error:', error);
      // Preserve suggestions from the backend error response if available
      const errorWithSuggestions = error as Error & { suggestions?: string[] };
      return {
        success: false,
        error: `Failed to parse instruction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestions: errorWithSuggestions.suggestions || [
          'Check your internet connection',
          'Verify the backend server is running',
          'Try simplifying your instruction'
        ]
      } as ConversionResult;
    }
  }

  static async getParserStatus() {
    try {
      const response = await apiClient.getGeminiStatus() as { data: any };
      return response.data;
    } catch (error) {
      console.error('Failed to get parser status:', error);
      return { available: false, apiKey: false };
    }
  }

  static async isGeminiAvailable(): Promise<boolean> {
    try {
      const status = await this.getParserStatus();
      return status.available;
    } catch {
      return false;
    }
  }
}