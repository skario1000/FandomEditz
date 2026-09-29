import { useEffect, useState } from 'react';

const STORAGE_KEY = 'editverse_force_device';

export type DeviceMode = 'auto' | 'phone' | 'desktop';

function detectIsPhone(): boolean {
  if (typeof window === 'undefined') return false;

  // Check URL param ?device=phone / ?mobile=1
  const params = new URLSearchParams(window.location.search);
  const urlDevice = params.get('device') || params.get('view');
  if (urlDevice === 'phone' || urlDevice === 'mobile' || params.get('mobile') === '1') {
    return true;
  }
  if (urlDevice === 'desktop') {
    return false;
  }

  // Check stored override
  const saved = localStorage.getItem(STORAGE_KEY) as DeviceMode | null;
  if (saved === 'phone') return true;
  if (saved === 'desktop') return false;

  // Auto detection: screen width <= 768px OR mobile user agent on a mobile-sized viewport
  const isWidthPhone = window.innerWidth <= 768;
  const isMobileUA = /Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  return isWidthPhone || (isMobileUA && isTouch && window.innerWidth <= 880);
}

export function useIsPhone(): { isPhone: boolean; mode: DeviceMode; setMode: (m: DeviceMode) => void } {
  const [isPhone, setIsPhone] = useState<boolean>(detectIsPhone);
  const [mode, setModeState] = useState<DeviceMode>(() => {
    if (typeof window === 'undefined') return 'auto';
    return (localStorage.getItem(STORAGE_KEY) as DeviceMode) || 'auto';
  });

  useEffect(() => {
    const check = () => {
      setIsPhone(detectIsPhone());
    };

    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [mode]);

  const setMode = (m: DeviceMode) => {
    if (m === 'auto') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, m);
    }
    setModeState(m);
    setIsPhone(detectIsPhone());
  };

  return { isPhone, mode, setMode };
}
