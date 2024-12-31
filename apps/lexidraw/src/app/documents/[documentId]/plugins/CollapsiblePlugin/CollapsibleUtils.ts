export function setDomHiddenUntilFound(dom: HTMLElement): void {
  // @ts-expect-error it's probably fine
  dom.hidden = "until-found";
}

export function domOnBeforeMatch(dom: HTMLElement, callback: () => void): void {
  // @ts-expect-error it's probably fine
  dom.onbeforematch = callback;
}
