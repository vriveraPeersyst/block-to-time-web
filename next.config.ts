import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-inline for its runtime hydration scripts and styles.
      // A nonce-based strict CSP would require middleware integration (future improvement).
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // Google Fonts (Geist is served via fonts.gstatic.com)
      "font-src 'self' data: https://fonts.gstatic.com",
      // Allow images from self, data URIs, and https (user avatars from Google OAuth)
      "img-src 'self' data: https:",
      // All external RPC/API calls are made server-side; the browser only talks to same-origin routes
      "connect-src 'self'",
      // Prevent this page from being embedded in iframes
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
