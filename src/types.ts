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

export interface RequestData {
  url?: string;
  data?: Record<string, unknown>;
  options?: PdfOptions;
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