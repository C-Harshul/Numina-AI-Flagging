import fetch from 'node-fetch';

/**
 * Get a nested value from an object using dot notation
 * @param {object} obj - The object to search in
 * @param {string} path - The dot notation path (e.g., 'Line.0.Amount')
 * @returns {any} The value at the path, or undefined if not found
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (key.match(/^\d+$/)) {
      // Handle array indices
      return current[parseInt(key)];
    }
    return current[key];
  }, obj);
}

// Helper: check if a field path starts with "Line."
function isLineField(field) {
  return field.startsWith('Line.');
}

// Comparison logic
function compare(fieldValue, operator, value) {
  if (fieldValue === undefined || fieldValue === null) return false;
  switch (operator) {
    case 'eq': return fieldValue == value;
    case 'ne': return fieldValue != value;
    case 'gt': return parseFloat(fieldValue) > parseFloat(value);
    case 'lt': return parseFloat(fieldValue) < parseFloat(value);
    case 'contains': return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
    case 'not_contains': return !String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
    case 'in': return Array.isArray(value) && value.includes(fieldValue);
    case 'not_in': return Array.isArray(value) && !value.includes(fieldValue);
    default: return false;
  }
}

// Evaluate a single condition, handling Line arrays
function evaluateCondition(transaction, condition) {
  const { field, operator, value } = condition;

  // Special handling for Line array fields
  if (isLineField(field)) {
    const lines = transaction.Line;
    if (!Array.isArray(lines)) return false;
    // Remove "Line." prefix for nested path
    const lineFieldPath = field.substring(5);
    // Check if ANY line item matches
    return lines.some(line => {
      const fieldValue = getNestedValue(line, lineFieldPath);
      return compare(fieldValue, operator, value);
    });
  }

  // Normal field
  const fieldValue = getNestedValue(transaction, field);
  return compare(fieldValue, operator, value);
}

// Robust logical operator handling
function evaluateConditions(transaction, conditions) {
  if (!conditions || conditions.length === 0) return true;
  let result = evaluateCondition(transaction, conditions[0]);
  for (let i = 1; i < conditions.length; i++) {
    const op = conditions[i].logical_operator || 'AND';
    const condResult = evaluateCondition(transaction, conditions[i]);
    if (op === 'OR') result = result || condResult;
    else result = result && condResult;
  }
  return result;
}

/**
 * Fetch all records for a given entity from QuickBooks
 * @param {object} params
 * @param {string} params.realmId - The QuickBooks company ID
 * @param {string} params.accessToken - The OAuth access token
 * @param {string} params.entity - The entity type to fetch
 * @returns {Promise<Array>} Array of transaction records
 */
async function fetchQuickBooksData({ realmId, accessToken, entity }) {
  // URL encode the query parameter - QuickBooks API requires this
  const query = encodeURIComponent(`SELECT * FROM ${entity}`);
  const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${query}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    // Try to get more details from the error response
    let errorDetails = `${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.Fault) {
        errorDetails = errorData.Fault.Error?.[0]?.Message || errorDetails;
        if (errorData.Fault.Error?.[0]?.Detail) {
          errorDetails += `: ${errorData.Fault.Error[0].Detail}`;
        }
      }
    } catch (e) {
      // If we can't parse the error response, use the status text
    }
    throw new Error(`QuickBooks API error: ${errorDetails}`);
  }

  const data = await response.json();
  
  // Check for QuickBooks API errors in the response
  if (data.Fault) {
    const faultMessage = data.Fault.Error?.[0]?.Message || 'Unknown QuickBooks API error';
    throw new Error(`QuickBooks API error: ${faultMessage}`);
  }
  
  const records = data.QueryResponse && data.QueryResponse[entity];
  
  if (!records) {
    return [];
  }

  return records;
}

/**
 * Get complete QuickBooks data context for an entity
 * This function returns the full API response for better context understanding
 * @param {object} params
 * @param {string} params.realmId - The QuickBooks company ID
 * @param {string} params.accessToken - The OAuth access token
 * @param {string} params.entity - The entity type to fetch
 * @returns {Promise<object>} Complete QuickBooks API response
 */
export async function getQuickBooksDataContext({ realmId, accessToken, entity }) {
  // URL encode the query parameter - QuickBooks API requires this
  const query = encodeURIComponent(`SELECT * FROM ${entity}`);
  const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${query}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    // Try to get more details from the error response
    let errorDetails = `${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.Fault) {
        errorDetails = errorData.Fault.Error?.[0]?.Message || errorDetails;
        if (errorData.Fault.Error?.[0]?.Detail) {
          errorDetails += `: ${errorData.Fault.Error[0].Detail}`;
        }
      }
    } catch (e) {
      // If we can't parse the error response, use the status text
    }
    throw new Error(`QuickBooks API error: ${errorDetails}`);
  }

  const data = await response.json();
  
  // Check for QuickBooks API errors in the response
  if (data.Fault) {
    const faultMessage = data.Fault.Error?.[0]?.Message || 'Unknown QuickBooks API error';
    throw new Error(`QuickBooks API error: ${faultMessage}`);
  }
  
  return data;
}

/**
 * Execute a rule against QuickBooks data
 * @param {object} rule - The audit rule to execute
 * @param {object} params - QuickBooks connection parameters
 * @returns {Promise<object>} Execution results
 */
