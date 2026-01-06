import fs from "fs";
import path from "path";
import { generatePdfFromUrl } from "./pdf";

(async () => {
  const url = "https://shubhamgupta.dev/";
  const pdf = await generatePdfFromUrl(url);

  const out = path.join(process.cwd(), "dev-output.pdf");
  fs.writeFileSync(out, pdf);
  console.log("PDF saved to", out);
})();
