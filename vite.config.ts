import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  // host:true binds all interfaces (0.0.0.0) so the app reaches over LAN / Tailscale.
  // allowedHosts:true accepts any Host header (LAN + tailnet hostnames) — this app
  // holds no secrets and runs on a private network.
  server: { host: true, port: 4300, allowedHosts: true },
  preview: { host: true, port: 4300, allowedHosts: true },
});
