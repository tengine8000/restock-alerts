import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initForm } from './notify-me.module.js';

/**
 * Drain the microtask queue. Each `await Promise.resolve()` yields once;
 * chaining several handles promise chains that have multiple `.then()` hops
 * (e.g. fetch → .then → .json() → .catch → .then → .finally).
 */
async function flushPromises(depth = 10) {
  for (let i = 0; i < depth; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContainer(overrides = {}) {
  const {
    variantId = '12345',
    productId = '99999',
    shop = 'test-shop.myshopify.com',
    appUrl = 'https://my-app.example.com',
    submitText = 'Notify Me When Available',
  } = overrides;

  const div = document.createElement('div');
  div.className = 'bis-notify-me';
  div.dataset.variantId = variantId;
  div.dataset.productId = productId;
  div.dataset.shop = shop;
  div.dataset.appUrl = appUrl;
  div.innerHTML = `
    <form class="bis-form" novalidate>
      <div class="bis-field">
        <input
          type="email"
          name="email"
          class="bis-email-input"
          placeholder="Enter your email"
          required
          autocomplete="email"
        />
      </div>
      <button type="submit" class="bis-submit-btn">${submitText}</button>
      <div class="bis-success" style="display:none;">You're on the list!</div>
      <div class="bis-error" style="display:none;"></div>
    </form>
  `;
  document.body.appendChild(div);
  initForm(div);
  return div;
}

function submit(container) {
  const form = container.querySelector('.bis-form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notify-me.js', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // -------------------------------------------------------------------------
  it('invalid email: shows error, does NOT call fetch', () => {
    const container = buildContainer();
    const emailInput = container.querySelector('.bis-email-input');
    const errorEl = container.querySelector('.bis-error');

    emailInput.value = 'not-an-email';
    submit(container);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorEl.style.display).not.toBe('none');
    expect(errorEl.textContent).toMatch(/valid email/i);
  });

  // -------------------------------------------------------------------------
  it('valid email + 200 response: shows success, hides form fields, disables button permanently', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const container = buildContainer();
    const emailInput = container.querySelector('.bis-email-input');
    const submitBtn = container.querySelector('.bis-submit-btn');
    const successEl = container.querySelector('.bis-success');
    const errorEl = container.querySelector('.bis-error');

    emailInput.value = 'customer@example.com';
    submit(container);

    await flushPromises();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://my-app.example.com/api/subscribe',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'customer@example.com',
          variantId: '12345',
          productId: '99999',
          shop: 'test-shop.myshopify.com',
        }),
      })
    );

    // Success message visible
    expect(successEl.style.display).not.toBe('none');
    // Button hidden
    expect(submitBtn.style.display).toBe('none');
    // Error still hidden
    expect(errorEl.style.display).toBe('none');

    // Submitting again after success does nothing (form locked)
    submit(container);
    expect(fetchMock).toHaveBeenCalledOnce(); // still only once
  });

  // -------------------------------------------------------------------------
  it('valid email + 400 response: shows error, re-enables submit button', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Already subscribed.' }),
    });

    const container = buildContainer();
    const emailInput = container.querySelector('.bis-email-input');
    const submitBtn = container.querySelector('.bis-submit-btn');
    const errorEl = container.querySelector('.bis-error');
    const successEl = container.querySelector('.bis-success');

    emailInput.value = 'customer@example.com';
    submit(container);

    await flushPromises();

    expect(errorEl.textContent).toBe('Already subscribed.');
    expect(errorEl.style.display).not.toBe('none');
    expect(successEl.style.display).toBe('none');

    // Button must be re-enabled so the user can retry
    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.textContent).toBe('Notify Me When Available');
  });

  // -------------------------------------------------------------------------
  it('network error: shows generic error, re-enables submit button', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

    const container = buildContainer();
    const emailInput = container.querySelector('.bis-email-input');
    const submitBtn = container.querySelector('.bis-submit-btn');
    const errorEl = container.querySelector('.bis-error');

    emailInput.value = 'customer@example.com';
    submit(container);

    await flushPromises();

    expect(errorEl.textContent).toMatch(/unable to connect/i);
    expect(submitBtn.disabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  it('submit while loading: second submit is ignored (button already disabled)', () => {
    // Never resolve — keeps the request in-flight
    fetchMock.mockReturnValueOnce(new Promise(() => {}));

    const container = buildContainer();
    const emailInput = container.querySelector('.bis-email-input');
    const submitBtn = container.querySelector('.bis-submit-btn');

    emailInput.value = 'customer@example.com';

    // First submit — starts loading
    submit(container);

    // Button must be disabled immediately (synchronously)
    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.textContent).toBe('...');

    // Second submit — should be a no-op
    submit(container);

    // fetch was only called once
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
