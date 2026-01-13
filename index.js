import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" });

export const handler = async (event) => {
  // Support both API Gateway and Lambda Function URL formats
  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  
  // Only allow POST method
  if (httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { 
        "Content-Type": "application/json",
        "Allow": "POST"
      },
      body: JSON.stringify({
        message: "Method Not Allowed. Only POST requests are accepted.",
      }),
    };
  }

  let browser = null;

  try {
    // Parse request body for POST requests
    let requestData = {};
    
    if (event.body) {
      try {
        requestData = JSON.parse(event.isBase64Encoded 
          ? Buffer.from(event.body, "base64").toString("utf-8") 
          : event.body
        );
      } catch (parseError) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Invalid JSON in request body",
            error: parseError.message,
          }),
        };
      }
    }

    // Extract parameters from request
    const { url = "https://example.com", data = {}, options = {} } = requestData;

    // Validate URL
    if (!isValidUrl(url)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Invalid URL provided",
        }),
      };
    }

    // Launch browser
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
    });

    const page = await browser.newPage();

    // Collect console errors from the page
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
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Failed to load the page",
          status: response?.status(),
          statusText: response?.statusText(),
          pageErrors,
        }),
      };
    }

    // Wait for any additional time if specified
    if (options.waitTime) {
      await page.waitForTimeout(options.waitTime);
    }

    // Return errors if any occurred during page load
    if (pageErrors.length > 0 && options.failOnErrors) {
      return {
        statusCode: 422,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Page loaded with errors",
          pageErrors,
          consoleMessages,
        }),
      };
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

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "PDF uploaded successfully",
        bucket: bucketName,
        key: objectKey,
        s3Url: `https://${bucketName}.s3.amazonaws.com/${objectKey}`,
        pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
        consoleMessages: options.includeConsoleLogs ? consoleMessages : undefined,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Failed to generate or upload PDF",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      }),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// Helper function to validate URLs
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
