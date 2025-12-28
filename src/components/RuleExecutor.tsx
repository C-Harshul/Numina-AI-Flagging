import React, { useState, useEffect } from 'react';
import { 
  Play, 
  CheckCircle, 
  AlertCircle, 
  Download,
  Eye,
  Clock,
  BarChart3,
  Zap,
  Database,
  AlertTriangle,
  Trash2
} from 'lucide-react';
import { RuleStorage } from '../services/ruleStorage';
import { AuditRule } from '../types/audit';
import { apiClient } from '../services/apiClient';
import { QuickBooksStorage } from '../services/quickbooksStorage';
import { OAuthButton } from './OAuthButton';

interface ExecutionResult {
  rule_id: string;
  rule_type: string;
  entity: string;
  total_transactions: number;
  flagged_transactions: Array<{
    id: string;
    transaction_data: Record<string, unknown>;
    matched_conditions: Array<{
      field: string;
      operator: string;
      value: string | number | boolean;
      actual_value: string | number | boolean;
      flagged_field_data?: {
        // For Line fields
        line_index?: number;
        line_data?: Record<string, unknown>;
        field_path?: string;
        field_value?: any;
        // For regular fields
        parent_path?: string;
        parent_object?: Record<string, unknown>;
        field_name?: string;
      };
    }>;
    action: string;
    reason: string;
    flagged_at: string;
  }>;
  execution_summary: {
    total_checked: number;
    flagged_count: number;
    execution_time: number;
    flag_rate: string;
  };
}

interface BatchExecutionResult {
  summary: {
    total_rules_executed: number;
    successful_executions: number;
    failed_executions: number;
    total_transactions_checked: number;
    total_transactions_flagged: number;
    total_execution_time: number;
  };
  individual_results: Array<{
    success: boolean;
    data?: ExecutionResult;
    error?: string;
  }>;
  executed_at: string;
}

