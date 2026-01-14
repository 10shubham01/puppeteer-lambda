# PDF Generator API

A serverless PDF generation service built on AWS Lambda using Puppeteer. Converts web pages to PDF with optional password protection.

## API Endpoint

```
POST https://3dmdmtn4ywqypnti7y463ei3rq0joaga.lambda-url.ap-south-1.on.aws/
```

## Authentication

All requests require an API key passed in the `x-api-key` header.

```
x-api-key: your-api-key
```

## Request Format

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Must be `application/json` |
| `x-api-key` | Yes | Your API key for authentication |

### Body Parameters

```json
{
  "pageUrl": "https://example.com",
  "inputProps": {},
  "pdfOptions": {},
  "s3BucketConfig": {},
  "security": {}
}
```

#### pageUrl (string, required)
The URL of the web page to convert to PDF.

#### inputProps (object, optional)
Custom data to inject into the page. Accessible in the browser via `window.__INJECTED_DATA__`.

```json
{
  "inputProps": {
    "userId": "123",
    "reportDate": "2026-01-14"
  }
}
```

#### pdfOptions (object, optional)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `waitUntil` | string | `networkidle0` | When to consider navigation complete. Options: `load`, `domcontentloaded`, `networkidle0`, `networkidle2` |
| `timeout` | number | `30000` | Navigation timeout in milliseconds |
| `waitTime` | number | - | Additional wait time after page load (ms) |
| `failOnErrors` | boolean | `false` | Fail if page has JavaScript errors |
| `includeConsoleLogs` | boolean | `false` | Include browser console logs in response |
| `pdfFormat` | string | `A4` | Page format. Options: `A4`, `Letter`, `Legal`, `Tabloid`, `A3`, `A5` |
| `printBackground` | boolean | `true` | Print background graphics |
| `landscape` | boolean | `false` | Use landscape orientation |
| `margin` | object | - | Page margins with `top`, `right`, `bottom`, `left` properties |

#### s3BucketConfig (object, optional)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `bucket` | string | `pdf-storage-1` | S3 bucket name |
| `key` | string | `pdfs` | S3 folder path |
| `fileName` | string | `page-{timestamp}.pdf` | PDF file name |

#### security (object, optional)

| Property | Type | Description |
|----------|------|-------------|
| `password` | string | Password to protect the PDF. Used for both opening and editing restrictions. |

## Response Format

### Success Response (200)

```json
{
  "message": "PDF generated successfully",
  "requestId": "req-1705234567890-abc1234",
  "bucket": "pdf-storage-1",
  "key": "pdfs/page-1705234567890.pdf",
  "s3Url": "https://pdf-storage-1.s3.amazonaws.com/pdfs/page-1705234567890.pdf",
  "security": {
    "requested": true,
    "applied": true
  },
  "metrics": {
    "durationMs": 3500,
    "totalCostUSD": 0.0000584
  }
}
```

### Error Responses

#### 400 Bad Request
Invalid JSON or invalid URL provided.

```json
{
  "message": "Invalid URL provided"
}
```

#### 401 Unauthorized
Missing or invalid API key.

```json
{
  "message": "Unauthorized. Valid API key required."
}
```

#### 405 Method Not Allowed
Only POST requests are accepted.

```json
{
  "message": "Method Not Allowed. Only POST requests are accepted."
}
```

#### 502 Bad Gateway
Failed to load the target page.

```json
{
  "message": "Failed to load the page",
  "status": 404,
  "statusText": "Not Found"
}
```

#### 500 Internal Server Error
Server-side error during PDF generation.

```json
{
  "message": "Failed to generate or upload PDF",
  "error": "Error details"
}
```

## Examples

### Basic Request

```bash
curl -X POST https://3dmdmtn4ywqypnti7y463ei3rq0joaga.lambda-url.ap-south-1.on.aws/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{"pageUrl": "https://example.com"}'
```

### With Custom Options

