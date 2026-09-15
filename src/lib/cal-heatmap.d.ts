// cal-heatmap 4.2.4 omits its types from package exports and its bundled
// declaration does not export the ESM default. Describe the public API used here.
declare module "cal-heatmap" {
  type HeatmapOptions = {
    itemSelector: string;
    range: number;
    date: { start: Date; timezone: string };
    domain: { type: "month"; gutter: number; label: { text: string; position: "top" } };
    subDomain: { type: "ghDay"; width: number; height: number; gutter: number; radius: number };
    data: { source: { date: number; value: number }[]; x: "date"; y: "value" };
    scale: { color: { type: "threshold"; range: string[]; domain: number[] } };
    animationDuration: number;
  };
  export default class CalHeatmap {
    paint(options: HeatmapOptions): Promise<unknown>;
    destroy(): Promise<unknown>;
  }
}
