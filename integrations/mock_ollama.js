// Mock Ollama: answers like the real model so the AI triage plumbing can be
// verified end-to-end without downloading a 2GB model.
const http = require("http");

const PORT = process.env.PORT || 11434;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }));
    }

    if (req.url === "/api/chat") {
      const payload = JSON.parse(body || "{}");
      const isJson = payload.format === "json";
      const content = isJson
        ? JSON.stringify({
            severity: 9,
            roles: ["hospital"],
            category: "medical",
            reason: "Chest heaviness with dizziness suggests a possible cardiac event."
          })
        : "SITUATION: 1 open request, 1 critical. Network on satellite.\nCRITICAL: Possible cardiac event at Kothapalli Zone 3.\nRESOURCES: No shortages reported.\nACTIONS: Dispatch hospital team to Kothapalli immediately.";
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: { role: "assistant", content } }));
    }

    res.writeHead(404);
    res.end();
  });
});

server.listen(PORT, () => console.log(`[mock-ollama] listening on ${PORT}`));
