/**
 * Patch a live DOM subtree to match an HTML string, reusing every node that
 * still fits. Keeping nodes (instead of replacing innerHTML) is what lets a
 * full re-render run on every slider tick: focus, caret, an in-progress drag
 * and running CSS animations all survive, and entrance animations only play
 * for nodes that are genuinely new.
 *
 * Matching is positional, except for elements carrying `data-key`, which are
 * matched by key. Give a subtree a new key to force a fresh copy (and replay
 * its animations), e.g. a new toast or a screen change.
 */
export function morph(target: Element, markup: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  patchChildren(target, tpl.content);
}

const keyOf = (n: Node): string | null => (n.nodeType === Node.ELEMENT_NODE ? (n as Element).getAttribute('data-key') : null);

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const ea = a as Element;
  const eb = b as Element;
  return ea.tagName === eb.tagName && (ea.tagName !== 'INPUT' || ea.getAttribute('type') === eb.getAttribute('type'));
}

function patchChildren(from: Node, to: Node): void {
  // Keyed nodes match by key; unkeyed nodes match each other in order, so a
  // keyed node appearing or vanishing (a toast) never shifts the rest.
  const keyed = new Map<string, Node>();
  const unkeyed: Node[] = [];
  for (const n of Array.from(from.childNodes)) {
    const k = keyOf(n);
    if (k) keyed.set(k, n);
    else unkeyed.push(n);
  }
  // 1. Decide which old node (if any) each new node reuses.
  const plan: { next: Node; match: Node | null }[] = [];
  let u = 0;
  for (const next of Array.from(to.childNodes)) {
    const k = keyOf(next);
    let match: Node | null = null;
    if (k) {
      const cand = keyed.get(k);
      if (cand && sameKind(cand, next)) {
        match = cand;
        keyed.delete(k);
      }
    } else if (u < unkeyed.length) {
      if (sameKind(unkeyed[u], next)) {
        match = unkeyed[u++];
      } else if (u + 1 < unkeyed.length && sameKind(unkeyed[u + 1], next)) {
        // One old node was removed here: drop it and match the one after.
        u++;
        match = unkeyed[u++];
      }
      // Otherwise `next` is an insertion; leave the old node for later rows.
    }
    plan.push({ next, match });
  }

  // 2. Drop the old nodes nobody reuses. What remains is already in order
  //    (except reordered keyed nodes), so step 3 rarely has to move anything:
  //    moving a node, even in place, restarts its CSS animations.
  const reused = new Set(plan.map((p) => p.match));
  for (const n of Array.from(from.childNodes)) if (!reused.has(n)) from.removeChild(n);

  // 3. Insert new nodes and patch reused ones in place.
  plan.forEach(({ next, match }, i) => {
    const cur = from.childNodes[i] ?? null;
    if (match) {
      if (match !== cur) from.insertBefore(match, cur);
      patchNode(match, next);
    } else {
      from.insertBefore(next, cur);
    }
  });
}

function patchNode(a: Node, b: Node): void {
  if (a.nodeType !== Node.ELEMENT_NODE) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  const ea = a as Element;
  const eb = b as Element;
  for (const { name } of Array.from(ea.attributes)) if (!eb.hasAttribute(name)) ea.removeAttribute(name);
  for (const { name, value } of Array.from(eb.attributes)) if (ea.getAttribute(name) !== value) ea.setAttribute(name, value);

  if (ea instanceof HTMLInputElement) syncInput(ea, eb as HTMLInputElement);
  else if (ea instanceof HTMLTextAreaElement && ea !== document.activeElement) ea.value = (eb as HTMLTextAreaElement).defaultValue;

  patchChildren(ea, eb);
}

/** Attributes only set the default; the live value and checked state are properties. */
function syncInput(a: HTMLInputElement, b: HTMLInputElement): void {
  if (a.type === 'file') return;
  if (a.type === 'checkbox' || a.type === 'radio') {
    a.checked = b.hasAttribute('checked');
    return;
  }
  // Never fight the user over the field they are typing in or dragging.
  if (a === document.activeElement) return;
  const v = b.getAttribute('value') ?? '';
  if (a.value !== v) a.value = v;
}
