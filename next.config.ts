import type {NextConfig} from 'next';
const nextConfig:NextConfig={poweredByHeader:false,distDir:process.env.LUNE_BUILD_DIR||'.next'};
export default nextConfig;
