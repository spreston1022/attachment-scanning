// Builds demo/fixtures/customers.xlsx: a minimal workbook with fake PII.
import { writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";

const rows = [
  ["Name", "Card number", "IBAN", "Balance"],
  ["Tamar Lomidze", "4111 1111 1111 1111", "GE29NB0000000101904917", "12500"],
  ["Levan Chkheidze", "5500 0000 0000 0004", "DE89 3704 0044 0532 0130 00", "830"],
];
const strings = [...new Set(rows.flat().filter((v) => isNaN(Number(v))))];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const col = (i) => String.fromCharCode(65 + i);

const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
  .map(
    (r, ri) =>
      `<row r="${ri + 1}">${r
        .map((v, ci) =>
          isNaN(Number(v))
            ? `<c r="${col(ci)}${ri + 1}" t="s"><v>${strings.indexOf(v)}</v></c>`
            : `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`,
        )
        .join("")}</row>`,
  )
  .join("")}</sheetData></worksheet>`;

const files = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Customers" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  "xl/worksheets/sheet1.xml": sheet,
  "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
    .map((s) => `<si><t>${esc(s)}</t></si>`)
    .join("")}</sst>`,
};

const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
writeFileSync(new URL("./fixtures/customers.xlsx", import.meta.url), zip);
console.log("wrote demo/fixtures/customers.xlsx");
