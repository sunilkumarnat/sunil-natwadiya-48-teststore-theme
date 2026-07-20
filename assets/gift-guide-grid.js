/**
 * Gift Guide Grid — quick-view popup + add-to-cart.
 *
 * Built from scratch for the new "Gift Guide Grid" section. Every product's
 * variants/price/description are read from that product's own JSON payload
 * (rendered server-side per block), so nothing here is hardcoded per product.
 *
 * The only piece of existing theme code reused, per the project's rules, is the
 * cart-drawer integration: `@shopify/events` is the theme's own event bus, and
 * dispatching `CartLinesUpdateEvent` is what makes the existing cart drawer
 * open/update itself after we add items — the same contract `product-form.js` uses.
 */
import { CartLinesUpdateEvent } from '@shopify/events';

const COLOR_OPTION_PATTERN = /colou?r/i;

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
 * @param {string} colorName
 * @returns {string|null}
 */
function colorNameToHex(colorName) {
  const lastWord = colorName.trim().split(/\s+/).pop().toLowerCase();
  return COLOR_NAME_TO_HEX[lastWord] || null;
}

/**
 * @param {string|{src:string}|null|undefined} image
 * @returns {string}
 */
function imageSrc(image) {
  if (!image) return '';
  return typeof image === 'string' ? image : image.src || '';
}

/**
 * @param {number} cents
 * @returns {string}
 */
