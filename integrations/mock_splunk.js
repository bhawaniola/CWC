// Mock Splunk HEC: accepts events exactly like a real Splunk HTTP Event
// Collector so the forwarding chain can be verified without the real (heavy)
// Splunk. GET /events returns everything received, for test assertions.
const http = require("http");

const PORT = process.env.PORT || 19310;
const EXPECTED_TOKEN = process.env.HEC_TOKEN || "test-hec-token";

const events = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/services/collector/event") {
      const auth = req.headers.authorization || "";
      if (auth !== `Splunk ${EXPECTED_TOKEN}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ text: "Invalid token", code: 4 }));
      }
      // HEC accepts newline-separated JSON event objects in one request.
      for (const line of String(body).split("\n")) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line));
        } catch (error) {
          // ignore malformed lines, same as real HEC's lenient batch handling
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ text: "Success", code: 0 }));
    }

    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ count: events.length, data: events }));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: "Not found" }));
  });
});

server.listen(PORT, () => {
  console.log(`[mock-splunk] HEC listening on ${PORT} (token: ${EXPECTED_TOKEN})`);
});
