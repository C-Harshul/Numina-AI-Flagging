import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { getQuickBooksFields } from '../services/quickbooksSchemaExtractor.js';
import { injectOAuthToken } from '../services/oauthTokenManager.js';

const router = express.Router();

// Initialize Gemini AI
let genAI = null;
let model = null;

const initializeGemini = () => {
  // Try both environment variable names
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  
  console.log('🔍 Initializing Gemini AI...');
  console.log('- GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Found' : '❌ Not found');
  console.log('- VITE_GEMINI_API_KEY:', process.env.VITE_GEMINI_API_KEY ? '✅ Found' : '❌ Not found');
  
  if (!apiKey) {
    console.warn('⚠️  Gemini API key not found. AI parsing will use fallback method.');
    console.warn('   Please add GEMINI_API_KEY to your server/.env file');
    return false;
  }

  try {
    genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    console.log('✅ Gemini AI initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Gemini:', error.message);
    return false;
  }
};

// Initialize on startup
const isGeminiAvailable = initializeGemini();

// Get Gemini status
router.get('/status', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  
  res.json({
    success: true,
    data: {
      available: model !== null,
      apiKey: !!apiKey,
      model: model ? 'gemini-2.5-flash' : null,
      debug: {
        gemini_api_key_set: !!process.env.GEMINI_API_KEY,
        vite_gemini_api_key_set: !!process.env.VITE_GEMINI_API_KEY,
        using_key: apiKey ? 'Found' : 'Not found'
      }
    }
  });
});

// Helper to build a prompt with complete QuickBooks data context
function buildPromptWithCompleteData(instruction, quickbooksData, entity) {
  return `
You are an expert audit rule parser. Convert the following natural language audit instruction into a structured JSON rule.

INSTRUCTION: "${instruction}"

QUICKBOOKS ENTITY: ${entity}

COMPLETE QUICKBOOKS DATA CONTEXT:
The following is the complete response from QuickBooks API for this entity. Use this to understand the data structure, field names, and typical values:

${JSON.stringify(quickbooksData, null, 2)}

Based on this complete data context, analyze the instruction and return a JSON object with the following structure:
{
  "rule_type": "string",
  "conditions": [
    {
      "field": "string (use exact field names from the data above)",
      "operator": "string (gt, lt, eq, ne, contains, not_contains, in, not_in)",
      "value": "any",
      "logical_operator": "string (AND, OR) - optional"
    }
  ],
  "action": "string (flag, review, reject, approve)",
  "reason": "string",
  "confidence_score": "number (0.0 to 1.0)"
}

IMPORTANT: 
- Use exact field names from the QuickBooks data structure above
- Consider the actual data values when determining appropriate conditions
- Make sure your rule will work with the real data format shown

Return ONLY the JSON object, no additional text or explanation.
`;
}

// Parse instruction using Gemini AI
router.post('/parse', injectOAuthToken, async (req, res) => {
  try {
    const { instruction, realmId, accessToken, entity } = req.body;
    if (!instruction || !instruction.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Instruction cannot be empty',
        suggestions: ['Please provide a clear audit instruction']
      });
    }
    if (!realmId || !accessToken || !entity) {
      return res.status(400).json({
        success: false,
        error: 'realmId, accessToken, and entity are required to fetch QuickBooks data for context.'
      });
    }
    
    // 1. Fetch complete QuickBooks data for this entity
    let quickbooksData;
    try {
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
      
      quickbooksData = data.QueryResponse && data.QueryResponse[entity];
      
      if (!quickbooksData || !quickbooksData.length) {
        throw new Error(`No records found for entity: ${entity}`);
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch QuickBooks data: ' + err.message,
        suggestions: [
          'Verify your QuickBooks Realm ID is correct',
          'Check that your OAuth access token is valid and not expired',
          'Ensure the entity name is correct (e.g., Expense, Invoice, Bill, Payment)',
          'Verify you have access to the QuickBooks company data',
          'Check your internet connection'
        ]
      });
    }
    
    // 2. If Gemini is not available, use fallback parsing
    if (!model) {
      console.log('🔄 Using fallback parsing (Gemini not available)');
      const fallbackResult = fallbackParsing(instruction);
      return res.json(fallbackResult);
    }
    
    // 3. Build a prompt that includes the complete QuickBooks data
    const prompt = buildPromptWithCompleteData(instruction, quickbooksData, entity);
    try {
      console.log('🤖 Processing with Gemini AI:', instruction.substring(0, 50) + '...');
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsedResult = parseGeminiResponse(text, instruction);
      
      console.log('✅ Gemini parsing completed');
      res.json(parsedResult);
    } catch (error) {
      console.error('❌ Gemini API error:', error.message);
      // Fall back to rule-based parsing on error
      const fallbackResult = fallbackParsing(instruction);
      res.json(fallbackResult);
    }
  } catch (error) {
    console.error('Parse instruction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to parse instruction',
      suggestions: [
        'Check your internet connection',
        'Verify your Gemini API key is configured correctly',
        'Try simplifying your instruction'
      ]
    });
  }
});

