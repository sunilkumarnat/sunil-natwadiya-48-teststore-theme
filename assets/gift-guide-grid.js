/**
 * Gift Guide Grid — quick-view popup + add-to-cart.
 *
 * Built from scratch for the new "Gift Guide Grid" section. The popup's body (image, title,
 * price, description, options, add-to-cart button) is real server-rendered Liquid: on open, and
 * again on every option change, this fetches sections/gift-popup-content.liquid for the current
 * product/variant via Shopify's Section Rendering API and swaps it in — nothing about a
 * product's own markup is templated here in JS. The only client-side data kept per product is a
 * small variant-id lookup (id + option values), needed to resolve which variant to fetch next
 * when an option changes, since the Section Rendering API selects a variant by id, not by option
 * values.
 *
 * The only piece of existing theme code reused, per the project's rules, is the cart-drawer
 * integration: `@shopify/events` is the theme's own event bus, and dispatching
 * `CartLinesUpdateEvent` is what makes the existing cart drawer open/update itself after we add
 * items — the same contract `product-form.js` uses.
 */
import { CartLinesUpdateEvent } from '@shopify/events';

// Maps common color option values to a real swatch color. Multi-word values (e.g. "Navy Blue")
// are matched by their last word so specific shades still resolve to a sensible base color.
const COLOR_NAME_TO_HEX = {
  black: '#000000',
  white: '#ffffff',
  grey: '#8a8a8a',
  gray: '#8a8a8a',
  silver: '#c0c0c0',
  red: '#c0392b',
  maroon: '#800000',
  burgundy: '#7b1f2b',
  pink: '#e5989b',
  orange: '#e07b39',
  yellow: '#f1c40f',
  gold: '#d4af37',
  green: '#3a7d44',
  olive: '#708238',
  khaki: '#c3b091',
  teal: '#128277',
  blue: '#2e5eaa',
  navy: '#1b2a4a',
  purple: '#6c3483',
  lavender: '#b497bd',
  brown: '#6f4e37',
  tan: '#d2b48c',
  beige: '#e8dcc4',
  cream: '#f5f0e1',
  denim: '#4a6c8c',
};

/**
 * @param {string|undefined} colorName
 * @returns {string|null}
 */
function colorNameToHex(colorName) {
  const words = (colorName || '').trim().split(/\s+/);
  const lastWord = (words[words.length - 1] || '').toLowerCase();
  return COLOR_NAME_TO_HEX[lastWord] || null;
}

/**
 * A single quick-view popup, scoped to one Gift Guide Grid section.
 * Handles fetching the popup's rendered content and the add-to-cart flow.
 */
class GiftGuidePopup {
  /** @param {HTMLElement} section */
  constructor(section) {
    this.section = section;
    this.dialog = /** @type {HTMLDialogElement} */ (section.querySelector('[data-gift-popup]'));
    this.body = /** @type {HTMLElement} */ (this.dialog.querySelector('[data-gift-popup-body]'));
    /** @type {{variants: Array<{id:number, available:boolean}>}|null} */
    this.companionProduct = this.#readJson(section.querySelector('[data-gift-companion-product]'));
    this.companionTriggerValues = (section.dataset.companionTriggerValues || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    /** @type {string|null} */
    this.productUrl = null;
    /** @type {Array<{id:number, options:string[], available:boolean}>} */
    this.variants = [];
    /** @type {string[]} positional selected option values, same order as each variant's `options` */
    this.selectedOptions = [];
    /** Guards against an older fetch resolving after a newer one has started. */
    this.requestToken = 0;

    this.#bindStaticEvents();
  }

  /** @type {number} */
  #scrollY = 0;

  /**
   * Locks background scroll without jumping the page to the top. Just setting
   * `overflow: hidden` on <body> resets scroll position on some mobile browsers, so instead
   * the body is pinned in place with `position: fixed` at its current scroll offset.
   */
  #lockScroll() {
    this.#scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${this.#scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
  }

  #unlockScroll() {
    document.body.style.removeProperty('position');
    document.body.style.removeProperty('top');
    document.body.style.removeProperty('left');
    document.body.style.removeProperty('right');
    // `behavior: 'instant'` matters here — the theme sets `scroll-behavior: smooth`
    // globally, which would otherwise animate this restore into a visible scroll motion.
    window.scrollTo({ top: this.#scrollY, left: 0, behavior: 'instant' });
  }

  /** @param {Element|null} [scriptEl] */
  #readJson(scriptEl) {
    if (!scriptEl?.textContent) return null;
    try {
      const data = JSON.parse(scriptEl.textContent.trim());
      return data && (Array.isArray(data) ? data.length : Object.keys(data).length) ? data : null;
    } catch {
      return null;
    }
  }

  #bindStaticEvents() {
    this.section.querySelectorAll('[data-gift-hotspot]').forEach((buttonEl) => {
      const button = /** @type {HTMLElement} */ (buttonEl);
      const url = button.dataset.giftProductUrl;
      const variantScript = button.parentElement?.querySelector('[data-gift-variant-map]');
      const variants = this.#readJson(variantScript);
      if (!url || !Array.isArray(variants) || variants.length === 0) return;
      button.addEventListener('click', () => this.open(url, variants));
    });

