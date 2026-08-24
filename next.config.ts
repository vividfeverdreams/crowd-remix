import type { NextConfig } from "next";

const nodeAvNativeTraceFiles = [
  "./node_modules/.pnpm/@seydx+node-av-darwin-arm64@*/node_modules/@seydx/node-av-darwin-arm64/**/*",
  "./node_modules/.pnpm/@seydx+node-av-darwin-x64@*/node_modules/@seydx/node-av-darwin-x64/**/*",
  "./node_modules/.pnpm/@seydx+node-av-linux-arm64@*/node_modules/@seydx/node-av-linux-arm64/**/*",
  "./node_modules/.pnpm/@seydx+node-av-linux-x64@*/node_modules/@seydx/node-av-linux-x64/**/*"
];

const nextConfig: NextConfig = {
  // node-av is a native FFmpeg binding used only by render-completion
  // functions. Keep it external so Next can trace its platform prebuild into
  // server functions without attempting to bundle a native addon.
  serverExternalPackages: ["node-av"],
  outputFileTracingIncludes: {
    "/api/r/*": nodeAvNativeTraceFiles,
    "/api/twilio/inbound": nodeAvNativeTraceFiles,
    "/api/sessions/*/control": nodeAvNativeTraceFiles,
    "/api/sessions/*/reconcile": nodeAvNativeTraceFiles,
    "/api/sessions/*/start": nodeAvNativeTraceFiles,
    "/api/sessions/*/transition": nodeAvNativeTraceFiles
  }
};

export default nextConfig;
