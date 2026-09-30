import { expect, test } from "bun:test";
import { parseHTML, Event } from "linkedom";
import { startHTMLBlock, prepareHTML } from "./runtime";
import { parseHTMLBlockSource } from "../html-block";
const mount = () => parseHTML("<html><body></body></html>").document.body;
test("calculator starts with saved defaults and reacts locally", async () => {
  const root = mount();
  const source = parseHTMLBlockSource({
    html: '<label for="x">Amount</label><input id="x"><button id="go">Calculate</button><output id="result"></output>',
    defaults: { x: 4 },
    data: { rate: 3 },
    description: "Calculator",
    javascript:
      'const x=document.getElementById("x"); const out=document.getElementById("result"); function calc(){out.textContent=Number(x.value)*data.rate} document.getElementById("go").addEventListener("click",calc);calc();blockReady();',
  });
  prepareHTML(root, source.html);
  const run = await startHTMLBlock(root, source);
  expect(root.querySelector("#result")?.textContent).toBe("12");
  const input = root.querySelector("#x");
  input?.setAttribute("value", "5");
  root.querySelector("#go")?.dispatchEvent(new Event("click"));
  expect(root.querySelector("#result")?.textContent).toBe("15");
  run.dispose();
});
test("no host browser or network capabilities and no constructor escape", async () => {
  const root = mount();
  const source = parseHTMLBlockSource({
    html: '<output id="out"></output>',
    description: "Isolation",
    javascript:
      'document.getElementById("out").textContent=[typeof fetch,typeof location,typeof parent,typeof window,typeof process,document.getElementById.constructor("return typeof fetch")()].join(",");blockReady()',
  });
  prepareHTML(root, source.html);
  const run = await startHTMLBlock(root, source);
  expect(root.textContent).toBe(
    "undefined,undefined,undefined,undefined,undefined,undefined",
  );
  run.dispose();
});
test("hostile markup, navigation, never-ready scripts and loops fail within bounds", async () => {
  const root = mount();
  for (const html of [
    "<script>alert(1)</script>",
    '<a href="https://attacker.test">go</a>',
    '<img src="https://attacker.test/x">',
    '<meta http-equiv="refresh" content="0;url=https://attacker.test">',
  ])
    expect(() => prepareHTML(root, html)).toThrow();
  await expect(
    startHTMLBlock(
      root,
      parseHTMLBlockSource({
        html: "",
        description: "Loop",
        javascript: "while(true){}",
      }),
    ),
  ).rejects.toThrow();
  await expect(
    startHTMLBlock(
      root,
      parseHTMLBlockSource({
        html: "",
        description: "Pending",
        javascript: "new Promise(()=>{})",
      }),
    ),
  ).rejects.toThrow("blockReady");
});
test("interaction promise jobs run and remain bounded", async () => {
  const root = mount();
  const source = parseHTMLBlockSource({
    html: '<button id="go">Go</button><output id="out"></output>',
    description: "Async interaction",
    javascript:
      'document.getElementById("go").addEventListener("click",()=>Promise.resolve().then(()=>document.getElementById("out").textContent="done"));blockReady()',
  });
  prepareHTML(root, source.html);
  const run = await startHTMLBlock(root, source);
  root.querySelector("#go")?.dispatchEvent(new Event("click"));
  expect(root.querySelector("#out")?.textContent).toBe("done");
  run.dispose();
});
test("select initial state matches the browser even without explicit saved defaults", async () => {
  const root = mount();
  const source = parseHTMLBlockSource({
    html: '<select id="choice"><option value="a">A</option><option value="b">B</option></select><output id="out"></output>',
    description: "Selection",
    javascript:
      'document.getElementById("out").textContent=document.getElementById("choice").value;blockReady()',
  });
  prepareHTML(root, source.html);
  const run = await startHTMLBlock(root, source);
  expect(root.querySelector("#out")?.textContent).toBe("a");
  run.dispose();
});

test("delegated events expose the actual input target", async () => {
  const root = mount();
  const source = parseHTMLBlockSource({
    html: '<div id="wrap"><input id="x"></div><output id="out"></output>',
    description: "Delegated input",
    javascript:
      'document.getElementById("wrap").addEventListener("input",e=>document.getElementById("out").textContent=e.target.getAttribute("id"));blockReady()',
  });
  prepareHTML(root, source.html);
  const run = await startHTMLBlock(root, source);
  root
    .querySelector("#x")
    ?.dispatchEvent(new Event("input", { bubbles: true }));
  expect(root.querySelector("#out")?.textContent).toBe("x");
  run.dispose();
});
