export type RenderingCheck = {
  readonly name: string;
  readonly pass: boolean;
  readonly expected: unknown;
  readonly actual: unknown;
};

export type RenderingResult = {
  readonly name: string;
  readonly checks: readonly RenderingCheck[];
};

declare global {
  var runRenderingContract:
    | ((options: {
        readonly deviceScaleFactor: number;
      }) => RenderingResult | Promise<RenderingResult>)
    | undefined;
}
