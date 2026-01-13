import http from "http";
import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  authenticate,
  parseRequestBody,
  generatePdf,
  createResponse,
} from "./core.js";

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "dev-api-key";

const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" });

// Parse HTTP request body
async function parseHttpBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// Send response
function sendResponse(res, lambdaResponse, pdfBuffer = null) {
  const { statusCode, headers, body } = lambdaResponse;

  // If SKIP_S3 and we have PDF buffer, return PDF directly
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

// Main handler (mimics Lambda)
async function handleRequest(req, res) {
  const method = req.method;

  // Convert HTTP request to Lambda event format
  const event = {
    httpMethod: method,
    headers: req.headers,
    body: await parseHttpBody(req),
    isBase64Encoded: false,
  };

  // API Key authentication (using shared logic)
  const authResult = authenticate(event.headers, API_KEY);
  if (!authResult.valid) {
    return sendResponse(res, authResult.response);
  }

  // Only allow POST
  if (method !== "POST") {
    return sendResponse(res, createResponse(405, {
      message: "Method Not Allowed. Only POST requests are accepted.",
    }, { "Allow": "POST" }));
  }

  let browser = null;

  try {
    // Parse request body (using shared logic)
    const parseResult = parseRequestBody(event.body, event.isBase64Encoded);
    if (!parseResult.success) {
      return sendResponse(res, parseResult.response);
    }

    console.log(`🚀 Generating PDF for: ${parseResult.data.url || "https://example.com"}`);

    // Launch browser (local puppeteer)
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Generate PDF using shared logic
    const result = await generatePdf(browser, parseResult.data, s3, PutObjectCommand);

    console.log(`📄 PDF generated successfully`);

    // Send response (with pdfBuffer for SKIP_S3 mode)
    sendResponse(res, result, result.pdfBuffer);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    sendResponse(res, createResponse(500, {
      message: "Failed to generate or upload PDF",
      error: error.message,
      stack: error.stack,
    }));
  } finally {
    if (browser) {
      await browser.close();
      console.log("🔒 Browser closed");
    }
  }
}

// Create server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║         🚀 PDF Generator Dev Server                    ║
╠════════════════════════════════════════════════════════╣
║  URL:      http://localhost:${PORT}                       ║
║  API Key:  ${API_KEY.substring(0, 10)}...                            ║
║  Skip S3:  ${process.env.SKIP_S3 === "true" ? "Yes (returns PDF directly)" : "No (uploads to S3)"}       ║
╚════════════════════════════════════════════════════════╝

Sample request:
curl -X POST http://localhost:${PORT} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${API_KEY}" \\
  -d '{"url": "https://example.com", "data": {"test": true}}'${process.env.SKIP_S3 === "true" ? " \\\n  --output test.pdf" : ""}
`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  server.close(() => process.exit(0));
});
