// Use environment variable or default to proxy
const API_BASE = import.meta.env.VITE_API_URL || ''
console.log('API Base URL:', API_BASE)

// Token management
export function getToken() {
  return localStorage.getItem('codeflow_token')
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('codeflow_token', token)
  } else {
    localStorage.removeItem('codeflow_token')
  }
}

// API client with auth headers
export const api = {
  async request(method, path, data = null) {
    const token = getToken()
    const headers = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'  // Skip ngrok warning page
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const options = {
      method,
      headers
    }

    if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
      options.body = JSON.stringify(data)
    }

    const url = `${API_BASE}${path}`
    console.log(`API Request: ${method} ${url}`)

    try {
      const response = await fetch(url, options)
      console.log(`API Response: ${response.status}`)

      if (response.status === 401) {
        setToken(null)
        throw new Error('Unauthorized')
      }

      const json = await response.json()

      if (!response.ok) {
        throw new Error(json.error || 'Request failed')
      }

      return { data: json, status: response.status }
    } catch (error) {
      console.error('API Error:', error)
      throw error
    }
  },

  get(path) {
    return this.request('GET', path)
  },

  post(path, data) {
    return this.request('POST', path, data)
  },

  put(path, data) {
    return this.request('PUT', path, data)
  },

  delete(path) {
    return this.request('DELETE', path)
  }
}

// Snippets API
export const snippetsApi = {
  list(params = {}) {
    const query = new URLSearchParams(params).toString()
    return api.get(`/v1/snippets${query ? `?${query}` : ''}`)
  },

  get(id) {
    return api.get(`/v1/snippets/${id}`)
  },

  create(data) {
    return api.post('/v1/snippets', data)
  },

  update(id, data) {
    return api.put(`/v1/snippets/${id}`, data)
  },

  delete(id) {
    return api.delete(`/v1/snippets/${id}`)
  },

  test(id, inputs) {
    return api.post(`/v1/snippets/${id}/test`, { inputs })
  }
}

// Secrets API
export const secretsApi = {
  list() {
    return api.get('/v1/secrets')
  },

  create(data) {
    return api.post('/v1/secrets', data)
  },

  update(name, data) {
    return api.put(`/v1/secrets/${name}`, data)
  },

  delete(name) {
    return api.delete(`/v1/secrets/${name}`)
  },

  verify(name) {
    return api.post(`/v1/secrets/${name}/verify`)
  }
}

// Logs API
export const logsApi = {
  list(params = {}) {
    const query = new URLSearchParams(params).toString()
    return api.get(`/v1/logs${query ? `?${query}` : ''}`)
  },

  get(id) {
    return api.get(`/v1/logs/${id}`)
  },

  getStats(days = 7) {
    return api.get(`/v1/logs/stats/summary?days=${days}`)
  },

  getDailyStats(days = 7) {
    return api.get(`/v1/logs/stats/daily?days=${days}`)
  },

  getRecentErrors(limit = 10) {
    return api.get(`/v1/logs/errors/recent?limit=${limit}`)
  }
}

// Usage API
export const usageApi = {
  get(days = 30) {
    return api.get(`/v1/usage?days=${days}`)
  },

  getResources() {
    return api.get('/v1/usage/resources')
  },

  getTopSnippets() {
    return api.get('/v1/usage/top-snippets')
  },

  getWorkflows(days = 30) {
    return api.get(`/v1/usage/workflows?days=${days}`)
  },

  getHourly(days = 7) {
    return api.get(`/v1/usage/hourly?days=${days}`)
  }
}

// Templates API
export const templatesApi = {
  list() {
    return api.get('/v1/templates')
  }
}
