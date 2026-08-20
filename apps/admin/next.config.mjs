/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // The widget loader and beacons run on publisher origins.
    const cors = [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'content-type' },
    ];
    return [
      { source: '/api/serve', headers: cors },
      { source: '/api/events', headers: cors },
      { source: '/w.js', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
    ];
  },
};

export default nextConfig;
