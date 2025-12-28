import React, { useState, useEffect } from 'react';
import { 
  Brain, 
  Play, 
  CheckCircle, 
  AlertCircle, 
  Copy, 
  Download,
  Trash2,
  Eye,
  Wifi,
  WifiOff,
  Key,
  Server,
  ServerOff
} from 'lucide-react';
import { RuleParser } from '../services/ruleParser';
import { RuleStorage } from '../services/ruleStorage';
import { AuditRule, ConversionResult } from '../types/audit';
import { apiClient } from '../services/apiClient';
import { QuickBooksStorage } from '../services/quickbooksStorage';
import { OAuthButton } from './OAuthButton';

export const RuleConverter: React.FC = () => {
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [savedRules, setSavedRules] = useState<AuditRule[]>([]);
  const [showRuleDetails, setShowRuleDetails] = useState<string | null>(null);
  const [parserStatus, setParserStatus] = useState({ available: false, apiKey: false });
  const [serverStatus, setServerStatus] = useState<{ connected: boolean; error: string | null }>({ connected: false, error: null });
  const [realmId, setRealmId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [entity, setEntity] = useState('Expense');

  useEffect(() => {
    checkServerConnection();
    loadSavedRules();
    loadParserStatus();
    loadQuickBooksCredentials();
    
    // Check OAuth status if we have a stored OAuth connection
    const credentials = QuickBooksStorage.loadCredentials();
    if (credentials?.oauthConnected && credentials.realmId) {
      // OAuth status will be checked by OAuthButton component
    }
  }, []);

  const loadQuickBooksCredentials = () => {
    const credentials = QuickBooksStorage.loadCredentials();
    if (credentials) {
      setRealmId(credentials.realmId);
      setAccessToken(credentials.accessToken || ''); // May be empty for OAuth connections
      setEntity(credentials.entity || 'Expense');
    }
  };

  const checkServerConnection = async () => {
    try {
      await apiClient.healthCheck();
      setServerStatus({ connected: true, error: null });
    } catch (error) {
      setServerStatus({ 
        connected: false, 
        error: error instanceof Error ? error.message : 'Connection failed' 
      });
    }
  };

  const loadSavedRules = async () => {
    try {
      const rules = await RuleStorage.getActiveRules();
      setSavedRules(rules);
    } catch (error) {
      console.error('Failed to load saved rules:', error);
    }
  };

  const loadParserStatus = async () => {
    try {
      const status = await RuleParser.getParserStatus();
      setParserStatus(status);
    } catch (error) {
      console.error('Failed to load parser status:', error);
    }
  };

  const exampleInstructions = [
    "Flag all purchases done using cash and which are not checking",
    "Flag any bill where the expense account is labeled 'Miscellaneous' or something ambigous and the total amount exceeds $500.",
    "Flag all transactions done using Visa card",
    "Flag duplicate transactions with same amount and vendor.",
    "Review any expense after 10 PM or before 6 AM."
  ];

  const handleConvert = async () => {
    if (!instruction.trim() || !realmId.trim() || !entity.trim()) return;
    setIsProcessing(true);
    try {
      // Use OAuth token if available, otherwise use manual token (for backward compatibility)
      const conversionResult = await RuleParser.parseInstruction(
        instruction, 
        realmId, 
        accessToken.trim() || null, // Pass null if empty to use OAuth
        entity
      );
      setResult(conversionResult);
    } catch (error) {
      setResult({
        success: false,
        error: `Conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveRule = async () => {
    if (!result?.rule) return;

    try {
      const savedRule = await RuleStorage.saveRule(result.rule, instruction, 'user');
      await loadSavedRules();
      
      // Clear the form
      setInstruction('');
      setResult(null);
    } catch (error) {
      console.error('Failed to save rule:', error);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await RuleStorage.deleteRule(id);
      await loadSavedRules();
    } catch (error) {
      console.error('Failed to delete rule:', error);
    }
  };

  const handleExportRules = async () => {
    try {
      const rulesJson = await RuleStorage.exportRules();
      const blob = new Blob([rulesJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audit-rules.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export rules:', error);
    }
  };

  const handleClearAllRules = async () => {
    try {
      await RuleStorage.clearAllRules();
      await loadSavedRules();
    } catch (error) {
      console.error('Failed to clear rules:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatRuleForDisplay = (rule: any) => {
    return JSON.stringify(rule, null, 2);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="flex items-center justify-center space-x-3 mb-4">
          <Brain className="w-8 h-8 text-gray-800" />
          <h1 className="text-3xl font-bold text-gray-800 uppercase tracking-wide">AI Rule Converter</h1>
        </div>
        <p className="text-gray-600 max-w-2xl mx-auto">
          Convert natural language audit instructions into machine-executable rules using Google Gemini AI
        </p>
        
        {/* Status Indicators */}
        <div className="flex items-center justify-center space-x-4 mt-4">
          {/* Server Status */}
          <div className={`flex items-center space-x-2 px-3 py-1 border text-sm rounded ${
            serverStatus.connected 
              ? 'border-green-500 text-green-700 bg-green-50' 
              : 'border-red-300 bg-red-50 text-red-600'
          }`}>
            {serverStatus.connected ? (
              <Server className="w-4 h-4" />
            ) : (
              <ServerOff className="w-4 h-4" />
            )}
            <span>
              {serverStatus.connected ? 'Backend Connected' : 'Backend Disconnected'}
            </span>
          </div>

          {/* API Status */}
          <div className={`flex items-center space-x-2 px-3 py-1 border text-sm rounded ${
            parserStatus.available 
              ? 'border-purple-500 text-purple-700 bg-purple-50' 
              : 'border-gray-300 text-gray-600 bg-gray-50'
          }`}>
            {parserStatus.available ? (
              <Wifi className="w-4 h-4" />
            ) : (
              <WifiOff className="w-4 h-4" />
            )}
            <span>
              {parserStatus.available ? 'Gemini AI Connected' : 'Using Fallback Parser'}
            </span>
          </div>
          
          {!parserStatus.apiKey && (
            <div className="flex items-center space-x-2 px-3 py-1 border border-gray-300 text-gray-600 bg-gray-50 text-sm rounded">
              <Key className="w-4 h-4" />
              <span>API Key Required</span>
            </div>
          )}
        </div>

        {!serverStatus.connected && (
          <div className="mt-4 p-4 border border-red-200 bg-red-50 rounded text-left max-w-2xl mx-auto">
            <h4 className="font-medium text-red-900 mb-2">Backend Server Not Connected</h4>
            <p className="text-sm text-red-800 mb-2">
              The backend server is not running. Please start it to use the AI Rule Converter.
            </p>
            <ol className="text-sm text-red-800 space-y-1 list-decimal list-inside">
              <li>Open a terminal in the project directory</li>
              <li>Run <code className="bg-red-100 px-1 text-red-900 rounded">npm run dev:server</code></li>
              <li>Or run <code className="bg-red-100 px-1 text-red-900 rounded">npm run dev</code> to start both frontend and backend</li>
            </ol>
          </div>
        )}

        {!parserStatus.apiKey && serverStatus.connected && (
          <div className="mt-4 p-4 border border-purple-200 bg-purple-50 rounded text-left max-w-2xl mx-auto">
            <h4 className="font-medium text-purple-900 mb-2">Setup Google Gemini API</h4>
            <ol className="text-sm text-purple-800 space-y-1 list-decimal list-inside">
              <li>Visit <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline text-purple-900 hover:text-purple-700">Google AI Studio</a></li>
              <li>Create a new API key</li>
              <li>Add <code className="bg-purple-100 px-1 text-purple-900 rounded">GEMINI_API_KEY=your_api_key</code> to your server/.env file</li>
              <li>Restart the backend server</li>
            </ol>
          </div>
        )}
      </div>

      {/* Main Converter */}
      <div className="bg-white border border-gray-200 p-8 rounded">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Audit Instruction
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Enter your audit rule in plain English..."
              className="w-full h-32 px-4 py-3 bg-gray-50 border border-gray-300 text-gray-800 placeholder-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500 outline-none resize-none disabled:opacity-50 rounded"
              disabled={!serverStatus.connected}
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                QuickBooks Realm ID
              </label>
              {QuickBooksStorage.hasCredentials() && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Saved
                </span>
              )}
            </div>
            <input
              type="text"
              value={realmId}
              onChange={e => {
                setRealmId(e.target.value);
                QuickBooksStorage.updateCredential('realmId', e.target.value);
              }}
              placeholder="Enter your QuickBooks company (realm) ID"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 text-gray-800 placeholder-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50 rounded"
              disabled={!serverStatus.connected}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                OAuth Connection
              </label>
            </div>
            {realmId ? (
              <OAuthButton realmId={realmId} />
            ) : (
              <div className="text-sm text-gray-500">
                Enter Realm ID above to connect via OAuth
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Transaction Entity Type
              </label>
              {QuickBooksStorage.hasCredentials() && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Saved
                </span>
              )}
            </div>
            <input
              type="text"
              value={entity}
              onChange={e => {
                setEntity(e.target.value);
                QuickBooksStorage.updateCredential('entity', e.target.value);
              }}
              placeholder="e.g. Expense, Invoice, Bill, Payment"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 text-gray-800 placeholder-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50 rounded"
              disabled={!serverStatus.connected}
            />
          </div>
          {QuickBooksStorage.hasCredentials() && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  QuickBooksStorage.clearCredentials();
                  setRealmId('');
                  setAccessToken('');
                  setEntity('Expense');
                }}
                className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
              >
                <Trash2 className="w-4 h-4" />
                Clear Saved Credentials
              </button>
              <p className="text-xs text-gray-500 mt-1">
                Your credentials are automatically saved and will persist across page refreshes.
              </p>
            </div>
          )}

          {/* Example Instructions */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Example Instructions:</p>
            <div className="grid gap-2">
              {exampleInstructions.map((example, index) => (
                <button
                  key={index}
                  onClick={() => setInstruction(example)}
                  disabled={!serverStatus.connected}
                  className="text-left p-3 bg-gray-50 border border-gray-300 hover:border-purple-500 text-sm text-gray-700 hover:text-gray-900 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed rounded"
                >
                  "{example}"
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleConvert}
            disabled={!instruction.trim() || !realmId.trim() || !entity.trim() || isProcessing || !serverStatus.connected}
            className="w-full px-6 py-3 bg-purple-600 text-white border border-purple-600 font-medium hover:bg-purple-700 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Processing with AI...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Convert to Rule</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Conversion Result */}
      {result && (
        <div className="bg-white border border-gray-200 p-8 rounded">
          <div className="flex items-center space-x-3 mb-6">
            {result.success ? (
              <CheckCircle className="w-6 h-6 text-green-600" />
            ) : (
              <AlertCircle className="w-6 h-6 text-red-600" />
            )}
            <h3 className="text-xl font-semibold text-gray-800">
              {result.success ? 'Conversion Successful' : 'Conversion Failed'}
            </h3>
            {result.success && result.rule && (
              <div className="ml-auto flex items-center space-x-2">
                <span className="text-sm text-gray-500">Powered by</span>
                <div className="flex items-center space-x-1">
                  {parserStatus.available ? (
                    <span className="text-sm font-medium text-purple-600">Gemini AI</span>
                  ) : (
                    <span className="text-sm font-medium text-gray-600">Fallback Parser</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {result.success && result.rule ? (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 p-4 rounded">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Generated Rule</span>
                  <button
                    onClick={() => copyToClipboard(formatRuleForDisplay(result.rule))}
                    className="p-1 hover:bg-gray-200 rounded transition-colors duration-200"
                  >
                    <Copy className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
                <pre className="text-sm text-gray-800 overflow-x-auto">
                  {formatRuleForDisplay(result.rule)}
                </pre>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Confidence Score: <span className="font-medium text-gray-800">{(result.rule.confidence_score * 100).toFixed(1)}%</span>
                </div>
                <button
                  onClick={handleSaveRule}
                  className="px-4 py-2 bg-purple-600 text-white border border-purple-600 font-medium hover:bg-purple-700 transition-colors duration-200 rounded"
                >
                  Save Rule
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-red-600">{result.error}</p>
              {result.suggestions && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Suggestions:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                    {result.suggestions.map((suggestion, index) => (
                      <li key={index}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Saved Rules */}
      <div className="bg-white border border-gray-200 p-8 rounded">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-800">Saved Rules ({savedRules.length})</h3>
          <div className="flex space-x-2">
            <button
              onClick={handleExportRules}
              disabled={!serverStatus.connected}
              className="px-4 py-2 bg-white text-gray-700 border border-gray-300 font-medium hover:bg-gray-50 transition-colors duration-200 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
            <button
              onClick={handleClearAllRules}
              disabled={!serverStatus.connected}
              className="px-4 py-2 bg-white text-gray-700 border border-gray-300 font-medium hover:bg-gray-50 transition-colors duration-200 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear All</span>
            </button>
          </div>
        </div>

        {savedRules.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No rules saved yet. Convert your first instruction above!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {savedRules.map((rule) => (
              <div key={rule.id} className="border border-gray-200 p-4 rounded hover:border-purple-300 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="px-2 py-1 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded">
                        {rule.rule_type}
                      </span>
                      <span className="px-2 py-1 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded">
                        {rule.action}
                      </span>
                      <span className="text-xs text-gray-500">v{rule.version}</span>
                      <span className="text-xs text-gray-500">
                        {(rule.confidence_score * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 mb-2">{rule.original_instruction}</p>
                    <p className="text-xs text-gray-500">{rule.reason}</p>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => setShowRuleDetails(showRuleDetails === rule.id ? null : rule.id)}
                      className="p-2 hover:bg-gray-100 border border-gray-300 transition-colors duration-200 rounded"
                    >
                      <Eye className="w-4 h-4 text-gray-600" />
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      disabled={!serverStatus.connected}
                      className="p-2 hover:bg-gray-100 border border-gray-300 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed rounded"
                    >
                      <Trash2 className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>

                {showRuleDetails === rule.id && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-200 p-3 overflow-x-auto rounded">
                      {formatRuleForDisplay(rule)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};