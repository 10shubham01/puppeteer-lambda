import chromium from "@sparticuz/chromium";
import puppeteerCore from "puppeteer-core";
import puppeteer from "puppeteer";

const isDev=true;
console.log(isDev);

export async function generatePdfFromUrl(url: string): Promise<Buffer> {
  const browser = isDev
    ? await puppeteer.launch({
        headless: true,
      })
    : await puppeteerCore.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto(url, {
    waitUntil: "networkidle0",
    timeout: 30000,
  });

  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
  });

  await browser.close();
  return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
}
