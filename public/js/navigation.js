// Navigation disclosure: native click, touch, Enter and Space behavior remains.
const dropdown = document.querySelector('.nav-dropdown');
if (dropdown) {
  const toggle = dropdown.querySelector('summary');
  const links = [...dropdown.querySelectorAll('a')];
  const close = (restoreFocus = false) => {
    dropdown.open = false;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  };
  dropdown.addEventListener('toggle', () => {
    toggle.setAttribute('aria-expanded', String(dropdown.open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!dropdown.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dropdown.open) {
      event.preventDefault(); close(true);
    }
  });
  dropdown.addEventListener('focusout', () => {
    // Wait until focus has moved before deciding whether it left the disclosure.
    setTimeout(() => { if (!dropdown.contains(document.activeElement)) close(); }, 0);
  });
  dropdown.addEventListener('keydown', (event) => {
    const index = links.indexOf(document.activeElement);
    let target;
    if (event.key === 'ArrowDown') target = links[(index + 1) % links.length];
    else if (event.key === 'ArrowUp') target = links[index <= 0 ? links.length - 1 : index - 1];
    else if (index >= 0 && event.key === 'Home') target = links[0];
    else if (index >= 0 && event.key === 'End') target = links.at(-1);
    if (target) {
      event.preventDefault(); dropdown.open = true;
      toggle.setAttribute('aria-expanded', 'true'); target.focus();
    }
  });
}
