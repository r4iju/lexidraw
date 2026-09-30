import { getQuickJS } from "quickjs-emscripten";
import type { HTMLBlockSourceValue } from "../html-block.js";

const TAGS = new Set(
  "div span p h1 h2 h3 h4 h5 h6 section article header footer main aside label input button select option textarea output table thead tbody tfoot tr th td ul ol li dl dt dd strong em b i small pre code br hr details summary progress meter img".split(
    " ",
  ),
);
const ATTRS = new Set(
  "id class title role aria-label aria-labelledby aria-describedby aria-live aria-hidden for type value min max step placeholder checked selected disabled multiple name rows cols colspan rowspan open alt width height style tabindex".split(
    " ",
  ),
);
const PROPS = new Set([
  "textContent",
  "value",
  "checked",
  "disabled",
  "selectedIndex",
  "innerHTML",
  "className",
]);
const EVENTS = new Set(["click", "input", "change", "keydown", "keyup"]);
const MAX_NODES = 2000;
function setProperty(element: Element, name: string, value: unknown) {
  const properties = element as unknown as Record<string, unknown>;
  const tag = element.tagName.toLowerCase();
  if (name === "checked" || name === "disabled") {
    properties[name] = value;
    if (value) element.setAttribute(name, "");
    else element.removeAttribute(name);
  } else if (
    name === "selectedIndex" ||
    (name === "value" && tag === "select")
  ) {
    const options = Array.from(element.querySelectorAll("option"));
    const index =
      name === "selectedIndex"
        ? Number(value)
        : options.findIndex(
            (option) =>
              (option.getAttribute("value") ?? option.textContent) ===
              String(value),
          );
    options.forEach((option, i) => {
      if (i === index) option.setAttribute("selected", "");
      else option.removeAttribute("selected");
    });
    properties.selectedIndex = index;
  } else if (name === "value" && tag === "textarea") {
    element.textContent = String(value);
    properties.value = String(value);
  } else {
    properties[name] = value;
    if (name === "value" && tag === "input")
      element.setAttribute("value", String(value));
  }
}
function property(element: Element, name: string): unknown {
  const properties = element as unknown as Record<string, unknown>;
  if (name === "value" && element.tagName.toLowerCase() === "select") {
    const options = Array.from(element.querySelectorAll("option"));
    const index =
      typeof properties.selectedIndex === "number"
        ? properties.selectedIndex
        : options.findIndex((option) => option.hasAttribute("selected"));
    const option = options[index];
    return option
      ? (option.getAttribute("value") ?? option.textContent ?? "")
      : "";
  }
  if (properties[name] !== undefined) return properties[name];
  if (name === "checked" || name === "disabled")
    return element.hasAttribute(name);
  if (name === "selectedIndex")
    return Array.from(element.querySelectorAll("option")).findIndex((option) =>
      option.hasAttribute("selected"),
    );
  return null;
}
function attribute(element: Element, name: string, value: string) {
  if (
    name === "src" &&
    element.tagName.toLowerCase() === "img" &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  ) {
    element.setAttribute(name, value);
    return;
  }
  if (!ATTRS.has(name) || (name === "type" && /^(image|file)$/i.test(value)))
    throw new Error(`Unsupported HTML attribute: ${name}`);
  element.setAttribute(name, value);
}
/** Template contents stay inert until every element and attribute was checked. */
export function prepareHTML(root: HTMLElement, html: string) {
  if (html.length > 131072) throw new Error("HTML exceeds content limit");
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const elements = template.content.querySelectorAll("*");
  if (elements.length > MAX_NODES)
    throw new Error("HTML exceeds 2000 elements");
  for (const element of elements) {
    if (!TAGS.has(element.tagName.toLowerCase()))
      throw new Error(
        `Unsupported HTML element: ${element.tagName.toLowerCase()}`,
      );
    for (const attr of Array.from(element.attributes))
      attribute(element, attr.name, attr.value);
  }
  root.replaceChildren(template.content.cloneNode(true));
}

const BOOTSTRAP = `
const __listeners=[];
function __call(op,...args){return JSON.parse(__bridge(JSON.stringify([op,...args])))}
function __node(id){if(id===null)return null;return {
 get textContent(){return __call('get',id,'textContent')},set textContent(v){__call('set',id,'textContent',String(v))},
 get innerHTML(){return __call('get',id,'innerHTML')},set innerHTML(v){__call('set',id,'innerHTML',String(v))},
 get value(){return __call('get',id,'value')},set value(v){__call('set',id,'value',String(v))},
 get checked(){return __call('get',id,'checked')},set checked(v){__call('set',id,'checked',Boolean(v))},
 get disabled(){return __call('get',id,'disabled')},set disabled(v){__call('set',id,'disabled',Boolean(v))},
 get selectedIndex(){return __call('get',id,'selectedIndex')},set selectedIndex(v){__call('set',id,'selectedIndex',Number(v))},
 get className(){return __call('get',id,'className')},set className(v){__call('set',id,'className',String(v))},
 setAttribute(n,v){__call('attribute',id,String(n),String(v))},
 getAttribute(n){return __call('getAttribute',id,String(n))},
 querySelector(s){return __node(__call('query',id,String(s)))},
 querySelectorAll(s){return __call('queryAll',id,String(s)).map(__node)},
 appendChild(child){__call('append',id,child.__id);return child},
 addEventListener(type,callback){if(typeof callback!=='function')throw Error('Callback required');const i=__listeners.push(callback)-1;__call('listen',id,String(type),i)},
 __id:id
}}
const document={ getElementById(id){return __node(__call('query',0,'#'+String(id).replace(/[^a-zA-Z0-9_-]/g,'')))},querySelector(s){return __node(__call('query',0,String(s)))},querySelectorAll(s){return __call('queryAll',0,String(s)).map(__node)},createElement(t){return __node(__call('create',String(t)))},body:__node(0)};
function __dispatch(index,target,key){__listeners[index]({target:__node(target),key,preventDefault(){},stopPropagation(){}})}
function blockReady(){__call('ready')}
`;

