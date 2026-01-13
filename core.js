// Core PDF generation logic shared between Lambda and dev server

// Helper function to validate URLs
export function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Create JSON response (Lambda format)
export function createResponse(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(data),
  };
}

// Authenticate request
export function authenticate(headers, validApiKey) {
  // Normalize headers to lowercase
  const normalizedHeaders = Object.fromEntries(
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

// Parse request body
export function parseRequestBody(body, isBase64Encoded = false) {
  if (!body) return { success: true, data: {} };

  try {
    const decoded = isBase64Encoded
      ? Buffer.from(body, "base64").toString("utf-8")
      : body;
    return { success: true, data: JSON.parse(decoded) };
  } catch (error) {
    return {
      success: false,
      response: createResponse(400, {
        message: "Invalid JSON in request body",
        error: error.message,
      }),
    };
  }
}

// Setup page error collection
export function setupPageErrorCollection(page) {
  const pageErrors = [];
  const consoleMessages = [];

  page.on("console", (msg) => {
    const logEntry = {
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
    pageErrors.push({
      type: "pageerror",
      text: error.message,
      stack: error.stack,
    });
  });

  return { pageErrors, consoleMessages };
}

// Core PDF generation handler
export async function generatePdf(browser, requestData, s3Client, PutObjectCommand) {
  const { url = "https://example.com", data = {}, options = {} } = requestData;

  // Validate URL
  if (!isValidUrl(url)) {
    return createResponse(400, {
      message: "Invalid URL provided",
    });
  }

  const page = await browser.newPage();

  // Setup error collection
  const { pageErrors, consoleMessages } = setupPageErrorCollection(page);

  // Inject data into the page before it loads
  await page.evaluateOnNewDocument((injectedData) => {
    window.__INJECTED_DATA__ = injectedData;
  }, data);

  // Navigate to the URL
  const response = await page.goto(url, {
    waitUntil: options.waitUntil || "networkidle0",
    timeout: options.timeout || 30000,
  });

  // Check if navigation was successful
  if (!response || !response.ok()) {
    return createResponse(502, {
      message: "Failed to load the page",
      status: response?.status(),
      statusText: response?.statusText(),
      pageErrors,
    });
  }

  // Wait for any additional time if specified
  if (options.waitTime) {
    await new Promise((r) => setTimeout(r, options.waitTime));
  }

  // Return errors if any occurred during page load
  if (pageErrors.length > 0 && options.failOnErrors) {
    return createResponse(422, {
      message: "Page loaded with errors",
      pageErrors,
      consoleMessages,
    });
  }

  // Generate PDF
  const pdfBuffer = await page.pdf({
    format: options.pdfFormat || "A4",
    printBackground: options.printBackground !== false,
    margin: options.margin || undefined,
    landscape: options.landscape || false,
  });

  // Upload to S3
  const bucketName = process.env.PDF_BUCKET || "pdf-storage-1";
  const objectKey = `pdfs/page-${Date.now()}.pdf`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    })
  );

  return {
    ...createResponse(200, {
      message: "PDF uploaded successfully",
      bucket: bucketName,
      key: objectKey,
      s3Url: `https://${bucketName}.s3.amazonaws.com/${objectKey}`,
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
      consoleMessages: options.includeConsoleLogs ? consoleMessages : undefined,
    }),
    pdfBuffer, // Also return buffer for dev server
  };
}
