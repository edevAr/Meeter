export function stripHtml(value: string): string {
  return (value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function isRichHtml(value: string): boolean {
  return (
    /<\s*(b|i|u|s|strong|em|ul|ol|li|mark|span|font|h[1-6]|blockquote)\b/i.test(value || '') ||
    /style\s*=/i.test(value || '')
  );
}

export function sanitizeRich(html: string): string {
  const raw = (html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
  if (typeof DOMParser === 'undefined') return raw;
  try {
    const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';
    const allowed = new Set(['B', 'I', 'U', 'S', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'MARK', 'SPAN', 'FONT', 'P', 'DIV', 'BR', 'BLOCKQUOTE']);
    const walk = (node: Element) => {
      [...node.children].forEach((child) => {
        if (!allowed.has(child.tagName)) {
          const nested = [...child.childNodes];
          child.replaceWith(...nested);
          nested.forEach((item) => {
            if (item.nodeType === 1) walk(item as Element);
          });
          return;
        }
        [...child.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          if (name === 'style') {
            const cleaned = (child.getAttribute('style') || '')
              .split(';')
              .map((part) => part.trim())
              .filter((part) =>
                /^(color|background-color|font-size|font-family|font-weight|font-style|text-decoration)\s*:/i.test(
                  part,
                ),
              )
              .join('; ');
            if (cleaned) child.setAttribute('style', cleaned);
            else child.removeAttribute('style');
          } else if (name !== 'face' && name !== 'size' && name !== 'color') {
            child.removeAttribute(attr.name);
          }
        });
        walk(child);
      });
    };
    walk(root);
    return root.innerHTML;
  } catch {
    return stripHtml(raw);
  }
}

function editorRange(root: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== root) return null;
  return range;
}

function selectNode(node: Node): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function wrapSelection(root: HTMLElement, tag: string, styles?: Record<string, string>): boolean {
  const range = editorRange(root);
  if (!range || range.collapsed) return false;
  const el = document.createElement(tag);
  if (styles) {
    for (const [name, value] of Object.entries(styles)) el.style.setProperty(name, value);
  }
  try {
    range.surroundContents(el);
  } catch {
    el.appendChild(range.extractContents());
    range.insertNode(el);
  }
  selectNode(el);
  return true;
}

function fragmentLines(frag: DocumentFragment): DocumentFragment[] {
  const lines: DocumentFragment[] = [];
  let current = document.createDocumentFragment();
  const flush = () => {
    lines.push(current);
    current = document.createDocumentFragment();
  };
  const take = (node: Node) => {
    if (node.nodeName === 'BR') {
      flush();
      return;
    }
    if (node.nodeName === 'DIV' || node.nodeName === 'P' || node.nodeName === 'LI') {
      if (current.childNodes.length) flush();
      const line = document.createDocumentFragment();
      [...node.childNodes].forEach((child) => {
        if (child.nodeName !== 'BR' || line.childNodes.length) line.appendChild(child);
      });
      lines.push(line);
      return;
    }
    if (node.nodeName === 'UL' || node.nodeName === 'OL') {
      [...node.childNodes].forEach(take);
      return;
    }
    current.appendChild(node);
  };
  [...frag.childNodes].forEach(take);
  if (current.childNodes.length) flush();
  return lines.length ? lines : [document.createDocumentFragment()];
}

function unwrapList(list: Element): void {
  const bits: Node[] = [];
  [...list.children].forEach((item, index) => {
    bits.push(...item.childNodes);
    if (index < list.children.length - 1) bits.push(document.createElement('br'));
  });
  list.replaceWith(...bits);
}

function expandToLines(root: HTMLElement, range: Range): void {
  const breaks = [...root.querySelectorAll('br')];
  let startAt: Node | null = null;
  let endAt: Node | null = null;
  for (const br of breaks) {
    const probe = document.createRange();
    probe.selectNode(br);
    if (probe.compareBoundaryPoints(Range.END_TO_START, range) < 0) startAt = br;
    if (!endAt && probe.compareBoundaryPoints(Range.START_TO_END, range) > 0) endAt = br;
  }
  if (startAt) range.setStartAfter(startAt);
  else range.setStart(root, 0);
  if (endAt) range.setEndBefore(endAt);
  else range.setEnd(root, root.childNodes.length);
}

export function applyList(root: HTMLElement, ordered: boolean): boolean {
  const range = editorRange(root);
  if (!range) return false;
  const startEl =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const existing = startEl?.closest('ul, ol');
  if (existing && root.contains(existing)) {
    if ((ordered && existing.tagName === 'OL') || (!ordered && existing.tagName === 'UL')) {
      unwrapList(existing);
      return true;
    }
    const swapped = document.createElement(ordered ? 'ol' : 'ul');
    swapped.append(...existing.childNodes);
    existing.replaceWith(swapped);
    return true;
  }
  if (range.collapsed) expandToLines(root, range);
  const frag = range.extractContents();
  const lines = fragmentLines(frag);
  const list = document.createElement(ordered ? 'ol' : 'ul');
  for (const line of lines) {
    const item = document.createElement('li');
    if (line.childNodes.length) item.append(...line.childNodes);
    else item.appendChild(document.createElement('br'));
    list.appendChild(item);
  }
  if (!list.childElementCount) {
    const item = document.createElement('li');
    item.appendChild(document.createElement('br'));
    list.appendChild(item);
  }
  range.insertNode(list);
  selectNode(list);
  return true;
}

function nodeTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === 'BR') return 1;
  let length = 0;
  node.childNodes.forEach((child, index) => {
    if (index > 0 && (child.nodeName === 'DIV' || child.nodeName === 'P' || child.nodeName === 'LI')) length += 1;
    length += nodeTextLength(child);
  });
  return length;
}

export function offsetsFromRange(root: HTMLElement, range: Range): { start: number; end: number } {
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = nodeTextLength(before.cloneContents());
  const inner = range.cloneContents();
  const end = start + nodeTextLength(inner);
  return { start, end };
}

export function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const from = pointFromOffset(root, Math.max(0, start));
  const to = pointFromOffset(root, Math.max(0, end));
  if (!from || !to) return null;
  try {
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  } catch {
    return null;
  }
}

function pointFromOffset(root: HTMLElement, target: number): { node: Node; offset: number } | null {
  let pos = 0;
  let found: { node: Node; offset: number } | null = null;
  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (pos + len >= target) {
        found = { node, offset: Math.min(len, target - pos) };
        return false;
      }
      pos += len;
      return true;
    }
    if (node.nodeName === 'BR') {
      if (target <= pos) {
        const parent = node.parentNode;
        if (!parent) return false;
        found = { node: parent, offset: [...parent.childNodes].indexOf(node as ChildNode) };
        return false;
      }
      pos += 1;
      return true;
    }
    for (const child of [...node.childNodes]) {
      if (child.nodeName === 'DIV' || child.nodeName === 'P' || child.nodeName === 'LI') {
        if (child !== node.firstChild && target <= pos) {
          found = {
            node: child.parentNode ?? root,
            offset: [...(child.parentNode ?? root).childNodes].indexOf(child as ChildNode),
          };
          return false;
        }
        if (child !== node.firstChild) pos += 1;
      }
      if (!visit(child)) return false;
    }
    return true;
  };
  if (!visit(root)) return found;
  return { node: root, offset: root.childNodes.length };
}

