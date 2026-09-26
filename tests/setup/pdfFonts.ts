import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

/** BaseFont names of every font in the PDF, sorted and de-duplicated. */
export async function pdfFontNames(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const names = new Set<string>();
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const baseFont = object.get(PDFName.of("BaseFont"));
    if (baseFont instanceof PDFName) names.add(baseFont.decodeText());
  }
  return [...names].sort();
}