    this.dialog.querySelector('[data-gift-popup-close]')?.addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });

    // The dialog's native `close` event fires however it closes (our close(), Escape key,
    // backdrop click), so unlocking scroll here — rather than only in close() — catches all of them.
    this.dialog.addEventListener('close', () => this.#unlockScroll());
  }

  /**
   * @param {string} url the product's own URL
   * @param {Array<{id:number, options:string[], available:boolean}>} variants
   */
  open(url, variants) {
    const startingVariant = variants.find((variant) => variant.available) || variants[0];
    if (!startingVariant) return;

    this.productUrl = url;
    this.variants = variants;
    this.selectedOptions = [...startingVariant.options];

    this.body.innerHTML = '<p class="gift-popup__loading">Loading…</p>';

    this.#lockScroll();

    if (typeof this.dialog.showModal === 'function') {
      this.dialog.showModal();
    } else {
      this.dialog.setAttribute('open', '');
    }

    this.#loadContent(startingVariant.id);
  }

  close() {
    this.dialog.close?.();
  }

  /** Finds the variant whose option values exactly match the current selection. */
  #findVariant() {
    return this.variants.find((variant) =>
      variant.options.every((value, index) => value === this.selectedOptions[index])
    );
  }

  /** @param {number} variantId */
  async #loadContent(variantId) {
    if (!this.productUrl) return;

    const token = ++this.requestToken;
    const separator = this.productUrl.includes('?') ? '&' : '?';
    const url = `${this.productUrl}${separator}variant=${variantId}&section_id=gift-popup-content`;

    try {
      const html = await fetch(url, { headers: { Accept: 'text/html' } }).then((response) => response.text());
      if (token !== this.requestToken) return;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const content = doc.querySelector('[data-gift-popup-content]');
      if (!content) return;

      this.body.innerHTML = content.innerHTML;
      this.#afterRender();
    } catch {
      if (token !== this.requestToken) return;
      this.body.innerHTML = '<p class="gift-popup__error">Something went wrong loading this product. Please try again.</p>';
    }
  }

  /** Wires up interactivity for content that was just fetched and injected. */
  #afterRender() {
    // The dialog's aria-labelledby points at whatever id lives here — set it here rather than
    // in the fetched section so that section doesn't need to know the grid section's id.
    const title = this.body.querySelector('[data-gift-popup-title]');
    if (title) title.id = this.dialog.getAttribute('aria-labelledby') || '';

    this.body.querySelectorAll('.gift-popup__swatch').forEach((el) => {
      const button = /** @type {HTMLElement} */ (el);
      const hex = colorNameToHex(button.dataset.value);
      if (hex) button.style.setProperty('--swatch-color', hex);

      button.addEventListener('click', () => {
        const group = /** @type {HTMLElement|null} */ (button.closest('[data-option-index]'));
        if (!group) return;
        const index = Number(group.dataset.optionIndex);
        if (Number.isNaN(index)) return;

        this.selectedOptions[index] = button.dataset.value || '';
        group.querySelectorAll('.gift-popup__swatch').forEach((swatchEl) => {
          swatchEl.setAttribute('aria-pressed', String(swatchEl === button));
        });
        this.#onOptionChange();
      });
    });

    this.body.querySelectorAll('.gift-popup__select').forEach((el) => {
      const select = /** @type {HTMLSelectElement} */ (el);
      select.addEventListener('change', () => {
        const index = Number(select.dataset.optionIndex);
        if (Number.isNaN(index)) return;

        this.selectedOptions[index] = select.value;
        this.#onOptionChange();
      });
    });

    this.body.querySelector('[data-gift-popup-add]')?.addEventListener('click', () => this.addToCart());
  }

  #onOptionChange() {
    const variant = this.#findVariant();
    if (variant) this.#loadContent(variant.id);
  }

  /**
   * Whether the current selection matches every configured companion trigger value
   * (e.g. Color: Black + Size: Medium), regardless of which option holds which value.
   */
  #matchesCompanionTrigger() {
    if (!this.companionProduct || this.companionTriggerValues.length === 0) return false;

    const selectedValues = this.selectedOptions.map((value) => (value || '').toLowerCase());
    return this.companionTriggerValues.every((trigger) => selectedValues.includes(trigger.toLowerCase()));
  }

  async addToCart() {
    const addButton = /** @type {HTMLButtonElement|null} */ (this.body.querySelector('[data-gift-popup-add]'));
    const variantId = Number(addButton?.dataset.variantId);
    if (!addButton || !variantId) return;

    const labels = this.body.querySelectorAll('[data-gift-popup-add-label]');
    addButton.disabled = true;
    labels.forEach((label) => (label.textContent = 'Adding…'));

    const items = [{ id: variantId, quantity: 1 }];

    if (this.#matchesCompanionTrigger() && this.companionProduct) {
      const companionVariant =
        this.companionProduct.variants.find((variant) => variant.available) || this.companionProduct.variants[0];
      if (companionVariant && companionVariant.id !== variantId) {
        items.push({ id: companionVariant.id, quantity: 1 });
      }
    }

    // Reuse the theme's cart-drawer open/update behaviour: it listens for this
    // standard event on `document` and reacts once our fetch resolves the promise.
    const deferred = CartLinesUpdateEvent.createPromise();
    document.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: items.map((item) => ({ merchandiseId: item.id, quantity: item.quantity })),
        promise: deferred.promise,
      })
    );

    try {
      const addResponse = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
      }).then((response) => response.json());

      if (addResponse.status) {
        throw new Error(addResponse.message || 'Could not add this item to your cart.');
      }

      const cart = await fetch('/cart.js', { headers: { Accept: 'application/json' } }).then((response) =>
        response.json()
      );

      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          source: 'gift-guide-grid',
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          didError: false,
        },
      });

      this.close();
    } catch (error) {
      deferred.reject(error);
      const errorEl = /** @type {HTMLElement|null} */ (this.body.querySelector('[data-gift-popup-error]'));
      if (errorEl) {
        errorEl.textContent = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
        errorEl.hidden = false;
      }
    } finally {
      addButton.disabled = false;
      labels.forEach((label) => (label.textContent = 'Add to cart'));
    }
  }
}

document.querySelectorAll('[data-gift-grid]').forEach((section) => new GiftGuidePopup(section));
