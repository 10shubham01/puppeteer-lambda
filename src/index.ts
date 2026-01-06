import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { generatePdfFromUrl } from "./pdf";

const s3 = new S3Client({ region: process.env.AWS_REGION ||'ap-south-1' });
const BUCKET_NAME = process.env.BUCKET_NAME||'my-nuxt-pdf-bucket';

export const handler = async (event: any) => {
  if (!event?.cdnUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "cdnUrl is required" }),
    };
  }

  const pdf = await generatePdfFromUrl(event.cdnUrl);
  const key = `pdfs/${Date.now()}.pdf`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: pdf,
      ContentType: "application/pdf",
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ s3Key: key }),
  };
};
