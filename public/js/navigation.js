/**
 * Open Workers — Primary Site Navigation & Dropdown Controller
 *
 * Implements accessible keyboard navigation, ARIA synchronization,
 * outside-click dismissal, focus restoration, and active route indication
 * for the shared navigation bar and Licensing disclosure.
 */

(function initNavigation() {
  const dropdown = document.querySelector('.nav-dropdown');
  if (!dropdown) return;

  const toggle = dropdown.querySelector('summary');
  if (!toggle) return;

  const panel = dropdown.querySelector('.nav-dropdown-panel');
  const links = [...dropdown.querySelectorAll('a')];

  // ARIA attributes setup
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', String(dropdown.open));

  if (panel) {
    panel.setAttribute('role', 'menu');
    for (const link of links) {
      link.setAttribute('role', 'menuitem');
    }
  }

  // Active state synchronization for licensing dropdown
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const isLicensingActive = links.some((link) => {
    const href = link.getAttribute('href');
    return (
      link.getAttribute('aria-current') === 'page' ||
      (href && currentPath && (href === currentPath || currentPath.endsWith(href)))
    );
  });

  if (isLicensingActive) {
    toggle.classList.add('is-active');
  }

  const close = (restoreFocus = false) => {
    if (!dropdown.open) return;
    dropdown.open = false;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  };

  const open = () => {
    if (dropdown.open) return;
    dropdown.open = true;
    toggle.setAttribute('aria-expanded', 'true');
  };

  // Synchronize on native toggle event
  dropdown.addEventListener('toggle', () => {
    toggle.setAttribute('aria-expanded', String(dropdown.open));
  });

  // Close when clicking outside
  document.addEventListener('pointerdown', (event) => {
    if (!dropdown.contains(event.target)) {
      close(false);
    }
  });

  // Escape key closes and restores focus to toggle
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dropdown.open) {
      event.preventDefault();
      close(true);
    }
  });

  // Focusout closes if focus moves completely outside the dropdown
  dropdown.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!dropdown.contains(document.activeElement)) {
        close(false);
      }
    }, 10);
  });

  // Keyboard navigation within disclosure
  dropdown.addEventListener('keydown', (event) => {
    if (links.length === 0) return;
    const activeEl = document.activeElement;
    const index = links.indexOf(activeEl);

    let target = null;
    if (event.key === 'ArrowDown') {
      target = links[(index + 1) % links.length];
    } else if (event.key === 'ArrowUp') {
      target = links[index <= 0 ? links.length - 1 : index - 1];
    } else if (index >= 0 && event.key === 'Home') {
      target = links[0];
    } else if (index >= 0 && event.key === 'End') {
      target = links[links.length - 1];
    }

    if (target) {
      event.preventDefault();
      open();
      target.focus();
    }
  });
})();
