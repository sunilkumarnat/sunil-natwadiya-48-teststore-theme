/**
 * Gift Header — mobile toggle.
 *
 * On mobile the announcement + CTA are collapsed behind a burger trigger next to the logo,
 * matching a standard menu-toggle disclosure: closed by default on every page load, opens
 * and closes on tap. The toggle button's `aria-controls` points at the content's id.
 *
 * All visual states (collapsed/expanded height, opacity, padding, and the transition between
 * them) live in CSS via the `.is-open` class — this only ever toggles that class plus
 * `aria-expanded`, it never sets inline styles directly.
 */
document.querySelectorAll('[data-testid="gift-header"]').forEach((header) => {
  const toggleButton = header.querySelector('[data-gift-header-toggle]');
  const content = document.getElementById(toggleButton?.getAttribute('aria-controls'));

  toggleButton?.addEventListener('click', () => {
    const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
    toggleButton.setAttribute('aria-expanded', String(!isExpanded));
    content?.classList.toggle('is-open', !isExpanded);
  });
});