export async function executeRule(rule, { realmId, accessToken, entity }) {
  try {
    console.log(`🔍 Executing rule: ${rule.rule_type} against ${entity} data...`);
    
    // Fetch data from QuickBooks
    const transactions = await fetchQuickBooksData({ realmId, accessToken, entity });
    
    console.log(transactions)
    if (transactions.length === 0) {
      return {
        success: true,
        data: {
          rule_id: rule.id,
          rule_type: rule.rule_type,
          entity: entity,
          total_transactions: 0,
          flagged_transactions: [],
          execution_summary: {
            total_checked: 0,
            flagged_count: 0,
            execution_time: 0
          }
        }
      };
    }

    console.log(`📊 Processing ${transactions.length} transactions...`);
    
    const startTime = Date.now();
    const flaggedTransactions = [];

    // Evaluate each transaction against the rule
    for (const transaction of transactions) {
        
      const isFlagged = evaluateConditions(transaction, rule.conditions);
      
      if (isFlagged) {
        flaggedTransactions.push({
          id: transaction.Id,
          transaction_data: transaction,
          matched_conditions: rule.conditions.map(condition => {
            const actualValue = getNestedValue(transaction, condition.field);
            let flaggedFieldData = null;
            
            // Get the complete field data that was flagged
            if (isLineField(condition.field)) {
              // For Line fields, find the specific line item that matched
              const lines = transaction.Line;
              const lineFieldPath = condition.field.substring(5);
              const matchingLineIndex = lines.findIndex(line => {
                const fieldValue = getNestedValue(line, lineFieldPath);
                return compare(fieldValue, condition.operator, condition.value);
              });
              
              if (matchingLineIndex !== -1) {
                flaggedFieldData = {
                  line_index: matchingLineIndex,
                  line_data: lines[matchingLineIndex],
                  field_path: condition.field,
                  field_value: actualValue
                };
              }
            } else {
              // For regular fields, get the parent object containing the field
              const fieldParts = condition.field.split('.');
              const parentPath = fieldParts.slice(0, -1).join('.');
              const fieldName = fieldParts[fieldParts.length - 1];
              
              if (parentPath) {
                const parentObject = getNestedValue(transaction, parentPath);
                flaggedFieldData = {
                  parent_path: parentPath,
                  parent_object: parentObject,
                  field_name: fieldName,
                  field_value: actualValue
                };
              } else {
                // Top-level field
                flaggedFieldData = {
                  field_name: condition.field,
                  field_value: actualValue,
                  parent_object: transaction
                };
              }
            }
            
            return {
              field: condition.field,
              operator: condition.operator,
              value: condition.value,
              actual_value: actualValue,
              flagged_field_data: flaggedFieldData
            };
          }),
          action: rule.action,
          reason: rule.reason,
          flagged_at: new Date().toISOString()
        });
      }
    }

    const executionTime = Date.now() - startTime;

    console.log(`✅ Rule execution completed: ${flaggedTransactions.length} transactions flagged out of ${transactions.length} total`);

    return {
      success: true,
      data: {
        rule_id: rule.id,
        rule_type: rule.rule_type,
        entity: entity,
        total_transactions: transactions.length,
        flagged_transactions: flaggedTransactions,
        execution_summary: {
          total_checked: transactions.length,
          flagged_count: flaggedTransactions.length,
          execution_time: executionTime,
          flag_rate: transactions.length > 0 ? (flaggedTransactions.length / transactions.length * 100).toFixed(2) + '%' : '0%'
        }
      }
    };

  } catch (error) {
    console.error('❌ Rule execution failed:', error);
    return {
      success: false,
      error: `Failed to execute rule: ${error.message}`,
      data: null
    };
  }
}

/**
 * Execute multiple rules against QuickBooks data
 * @param {Array} rules - Array of audit rules to execute
 * @param {object} params - QuickBooks connection parameters
 * @returns {Promise<object>} Combined execution results
 */
export async function executeMultipleRules(rules, { realmId, accessToken, entity }) {
  try {
    console.log(`🚀 Executing ${rules.length} rules against ${entity} data...`);
    
    const results = [];
    const startTime = Date.now();

    for (const rule of rules) {
      const result = await executeRule(rule, { realmId, accessToken, entity });
      results.push(result);
    }

    const totalExecutionTime = Date.now() - startTime;
    
    // Compile summary statistics
    const summary = {
      total_rules_executed: rules.length,
      successful_executions: results.filter(r => r.success).length,
      failed_executions: results.filter(r => !r.success).length,
      total_transactions_checked: 0,
      total_transactions_flagged: 0,
      total_execution_time: totalExecutionTime
    };

    // Aggregate transaction counts
    results.forEach(result => {
      if (result.success && result.data) {
        summary.total_transactions_checked += result.data.execution_summary.total_checked;
        summary.total_transactions_flagged += result.data.execution_summary.flagged_count;
      }
    });

    console.log(`✅ Batch execution completed: ${summary.successful_executions}/${summary.total_rules_executed} rules executed successfully`);

    return {
      success: true,
      data: {
        summary,
        individual_results: results,
        executed_at: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('❌ Batch rule execution failed:', error);
    return {
      success: false,
      error: `Failed to execute rules: ${error.message}`,
      data: null
    };
  }
} 