/** @type {import('next').NextConfig} */
const nextConfig = {
  // LOCAL_PG=1 swaps Neon's HTTP driver for a plain-Postgres shim so the admin
  // can run against a local database (see lib/dev-pg-driver.mjs). Never set in
  // production — the alias is not applied unless the env var is present.
  webpack: (config) => {
    if (process.env.LOCAL_PG === '1') {
      config.resolve.alias['@neondatabase/serverless'] = new URL(
        './lib/dev-pg-driver.mjs',
        import.meta.url,
      ).pathname;
    }
    return config;
  },
  // The app is exposed at stepnetwork.dk/stepcommerce via a rewrite in the
  // website project; everything (admin, /api/serve, /c/*, w.js) lives under
  // this base path.
  basePath: '/stepcommerce',
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
