const fs = require("fs");
const path = require("path");

const apps = [
  ["home", "https://imageprivacy.org/"],
  ["exif", "https://exif.imageprivacy.org/"],
  ["watermark", "https://watermark.imageprivacy.org/"],
  ["redact", "https://redact.imageprivacy.org/"],
  ["resize", "https://resize.imageprivacy.org/"],
  ["compress", "https://compress.imageprivacy.org/"],
  ["convert", "https://convert.imageprivacy.org/"]
];

const requiredFiles = ["index.html", "robots.txt", "sitemap.xml", "ads.txt", "llms.txt", "vercel.json"];
let failures = 0;

for (const [name, canonical] of apps) {
  const root = path.join(__dirname, "..", "apps", name);
  for (const file of requiredFiles) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) {
      console.error(`[${name}] missing ${file}`);
      failures++;
    }
  }

  const htmlPath = path.join(root, "index.html");
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, "utf8");
    if (!html.includes(`<link rel="canonical" href="${canonical}`)) {
      console.error(`[${name}] missing expected canonical ${canonical}`);
      failures++;
    }
    if (!html.includes("application/ld+json")) {
      console.error(`[${name}] missing JSON-LD`);
      failures++;
    }
  }

  const robotsPath = path.join(root, "robots.txt");
  if (fs.existsSync(robotsPath)) {
    const robots = fs.readFileSync(robotsPath, "utf8");
    if (!robots.includes(`${canonical}sitemap.xml`)) {
      console.error(`[${name}] robots.txt missing sitemap for ${canonical}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}

console.log(`Static checks passed for ${apps.length} ImagePrivacy apps`);
