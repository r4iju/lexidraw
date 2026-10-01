/**
 * Runs inside the render page: a self-contained SVG of #native-embed whose
 * styles are inlined, for clients with a browser-compatible SVG renderer.
 */
export async function serializeEmbedSVG(): Promise<string> {
  const original = document.getElementById("native-embed");
  if (!original) throw new Error("No rendered embed");
  const clone = original.cloneNode(true);
  if (!(clone instanceof HTMLElement)) throw new Error("Invalid render root");
  const originals = [original, ...original.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  // A property is left out when the copy would get the same value anyway:
  // equal to the parent's covers inherited properties, and equal to a blank
  // element's browser default at the same tag path covers the rest.
  const sandbox = document.createElement("iframe");
  sandbox.style.cssText =
    "position:absolute;width:0;height:0;border:0;visibility:hidden";
  document.body.append(sandbox);
  const sandboxDocument = sandbox.contentDocument;
  if (!sandboxDocument) throw new Error("No style sandbox");
  const blanks = new Map<Element, Element>();
  const blankFor = (element: Element): Element => {
    const known = blanks.get(element);
    if (known) return known;
    const parent =
      element === original || !element.parentElement
        ? sandboxDocument.body
        : blankFor(element.parentElement);
    const blank = sandboxDocument.createElementNS(
      element.namespaceURI,
      element.localName,
    );
    for (const attribute of element.attributes)
      if (!/^(class|style|id|src|srcset|data-.*|aria-.*)$/.test(attribute.name))
        blank.setAttribute(attribute.name, attribute.value);
    parent.append(blank);
    blanks.set(element, blank);
    return blank;
  };
  for (let i = 0; i < originals.length; i++) {
    const source = originals[i];
    const target = copies[i];
    if (
      !source ||
      !(target instanceof HTMLElement || target instanceof SVGElement)
    )
      continue;
    const style = getComputedStyle(source);
    const inherited =
      source === original || !source.parentElement
        ? undefined
        : getComputedStyle(source.parentElement);
    const initial = getComputedStyle(blankFor(source));
    for (const property of style) {
      if (property.startsWith("--")) continue;
      const value = style.getPropertyValue(property);
      if (
        // A declaration copied with the element may name an undefined var().
        !target.style.getPropertyValue(property) &&
        initial.getPropertyValue(property) === value &&
        (!inherited || inherited.getPropertyValue(property) === value)
      )
        continue;
      target.style.setProperty(property, value);
    }
    if (
      source instanceof HTMLImageElement &&
      target instanceof HTMLImageElement &&
      source.src
    ) {
      if (
        source.closest("[data-native-article]") &&
        source.naturalWidth === 0
      ) {
        target.removeAttribute("src");
        continue;
      }
      try {
        const blob = await (await fetch(source.src)).blob();
        target.src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error("Invalid image"));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        if (!source.closest("[data-native-article]")) throw error;
        // Images can display without granting fetch CORS permission. The PNG
        // retains that image; the self-contained SVG keeps its accessible alt.
        target.removeAttribute("src");
        target.removeAttribute("srcset");
        if (!target.alt) target.alt = "Article image unavailable in SVG";
      }
    }
  }
  sandbox.remove();
  const box = original.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.margin = "0";
  const markup = new XMLSerializer().serializeToString(clone);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
}
