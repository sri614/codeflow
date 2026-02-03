const { Client } = require('@hubspot/api-client');
const axios = require('axios');
const Portal = require('../models/Portal');

const HUBSPOT_OAUTH_URL = 'https://api.hubapi.com/oauth/v1/token';

/**
 * Get OAuth authorization URL
 * @param {string} state - State parameter for CSRF protection
 * @returns {string} - Authorization URL
 */
function getAuthorizationUrl(state) {
  const scopes = [
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
    'crm.objects.companies.read',
    'crm.objects.companies.write',
    'crm.objects.deals.read',
    'crm.objects.deals.write',
    'automation',
    'oauth'
  ];

  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID,
    redirect_uri: `${process.env.BASE_URL}/oauth/callback`,
    scope: scopes.join(' '),
    state
  });

  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Object} - Token response
 */
async function exchangeCodeForTokens(code) {
  const redirectUri = `${process.env.BASE_URL}/oauth/callback`;
  console.log('Exchanging code for tokens...');
  console.log('Redirect URI:', redirectUri);
  console.log('Client ID:', process.env.HUBSPOT_CLIENT_ID);

  try {
    const response = await axios.post(HUBSPOT_OAUTH_URL, new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Token exchange successful');
    return response.data;
  } catch (error) {
    console.error('Token exchange failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Refresh access token
 * @param {string} refreshToken - Refresh token
 * @returns {Object} - New token response
 */
async function refreshAccessToken(refreshToken) {
  const response = await axios.post(HUBSPOT_OAUTH_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    refresh_token: refreshToken
  }), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  return response.data;
}

/**
 * Get token info (portal ID, scopes, etc.)
 * @param {string} accessToken - Access token
 * @returns {Object} - Token info
 */
async function getTokenInfo(accessToken) {
  const response = await axios.get(`https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`);
  return response.data;
}

/**
 * Get a valid access token for a portal, refreshing if needed
 * @param {string} portalId - HubSpot portal ID
 * @returns {string} - Valid access token
 */
async function getValidAccessToken(portalId) {
  const portal = await Portal.findOne({ portalId });

  if (!portal) {
    throw new Error(`Portal ${portalId} not found`);
  }

  // Check if token needs refresh
  if (portal.isTokenExpiringSoon()) {
    try {
      const tokenData = await refreshAccessToken(portal.refreshToken);

      portal.accessToken = tokenData.access_token;
      portal.refreshToken = tokenData.refresh_token;
      portal.tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
      await portal.save();

      console.log(`Refreshed token for portal ${portalId}`);
    } catch (error) {
      console.error(`Failed to refresh token for portal ${portalId}:`, error.message);
      throw new Error('Failed to refresh HubSpot token');
    }
  }

  return portal.accessToken;
}

/**
 * Create a HubSpot API client for a portal
 * @param {string} portalId - HubSpot portal ID
 * @returns {Client} - HubSpot API client
 */
async function getHubSpotClient(portalId) {
  const accessToken = await getValidAccessToken(portalId);
  return new Client({ accessToken });
}

/**
 * Get portal account info
 * @param {string} accessToken - Access token
 * @returns {Object} - Account info
 */
async function getAccountInfo(accessToken) {
  const client = new Client({ accessToken });
  const response = await client.apiRequest({
    method: 'GET',
    path: '/account-info/v3/details'
  });
  return response;
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getTokenInfo,
  getValidAccessToken,
  getHubSpotClient,
  getAccountInfo
};
