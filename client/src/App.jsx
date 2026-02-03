import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import Snippets from './pages/Snippets'
import SnippetEditor from './pages/SnippetEditor'
import Secrets from './pages/Secrets'
import Logs from './pages/Logs'
import Usage from './pages/Usage'
import Account from './pages/Account'
import { getToken, setToken, api } from './api/client'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [portal, setPortal] = useState(null)

  useEffect(() => {
    const initAuth = async () => {
      // Check for token in URL (from OAuth callback)
      const params = new URLSearchParams(window.location.search)
      const urlToken = params.get('token')

      console.log('App init - URL token:', urlToken ? 'present' : 'not present')

      if (urlToken) {
        console.log('Setting token from URL')
        setToken(urlToken)
        // Remove token from URL
        window.history.replaceState({}, '', window.location.pathname)
      }

      // Check for HubSpot iframe parameters
      const portalId = params.get('portalId') || params.get('hub_id')
      if (portalId) {
        sessionStorage.setItem('hubspot_portal_id', portalId)
      }

      // Verify existing token
      const token = getToken()
      console.log('Stored token:', token ? 'present' : 'not present')

      if (token) {
        try {
          console.log('Verifying token with /oauth/me...')
          const res = await api.get('/oauth/me')
          console.log('Token verified successfully:', res.data)
          setPortal(res.data)
          setIsAuthenticated(true)
        } catch (error) {
          console.error('Token verification failed:', error)
          setToken(null)
          setIsAuthenticated(false)
        }
      }

      setIsLoading(false)
    }

    initAuth()
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-hubspot-light">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-hubspot-orange mx-auto mb-4"></div>
          <p className="text-hubspot-gray">Loading CodeFlow...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LandingPage />
  }

  return (
    <Layout portal={portal}>
      <Routes>
        <Route path="/" element={<Navigate to="/snippets" replace />} />
        <Route path="/snippets" element={<Snippets />} />
        <Route path="/snippets/new" element={<SnippetEditor />} />
        <Route path="/snippets/:id" element={<SnippetEditor />} />
        <Route path="/secrets" element={<Secrets />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/account" element={<Account portal={portal} />} />
      </Routes>
    </Layout>
  )
}

export default App