// Parse Gemini response
const parseGeminiResponse = (response, originalInstruction) => {
  try {
    // Clean the response to extract JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsedRule = JSON.parse(jsonMatch[0]);

    // Validate the parsed rule
    if (!validateParsedRule(parsedRule)) {
      throw new Error('Invalid rule structure from Gemini');
    }

    return {
      success: true,
      rule: parsedRule
    };

  } catch (error) {
    console.error('Failed to parse Gemini response:', error);
    return {
      success: false,
      error: `Failed to parse AI response: ${error.message}`,
      suggestions: [
        'Try rephrasing your instruction more clearly',
        'Include specific amounts, categories, or conditions',
        'Use clear action words like "flag", "review", "reject", or "approve"'
      ]
    };
  }
};

// Validate parsed rule structure
const validateParsedRule = (rule) => {
  return (
    rule &&
    typeof rule.rule_type === 'string' &&
    Array.isArray(rule.conditions) &&
    typeof rule.action === 'string' &&
    typeof rule.reason === 'string' &&
    typeof rule.confidence_score === 'number' &&
    rule.confidence_score >= 0 &&
    rule.confidence_score <= 1 &&
    rule.conditions.every((condition) =>
      condition.field &&
      condition.operator &&
      condition.value !== undefined
    )
  );
};

// Fallback parsing when Gemini is not available
const fallbackParsing = (instruction) => {
  const normalizedInstruction = instruction.toLowerCase().trim();
  
  const action = extractAction(normalizedInstruction);
  const ruleType = determineRuleType(normalizedInstruction);
  const conditions = extractBasicConditions(normalizedInstruction);

  if (!ruleType) {
    return {
      success: false,
      error: 'Could not determine rule type. Please check your Gemini API configuration.',
      suggestions: [
        'Ensure GEMINI_API_KEY is set in your server/.env file',
        'Try using more specific keywords like "expense", "vendor", "category"',
        'Include threshold amounts with $ symbol'
      ]
    };
  }

  const rule = {
    rule_type: ruleType,
    conditions,
    action,
    reason: `${action.charAt(0).toUpperCase() + action.slice(1)} based on ${ruleType.replace('_', ' ')}`,
    confidence_score: 0.6 // Lower confidence for fallback parsing
  };

  return {
    success: true,
    rule
  };
};

const extractAction = (instruction) => {
  const actionKeywords = {
    flag: ['flag', 'mark', 'highlight', 'identify'],
    review: ['review', 'check', 'examine', 'investigate'],
    reject: ['reject', 'deny', 'block', 'prevent'],
    approve: ['approve', 'accept', 'allow', 'permit']
  };

  for (const [action, keywords] of Object.entries(actionKeywords)) {
    if (keywords.some(keyword => instruction.includes(keyword))) {
      return action;
    }
  }
  return 'flag';
};

const determineRuleType = (instruction) => {
  if (/expense.*amount|amount.*above|cost.*over/i.test(instruction)) {
    return 'expense_amount_threshold';
  }
  if (/vendor.*frequency|appears.*times|vendor.*day/i.test(instruction)) {
    return 'vendor_frequency';
  }
  if (/category.*amount|tagged.*over|categorized.*above/i.test(instruction)) {
    return 'category_amount_threshold';
  }
  if (/duplicate|same.*transaction|identical/i.test(instruction)) {
    return 'duplicate_detection';
  }
  if (/time|after|before|am|pm/i.test(instruction)) {
    return 'time_based';
  }
  return null;
};

const extractBasicConditions = (instruction) => {
  const conditions = [];
  
  // Extract amount
  const amountMatch = instruction.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (amountMatch) {
    conditions.push({
      field: 'amount',
      operator: 'gt',
      value: parseFloat(amountMatch[1].replace(/,/g, ''))
    });
  }

  return conditions;
};

export default router;