export const RuleExecutor: React.FC = () => {
  const [savedRules, setSavedRules] = useState<AuditRule[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [realmId, setRealmId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [entity, setEntity] = useState('Expense');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<BatchExecutionResult | null>(null);
  const [showDetails, setShowDetails] = useState<string | null>(null);
  const [expandedFieldData, setExpandedFieldData] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<{ connected: boolean; error: string | null }>({ connected: false, error: null });
  const [dataContext, setDataContext] = useState<Record<string, unknown> | null>(null);
  const [showDataContext, setShowDataContext] = useState(false);

  useEffect(() => {
    checkServerConnection();
    loadSavedRules();
    loadQuickBooksCredentials();
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

  const handleRuleSelection = (ruleId: string) => {
    setSelectedRules(prev => 
      prev.includes(ruleId) 
        ? prev.filter(id => id !== ruleId)
        : [...prev, ruleId]
    );
  };

  const handleSelectAll = () => {
    setSelectedRules(savedRules.map(rule => rule.id));
  };

  const handleDeselectAll = () => {
    setSelectedRules([]);
  };

  const handleExecuteSelected = async () => {
    if (selectedRules.length === 0 || !realmId.trim() || !entity.trim()) {
      return;
    }

    setIsExecuting(true);
    try {
      const rulesToExecute = savedRules.filter(rule => selectedRules.includes(rule.id));
      const result = await apiClient.executeRules(rulesToExecute, realmId, accessToken.trim() || null, entity) as { data: BatchExecutionResult };
      setExecutionResult(result.data);
    } catch (error) {
      console.error('Execution failed:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExecuteAllActive = async () => {
    if (!realmId.trim() || !entity.trim()) {
      return;
    }

    setIsExecuting(true);
    try {
      const result = await apiClient.executeAllActiveRules(savedRules, realmId, accessToken.trim() || null, entity) as { data: BatchExecutionResult };
      setExecutionResult(result.data);
    } catch (error) {
      console.error('Execution failed:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExecuteSingleRule = async (rule: AuditRule) => {
    if (!realmId.trim() || !entity.trim()) {
      return;
    }

    setIsExecuting(true);
    try {
      const result = await apiClient.executeRule(rule, realmId, accessToken.trim() || null, entity) as { data: ExecutionResult };
      setExecutionResult({
        summary: {
          total_rules_executed: 1,
          successful_executions: 1,
          failed_executions: 0,
          total_transactions_checked: result.data.execution_summary.total_checked,
          total_transactions_flagged: result.data.execution_summary.flagged_count,
          total_execution_time: result.data.execution_summary.execution_time
        },
        individual_results: [{ success: true, data: result.data }],
        executed_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Execution failed:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  const exportResults = () => {
    if (!executionResult) return;
    
    const dataStr = JSON.stringify(executionResult, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-results-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatExecutionTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const handleFetchDataContext = async () => {
    if (!realmId.trim() || !entity.trim()) {
      return;
    }

    try {
      const result = await apiClient.getDataContext(realmId, accessToken.trim() || null, entity) as { data: Record<string, unknown> };
      setDataContext(result.data);
      setShowDataContext(true);
    } catch (error) {
      console.error('Failed to fetch data context:', error);
    }
  };

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-800 mb-4 uppercase tracking-wide">
            Rule Execution Engine
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Execute your audit rules against QuickBooks data to identify flagged transactions and compliance issues.
          </p>
        </div>

        {/* Connection Status */}
        <div className={`p-4 border rounded ${
          serverStatus.connected 
            ? 'border-green-500 bg-green-50 text-green-800' 
            : 'border-red-300 bg-red-50 text-red-800'
        }`}>
          <div className="flex items-center gap-2">
            {serverStatus.connected ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span className="font-medium">
              {serverStatus.connected ? 'Connected to server' : 'Server connection failed'}
            </span>
          </div>
          {serverStatus.error && (
            <p className="text-sm mt-1">{serverStatus.error}</p>
          )}
        </div>

        {/* Configuration */}
        <div className="bg-white border border-gray-200 p-8 rounded">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">QuickBooks Configuration</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">
                  Realm ID
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
                placeholder="Enter QuickBooks Realm ID"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none disabled:opacity-50"
                disabled={!serverStatus.connected}
              />
            </div>
            
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-2">
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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Entity Type
                </label>
                {QuickBooksStorage.hasCredentials() && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Saved
                  </span>
                )}
              </div>
              <select
                value={entity}
                onChange={e => {
                  setEntity(e.target.value);
                  QuickBooksStorage.updateCredential('entity', e.target.value);
                }}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none disabled:opacity-50"
                disabled={!serverStatus.connected}
              >
                <option value="Expense">Expense</option>
                <option value="Bill">Bill</option>
                <option value="Purchase">Purchase</option>
                <option value="Invoice">Invoice</option>
                <option value="Payment">Payment</option>
              </select>
            </div>
          </div>
          
          {QuickBooksStorage.hasCredentials() && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <button
                onClick={() => {
                  QuickBooksStorage.clearCredentials();
                  setRealmId('');
                  setAccessToken('');
                  setEntity('Expense');
                }}
                className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 className="w-4 h-4" />
                Clear Saved Credentials
              </button>
              <p className="text-xs text-slate-500 mt-1">
                Your credentials are automatically saved and will persist across page refreshes.
              </p>
            </div>
          )}
          
          <div className="mt-6 pt-6 border-t border-slate-200">
            <button
              onClick={handleFetchDataContext}
              disabled={!realmId.trim() || !entity.trim() || !serverStatus.connected}
              className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Database className="w-4 h-4" />
              View Complete Data Context
            </button>
            <p className="text-sm text-slate-600 mt-2">
              Fetch and view the complete QuickBooks data structure for better rule understanding
            </p>
          </div>
        </div>

        {/* Rule Selection */}
        <div className="bg-white border border-gray-200 p-8 rounded">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-800">Select Rules to Execute</h2>
            <div className="flex gap-2">
              <button
                onClick={handleSelectAll}
                className="px-4 py-2 text-sm bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors rounded"
              >
                Select All
              </button>
              <button
                onClick={handleDeselectAll}
                className="px-4 py-2 text-sm bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors rounded"
              >
                Deselect All
              </button>
            </div>
          </div>

          {savedRules.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No rules found. Create some rules first to execute them.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {savedRules.map(rule => (
                <div
                  key={rule.id}
                  className={`p-4 border cursor-pointer transition-all ${
                    selectedRules.includes(rule.id)
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-300 hover:border-purple-300'
                  }`}
                  onClick={() => handleRuleSelection(rule.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <input
                          type="checkbox"
                          checked={selectedRules.includes(rule.id)}
                          onChange={() => handleRuleSelection(rule.id)}
                          className="w-4 h-4 text-black rounded focus:ring-white"
                        />
                        <span className="font-medium text-gray-800">{rule.rule_type}</span>
                        <span className="px-2 py-1 text-xs border border-gray-300 text-gray-700 bg-white rounded">
                          {rule.action}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 ml-7">{rule.original_instruction}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExecuteSingleRule(rule);
                      }}
                      disabled={isExecuting || !serverStatus.connected}
                      className="px-3 py-1 text-sm bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50 rounded"
                    >
                      Execute
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Execution Controls */}
        <div className="bg-white border border-gray-200 p-8 rounded">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Execution Controls</h2>
          
          <div className="flex flex-wrap gap-4">
            <button
              onClick={handleExecuteSelected}
              disabled={isExecuting || selectedRules.length === 0 || !serverStatus.connected}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white border border-purple-600 font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              <Play className="w-5 h-5" />
              Execute Selected ({selectedRules.length})
            </button>
            
            <button
              onClick={handleExecuteAllActive}
              disabled={isExecuting || savedRules.length === 0 || !serverStatus.connected}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white border border-purple-600 font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              <Zap className="w-5 h-5" />
              Execute All Active ({savedRules.length})
            </button>
          </div>

          {isExecuting && (
            <div className="mt-4 flex items-center gap-2 text-gray-700">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
              <span>Executing rules...</span>
            </div>
          )}
        </div>

        {/* Data Context */}
        {showDataContext && dataContext && (
          <div className="bg-black border border-white/20 p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-white">Complete Data Context</h2>
              <button
                onClick={() => setShowDataContext(false)}
                className="px-3 py-1 text-sm bg-black text-white border border-white/30 hover:border-white transition-colors"
              >
                Close
              </button>
            </div>
            
            <div className="bg-gray-50 border border-gray-200 p-4 max-h-96 overflow-auto rounded">
              <pre className="text-sm text-gray-300 whitespace-pre-wrap">
                {JSON.stringify(dataContext, null, 2)}
              </pre>
            </div>
            
            <p className="text-sm text-gray-400 mt-4">
              This is the complete QuickBooks API response for the {entity} entity. 
              Use this data structure to understand available fields and data formats for creating more accurate rules.
            </p>
          </div>
        )}

        {/* Results */}
        {executionResult && (
          <div className="bg-white border border-gray-200 p-8 rounded">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-800">Execution Results</h2>
                <button
                  onClick={exportResults}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors rounded"
                >
                  <Download className="w-4 h-4" />
                  Export Results
                </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="p-4 bg-gray-50 border border-gray-200 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  <span className="text-sm font-medium text-gray-700">Rules Executed</span>
                </div>
                <p className="text-2xl font-bold text-gray-800">{executionResult.summary.total_rules_executed}</p>
              </div>
              
              <div className="p-4 bg-gray-50 border border-gray-200 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-medium text-gray-700">Successful</span>
                </div>
                <p className="text-2xl font-bold text-gray-800">{executionResult.summary.successful_executions}</p>
              </div>
              
              <div className="p-4 bg-gray-50 border border-gray-200 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  <span className="text-sm font-medium text-gray-700">Flagged</span>
                </div>
                <p className="text-2xl font-bold text-gray-800">{executionResult.summary.total_transactions_flagged}</p>
              </div>
              
              <div className="p-4 bg-gray-50 border border-gray-200 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-medium text-gray-700">Duration</span>
                </div>
                <p className="text-2xl font-bold text-gray-800">{formatExecutionTime(executionResult.summary.total_execution_time)}</p>
              </div>
            </div>

            {/* Individual Results */}
            <div className="space-y-4">
              {executionResult.individual_results.map((result, index) => (
                <div key={index} className="border border-gray-200 p-4 rounded">
                  {result.success && result.data ? (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-800">
                          {result.data?.rule_type}
                        </h3>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-gray-600">
                            {result.data?.execution_summary.flagged_count} flagged / {result.data?.execution_summary.total_checked} total
                          </span>
                          <button
                            onClick={() => setShowDetails(showDetails === result.data?.rule_id ? null : result.data?.rule_id || null)}
                            className="flex items-center gap-1 px-3 py-1 text-sm bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors rounded"
                          >
                            <Eye className="w-4 h-4" />
                            {showDetails === result.data?.rule_id ? 'Hide' : 'Show'} Details
                          </button>
                        </div>
                      </div>
                      
                      {showDetails === result.data?.rule_id && (
                        <div className="mt-4 space-y-4">
                          {result.data.flagged_transactions.map((transaction, txIndex) => (
                            <div key={txIndex} className="bg-red-50 border border-red-300 p-4 rounded">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-red-900">Transaction ID: {transaction.id}</span>
                                <span className="text-sm text-red-900 bg-red-200 border border-red-400 px-2 py-1 rounded">{transaction.action}</span>
                              </div>
                              <p className="text-sm text-red-800 mb-3">{transaction.reason}</p>
                              
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium text-red-900">Matched Conditions:</h4>
                                {transaction.matched_conditions.map((condition, condIndex) => {
                                  const fieldDataKey = `${transaction.id}-${condIndex}`;
                                  const isExpanded = expandedFieldData === fieldDataKey;
                                  
                                  return (
                                    <div 
                                      key={condIndex} 
                                      onClick={() => condition.flagged_field_data && setExpandedFieldData(isExpanded ? null : fieldDataKey)}
                                      className={`text-sm text-red-800 ml-4 space-y-2 ${condition.flagged_field_data ? 'cursor-pointer' : ''}`}
                                    >
                                      <div className={`flex items-center gap-2 p-3 rounded border-2 transition-all ${condition.flagged_field_data ? (isExpanded ? 'bg-red-100 border-red-400' : 'bg-red-50 border-red-300 hover:bg-red-100 hover:border-red-400') : 'bg-red-50 border-red-200'}`}>
                                        {condition.flagged_field_data && (
                                          <span className="text-red-700 font-bold text-lg">
                                            {isExpanded ? '▼' : '▶'}
                                          </span>
                                        )}
                                        <span className="font-medium text-red-900">{condition.field}</span>
                                        <span className="mx-2 text-red-700">{condition.operator}</span>
                                        <span className="bg-red-100 border border-red-300 px-2 py-1 text-red-800 rounded">{String(condition.value)}</span>
                                        <span className="mx-2 text-red-600">→</span>
                                        <span className="bg-red-300 border border-red-500 px-2 py-1 text-red-900 rounded">{String(condition.actual_value)}</span>
                                      </div>
                                      
                                      {/* Enhanced Field Data Display */}
                                      {condition.flagged_field_data && isExpanded && (
                                        <div className="ml-4 bg-red-100 border border-red-400 p-3 rounded">
                                          <h5 className="text-xs font-medium text-red-900 mb-2">Complete Flagged Field Data:</h5>
                                          
                                          {condition.flagged_field_data.line_index !== undefined ? (
                                            // Line field data
                                            <div className="space-y-2">
                                              <div className="text-xs text-red-800">
                                                <span className="font-medium text-red-900">Line Index:</span> {condition.flagged_field_data.line_index}
                                              </div>
                                              <div className="text-xs text-red-800">
                                                <span className="font-medium text-red-900">Field Path:</span> {condition.flagged_field_data.field_path}
                                              </div>
                                              <div className="text-xs text-red-800">
                                                <span className="font-medium text-red-900">Field Value:</span> {String(condition.flagged_field_data.field_value)}
                                              </div>
                                              <div className="text-xs text-red-800">
                                                <span className="font-medium text-red-900">Complete Line Data:</span>
                                              </div>
                                              <pre className="text-xs bg-red-200 border border-red-400 p-2 overflow-auto max-h-32 text-red-900 rounded">
                                                {JSON.stringify(condition.flagged_field_data.line_data, null, 2)}
                                              </pre>
                                            </div>
                                          ) : (
                                            // Regular field data
                                            <div className="space-y-2">
                                              {condition.flagged_field_data.parent_path && (
                                                <div className="text-xs text-red-800">
                                                  <span className="font-medium text-red-900">Parent Path:</span> {condition.flagged_field_data.parent_path}
                                                </div>
                                              )}
                                              <div className="text-xs text-red-800">
                                                <span className="font-medium text-red-900">Field Name:</span> {condition.flagged_field_data.field_name}
                                              </div>
                                              <div className="text-xs text-red-800">
                                                <span className="font-medium text-red-900">Field Value:</span> {String(condition.flagged_field_data.field_value)}
                                              </div>
                                              <div className="text-xs text-red-800">
                                                <span className="font-medium text-red-900">Parent Object:</span>
                                              </div>
                                              <pre className="text-xs bg-red-200 border border-red-400 p-2 overflow-auto max-h-32 text-red-900 rounded">
                                                {JSON.stringify(condition.flagged_field_data.parent_object, null, 2)}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-700">
                      <AlertCircle className="w-5 h-5" />
                      <span>Failed to execute rule: {result.error}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}; 