import fetch from 'node-fetch';

/**
 * Recursively extract all field paths from a JSON object.
 * @param {object} obj - The JSON object.
 * @param {string} prefix - The current field path prefix.
 * @returns {string[]} Array of field paths.
 */
function extractFieldPaths(obj, prefix = '') {
  let paths = [];
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths = paths.concat(extractFieldPaths(value, path));
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      // For arrays of objects, extract from first element
      paths = paths.concat(extractFieldPaths(value[0], path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Fetch a sample record for a given entity from QuickBooks and extract field paths.
 * @param {object} params
 * @param {string} params.realmId - The QuickBooks company ID.
 * @param {string} params.accessToken - The OAuth access token.
 * @param {string} params.entity - The transaction entity type (e.g., 'Expense').
 * @returns {Promise<string[]>} List of field paths.
 */
export async function getQuickBooksFields({ realmId, accessToken, entity }) {
  // URL encode the query parameter - QuickBooks API requires this
  const query = encodeURIComponent(`SELECT * FROM ${entity}`);
  const url = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${query}`;
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
  
  if (!res.ok) {
    // Try to get more details from the error response
    let errorDetails = `${res.status} ${res.statusText}`;
    try {
      const errorData = await res.json();
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
  
  const data = await res.json();
  
  // Check for QuickBooks API errors in the response
  if (data.Fault) {
    const faultMessage = data.Fault.Error?.[0]?.Message || 'Unknown QuickBooks API error';
    throw new Error(`QuickBooks API error: ${faultMessage}`);
  }
  
  // The entity records are in data[entity] or data.QueryResponse[entity]
  const records = data.QueryResponse && data.QueryResponse[entity];
  if (!records || !records.length) {
    throw new Error(`No records found for entity: ${entity}`);
  }
  // Extract field paths from the first record
  return extractFieldPaths(records[0]);
} 