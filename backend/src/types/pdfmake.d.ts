declare module "pdfmake" {
  import { Readable } from "stream";

  export type TDocumentDefinitions = Record<string, unknown>;
  export type TFontDictionary = Record<
    string,
    {
      normal: string;
      bold?: string;
      italics?: string;
      bolditalics?: string;
    }
  >;

  export default class PdfPrinter {
    constructor(fonts: TFontDictionary);
    createPdfKitDocument(docDefinition: TDocumentDefinitions): Readable & { end(): void };
  }
}