```bash
curl -X POST https://3dmdmtn4ywqypnti7y463ei3rq0joaga.lambda-url.ap-south-1.on.aws/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "pageUrl": "https://example.com",
    "pdfOptions": {
      "pdfFormat": "Letter",
      "landscape": true,
      "printBackground": true,
      "margin": {
        "top": "20mm",
        "bottom": "20mm",
        "left": "15mm",
        "right": "15mm"
      }
    }
  }'
```

### With Data Injection

```bash
curl -X POST https://3dmdmtn4ywqypnti7y463ei3rq0joaga.lambda-url.ap-south-1.on.aws/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "pageUrl": "https://your-app.com/report",
    "inputProps": {
      "userId": "12345",
      "reportType": "monthly",
      "date": "2026-01-14"
    }
  }'
```

In your web page, access the injected data:

```javascript
const data = window.__INJECTED_DATA__;
console.log(data.userId); // "12345"
```

### With Password Protection

```bash
curl -X POST https://3dmdmtn4ywqypnti7y463ei3rq0joaga.lambda-url.ap-south-1.on.aws/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "pageUrl": "https://example.com",
    "security": {
      "password": "secret123"
    }
  }'
```

### With Custom S3 Location

```bash
curl -X POST https://3dmdmtn4ywqypnti7y463ei3rq0joaga.lambda-url.ap-south-1.on.aws/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "pageUrl": "https://example.com",
    "s3BucketConfig": {
      "bucket": "my-bucket",
      "key": "reports/2026/january",
      "fileName": "monthly-report.pdf"
    }
  }'
```

### Full Request Example

```bash
curl -X POST https://3dmdmtn4ywqypnti7y463ei3rq0joaga.lambda-url.ap-south-1.on.aws/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "pageUrl": "https://example.com",
    "inputProps": {
      "customField": "value"
    },
    "pdfOptions": {
      "pdfFormat": "A4",
      "printBackground": true,
      "waitUntil": "networkidle0",
      "timeout": 30000,
      "waitTime": 1000,
      "includeConsoleLogs": false
    },
    "s3BucketConfig": {
      "bucket": "pdf-storage-1",
      "key": "reports",
      "fileName": "report.pdf"
    },
    "security": {
      "password": "secret123"
    }
  }'
```

## Progress Tracking

Each successful request creates a `progress.json` file in the same S3 folder as the PDF. This file contains:

```json
{
  "requestId": "req-1705234567890-abc1234",
  "timestamp": "2026-01-14T10:30:00.000Z",
  "request": {
    "pageUrl": "https://example.com",
    "inputProps": {},
    "pdfOptions": {},
    "s3BucketConfig": {}
  },
  "response": {
    "status": "success",
    "bucket": "pdf-storage-1",
    "key": "pdfs/report.pdf",
    "s3Url": "https://pdf-storage-1.s3.amazonaws.com/pdfs/report.pdf",
    "hasErrors": false,
    "errorCount": 0
  },
  "security": {
    "requested": true,
    "applied": true
  },
  "metrics": {
    "durationMs": 3500,
    "totalCostUSD": 0.0000584
  }
}
```

## Cost Estimation

The API returns estimated Lambda execution cost per request in the `metrics.totalCostUSD` field. This includes:

- Lambda compute time (based on memory and duration)
- Lambda request cost
- S3 PUT operation cost

Typical costs range from $0.00005 to $0.0002 per PDF depending on page complexity and load time.

## Local Development

### Setup

```bash
npm install
```

### Run Dev Server

```bash
npm run dev
```

This starts a local server at `http://localhost:3000` that mimics the Lambda behavior. PDFs are returned directly instead of being uploaded to S3.

### Build

```bash
npm run build
```

### Deploy

```bash
npm run deploy
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_KEY` | API key for authentication | Required |
| `AWS_REGION` | AWS region | `ap-south-1` |
| `PDF_BUCKET` | Default S3 bucket | `pdf-storage-1` |
| `SKIP_S3` | Skip S3 upload (dev only) | `false` |

## License

ISC
