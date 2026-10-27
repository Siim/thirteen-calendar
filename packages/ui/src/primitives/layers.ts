/**
 * The stack of open popovers and menus (not dialogs: a modal `<dialog>` is the
 * browser's own top layer and gets Escape as its `cancel` event).
 *
 * Escape closes only the topmost layer. Each open layer listens for Escape on
 * the document in the capture phase, so it sees the key before a `<dialog>`
 * that contains it; the topmost one takes it (`preventDefault` and
 * `stopPropagation`), which also stops the dialog's own close request. A menu
 * opened inside a popover inside the editor dialog therefore closes first,
 * then the popover, then (through its discard check) the dialog.
 */

const stack: symbol[] = [];

/** Registers an open layer; returns its handle. */
export function pushLayer(): symbol {
  const id = Symbol('layer');
  stack.push(id);
  return id;
}

/** Removes a layer, wherever it is in the stack. */
export function popLayer(id: symbol): void {
  const index = stack.lastIndexOf(id);
  if (index >= 0) stack.splice(index, 1);
}

export function isTopLayer(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** Number of open layers (tests). */
export function openLayerCount(): number {
  return stack.length;
}
