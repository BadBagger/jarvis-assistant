import { Document, HeadingLevel, Packer, Paragraph } from "docx";

/** Builds a simple .docx (title heading + one paragraph per non-empty line) and returns it as base64 bytes. */
export async function buildDocxBase64(title: string, content: string): Promise<string> {
  const paragraphs = content
    .split(/\n+/)
    .filter((line) => line.trim().length > 0)
    .map((line) => new Paragraph({ text: line }));

  const doc = new Document({
    sections: [
      {
        children: [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }), ...paragraphs],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const buffer = await blob.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
