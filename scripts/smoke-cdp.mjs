// Used by scripts/smoke-test.sh: waits until a JavaScript expression is true in
// the app's main window, over Chromium's remote debugging port.
//   node scripts/smoke-cdp.mjs <port> <timeout seconds> <expression>
// Prints the expression's last value; exits 0 once it's truthy, 1 on timeout.
const [port, timeoutSeconds, expression] = process.argv.slice(2);
const deadline = Date.now() + Number(timeoutSeconds) * 1000;
let last = "no window";

async function evaluate() {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === "page" && p.url.includes("renderer/dist/index.html"));
  if (!page) return { value: "no main window yet" };
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("no answer")); }, 5000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve({ value: message.result?.result?.value ?? message.result?.exceptionDetails?.text ?? null });
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("socket error")); };
  });
}

while (Date.now() < deadline) {
  try {
    const { value } = await evaluate();
    last = value;
    if (value) {
      console.log(typeof value === "string" ? value : JSON.stringify(value));
      process.exit(0);
    }
  } catch (error) {
    last = error.message;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`timed out (${typeof last === "string" ? last : JSON.stringify(last)})`);
process.exit(1);
