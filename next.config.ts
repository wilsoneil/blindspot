import type { NextConfig } from "next";

// Standard Next.js rendering. The newer "cache components" mode is left off
// to keep things simple while learning; pages that read the database ask for
// fresh data on every request (see src/lib/db.ts).
const nextConfig: NextConfig = {};

export default nextConfig;
