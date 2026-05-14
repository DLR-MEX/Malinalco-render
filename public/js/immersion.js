// Modo inmersion: oculta header/footer, expande canvas a pantalla completa.
// En desktop con mouse, el panel lateral se asoma al pasar el cursor por el
// borde derecho. Tactil/movil: el panel queda escondido (uso el boton para
// alternar si hace falta despues).
// Activable con boton, tecla Escape para salir, o ?immersive=1 en la URL.

export function initImmersion() {
  const $btn = document.getElementById('btn-expand');
  if (!$btn) return;

  function setImmersive(on) {
    document.body.classList.toggle('immersive', on);
    $btn.textContent = on ? '✕ SALIR' : '⛶ INMERSIÓN';
    if (!on) {
      document.querySelector('.side-panel')?.classList.remove('panel-visible');
      document.body.classList.remove('panel-open');
    }
    // Babylon resize cuando cambia el viewport
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  }

  // ?immersive=1 (bookmark-friendly desde celular)
  if (new URLSearchParams(location.search).get('immersive') === '1') {
    setImmersive(true);
  }

  $btn.addEventListener('click', () => {
    setImmersive(!document.body.classList.contains('immersive'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('immersive')) {
      setImmersive(false);
    }
  });

  setupHoverPanel();
}

function setupHoverPanel() {
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const panel = document.querySelector('.side-panel');
  if (!panel) return;

  const PANEL_WIDTH = 400;
  const TRIGGER_ZONE = 50; // px desde el borde derecho que dispara el panel
  let hideTimer = null;

  function showPanel() {
    clearTimeout(hideTimer);
    panel.classList.add('panel-visible');
    document.body.classList.add('panel-open');
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      panel.classList.remove('panel-visible');
      document.body.classList.remove('panel-open');
    }, 400);
  }

  window.addEventListener('mousemove', (e) => {
    if (!document.body.classList.contains('immersive')) return;
    const fromRight = window.innerWidth - e.clientX;
    if (fromRight <= TRIGGER_ZONE) showPanel();
    else if (fromRight > PANEL_WIDTH + 10) scheduleHide();
  });

  panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  panel.addEventListener('mouseleave', scheduleHide);
}
