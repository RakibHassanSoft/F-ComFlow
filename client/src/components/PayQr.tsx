// A REAL, scannable QR code for a payment link.
//
// We render it client-side (no third party ever sees the pay URL) using the
// tiny, well-tested qrcodejs library, loaded once from cdnjs on demand. If the
// script can't load, we fall back to the decorative QrMock plus the plain link,
// so the customer can always reach the pay page.
'use client';
import { useEffect, useRef, useState } from 'react';
import { QrMock } from './QrMock';

declare global {
  interface Window { QRCode?: any }
}

const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

export function PayQr({ value, size = 176 }: { value: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function render() {
      if (cancelled || !ref.current || !window.QRCode) return;
      ref.current.innerHTML = '';
      try {
        // eslint-disable-next-line new-cap
        new window.QRCode(ref.current, {
          text: value,
          width: size,
          height: size,
          correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0,
        });
      } catch {
        setFailed(true);
      }
    }

    if (window.QRCode) { render(); return; }

    let script = document.querySelector<HTMLScriptElement>('script[data-qrcode]');
    if (!script) {
      script = document.createElement('script');
      script.src = SRC;
      script.async = true;
      script.setAttribute('data-qrcode', '1');
      document.body.appendChild(script);
    }
    const onLoad = () => render();
    const onErr = () => { if (!cancelled) setFailed(true); };
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onErr);

    const timer = setTimeout(() => { if (!cancelled && !window.QRCode) setFailed(true); }, 6000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onErr);
    };
  }, [value, size]);

  if (failed) return <QrMock seed={value} size={size} />;
  return <div ref={ref} style={{ width: size, height: size }} className="rounded-lg bg-white p-1" />;
}
