import { useState, useEffect } from 'react'

// Icons as SVG components
const WebhookIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
)

const CodeIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>
)

const RetryIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
)

const ShieldIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
)

const LogsIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)

const ApiIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

const ArrowRightIcon = () => (
  <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
  </svg>
)

const HubSpotIcon = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.984 2.21 2.21 0 00-2.209-2.21 2.21 2.21 0 00-2.21 2.21c0 .872.51 1.625 1.248 1.984v2.807a5.252 5.252 0 00-2.465 1.306l-6.479-5.044a2.21 2.21 0 00.055-.482 2.21 2.21 0 00-2.21-2.21 2.21 2.21 0 00-2.21 2.21 2.21 2.21 0 002.21 2.21c.375 0 .727-.095 1.036-.261l6.368 4.958a5.278 5.278 0 00-.504 2.25c0 .823.188 1.602.524 2.297l-2.015 2.016a1.678 1.678 0 00-.52-.084 1.7 1.7 0 00-1.7 1.7 1.7 1.7 0 001.7 1.7 1.7 1.7 0 001.7-1.7c0-.182-.03-.357-.084-.52l1.977-1.977a5.277 5.277 0 103.52-9.146z"/>
  </svg>
)

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState('webhook')
  const [activeSection, setActiveSection] = useState('')

  const apiUrl = import.meta.env.VITE_API_URL || ''
  const installUrl = `${apiUrl}/oauth/authorize?returnUrl=${encodeURIComponent(window.location.origin)}`

  // Track active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      const sections = ['features', 'how-it-works', 'use-cases']
      const scrollPosition = window.scrollY + 100

      for (const section of sections) {
        const element = document.getElementById(section)
        if (element) {
          const { offsetTop, offsetHeight } = element
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveSection(section)
            return
          }
        }
      }
      setActiveSection('')
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const features = [
    {
      icon: <WebhookIcon />,
      title: 'Send Webhooks',
      description: 'Send HTTP requests to any external API directly from your HubSpot workflows. Supports GET, POST, PUT, PATCH, and DELETE methods.',
      color: 'from-orange-500 to-red-500'
    },
    {
      icon: <CodeIcon />,
      title: 'Run Custom Code',
      description: 'Execute JavaScript code snippets within your workflows. Transform data, perform calculations, and implement complex business logic.',
      color: 'from-blue-500 to-cyan-500'
    },
    {
      icon: <RetryIcon />,
      title: 'Auto Retry',
      description: 'Built-in retry mechanism with exponential backoff. Never lose data due to temporary API failures or network issues.',
      color: 'from-purple-500 to-pink-500'
    },
    {
      icon: <ShieldIcon />,
      title: 'Secure Secrets',
      description: 'Store API keys and credentials securely with AES-256 encryption. Access them safely in your code snippets.',
      color: 'from-green-500 to-emerald-500'
    },
    {
      icon: <LogsIcon />,
      title: 'Execution Logs',
      description: 'Complete visibility into every webhook call and code execution. Debug issues quickly with detailed logs and response data.',
      color: 'from-yellow-500 to-orange-500'
    },
    {
      icon: <ApiIcon />,
      title: 'All HTTP Methods',
      description: 'Full support for REST APIs with GET, POST, PUT, PATCH, DELETE. Custom headers, query parameters, and JSON bodies.',
      color: 'from-indigo-500 to-purple-500'
    }
  ]

  const useCases = [
    {
      title: 'Sync with External CRMs',
      description: 'Push contact updates to Salesforce, Pipedrive, or any CRM via their API.'
    },
    {
      title: 'Send Slack Notifications',
      description: 'Notify your team instantly when high-value deals are created or updated.'
    },
    {
      title: 'Enrich Contact Data',
      description: 'Call enrichment APIs to automatically fill in missing contact information.'
    },
    {
      title: 'Trigger External Workflows',
      description: 'Connect to Zapier, Make, or n8n to extend your automation capabilities.'
    },
    {
      title: 'Custom Lead Scoring',
      description: 'Run JavaScript to calculate complex lead scores based on multiple factors.'
    },
    {
      title: 'Data Transformation',
      description: 'Transform and format data before sending to external systems.'
    }
  ]

  const codeExample = `// Calculate lead score based on engagement
const score = inputs.pageViews * 2 +
              inputs.emailOpens * 5 +
              inputs.formSubmissions * 20;

// Determine lead tier
let tier = 'Cold';
if (score > 100) tier = 'Hot';
else if (score > 50) tier = 'Warm';

// Return values to HubSpot
return {
  lead_score: score,
  lead_tier: tier,
  scored_at: new Date().toISOString()
};`

  const webhookExample = `{
  "method": "POST",
  "url": "https://api.slack.com/webhooks/...",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "text": "New deal created!",
    "deal_name": "{{deal.name}}",
    "amount": "{{deal.amount}}"
  }
}`

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="#" className="flex items-center space-x-2 group">
              <div className="w-10 h-10 bg-gradient-to-br from-hubspot-orange to-red-500 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                <span className="text-white font-bold text-lg">C</span>
              </div>
              <span className="text-xl font-semibold text-hubspot-dark transition-colors duration-300 group-hover:text-hubspot-orange">CodeFlow</span>
            </a>
            <div className="hidden md:flex items-center space-x-8">
              <a
                href="#features"
                className={`relative py-2 transition-colors duration-300 group ${
                  activeSection === 'features'
                    ? 'text-hubspot-orange font-medium'
                    : 'text-hubspot-gray hover:text-hubspot-orange'
                }`}
              >
                Features
                <span className={`absolute bottom-0 left-0 h-0.5 bg-hubspot-orange transition-all duration-300 ${
                  activeSection === 'features' ? 'w-full' : 'w-0 group-hover:w-full'
                }`}></span>
              </a>
              <a
                href="#how-it-works"
                className={`relative py-2 transition-colors duration-300 group ${
                  activeSection === 'how-it-works'
                    ? 'text-hubspot-orange font-medium'
                    : 'text-hubspot-gray hover:text-hubspot-orange'
                }`}
              >
                How it Works
                <span className={`absolute bottom-0 left-0 h-0.5 bg-hubspot-orange transition-all duration-300 ${
                  activeSection === 'how-it-works' ? 'w-full' : 'w-0 group-hover:w-full'
                }`}></span>
              </a>
              <a
                href="#use-cases"
                className={`relative py-2 transition-colors duration-300 group ${
                  activeSection === 'use-cases'
                    ? 'text-hubspot-orange font-medium'
                    : 'text-hubspot-gray hover:text-hubspot-orange'
                }`}
              >
                Use Cases
                <span className={`absolute bottom-0 left-0 h-0.5 bg-hubspot-orange transition-all duration-300 ${
                  activeSection === 'use-cases' ? 'w-full' : 'w-0 group-hover:w-full'
                }`}></span>
              </a>
            </div>
            <a
              href={installUrl}
              className="relative bg-hubspot-orange text-white font-medium py-2 px-5 rounded-lg transition-all duration-300 hover:bg-hubspot-orange-dark hover:shadow-lg hover:shadow-orange-500/30 hover:-translate-y-0.5 active:translate-y-0"
            >
              Install Free
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 relative overflow-hidden">
        {/* Background decorations */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-to-br from-orange-100 via-transparent to-blue-100 rounded-full blur-3xl opacity-50 -z-10"></div>
        <div className="absolute top-40 right-0 w-96 h-96 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full blur-3xl opacity-40 -z-10"></div>

        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center space-x-2 bg-orange-50 text-hubspot-orange px-4 py-2 rounded-full text-sm font-medium mb-6">
            <HubSpotIcon />
            <span>HubSpot Workflow Extension</span>
          </div>

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-hubspot-dark mb-6 leading-tight">
            Supercharge Your
            <span className="block bg-gradient-to-r from-hubspot-orange to-red-500 bg-clip-text text-transparent">
              HubSpot Workflows
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-hubspot-gray max-w-3xl mx-auto mb-10 leading-relaxed">
            Send webhooks to any API and run custom JavaScript code directly in your HubSpot workflows.
            No coding experience required.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={installUrl}
              className="group bg-hubspot-orange hover:bg-hubspot-orange-dark text-white font-semibold py-4 px-8 rounded-xl transition-all hover:shadow-xl hover:shadow-orange-500/30 flex items-center text-lg"
            >
              Install on HubSpot
              <ArrowRightIcon />
            </a>
            <a
              href="#how-it-works"
              className="text-hubspot-dark font-semibold py-4 px-8 rounded-xl border-2 border-gray-200 hover:border-hubspot-orange hover:text-hubspot-orange transition-all"
            >
              See How it Works
            </a>
          </div>

          <p className="text-sm text-hubspot-gray mt-6">
            Free to use • No credit card required • 2-minute setup
          </p>
        </div>
      </section>

      {/* Trusted By / Stats Section */}
      <section className="py-12 bg-gray-50 border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl md:text-4xl font-bold text-hubspot-dark">5</div>
              <div className="text-hubspot-gray">HTTP Methods</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-hubspot-dark">256-bit</div>
              <div className="text-hubspot-gray">Encryption</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-hubspot-dark">Auto</div>
              <div className="text-hubspot-gray">Retry Built-in</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-bold text-hubspot-dark">100%</div>
              <div className="text-hubspot-gray">HubSpot Native</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-hubspot-dark mb-4">
              Everything You Need
            </h2>
            <p className="text-xl text-hubspot-gray max-w-2xl mx-auto">
              Powerful features to extend your HubSpot workflows beyond their native capabilities
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <div
                key={index}
                className="group p-8 bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-xl transition-all duration-300"
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform`}>
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold text-hubspot-dark mb-3">{feature.title}</h3>
                <p className="text-hubspot-gray leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24 px-4 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-hubspot-dark mb-4">
              How It Works
            </h2>
            <p className="text-xl text-hubspot-gray max-w-2xl mx-auto">
              Get started in minutes with our simple 3-step process
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-20">
            {[
              {
                step: '01',
                title: 'Install the App',
                description: 'Click "Install on HubSpot" and authorize CodeFlow to access your HubSpot account.'
              },
              {
                step: '02',
                title: 'Add to Workflow',
                description: 'Open any workflow and find "CodeFlow" actions in the action panel. Choose Send Webhook or Run Code.'
              },
              {
                step: '03',
                title: 'Configure & Run',
                description: 'Set up your webhook URL or write your code. Save and activate your workflow!'
              }
            ].map((item, index) => (
              <div key={index} className="relative">
                <div className="text-8xl font-bold text-gray-100 absolute -top-4 -left-2">{item.step}</div>
                <div className="relative bg-white rounded-2xl p-8 border border-gray-100 h-full">
                  <h3 className="text-xl font-semibold text-hubspot-dark mb-3">{item.title}</h3>
                  <p className="text-hubspot-gray">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Code Examples */}
          <div className="bg-hubspot-dark rounded-3xl p-8 md:p-12 overflow-hidden">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="lg:w-1/3">
                <h3 className="text-2xl font-bold text-white mb-4">See it in Action</h3>
                <p className="text-gray-400 mb-6">
                  Choose between sending webhooks to external APIs or running custom JavaScript code.
                </p>
                <div className="flex flex-col space-y-2">
                  <button
                    onClick={() => setActiveTab('webhook')}
                    className={`text-left px-4 py-3 rounded-lg transition-all ${
                      activeTab === 'webhook'
                        ? 'bg-hubspot-orange text-white'
                        : 'text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Webhook Example
                  </button>
                  <button
                    onClick={() => setActiveTab('code')}
                    className={`text-left px-4 py-3 rounded-lg transition-all ${
                      activeTab === 'code'
                        ? 'bg-hubspot-orange text-white'
                        : 'text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Code Example
                  </button>
                </div>
              </div>
              <div className="lg:w-2/3">
                <div className="bg-gray-900 rounded-xl p-6 font-mono text-sm overflow-x-auto">
                  <div className="flex items-center space-x-2 mb-4">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-gray-500 ml-4">
                      {activeTab === 'webhook' ? 'webhook-config.json' : 'lead-scoring.js'}
                    </span>
                  </div>
                  <pre className="text-green-400 whitespace-pre-wrap">
                    {activeTab === 'webhook' ? webhookExample : codeExample}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section id="use-cases" className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-hubspot-dark mb-4">
              Popular Use Cases
            </h2>
            <p className="text-xl text-hubspot-gray max-w-2xl mx-auto">
              See how teams are using CodeFlow to automate their workflows
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {useCases.map((useCase, index) => (
              <div
                key={index}
                className="p-6 bg-white rounded-xl border border-gray-100 hover:border-hubspot-orange/30 hover:shadow-lg transition-all"
              >
                <div className="flex items-start space-x-3">
                  <CheckIcon />
                  <div>
                    <h3 className="font-semibold text-hubspot-dark mb-1">{useCase.title}</h3>
                    <p className="text-hubspot-gray text-sm">{useCase.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-hubspot-orange to-red-500 rounded-3xl p-12 md:p-16 text-center relative overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full blur-2xl"></div>

            <div className="relative">
              <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
                Ready to Supercharge Your Workflows?
              </h2>
              <p className="text-xl text-white/90 mb-10 max-w-2xl mx-auto">
                Join hundreds of HubSpot users who have extended their workflow capabilities with CodeFlow.
              </p>
              <a
                href={installUrl}
                className="inline-flex items-center bg-white text-hubspot-orange font-semibold py-4 px-10 rounded-xl hover:shadow-2xl transition-all text-lg group"
              >
                Install CodeFlow Now
                <ArrowRightIcon />
              </a>
              <p className="text-white/70 mt-6 text-sm">
                Free forever • No credit card • Cancel anytime
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-hubspot-dark text-white py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-hubspot-orange to-red-500 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-lg">C</span>
                </div>
                <span className="text-xl font-semibold">CodeFlow</span>
              </div>
              <p className="text-gray-400 max-w-md">
                The most powerful workflow extension for HubSpot. Send webhooks and run custom code without leaving your CRM.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a></li>
                <li><a href="#use-cases" className="hover:text-white transition-colors">Use Cases</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-700 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-gray-400 text-sm">
              © {new Date().getFullYear()} CodeFlow. Built for HubSpot users.
            </p>
            <p className="text-gray-400 text-sm mt-4 md:mt-0">
              Not affiliated with HubSpot, Inc.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
