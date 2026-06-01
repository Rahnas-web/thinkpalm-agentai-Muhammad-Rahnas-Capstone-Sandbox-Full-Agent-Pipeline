import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** Proxies POST /openai/v1/chat/completions → Groq (reads .env on each request). */
function groqProxyPlugin() {
  return {
    name: "groq-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/openai/v1/chat/completions" || req.method !== "POST") {
          return next();
        }

        const env = loadEnv(server.config.mode, server.config.root, "");
        const apiKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY || "";

        if (!apiKey) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message:
                  "GROQ_API_KEY is missing. Create maritime-qa-pipeline/.env with GROQ_API_KEY=your_key and restart npm run dev.",
              },
            })
          );
          return;
        }

        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);

        try {
          const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body,
          });

          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
          if (upstream.body) {
            const reader = upstream.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
          }
          res.end();
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: { message: String(err.message || err) } }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), groqProxyPlugin()],
  server: { port: 5173 },
});
