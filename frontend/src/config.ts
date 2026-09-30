export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';
export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8001";

export const getWsUrl = (path: string) => {
  const wsBase = API_BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}${path}`;
};

