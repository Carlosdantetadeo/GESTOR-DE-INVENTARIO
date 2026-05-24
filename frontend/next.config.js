/** @type {import('next').NextConfig} */
const nextConfig = {
  // Supabase Realtime requires this header to be relaxed
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
    ]
  },
}

module.exports = nextConfig
