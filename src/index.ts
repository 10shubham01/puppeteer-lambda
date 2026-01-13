import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  authenticate,
  parseRequestBody,
  generatePdf,
  createResponse,
} from "./core.js";
import type { LambdaEvent, LambdaResponse } from "./types.js";

const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" });

export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  const httpMethod = event.httpMethod || event.requestContext?.http?.method;

  const authResult = authenticate(event.headers, process.env.API_KEY);
  if (!authResult.valid) {
    return authResult.response!;
  }

  if (httpMethod !== "POST") {
    return createResponse(
      405,
      { message: "Method Not Allowed. Only POST requests are accepted." },
      { Allow: "POST" }
    );
  }

  let browser = null;

  try {
    const parseResult = parseRequestBody(event.body, event.isBase64Encoded);
    if (!parseResult.success) {
      return parseResult.response!;
    }

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 1920, height: 1080 },
    });

    const result = await generatePdf(
      browser,
      parseResult.data!,
      s3,
      PutObjectCommand
    );

    const { pdfBuffer: _, ...response } = result;
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;

    return createResponse(500, {
      message: "Failed to generate or upload PDF",
      error: errorMessage,
      stack: process.env.NODE_ENV === "development" ? errorStack : undefined,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
