declare module "qrcode" {
  export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  export interface QRCodeOptions {
    errorCorrectionLevel?: ErrorCorrectionLevel;
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }

  export interface QRCode {
    version: number;
    modules: { size: number };
  }

  export function create(text: string, options?: QRCodeOptions): QRCode;

  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRCodeOptions,
  ): Promise<HTMLCanvasElement>;
}
