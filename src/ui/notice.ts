/** A short message shown briefly near the top of the screen; the page owns the element. */
export function createNotice(parent: HTMLElement = document.body, ms = 3000): (message: string) => void {
  const el = Object.assign(document.createElement('div'), { id: 'notice' });
  Object.assign(el.style, {
    position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)', padding: '10px 22px',
    background: 'rgba(20,16,10,0.85)', border: '2px solid #c9a24a', color: '#f3e6c4', font: '600 22px system-ui, sans-serif',
    borderRadius: '6px', pointerEvents: 'none', transition: 'opacity 0.4s', opacity: '0', zIndex: '10',
  });
  parent.append(el);
  let timer = 0;
  return (message) => {
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(timer);
    timer = window.setTimeout(() => (el.style.opacity = '0'), ms);
  };
}
