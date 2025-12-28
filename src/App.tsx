import React, { useState, useEffect } from 'react';
import { QuickBooksStorage } from './services/quickbooksStorage';
import { 
  Brain,
  Settings,
  Play
} from 'lucide-react';
import { RuleConverter } from './components/RuleConverter';
import { RuleExecutor } from './components/RuleExecutor';

function App() {
  const [currentView, setCurrentView] = useState<'converter' | 'executor'>('converter');

  // Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const oauthSuccess = urlParams.get('oauth_success');
    const oauthError = urlParams.get('oauth_error');
    const realmId = urlParams.get('realmId');

    if (oauthSuccess && realmId) {
      // Save OAuth connection to localStorage
      QuickBooksStorage.saveOAuthConnection(realmId);
      // Redirect to converter or executor view
      setCurrentView('converter');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      // Show success message
      alert(`QuickBooks connected successfully for Realm ID: ${realmId}!`);
    } else if (oauthError) {
      // Show error message
      alert(`OAuth connection failed: ${decodeURIComponent(oauthError)}`);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Navigation component for converter and executor views
  const Navigation = ({ currentView }: { currentView: 'converter' | 'executor' }) => (
    <nav className="px-6 py-4 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <Brain className="w-6 h-6 text-gray-800" />
          <span className="text-2xl font-bold text-gray-800 uppercase tracking-wide">NUMINA</span>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setCurrentView('converter')}
            className={`flex items-center space-x-2 px-4 py-2 border text-sm font-medium transition-all duration-200 ${
              currentView === 'converter'
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-purple-500'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Rule Creator</span>
          </button>
          <button
            onClick={() => setCurrentView('executor')}
            className={`flex items-center space-x-2 px-4 py-2 border text-sm font-medium transition-all duration-200 ${
              currentView === 'executor'
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-purple-500'
            }`}
          >
            <Play className="w-4 h-4" />
            <span>Rule Executor</span>
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-white">
      <Navigation currentView={currentView} />
      <div className="py-8">
        {currentView === 'converter' ? <RuleConverter /> : <RuleExecutor />}
      </div>
    </div>
  );
}

export default App;