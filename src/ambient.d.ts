// Ambient type declarations so `tsc --checkJs` can type-check this plain-JS
// project without needing full @types packages for every dependency. This
// exists purely to support `npm run typecheck` (see package.json) - it has
// no effect on the actual app at runtime.
declare module "*.png" { const src: string; export default src; }
declare module "*.jpg" { const src: string; export default src; }
declare module "*.jpeg" { const src: string; export default src; }
declare module "html2canvas" { const html2canvas: any; export default html2canvas; }
declare module "jspdf" { const jsPDF: any; export default jsPDF; }
declare module "xlsx" { export function read(...args: any[]): any; export const utils: any; }
declare module "recharts" {
  export const BarChart: any; export const Bar: any; export const ComposedChart: any;
  export const Line: any; export const XAxis: any; export const YAxis: any;
  export const CartesianGrid: any; export const Tooltip: any; export const Legend: any;
  export const ResponsiveContainer: any; export const Cell: any;
}
declare module "@supabase/supabase-js" {
  export function createClient(...args: any[]): any;
}
declare module "react" {
  const React: any;
  export default React;
  export const useState: any;
  export const useEffect: any;
  export const useMemo: any;
  export const useCallback: any;
  export const useRef: any;
  export const StrictMode: any;
}
declare module "react-dom/client" {
  export function createRoot(...args: any[]): any;
}
declare namespace JSX {
  interface IntrinsicElements { [elemName: string]: any; }
  interface Element {}
}
interface ImportMetaEnv { [key: string]: any; }
interface ImportMeta { env: ImportMetaEnv; }
