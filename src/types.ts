export interface PdfOptions {
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  timeout?: number;
  waitTime?: number;
  failOnErrors?: boolean;
  includeConsoleLogs?: boolean;
  pdfFormat?: "A4" | "Letter" | "Legal" | "Tabloid" | "A3" | "A5";
  printBackground?: boolean;
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  landscape?: boolean;
}

export interface S3Config {
  bucket?: string;
  key?: string;
  fileName?: string;
}

export interface PdfSecurity {
  password?: string;
  ownerPassword?: string;
}

export interface RequestData {
  url?: string;
  data?: Record<string, unknown>;
  options?: PdfOptions;
  s3?: S3Config;
  security?: PdfSecurity;
}

export interface LogEntry {
  type: string;
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  stack?: string;
}

export interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface CostMetrics {
  durationMs: number;
  durationSeconds: number;
  memorySizeMB: number;
  estimatedGBSeconds: number;
  estimatedCostUSD: number;
  breakdown: {
    computeCost: number;
    requestCost: number;
    s3PutCost: number;
    totalCost: number;
  };
}

export interface ProgressData {
  requestId: string;
  timestamp: string;
  request: RequestData;
  response: {
    status: string;
    bucket?: string;
    key?: string;
    s3Url?: string;
    hasErrors: boolean;
    errorCount: number;
  };
  metrics: CostMetrics;
}

export interface PdfResult extends LambdaResponse {
  pdfBuffer?: Buffer;
}

export interface AuthResult {
  valid: boolean;
  response?: LambdaResponse;
}

export interface ParseResult {
  success: boolean;
  data?: RequestData;
  response?: LambdaResponse;
}

export interface LambdaEvent {
  httpMethod?: string;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface ErrorCollection {
  pageErrors: LogEntry[];
  consoleMessages: LogEntry[];
}