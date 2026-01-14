import http, { IncomingMessage, ServerResponse } from "http";
import net from "net";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  authenticate,
  parseRequestBody,
  generatePdf,
  createResponse,
} from "./core.js";
import type { LambdaResponse } from "./types.js";

const DEFAULT_PORT = 3000;
const API_KEY = process.env.API_KEY || "dev-api-key";
const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" });

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxPort = startPort + 100;

  while (port < maxPort) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }

  throw new Error(`No available port found between ${startPort} and ${maxPort}`);
}

async function parseHttpBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendResponse(
  res: ServerResponse,
  lambdaResponse: LambdaResponse,
  pdfBuffer: Buffer | null = null
): void {
  const { statusCode, headers, body } = lambdaResponse;

  if (process.env.SKIP_S3 === "true" && pdfBuffer && statusCode === 200) {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="generated-${Date.now()}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });
    res.end(pdfBuffer);
    return;
  }

  res.writeHead(statusCode, headers);
  res.end(body);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const method = req.method || "GET";

  const event = {
    httpMethod: method,
    headers: req.headers as Record<string, string>,
    body: await parseHttpBody(req),
    isBase64Encoded: false,
  };

  const authResult = authenticate(event.headers, API_KEY);
  if (!authResult.valid) {
    sendResponse(res, authResult.response!);
    return;
  }

  if (method !== "POST") {
    sendResponse(
      res,
      createResponse(
        405,
        { message: "Method Not Allowed. Only POST requests are accepted." },
        { Allow: "POST" }
      )
    );
    return;
  }

  let browser = null;

  try {
    const parseResult = parseRequestBody(event.body, event.isBase64Encoded);
    if (!parseResult.success) {
      sendResponse(res, parseResult.response!);
      return;
    }

    console.log(`Generating PDF for: ${parseResult.data?.url || "https://example.com"}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const result = await generatePdf(
      browser,
      parseResult.data!,
      s3,
      PutObjectCommand
    );

    console.log("PDF generated successfully");

    sendResponse(res, result, result.pdfBuffer || null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(`Error: ${errorMessage}`);
    sendResponse(
      res,
      createResponse(500, {
        message: "Failed to generate or upload PDF",
        error: errorMessage,
        stack: errorStack,
      })
    );
  } finally {
    if (browser) {
      await browser.close();
      console.log("Browser closed");
    }
  }
}

async function startServer(): Promise<void> {
  const requestedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;

  let port: number;
  try {
    port = await findAvailablePort(requestedPort);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : "Failed to find port"}`);
    process.exit(1);
  }

  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} is in use, using port ${port} instead`);
  }

  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    const skipS3 = process.env.SKIP_S3 === "true";
    console.log(`
PDF Generator Dev Server
========================
URL:      http://localhost:${port}
API Key:  ${API_KEY.substring(0, 10)}...
Skip S3:  ${skipS3 ? "Yes (returns PDF directly)" : "No (uploads to S3)"}

Sample request:
curl -X POST http://localhost:${port} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${API_KEY}" \\
  -d '{"url": "https://example.com"}'${skipS3 ? " \\\n  --output test.pdf" : ""}
`);
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    server.close(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    server.close(() => process.exit(0));
  });
}

startServer().catch(console.error);