function formatMoney(cents) {
  const currency = window.Shopify?.currency?.active || 'USD';
  const locale = document.documentElement.lang || 'en';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

/**
 * A single quick-view popup, scoped to one Gift Guide Grid section.
 * Handles rendering dynamic variant controls and the add-to-cart flow.
 */
class GiftGuidePopup {
  /** @param {HTMLElement} section */
  constructor(section) {
    this.section = section;
    this.dialog = section.querySelector('[data-gift-popup]');
    this.companionProduct = this.#readJson(section.querySelector('[data-gift-companion-product]'));
    this.companionTriggerValues = (section.dataset.companionTriggerValues || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    /** @type {object|null} currently open product */
    this.product = null;
    /** @type {Record<string,string>} option name -> selected value */
    this.selectedOptions = {};
    /** @type {object|null} */
    this.currentVariant = null;

    this.#bindStaticEvents();
  }

  #readJson(scriptEl) {
    if (!scriptEl) return null;
    try {
      const data = JSON.parse(scriptEl.textContent.trim());
      return data && Object.keys(data).length ? data : null;
    } catch {
      return null;
    }
  }

  #bindStaticEvents() {
    this.section.querySelectorAll('[data-gift-hotspot]').forEach((button) => {
      const productScript = button.parentElement.querySelector('[data-gift-product-json]');
      const product = this.#readJson(productScript);
      if (!product) return;
      button.addEventListener('click', () => this.open(product));
    });

    this.dialog?.querySelector('[data-gift-popup-close]')?.addEventListener('click', () => this.close());
    this.dialog?.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });
    this.dialog?.querySelector('[data-gift-popup-add]')?.addEventListener('click', () => this.addToCart());

    // The dialog's native `close` event fires however it closes (our close(), Escape key,
    // backdrop click), so unlocking scroll here — rather than only in close() — catches all of them.
    this.dialog?.addEventListener('close', () => {
      document.body.style.removeProperty('overflow');
    });
  }

  /** @param {object} product */
  open(product) {
    if (!Array.isArray(product?.variants) || product.variants.length === 0) {
      console.warn('[gift-guide-grid] Product is missing variant data, skipping quick view:', product);
      return;
    }

    this.product = product;
    this.selectedOptions = {};

    // `{{ product | json }}` includes `options` (names) and `variants` (with raw option1/2/3
    // values) but not `options_with_values` — so derive each option's value list from the
    // variants themselves, in first-seen order.
    this.optionsWithValues = (product.options || []).map((name, index) => {
      const key = `option${index + 1}`;
      const values = [];
      product.variants.forEach((variant) => {
        if (variant[key] && !values.includes(variant[key])) values.push(variant[key]);
      });
      return { name, values };
    });

    // Seed selections with the first available variant's options, falling back to the first variant.
    const startingVariant = product.variants.find((variant) => variant.available) || product.variants[0];
    (product.options || []).forEach((name, index) => {
      const key = `option${index + 1}`;
      this.selectedOptions[name] = startingVariant?.[key] ?? this.optionsWithValues[index]?.values?.[0];
    });

    this.#renderStaticFields();
    this.#renderOptions();
    this.#syncVariant();
    this.#setError('');

    if (typeof this.dialog.showModal === 'function') {
      this.dialog.showModal();
    } else {
      this.dialog.setAttribute('open', '');
    }

    document.body.style.overflow = 'hidden';
  }

  close() {
    this.dialog?.close?.();
  }

  #renderStaticFields() {
    const { product } = this;
    this.dialog.querySelector('[data-gift-popup-title]').textContent = product.title;
    this.dialog.querySelector('[data-gift-popup-description]').innerHTML = product.description || '';

    const image = this.dialog.querySelector('[data-gift-popup-image]');
    image.src = imageSrc(product.featured_image) || imageSrc(product.images?.[0]);
    image.alt = product.title;
  }

  #renderOptions() {
    const wrap = this.dialog.querySelector('[data-gift-popup-options]');
    wrap.innerHTML = '';

    // Color renders first regardless of the store's raw option order, matching the design.
    const orderedOptions = [...(this.optionsWithValues || [])].sort((a, b) => {
      const aIsColor = COLOR_OPTION_PATTERN.test(a.name);
      const bIsColor = COLOR_OPTION_PATTERN.test(b.name);
      if (aIsColor === bIsColor) return 0;
      return aIsColor ? -1 : 1;
    });

    orderedOptions.forEach((option) => {
      const group = document.createElement('div');
      group.className = 'gift-popup__option';

      const label = document.createElement('span');
      label.className = 'gift-popup__option-label';
      label.textContent = option.name;
      group.appendChild(label);

      if (COLOR_OPTION_PATTERN.test(option.name)) {
        group.appendChild(this.#buildSwatchControl(option));
      } else {
        group.appendChild(this.#buildSelectControl(option));
      }

      wrap.appendChild(group);
    });
  }

  /** @param {{name: string, values: string[]}} option */
  #buildSwatchControl(option) {
    const list = document.createElement('div');
    list.className = 'gift-popup__swatches';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', option.name);

    option.values.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gift-popup__swatch';
      button.textContent = value;
      button.setAttribute('aria-pressed', String(this.selectedOptions[option.name] === value));
      const swatchColor = colorNameToHex(value);
      if (swatchColor) button.style.setProperty('--swatch-color', swatchColor);
      button.addEventListener('click', () => {
        this.selectedOptions[option.name] = value;
        list.querySelectorAll('.gift-popup__swatch').forEach((el) => {
          el.setAttribute('aria-pressed', String(el === button));
        });
        this.#syncVariant();
      });
      list.appendChild(button);
    });

    return list;
  }

  /** @param {{name: string, values: string[]}} option */
  #buildSelectControl(option) {
    const select = document.createElement('select');
    select.className = 'gift-popup__select';
    select.setAttribute('aria-label', option.name);

    option.values.forEach((value) => {
      const optionEl = document.createElement('option');
      optionEl.value = value;
      optionEl.textContent = value;
      optionEl.selected = this.selectedOptions[option.name] === value;
      select.appendChild(optionEl);
    });

    select.addEventListener('change', () => {
      this.selectedOptions[option.name] = select.value;
      this.#syncVariant();
    });

    return select;
  }

  #syncVariant() {
    const { product, selectedOptions } = this;
    const optionNames = product.options || [];

    this.currentVariant =
      product.variants.find((variant) =>
        optionNames.every((name, index) => variant[`option${index + 1}`] === selectedOptions[name])
      ) || null;

    const priceEl = this.dialog.querySelector('[data-gift-popup-price]');
    const addButton = this.dialog.querySelector('[data-gift-popup-add]');
    const image = this.dialog.querySelector('[data-gift-popup-image]');

    if (this.currentVariant) {
      priceEl.textContent = formatMoney(this.currentVariant.price);
      addButton.disabled = !this.currentVariant.available;
      const variantImage = imageSrc(this.currentVariant.featured_image);
      if (variantImage) image.src = variantImage;
      this.#setError(this.currentVariant.available ? '' : 'This combination is sold out.');
    } else {
      priceEl.textContent = formatMoney(product.price);
      addButton.disabled = true;
      this.#setError('This combination is unavailable.');
    }
  }

  #setError(message) {
    const errorEl = this.dialog.querySelector('[data-gift-popup-error]');
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  /**
   * Whether the current selection matches every configured companion trigger value
   * (e.g. Color: Black + Size: Medium), regardless of which option holds which value.
   */
  #matchesCompanionTrigger() {
    if (!this.companionProduct || this.companionTriggerValues.length === 0) return false;

    const selectedValues = Object.values(this.selectedOptions).map((value) => value.toLowerCase());
    return this.companionTriggerValues.every((trigger) => selectedValues.includes(trigger.toLowerCase()));
  }

  async addToCart() {
    if (!this.currentVariant) return;

    const addButton = this.dialog.querySelector('[data-gift-popup-add]');
    const labels = this.dialog.querySelectorAll('[data-gift-popup-add-label]');
    addButton.disabled = true;
    labels.forEach((label) => (label.textContent = 'Adding…'));

    const items = [{ id: this.currentVariant.id, quantity: 1 }];

    if (this.#matchesCompanionTrigger()) {
      const companionVariant =
        this.companionProduct.variants.find((variant) => variant.available) || this.companionProduct.variants[0];
      if (companionVariant && companionVariant.id !== this.currentVariant.id) {
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
      this.#setError(error.message || 'Something went wrong. Please try again.');
    } finally {
      addButton.disabled = false;
      labels.forEach((label) => (label.textContent = 'Add to cart'));
    }
  }
}

document.querySelectorAll('[data-gift-grid]').forEach((section) => new GiftGuidePopup(section));
