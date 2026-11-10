import type { DesktopApi } from './contracts/desktop';
declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
  const MAIN_WINDOW_VITE_NAME: string;
  interface Window { mediPharm: DesktopApi }
}
