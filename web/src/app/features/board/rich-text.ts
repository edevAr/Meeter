import { Directive, ElementRef, Input, OnChanges } from '@angular/core';

@Directive({
  selector: '[noteRichHtml]',
  standalone: true,
})
export class NoteRichHtmlDirective implements OnChanges {
  @Input('noteRichHtml') html = '';

  constructor(private readonly el: ElementRef<HTMLElement>) {}

  ngOnChanges(): void {
    const node = this.el.nativeElement;
    if (node.dataset['richSrc'] === this.html) return;
    if (node === document.activeElement || node.contains(document.activeElement)) return;
    node.innerHTML = this.html;
    node.dataset['richSrc'] = this.html;
  }
}

export function stripHtml(value: string): string {
  return (value || '')
    .replace(/<span[^>]*data-plain="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi, (_full, encoded: string) =>
      decodeHtmlAttr(encoded),
    )
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

function decodeHtmlAttr(value: string): string {
  return (value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function isRichHtml(value: string): boolean {
  return (
    /<\s*(b|i|u|s|strong|em|ul|ol|li|mark|span|font|h[1-6]|blockquote)\b/i.test(value || '') ||
    /style\s*=/i.test(value || '') ||
    /note-secret|data-plain/i.test(value || '')
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
          const isSecret =
            child.tagName === 'SPAN' &&
            (child.getAttribute('class') || '')
              .split(/\s+/)
              .includes('note-secret');
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
          } else if (name === 'class') {
            const kept = (attr.value || '')
              .split(/\s+/)
              .filter((part) => part === 'note-secret' || part === 'note-check' || part === 'is-checked')
              .join(' ');
            if (kept) child.setAttribute('class', kept);
            else child.removeAttribute('class');
          } else if (name === 'data-plain' && isSecret) {
            child.setAttribute('data-plain', attr.value);
          } else if (name === 'contenteditable' && isSecret && attr.value === 'false') {
            child.setAttribute('contenteditable', 'false');
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

function rangeElement(node: Node | null): HTMLElement | null {
  return node instanceof HTMLElement ? node : node?.parentElement ?? null;
}

function formatSelector(tag: string): string {
  switch (tag.toLowerCase()) {
    case 'strong':
    case 'b':
      return 'strong, b';
    case 'em':
    case 'i':
      return 'em, i';
    case 'u':
      return 'u';
    case 's':
    case 'strike':
    case 'del':
      return 's, strike, del';
    case 'mark':
      return 'mark';
    default:
      return tag;
  }
}

function sameCssColor(left: string, right: string): boolean {
  const a = left.replace(/\s/g, '').toLowerCase();
  const b = right.replace(/\s/g, '').toLowerCase();
  if (a === b) return true;
  const probe = document.createElement('span');
  probe.style.color = left;
  const parsed = probe.style.color;
  probe.style.color = right;
  return Boolean(parsed) && parsed === probe.style.color;
}

function sameStyleValue(name: string, left: string, right: string): boolean {
  const a = left.trim().replace(/['"]/g, '').toLowerCase();
  const b = right.trim().replace(/['"]/g, '').toLowerCase();
  if (name === 'font-weight') {
    const map: Record<string, string> = { bold: '700', bolder: '900', '900': '900', '700': '700' };
    return (map[a] || a) === (map[b] || b);
  }
  if (name === 'background-color' || name === 'color') return sameCssColor(left, right);
  return a === b;
}

function tagDecoration(tag: string): string | null {
  const name = tag.toLowerCase();
  if (name === 'u') return 'underline';
  if (name === 's' || name === 'strike' || name === 'del') return 'line-through';
  return null;
}

function hasDecoration(el: HTMLElement, decoration: string): boolean {
  const value = `${el.style.textDecoration} ${el.style.textDecorationLine}`.toLowerCase();
  return value.includes(decoration);
}

function hasStyle(el: HTMLElement, styles?: Record<string, string>): boolean {
  if (!styles) return true;
  return Object.entries(styles).every(([name, value]) => {
    if (value === 'transparent') return Boolean(el.style.getPropertyValue(name).trim()) || el.tagName === 'MARK';
    if (name === 'text-decoration') return hasDecoration(el, value);
    const current = el.style.getPropertyValue(name);
    return current ? sameStyleValue(name, current, value) : true;
  });
}

function isFormatNode(el: HTMLElement, tag: string, styles?: Record<string, string>): boolean {
  if (el.classList.contains('note-secret')) return false;
  const deco = tagDecoration(tag);
  if (deco && hasDecoration(el, deco)) return true;
  const names = formatSelector(tag)
    .split(',')
    .map((part) => part.trim().toUpperCase());
  if (!names.includes(el.tagName)) return false;
  if (el.tagName === 'SPAN') {
    if (!styles) return false;
    return Object.keys(styles).every((name) => el.style.getPropertyValue(name));
  }
  return hasStyle(el, styles);
}

function matchingFormat(
  from: HTMLElement | null,
  root: HTMLElement,
  tag: string,
  styles?: Record<string, string>,
): HTMLElement | null {
  let current: HTMLElement | null = from;
  while (current && root.contains(current) && current !== root) {
    if (isFormatNode(current, tag, styles)) return current;
    current = current.parentElement;
  }
  return null;
}

function intersectingFormats(
  root: HTMLElement,
  range: Range,
  tag: string,
  styles?: Record<string, string>,
): HTMLElement[] {
  return [...root.querySelectorAll('*')].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || !range.intersectsNode(node)) return false;
    return isFormatNode(node, tag, styles);
  });
}

function textNodesInRange(root: HTMLElement, range: Range): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    if ((node.textContent || '').length && range.intersectsNode(node)) nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function selectionInsideFormats(root: HTMLElement, range: Range, matches: HTMLElement[]): boolean {
  if (!matches.length) return false;
  const texts = textNodesInRange(root, range);
  if (!texts.length) return matches.some((el) => range.intersectsNode(el));
  return texts.every((node) => matches.some((el) => el.contains(node)));
}

function unwrapFormat(el: HTMLElement, styles?: Record<string, string>): void {
  if (el.classList.contains('note-secret')) return;
  if (el.tagName === 'SPAN' && styles) {
    for (const name of Object.keys(styles)) el.style.removeProperty(name);
    if ((el.getAttribute('style') || '').replace(/[;\s]/g, '')) return;
  }
  const kids = [...el.childNodes];
  const first = kids[0];
  const last = kids[kids.length - 1];
  el.replaceWith(...kids);
  if (!first || !last) return;
  try {
    const next = document.createRange();
    next.setStartBefore(first);
    next.setEndAfter(last);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(next);
  } catch {
    /* ignore */
  }
}

export function wrapSelection(root: HTMLElement, tag: string, styles?: Record<string, string>): boolean {
  const range = editorRange(root);
  if (!range) return false;
  const clearHighlight = styles?.['background-color'] === 'transparent';
  const lookupTag = clearHighlight ? 'mark' : tag;
  const lookupStyles = clearHighlight ? undefined : styles;
  const startMatch =
    matchingFormat(rangeElement(range.startContainer), root, lookupTag, lookupStyles) ||
    (clearHighlight
      ? matchingFormat(rangeElement(range.startContainer), root, 'span', { 'background-color': 'currentColor' })
      : null);
  const endMatch =
    matchingFormat(rangeElement(range.endContainer), root, lookupTag, lookupStyles) ||
    (clearHighlight
      ? matchingFormat(rangeElement(range.endContainer), root, 'span', { 'background-color': 'currentColor' })
      : null);
  const hits = [
    ...(range.collapsed ? [] : intersectingFormats(root, range, lookupTag, lookupStyles)),
    ...(clearHighlight && !range.collapsed
      ? intersectingFormats(root, range, 'span', { 'background-color': 'currentColor' })
      : []),
  ];
  const allHits = [...new Set([...hits, startMatch, endMatch].filter((item): item is HTMLElement => Boolean(item)))];
  const shouldUnwrap =
    Boolean(startMatch && range.collapsed) ||
    (allHits.length > 0 && (clearHighlight || selectionInsideFormats(root, range, allHits)));
  if (shouldUnwrap) {
    const prop = styles ? Object.keys(styles)[0] : '';
    const next = prop && styles ? styles[prop] : '';
    if (prop && next && next !== 'transparent' && startMatch && startMatch === endMatch) {
      const current = startMatch.style.getPropertyValue(prop);
      if (current && !sameStyleValue(prop, current, next)) {
        startMatch.style.setProperty(prop, next);
        return true;
      }
    }
    allHits.forEach((el) => unwrapFormat(el, clearHighlight ? { 'background-color': '' } : styles));
    return true;
  }
  if (range.collapsed || clearHighlight) return false;
  const el = document.createElement(tag);
  if (styles) {
    for (const [name, value] of Object.entries(styles)) {
      if (value !== 'transparent') el.style.setProperty(name, value);
    }
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

export function toggleStrike(root: HTMLElement): boolean {
  return wrapSelection(root, 's');
}

function secretEl(node: Node | null, root: HTMLElement): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  const secret = el?.closest('.note-secret');
  return secret instanceof HTMLElement && root.contains(secret) ? secret : null;
}

function plainFromNode(node: Node): string {
  if (node instanceof HTMLElement && node.classList.contains('note-secret')) {
    return node.getAttribute('data-plain') || node.textContent || '';
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeName === 'BR') return '\n';
  let out = '';
  node.childNodes.forEach((child) => {
    out += plainFromNode(child);
  });
  return out;
}

function selectionIsHidden(range: Range): boolean {
  const frag = range.cloneContents();
  let hasText = false;
  let hasOpen = false;
  const visit = (node: Node) => {
    if (node instanceof HTMLElement && node.classList.contains('note-secret')) {
      if ((node.getAttribute('data-plain') || node.textContent || '').length) hasText = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').length) {
      hasText = true;
      hasOpen = true;
    }
    node.childNodes.forEach(visit);
  };
  visit(frag);
  return hasText && !hasOpen;
}

function revealSecret(el: HTMLElement): void {
  const plain = el.getAttribute('data-plain') ?? '';
  const bits: Node[] = [];
  plain.split('\n').forEach((part, index) => {
    if (index) bits.push(document.createElement('br'));
    if (part) bits.push(document.createTextNode(part));
  });
  if (!bits.length) bits.push(document.createTextNode(''));
  el.replaceWith(...bits);
}

function hidePlain(plain: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'note-secret';
  el.setAttribute('data-plain', plain);
  el.setAttribute('contenteditable', 'false');
  el.textContent = '';
  plain.split('\n').forEach((part, index) => {
    if (index) el.appendChild(document.createElement('br'));
    if (part.length) el.appendChild(document.createTextNode('x'.repeat([...part].length)));
  });
  if (!el.childNodes.length) el.textContent = 'x';
  return el;
}

export function toggleSecret(root: HTMLElement): boolean {
  const range = editorRange(root);
  if (!range) return false;
  const startSecret = secretEl(range.startContainer, root);
  const endSecret = secretEl(range.endContainer, root);
  if (range.collapsed) {
    if (!startSecret) return false;
    revealSecret(startSecret);
    return true;
  }
  if (startSecret && startSecret === endSecret) {
    revealSecret(startSecret);
    return true;
  }
  const secrets = [...root.querySelectorAll('.note-secret')].filter((el) =>
    range.intersectsNode(el),
  ) as HTMLElement[];
  if (secrets.length && selectionIsHidden(range)) {
    secrets.forEach(revealSecret);
    return true;
  }
  const plain = plainFromNode(range.cloneContents()).replace(/\u00a0/g, ' ');
  if (!plain.length) return false;
  const el = hidePlain(plain);
  range.deleteContents();
  range.insertNode(el);
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

export type ListKind = 'bullet' | 'number' | 'check';

function listKindOf(el: Element): ListKind {
  if (el.tagName === 'OL') return 'number';
  if (el.classList.contains('note-check')) return 'check';
  return 'bullet';
}

function makeList(kind: ListKind): HTMLElement {
  const list = document.createElement(kind === 'number' ? 'ol' : 'ul');
  if (kind === 'check') list.className = 'note-check';
  return list;
}

function convertList(existing: Element, kind: ListKind): HTMLElement {
  const list = makeList(kind);
  list.append(...existing.childNodes);
  if (kind !== 'check') {
    [...list.querySelectorAll('li.is-checked')].forEach((item) => item.classList.remove('is-checked'));
  }
  existing.replaceWith(list);
  return list;
}

export function applyList(root: HTMLElement, kind: ListKind | boolean): boolean {
  const listKind: ListKind = kind === true ? 'number' : kind === false ? 'bullet' : kind;
  const range = editorRange(root);
  if (!range) return false;
  const startEl =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const existing = startEl?.closest('ul, ol');
  if (existing && root.contains(existing)) {
    if (listKindOf(existing) === listKind) {
      unwrapList(existing);
      return true;
    }
    convertList(existing, listKind);
    return true;
  }
  if (range.collapsed) expandToLines(root, range);
  const frag = range.extractContents();
  const lines = fragmentLines(frag);
  const list = makeList(listKind);
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