/** Only JSON primitives cross into the interpreter; no host functions or DOM objects do. */
export async function startHTMLBlock(
  root: HTMLElement,
  source: HTMLBlockSourceValue,
  onError?: (message: string) => void,
) {
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  let deadline = Date.now() + 200;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  const nodes: Element[] = [root];
  const listeners: (() => void)[] = [];
  let ready = source.javascript.trim() === "";
  let disposed = false;
  let operations = 0;
  const remember = (element: Element | null) => {
    if (!element) return null;
    const existing = nodes.indexOf(element);
    if (existing >= 0) return existing;
    if (nodes.length >= MAX_NODES) throw new Error("DOM element limit reached");
    nodes.push(element);
    return nodes.length - 1;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const remove of listeners) remove();
    context.dispose();
    runtime.dispose();
  };
  const evaluate = (code: string) => {
    deadline = Date.now() + 200;
    const result = context.evalCode(code);
    if (result.error) {
      const error = context.dump(result.error);
      result.error.dispose();
      throw new Error(error.message ?? "HTML block script failed");
    }
    result.value.dispose();
    let jobs = 0;
    while (runtime.hasPendingJob() && ++jobs <= 100) {
      const result = runtime.executePendingJobs(1);
      if (result.error) {
        const error = context.dump(result.error);
        result.error.dispose();
        throw new Error(error.message ?? "Script job failed");
      }
      if (Date.now() > deadline)
        throw new Error("HTML block execution timed out");
    }
    if (runtime.hasPendingJob())
      throw new Error("HTML block job limit reached");
  };
  const bridge = context.newFunction("__bridge", (input) => {
    const encoded = context.getString(input);
    if (
      Date.now() > deadline ||
      encoded.length > 131072 ||
      ++operations > 20000
    )
      throw new Error("HTML block operation limit reached");
    const [op, id, name, value] = JSON.parse(encoded);
    const element = nodes[id];
    let result: unknown = null;
    if (op === "ready") ready = true;
    else if (op === "create") {
      if (!TAGS.has(id)) throw new Error("Unsupported element");
      result = remember(root.ownerDocument.createElement(id));
    } else {
      if (!Number.isInteger(id) || !element) throw new Error("Unknown element");
      if (op === "query") result = remember(element.querySelector(name));
      else if (op === "queryAll")
        result = Array.from(element.querySelectorAll(name)).map(remember);
      else if (op === "getAttribute") {
        if (!ATTRS.has(name)) throw new Error("Unsupported attribute");
        result = element.getAttribute(name);
      } else if (op === "attribute") attribute(element, name, value);
      else if (op === "get" || op === "set") {
        if (!PROPS.has(name)) throw new Error("Unsupported DOM property");
        // The allowlist above is the contract for indexing a real DOM element.
        if (op === "get") result = property(element, name);
        else if (name === "innerHTML")
          prepareHTML(element as HTMLElement, value);
        else setProperty(element, name, value);
      } else if (op === "append") {
        const child = nodes[name];
        if (!child || child === root || child.contains(element))
          throw new Error("Invalid append");
        element.appendChild(child);
      } else if (op === "listen") {
        if (
          !EVENTS.has(name) ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > 1000 ||
          listeners.length >= 1000
        )
          throw new Error("Unsupported event listener");
        const listener = (event: Event) => {
          if (disposed) return;
          try {
            const target = event.target as Element | null;
            if (target?.nodeType !== 1 || !root.contains(target)) return;
            evaluate(
              `__dispatch(${value},${remember(target)},${JSON.stringify("key" in event ? String(event.key) : "")})`,
            );
          } catch (error) {
            dispose();
            onError?.(
              error instanceof Error ? error.message : "Interaction failed",
            );
          }
        };
        element.addEventListener(name, listener);
        listeners.push(() => element.removeEventListener(name, listener));
      } else throw new Error("Unsupported DOM operation");
    }
    if (
      root.querySelectorAll("*").length > MAX_NODES ||
      root.innerHTML.length > 512 * 1024
    )
      throw new Error("DOM output exceeds limits");
    return context.newString(JSON.stringify(result));
  });
  context.setProp(context.global, "__bridge", bridge);
  bridge.dispose();
  try {
    for (const select of root.querySelectorAll("select")) {
      if (
        !select.querySelector("option[selected]") &&
        select.querySelector("option")
      )
        setProperty(select, "selectedIndex", 0);
    }
    for (const [id, value] of Object.entries(source.defaults)) {
      const input = root.querySelector(
        `[id="${id.replace(/[^a-zA-Z0-9_-]/g, "")}"]`,
      );
      if (input)
        setProperty(
          input,
          typeof value === "boolean" ? "checked" : "value",
          value,
        );
    }
    evaluate(
      `${BOOTSTRAP}\nconst data=${JSON.stringify(source.data)};const defaults=${JSON.stringify(source.defaults)};\n${source.javascript}`,
    );
    if (!ready)
      throw new Error(
        "HTML block did not call blockReady() after initializing",
      );
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
