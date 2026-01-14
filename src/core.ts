import type { Browser, Page, ConsoleMessage } from "puppeteer-core";
import type { S3Client as S3ClientType } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import type {
  LambdaResponse,
  AuthResult,
  ParseResult,
  RequestData,
  PdfResult,
  LogEntry,
  ErrorCollection,
  CostMetrics,
  ProgressData,
} from "./types.js";

export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function createResponse(
  statusCode: number,
  data: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): LambdaResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(data),
  };
}

export function authenticate(
  headers: Record<string, string> | undefined,
  validApiKey: string | undefined
): AuthResult {
  const normalizedHeaders: Record<string, string> = Object.fromEntries(
    Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  const apiKey = normalizedHeaders["x-api-key"];

  if (!validApiKey) {
    return {
      valid: false,
      response: createResponse(500, {
        message: "Server configuration error: API_KEY not set",
      }),
    };
  }

  if (!apiKey || apiKey !== validApiKey) {
    return {
      valid: false,
      response: createResponse(401, {
        message: "Unauthorized. Valid API key required.",
      }),
    };
  }

  return { valid: true };
}

export function parseRequestBody(
  body: string | undefined,
  isBase64Encoded = false
): ParseResult {
  if (!body) return { success: true, data: {} };

  try {
    const decoded = isBase64Encoded
      ? Buffer.from(body, "base64").toString("utf-8")
      : body;
    return { success: true, data: JSON.parse(decoded) as RequestData };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      response: createResponse(400, {
        message: "Invalid JSON in request body",
        error: errorMessage,
      }),
    };
  }
}

export function setupPageErrorCollection(page: Page): ErrorCollection {
  const pageErrors: LogEntry[] = [];
  const consoleMessages: LogEntry[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    const logEntry: LogEntry = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    };
    consoleMessages.push(logEntry);
    if (msg.type() === "error") {
      pageErrors.push(logEntry);
    }
  });

  page.on("pageerror", (error) => {
    const err = error as Error;
    pageErrors.push({
      type: "pageerror",
      text: err.message,
      stack: err.stack,
    });
  });

  return { pageErrors, consoleMessages };
}

export function calculateCost(durationMs: number, memorySizeMB = 1024): CostMetrics {
  const durationSeconds = durationMs / 1000;
  const gbSeconds = (memorySizeMB / 1024) * durationSeconds;
  const computeCostPerGBSecond = 0.0000166667;
  const requestCost = 0.0000002;
  const s3PutCost = 0.000005;
  const computeCost = gbSeconds * computeCostPerGBSecond;
  const totalCost = computeCost + requestCost + s3PutCost;

  return {
    durationMs,
    durationSeconds: Math.round(durationSeconds * 1000) / 1000,
    memorySizeMB,
    estimatedGBSeconds: Math.round(gbSeconds * 1000000) / 1000000,
    estimatedCostUSD: Math.round(totalCost * 10000000) / 10000000,
    breakdown: {
      computeCost: Math.round(computeCost * 10000000) / 10000000,
      requestCost,
      s3PutCost,
      totalCost: Math.round(totalCost * 10000000) / 10000000,
    },
  };
}

export async function protectPdf(
  pdfBuffer: Uint8Array,
  userPassword?: string,
  ownerPassword?: string
): Promise<Uint8Array> {
  if (!userPassword && !ownerPassword) {
    return pdfBuffer;
  }

  const pdfDoc = await PDFDocument.load(pdfBuffer);

  if (userPassword || ownerPassword) {
    const encrypt = (pdfDoc as any).encrypt;
    if (typeof encrypt === "function") {
      encrypt.call(pdfDoc, {
        userPassword,
        ownerPassword: ownerPassword || userPassword,
      });
    } else {
      return pdfBuffer;
    }
  }

  const protectedPdf = await pdfDoc.save();

  return protectedPdf;
}

export async function generatePdf(
  browser: Browser,
  requestData: RequestData,
  s3Client: S3ClientType,
  PutObjectCommand: typeof import("@aws-sdk/client-s3").PutObjectCommand
): Promise<PdfResult> {
  const startTime = Date.now();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const { url = "https://example.com", data = {}, options = {}, s3 = {}, security = {} } = requestData;

  if (!isValidUrl(url)) {
    return createResponse(400, {
      message: "Invalid URL provided",
    });
  }

  const page = await browser.newPage();

  const { pageErrors, consoleMessages } = setupPageErrorCollection(page);

  await page.evaluateOnNewDocument((injectedData: Record<string, unknown>) => {
    const w = globalThis as any;
    w.__INJECTED_DATA__ = injectedData;
  }, data);

  const response = await page.goto(url, {
    waitUntil: options.waitUntil || "networkidle0",
    timeout: options.timeout || 30000,
  });

  if (!response || !response.ok()) {
    return createResponse(502, {
      message: "Failed to load the page",
      status: response?.status(),
      statusText: response?.statusText(),
      pageErrors,
    });
  }

  if (options.waitTime) {
    await new Promise((r) => setTimeout(r, options.waitTime));
  }

  if (pageErrors.length > 0 && options.failOnErrors) {
    return createResponse(422, {
      message: "Page loaded with errors",
      pageErrors,
      consoleMessages,
    });
  }

  let pdfBuffer = await page.pdf({
    format: options.pdfFormat || "A4",
    printBackground: options.printBackground !== false,
    margin: options.margin || undefined,
    landscape: options.landscape || false,
  });

  if (security.password || security.ownerPassword) {
    pdfBuffer = await protectPdf(pdfBuffer, security.password, security.ownerPassword);
  }

  const bucketName = s3.bucket || process.env.PDF_BUCKET || "pdf-storage-1";
  const fileName = s3.fileName || `page-${Date.now()}.pdf`;
  const objectKey = s3.key ? `${s3.key}/${fileName}` : `pdfs/${fileName}`;
  const skipS3 = process.env.SKIP_S3 === "true";

  if (!skipS3) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );
  }

  const durationMs = Date.now() - startTime;
  const memorySizeMB = parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || "1024", 10);
  const metrics = calculateCost(durationMs, memorySizeMB);

  const progressData: ProgressData = {
    requestId,
    timestamp: new Date().toISOString(),
    request: { url, data, options, s3, security: { password: security.password ? "***" : undefined } },
    response: {
      status: "success",
      bucket: bucketName,
      key: objectKey,
      s3Url: `https://${bucketName}.s3.amazonaws.com/${objectKey}`,
      hasErrors: pageErrors.length > 0,
      errorCount: pageErrors.length,
    },
    metrics,
  };

  if (!skipS3) {
    const progressKey = s3.key ? `${s3.key}/progress.json` : "pdfs/progress.json";
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: progressKey,
        Body: JSON.stringify(progressData, null, 2),
        ContentType: "application/json",
      })
    );
  }

  return {
    ...createResponse(200, {
      message: "PDF generated successfully",
      requestId,
      bucket: bucketName,
      key: objectKey,
      s3Url: skipS3 ? undefined : `https://${bucketName}.s3.amazonaws.com/${objectKey}`,
      isPasswordProtected: !!(security.password || security.ownerPassword),
      metrics: {
        durationMs: metrics.durationMs,
        durationSeconds: metrics.durationSeconds,
        estimatedCostUSD: metrics.estimatedCostUSD,
        breakdown: metrics.breakdown,
      },
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
      consoleMessages: options.includeConsoleLogs ? consoleMessages : undefined,
    }),
    pdfBuffer: Buffer.from(pdfBuffer),
  };
}
