// Types for libs.js, a pre-built bundle of fflate and unpdf (see
// `npm run vendor`). Zuplo's Git build does not install npm dependencies, so
// the libraries ship as a vendored module.
export { strFromU8, unzipSync, type Unzipped } from "fflate";
export { extractText, getDocumentProxy } from "unpdf";
