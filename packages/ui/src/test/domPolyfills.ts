/**
 * What jsdom lacks for the primitives: `<dialog>`'s `show()`, `showModal()` and
 * `close()`, Escape turning into the dialog's `cancel` event, and the Popover
 * API's `showPopover()` / `hidePopover()` (jsdom hides every `[popover]`
 * element but cannot show one). Enough to test focus handling and the close
 * requests, not layout or the top layer. Imported by the test setups of
 * packages/ui and apps/web.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const modalStack: HTMLDialogElement[] = [];

if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  const proto = HTMLDialogElement.prototype;

  if (!Object.getOwnPropertyDescriptor(proto, 'open')) {
    Object.defineProperty(proto, 'open', {
      configurable: true,
      get(this: HTMLDialogElement) {
        return this.hasAttribute('open');
      },
      set(this: HTMLDialogElement, value: boolean) {
        this.toggleAttribute('open', Boolean(value));
      },
    });
  }

  proto.show = function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };

  proto.showModal = function showModal(this: HTMLDialogElement) {
    if (this.hasAttribute('open')) throw new DOMException('The dialog is already open.', 'InvalidStateError');
    if (!this.isConnected) throw new DOMException('The dialog is not connected.', 'InvalidStateError');
    this.setAttribute('open', '');
    modalStack.push(this);
    const target = this.querySelector<HTMLElement>('[autofocus]') ?? this.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? this).focus();
  };

  proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    const index = modalStack.lastIndexOf(this);
    if (index >= 0) modalStack.splice(index, 1);
    if (returnValue !== undefined) this.returnValue = returnValue;
    // Browsers fire `close` from a queued task.
    setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  };

  // Escape on a modal dialog: a cancelable `cancel` event, then close unless it was canceled.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const dialog = modalStack[modalStack.length - 1];
    if (dialog === undefined || !dialog.isConnected) return;
    const cancel = new Event('cancel', { cancelable: true });
    if (dialog.dispatchEvent(cancel)) dialog.close();
  });
}

if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover !== 'function') {
  const shown = new WeakSet<HTMLElement>();
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    if (shown.has(this)) throw new DOMException('The popover is already showing.', 'InvalidStateError');
    shown.add(this);
    this.style.setProperty('display', 'block');
  };
  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    shown.delete(this);
    this.style.removeProperty('display');
  };
}

export {};
