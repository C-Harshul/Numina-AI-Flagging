import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, RefreshCw, LogIn, LogOut, AlertCircle } from 'lucide-react';
import { OAuthService, OAuthStatus } from '../services/oauthService';
import { QuickBooksStorage } from '../services/quickbooksStorage';

interface OAuthButtonProps {
  realmId: string;
  onConnectionChange?: (connected: boolean) => void;
}

export const OAuthButton: React.FC<OAuthButtonProps> = ({ realmId, onConnectionChange }) => {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (realmId) {
      checkStatus();
    } else {
      setStatus(null);
      setIsChecking(false);
    }
  }, [realmId]);

  const checkStatus = async () => {
    if (!realmId) return;
    
    setIsChecking(true);
    try {
      const statusData = await OAuthService.getStatus(realmId);
      setStatus(statusData);
      const isConnected = statusData.connected || false;
      
      // Update localStorage to reflect OAuth connection status
      if (isConnected) {
        const credentials = QuickBooksStorage.loadCredentials();
        if (credentials) {
          credentials.oauthConnected = true;
          credentials.realmId = realmId; // Ensure realmId is set
          QuickBooksStorage.saveCredentials(credentials);
        } else {
          QuickBooksStorage.saveOAuthConnection(realmId);
        }
      }
      
      onConnectionChange?.(isConnected);
    } catch (error) {
      console.error('Failed to check OAuth status:', error);
      setStatus({ success: false, connected: false });
      onConnectionChange?.(false);
    } finally {
      setIsChecking(false);
    }
  };

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      await OAuthService.initiateAuth();
      // The page will redirect, so we don't need to update state here
    } catch (error) {
      console.error('Failed to initiate OAuth:', error);
      alert('Failed to start OAuth flow: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!realmId) return;
    
    setIsLoading(true);
    try {
      const result = await OAuthService.revokeToken(realmId);
      if (result.success) {
        // Clear OAuth connection from localStorage
        const credentials = QuickBooksStorage.loadCredentials();
        if (credentials) {
          credentials.oauthConnected = false;
          QuickBooksStorage.saveCredentials(credentials);
        }
        await checkStatus();
        onConnectionChange?.(false);
      } else {
        alert('Failed to disconnect: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
      alert('Failed to disconnect: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!realmId) return;
    
    setIsLoading(true);
    try {
      const result = await OAuthService.refreshToken(realmId);
      if (result.success) {
        await checkStatus();
      } else {
        alert('Failed to refresh token: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
      alert('Failed to refresh token: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Checking connection...</span>
      </div>
    );
  }

  if (!realmId) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <AlertCircle className="w-4 h-4" />
        <span>Enter Realm ID to connect</span>
      </div>
    );
  }

  if (status?.connected) {
    const expiresIn = status.expiresIn || 0;
    const minutesLeft = Math.floor(expiresIn / 60);
    const needsRefresh = status.needsRefresh || status.isExpired;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <span className="text-sm font-medium text-gray-700">Connected via OAuth</span>
          {needsRefresh && (
            <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-1 rounded">
              Needs Refresh
            </span>
          )}
        </div>
        
        {expiresIn > 0 && (
          <div className="text-xs text-gray-500">
            Token expires in {minutesLeft} minute{minutesLeft !== 1 ? 's' : ''}
          </div>
        )}

        <div className="flex items-center gap-2">
          {needsRefresh && (
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh Token
            </button>
          )}
          <button
            onClick={handleDisconnect}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <XCircle className="w-5 h-5 text-gray-400" />
        <span className="text-sm text-gray-600">Not connected</span>
      </div>
      <button
        onClick={handleConnect}
        disabled={isLoading}
        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
      >
        <LogIn className="w-4 h-4" />
        {isLoading ? 'Connecting...' : 'Connect QuickBooks'}
      </button>
      <p className="text-xs text-gray-500">
        Connect your QuickBooks account via OAuth to automatically manage authentication
      </p>
    </div>
  );
};

