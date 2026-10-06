// A .wasm import is a compiled WebAssembly module in the Workers runtime (and its build).
declare module "*.wasm" {
  const module: WebAssembly.Module
  export default module
}
